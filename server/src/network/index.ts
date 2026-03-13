import type Database from 'better-sqlite3';
import crypto, { createHash } from 'crypto';
import { getIdentity } from '../identity.js';
import { createBeepBotNode, getListenAddrs, type BeepBotNode, type NodeConfig } from './node.js';
import { PeerStore, type Peer } from './peer-store.js';
import { DiscoveryManager, type AgentCard } from './discovery.js';
import { DistributedLedger, type LedgerAction, type LedgerEntry } from './ledger.js';
import { MerkleAnchorManager, type MerkleAnchor } from './merkle-anchor.js';
import { GossipRouter } from './gossip.js';
import { ReputationManager, type ReputationChange } from './reputation.js';
import { TaskRelay, type NetworkTask } from './task-relay.js';
import { UpdateManager, type StoredUpdate } from './updates.js';
import { Economy, type TokenBalance } from './economy.js';
import { Marketplace, type Improvement } from './marketplace.js';
import {
  TOPIC_HILL, TOPIC_TASKS, TOPIC_LEDGER, TOPIC_UPDATES, TOPIC_ANCHORS,
  TOPIC_REVIEWS, TOPIC_ECONOMY,
  createGossipEnvelope, verifyGossipEnvelope,
  type GossipEnvelope,
  type HillChatPayload,
  type UpdateAnnouncePayload,
  type UpdateAppliedPayload,
  type LedgerEventPayload,
  type MerkleAnchorPayload,
  type RewardClaimPayload,
  type RewardAckPayload,
  type TokenTransferPayload,
  type ImprovementReviewPayload,
} from './protocols.js';

export class NetworkManager {
  readonly peerStore: PeerStore;
  readonly ledger: DistributedLedger;
  readonly reputation: ReputationManager;
  readonly taskRelay: TaskRelay;
  readonly updates: UpdateManager;
  readonly economy: Economy;
  readonly marketplace: Marketplace;

  // These are set during start()
  discovery!: DiscoveryManager;
  anchors!: MerkleAnchorManager;
  gossip!: GossipRouter;

  private node: BeepBotNode | null = null;
  private broadcast: ((data: Record<string, unknown>) => void) | null = null;
  private running = false;
  private nodeConfig: Partial<NodeConfig>;

  constructor(private db: Database.Database, config: Partial<NodeConfig>, projectRoot?: string) {
    this.nodeConfig = config;
    this.peerStore = new PeerStore(db);
    this.reputation = new ReputationManager(this.peerStore);
    this.ledger = new DistributedLedger(db, null, this.peerStore);
    this.taskRelay = new TaskRelay(db, null, this.peerStore);
    this.updates = new UpdateManager(db, projectRoot || process.cwd());
    this.economy = new Economy(db, null, this.ledger, this.peerStore);
    this.marketplace = new Marketplace(db, null, this.ledger, this.peerStore, this.economy);
  }

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcast = fn;
    this.reputation.setBroadcast(fn);
    this.taskRelay.setBroadcast(fn);
    this.updates.setBroadcast(fn);
    this.economy.setBroadcast(fn);
    this.marketplace.setBroadcast(fn);
  }

  async start(): Promise<void> {
    if (this.running) return;

    const identity = getIdentity();

    // 1. Create libp2p node
    this.node = await createBeepBotNode(this.nodeConfig);
    await this.node.start();

    // 2. Initialize GossipSub router
    this.gossip = new GossipRouter(this.node);
    this.ledger.setGossip(this.gossip);
    this.taskRelay.setGossip(this.gossip);
    this.economy.setGossip(this.gossip);
    this.marketplace.setGossip(this.gossip);

    // 3. Initialize discovery
    this.discovery = new DiscoveryManager(this.node, this.peerStore, this.db);
    if (this.broadcast) this.discovery.setBroadcast(this.broadcast);

    // 4. Initialize Merkle anchoring
    this.anchors = new MerkleAnchorManager(
      this.db, this.node, this.gossip, this.ledger, this.reputation, this.peerStore,
    );
    if (this.broadcast) this.anchors.setBroadcast(this.broadcast);

    // 5. Wire up GossipSub handlers
    this.gossip.on(TOPIC_LEDGER, (envelope) => {
      this.ledger.receiveRemoteEvent(envelope as GossipEnvelope<LedgerEventPayload>);
    });

    this.gossip.on(TOPIC_TASKS, (envelope) => {
      this.taskRelay.handleTaskGossip(envelope);
    });

    this.gossip.on(TOPIC_HILL, (envelope) => {
      this.handleHillChatGossip(envelope);
    });

    this.gossip.on(TOPIC_UPDATES, (envelope) => {
      this.handleUpdateGossip(envelope);
    });

    this.gossip.on(TOPIC_ANCHORS, (envelope) => {
      this.anchors.handleAnchorAnnouncement(envelope as GossipEnvelope<MerkleAnchorPayload>);
    });

    this.gossip.on(TOPIC_ECONOMY, (envelope) => {
      this.handleEconomyGossip(envelope);
    });

    this.gossip.on(TOPIC_REVIEWS, (envelope) => {
      this.marketplace.handleReviewGossip(envelope as GossipEnvelope<ImprovementReviewPayload>);
    });

    // 6. Start all systems
    await this.gossip.start();
    await this.discovery.start();
    this.anchors.start();

    // 7. Record genesis in ledger (if first time)
    if (this.ledger.getLocalSequence() === 0) {
      this.ledger.append('GENESIS', JSON.stringify({
        botId: identity.botId,
        publicKey: identity.publicKey,
        peerId: this.node.peerId.toString(),
      }));
    }

    this.running = true;

    const addrs = getListenAddrs(this.node);
    console.log(`[network] Network started — ${identity.shortId} (${this.node.peerId.toString()})`);
    console.log(`[network] Listening on: ${addrs.join(', ')}`);
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.economy.stop();
    this.anchors.stop();
    this.gossip.stop();
    this.discovery.stop();

    if (this.node) {
      await this.node.stop();
      this.node = null;
    }

    this.running = false;
    console.log('[network] Network stopped');
  }

  /** Connect to a peer by multiaddr */
  async connectToPeer(multiaddr: string): Promise<void> {
    await this.discovery.connectToPeer(multiaddr);
    // Peer connections are not recorded in the PoUW ledger (proofs only)
  }

  /** Disconnect from a peer */
  disconnectPeer(botId: string): void {
    const peer = this.peerStore.get(botId);
    if (peer?.peerId && this.node) {
      const { peerIdFromString } = require('@libp2p/peer-id');
      try {
        const pid = peerIdFromString(peer.peerId);
        this.node.hangUp(pid).catch(() => {});
      } catch { /* ignore */ }
    }
    // Peer disconnections are not recorded in the PoUW ledger (proofs only)
  }

  /** Submit a task to the network */
  submitTask(description: string): NetworkTask {
    const identity = getIdentity();
    const task = this.taskRelay.createTask(description, identity.botId);
    // Task submissions are tracked in network_tasks, not the PoUW ledger
    return task;
  }

  /** Record an action in the ledger */
  recordAction(action: LedgerAction, data: string, metadata?: Record<string, unknown>): void {
    const entry = this.ledger.append(action, data, metadata);
    if (this.broadcast) {
      this.broadcast({ type: 'chain_entry', data: entry });
    }
  }

  /** Send a Hill chat message */
  sendHillChat(content: string, displayName?: string): HillChatPayload {
    const identity = getIdentity();
    const payload: HillChatPayload = {
      id: crypto.randomUUID(),
      senderBotId: identity.botId,
      senderShortId: identity.shortId,
      displayName,
      content,
      timestamp: Date.now(),
    };

    // Store locally
    this.db.prepare(
      'INSERT INTO hill_messages (id, sender_bot_id, sender_short_id, display_name, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(payload.id, payload.senderBotId, payload.senderShortId, payload.displayName ?? null, payload.content, payload.timestamp);

    // Broadcast via GossipSub
    if (this.gossip) {
      const envelope = createGossipEnvelope('HILL_CHAT', payload);
      this.gossip.publish(TOPIC_HILL, envelope).catch(() => {});
    }

    // Record proof of hill service (hash of the message, not the content)
    this.ledger.append('PROOF_HILL_SERVICE', payload.content, {
      messageId: payload.id,
      to: 'hill',
    });

    if (this.broadcast) {
      this.broadcast({ type: 'hill_chat', data: payload });
    }

    return payload;
  }

  /** Get Hill messages */
  getHillMessages(limit = 100): HillChatPayload[] {
    const rows = this.db.prepare(
      'SELECT id, sender_bot_id, sender_short_id, display_name, content, timestamp FROM hill_messages ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as Array<{ id: string; sender_bot_id: string; sender_short_id: string; display_name: string | null; content: string; timestamp: number }>;

    return rows.reverse().map(r => ({
      id: r.id,
      senderBotId: r.sender_bot_id,
      senderShortId: r.sender_short_id,
      ...(r.display_name ? { displayName: r.display_name } : {}),
      content: r.content,
      timestamp: r.timestamp,
    }));
  }

  /** Get unread Hill messages */
  getHillUnread(botId?: string): HillChatPayload[] {
    const id = botId ?? getIdentity().botId;
    const readState = this.db.prepare(
      'SELECT last_read_timestamp FROM hill_read_state WHERE bot_id = ?'
    ).get(id) as { last_read_timestamp: number } | undefined;

    const lastRead = readState?.last_read_timestamp ?? 0;

    const rows = this.db.prepare(
      'SELECT id, sender_bot_id, sender_short_id, display_name, content, timestamp FROM hill_messages WHERE timestamp > ? ORDER BY timestamp ASC'
    ).all(lastRead) as Array<{ id: string; sender_bot_id: string; sender_short_id: string; display_name: string | null; content: string; timestamp: number }>;

    return rows.map(r => ({
      id: r.id,
      senderBotId: r.sender_bot_id,
      senderShortId: r.sender_short_id,
      ...(r.display_name ? { displayName: r.display_name } : {}),
      content: r.content,
      timestamp: r.timestamp,
    }));
  }

  /** Get unread count */
  getHillUnreadCount(botId?: string): number {
    const id = botId ?? getIdentity().botId;
    const readState = this.db.prepare(
      'SELECT last_read_timestamp FROM hill_read_state WHERE bot_id = ?'
    ).get(id) as { last_read_timestamp: number } | undefined;
    const lastRead = readState?.last_read_timestamp ?? 0;
    return (this.db.prepare('SELECT COUNT(*) as cnt FROM hill_messages WHERE timestamp > ?').get(lastRead) as { cnt: number }).cnt;
  }

  /** Ack Hill messages */
  ackHillMessages(timestamp: number, botId?: string): void {
    const id = botId ?? getIdentity().botId;
    this.db.prepare(
      'INSERT INTO hill_read_state (bot_id, last_read_timestamp) VALUES (?, ?) ON CONFLICT(bot_id) DO UPDATE SET last_read_timestamp = excluded.last_read_timestamp'
    ).run(id, timestamp);
  }

  /** Announce an update */
  announceUpdate(description: string): UpdateAnnouncePayload | null {
    const payload = this.updates.createUpdate(description);
    if (!payload) return null;

    if (this.gossip) {
      const envelope = createGossipEnvelope('UPDATE_ANNOUNCE', payload);
      this.gossip.publish(TOPIC_UPDATES, envelope).catch(() => {});
    }

    this.ledger.append('PROOF_IMPROVEMENT_PUBLISH', JSON.stringify({ id: payload.updateId, description }));
    return payload;
  }

  /** Request update files from a peer (via direct stream in future; for now stored locally) */
  requestUpdate(updateId: string): void {
    // For now, updates are announced with changed file info
    // Full file transfer via libp2p streams would be added here
    console.log(`[network] Update request: ${updateId} (file transfer via streams not yet implemented)`);
  }

  /** Get network stats */
  getStats(): Record<string, unknown> {
    const identity = getIdentity();
    return {
      running: this.running,
      identity,
      peerId: this.node?.peerId.toString() ?? null,
      listenAddrs: this.node ? getListenAddrs(this.node) : [],
      connectedPeers: this.node?.getConnections().length ?? 0,
      knownPeers: this.peerStore.list().length,
      chainLength: this.ledger.length(),
      localChainLength: this.ledger.localLength(),
      chainHead: this.ledger.getLocalHead(),
      tasks: this.taskRelay.stats(),
      bootstrapPeers: this.discovery?.getBootstrapPeers() ?? [],
      gossipTopics: this.gossip?.getStats() ?? null,
      p2pPort: this.nodeConfig.listenPort ?? 3005,
    };
  }

  /** Backward compat: hashChain proxy */
  get hashChain() {
    const ledger = this.ledger;
    return {
      recent: (limit?: number) => ledger.recent(limit),
      verifyIntegrity: () => ledger.verifyIntegrity(),
      length: () => ledger.localLength(),
      getHead: () => ledger.getLocalHead(),
      append: (action: LedgerAction, data: string, metadata?: Record<string, unknown>) => ledger.append(action, data, metadata),
      get: (idx: number) => ledger.get(idx),
      getRange: (from: number, to?: number) => ledger.getRange(from, to),
      verifyEntry: (idx: number) => {
        const entry = ledger.get(idx);
        return entry !== null;
      },
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  getNode(): BeepBotNode | null {
    return this.node;
  }

  // --- Private handlers ---

  private handleHillChatGossip(envelope: GossipEnvelope): void {
    const payload = envelope.payload as HillChatPayload;
    const identity = getIdentity();
    if (payload.senderBotId === identity.botId) return;

    const peer = this.peerStore.get(envelope.senderId);
    if (peer && !verifyGossipEnvelope(envelope, peer.publicKey)) return;

    // Deduplicate
    const existing = this.db.prepare('SELECT id FROM hill_messages WHERE id = ?').get(payload.id);
    if (existing) return;

    this.db.prepare(
      'INSERT INTO hill_messages (id, sender_bot_id, sender_short_id, display_name, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(payload.id, payload.senderBotId, payload.senderShortId, payload.displayName ?? null, payload.content, payload.timestamp);

    if (this.broadcast) {
      this.broadcast({ type: 'hill_chat', data: payload });
    }

    console.log(`[hill] Message from ${payload.senderShortId}: ${payload.content.slice(0, 80)}`);
  }

  private handleEconomyGossip(envelope: GossipEnvelope): void {
    switch (envelope.type) {
      case 'REWARD_CLAIM':
        this.economy.handleRewardClaim(envelope as GossipEnvelope<RewardClaimPayload>);
        break;
      case 'REWARD_ACK':
        this.economy.handleRewardAck(envelope as GossipEnvelope<RewardAckPayload>);
        break;
      case 'TOKEN_TRANSFER':
        this.economy.handleTokenTransfer(envelope as GossipEnvelope<TokenTransferPayload>);
        break;
    }
  }

  private handleUpdateGossip(envelope: GossipEnvelope): void {
    const peer = this.peerStore.get(envelope.senderId);
    if (peer && !verifyGossipEnvelope(envelope, peer.publicKey)) return;

    switch (envelope.type) {
      case 'UPDATE_ANNOUNCE': {
        const payload = envelope.payload as UpdateAnnouncePayload;
        this.updates.handleUpdateAnnounce(payload, envelope.signature);
        break;
      }
      case 'UPDATE_APPLIED': {
        const payload = envelope.payload as UpdateAppliedPayload;
        console.log(`[updates] Peer ${envelope.senderShortId} applied update ${payload.updateId}`);
        if (this.broadcast) {
          this.broadcast({ type: 'update_applied_by_peer', data: payload });
        }
        break;
      }
    }
  }
}

// Re-exports
export { PeerStore, type Peer } from './peer-store.js';
export { DistributedLedger, type LedgerEntry, type LedgerAction } from './ledger.js';
export { ReputationManager, type ReputationChange } from './reputation.js';
export { TaskRelay, type NetworkTask } from './task-relay.js';
export { DiscoveryManager, type AgentCard } from './discovery.js';
export { MerkleAnchorManager, type MerkleAnchor } from './merkle-anchor.js';
export { GossipRouter } from './gossip.js';
export { UpdateManager, type StoredUpdate } from './updates.js';
export { Economy, type TokenBalance } from './economy.js';
export { Marketplace, type Improvement } from './marketplace.js';
export { type BeepBotNode, type NodeConfig } from './node.js';
