import type Database from 'better-sqlite3';
import { getIdentity } from '../identity.js';
import { PeerStore } from './peer.js';
import { Transport, type PeerConnection } from './transport.js';
import { Discovery } from './discovery.js';
import { HashChain, type ChainAction } from './hash-chain.js';
import { ReputationManager } from './reputation.js';
import { TaskRelay, type NetworkTask } from './task-relay.js';
import crypto from 'crypto';
import {
  createMessage,
  verifyMessage,
  type NetworkMessage,
  type TaskSubmitPayload,
  type TaskClaimPayload,
  type TaskResultPayload,
  type VerifyRequestPayload,
  type VerifyResponsePayload,
  type StakeAnnouncePayload,
  type ChainSyncPayload,
  type ChainEntriesPayload,
  type HillChatPayload,
  type UpdateAnnouncePayload,
  type UpdateRequestPayload,
  type UpdateResponsePayload,
  type UpdateAppliedPayload,
} from './protocol.js';
import { UpdateManager } from './updates.js';

export class NetworkManager {
  readonly peerStore: PeerStore;
  readonly transport: Transport;
  readonly discovery: Discovery;
  readonly hashChain: HashChain;
  readonly reputation: ReputationManager;
  readonly taskRelay: TaskRelay;
  readonly updates: UpdateManager;

  private broadcast: ((data: Record<string, unknown>) => void) | null = null;
  private running = false;

  constructor(private db: Database.Database, p2pPort: number, projectRoot?: string) {
    this.peerStore = new PeerStore(db);
    this.transport = new Transport(p2pPort);
    this.hashChain = new HashChain(db);
    this.reputation = new ReputationManager(this.peerStore);
    this.taskRelay = new TaskRelay(db);
    this.updates = new UpdateManager(db, projectRoot || process.cwd());
    this.discovery = new Discovery(db, this.peerStore, this.transport, this.reputation);

    // Wire up message handling
    this.transport.on('message', (msg: NetworkMessage, conn: PeerConnection) => {
      this.handleMessage(msg, conn);
    });

    this.transport.on('incoming', (conn: PeerConnection) => {
      // New incoming connection — wait for HELLO
    });

    this.transport.on('disconnected', (conn: PeerConnection) => {
      if (conn.botId && this.broadcast) {
        this.broadcast({ type: 'peer_disconnected', data: { botId: conn.botId } });
      }
    });
  }

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcast = fn;
    this.discovery.setBroadcast(fn);
    this.reputation.setBroadcast(fn);
    this.taskRelay.setBroadcast(fn);
    this.updates.setBroadcast(fn);
  }

  /** Start the network */
  async start(): Promise<void> {
    if (this.running) return;

    // Record identity init in hash chain
    const identity = getIdentity();
    this.hashChain.append('IDENTITY_INIT', JSON.stringify({
      botId: identity.botId,
      publicKey: identity.publicKey,
    }));

    // Start transport
    await this.transport.start();

    // Start discovery
    await this.discovery.start();

    this.running = true;
    console.log(`[network] Network started — ${identity.shortId} listening on port ${this.transport.getPort()}`);

    // Auto-reconnect to known peers after a short delay to let the server bind
    setTimeout(() => {
      this.reconnectKnownPeers();
    }, 3000);
  }

  /** Stop the network */
  stop(): void {
    if (!this.running) return;

    // Send DISCONNECT to all peers
    const msg = createMessage('DISCONNECT', {});
    this.transport.broadcastToAll(msg);

    this.discovery.stop();
    this.transport.stop();
    this.running = false;
    console.log('[network] Network stopped');
  }

  /** Connect to a peer manually */
  async connectToPeer(host: string, port: number): Promise<void> {
    const conn = await this.transport.connect(host, port);
    this.discovery.sendHello(conn);
    this.hashChain.append('PEER_CONNECT', `${host}:${port}`);
  }

  /** Reconnect to previously known peers from the database */
  private async reconnectKnownPeers(): Promise<void> {
    const peers = this.peerStore.list().filter(p => p.host && p.port);
    if (peers.length === 0) return;

    console.log(`[network] Attempting to reconnect to ${peers.length} known peer(s)...`);

    for (const peer of peers) {
      try {
        await this.connectToPeer(peer.host, peer.port);
        console.log(`[network] Reconnected to ${peer.shortId} (${peer.host}:${peer.port})`);
      } catch (err) {
        console.log(`[network] Could not reach ${peer.shortId} (${peer.host}:${peer.port}): ${(err as Error).message}`);
      }
    }
  }

  /** Disconnect from a peer */
  disconnectPeer(botId: string): void {
    const msg = createMessage('DISCONNECT', {});
    this.transport.send(botId, msg);
    this.transport.disconnect(botId);
    this.hashChain.append('PEER_DISCONNECT', botId);
  }

  /** Submit a task to the network */
  submitTask(description: string): NetworkTask {
    const identity = getIdentity();
    const task = this.taskRelay.createTask(description, identity.botId);

    // Broadcast to network
    const msg = createMessage('TASK_SUBMIT', {
      id: task.id,
      description: task.description,
      requesterBotId: task.requesterBotId,
    } satisfies TaskSubmitPayload);
    this.transport.broadcastToAll(msg);

    this.hashChain.append('TASK_SUBMIT', JSON.stringify({ taskId: task.id, description }));

    return task;
  }

  /** Record an action in the hash chain (for external use) */
  recordAction(action: ChainAction, data: string, metadata?: Record<string, unknown>): void {
    const entry = this.hashChain.append(action, data, metadata);
    if (this.broadcast) {
      this.broadcast({ type: 'chain_entry', data: entry });
    }
  }

  /** Get network stats */
  getStats(): Record<string, unknown> {
    return {
      running: this.running,
      identity: getIdentity(),
      connections: this.transport.getConnectionCount(),
      knownPeers: this.peerStore.list().length,
      chainLength: this.hashChain.length(),
      chainHead: this.hashChain.getHead(),
      tasks: this.taskRelay.stats(),
      seedPeers: this.discovery.getSeedPeers(),
      p2pPort: this.transport.getPort(),
    };
  }

  /** Check if network is running */
  isRunning(): boolean {
    return this.running;
  }

  // --- Message Handler ---

  private handleMessage(msg: NetworkMessage, conn: PeerConnection): void {
    switch (msg.type) {
      case 'HELLO':
      case 'HELLO_ACK':
        this.discovery.handleHello(msg, conn);
        break;

      case 'PEER_REQUEST':
        this.handlePeerRequest(conn);
        break;

      case 'PEER_LIST':
        this.discovery.handlePeerList(msg);
        break;

      case 'PING':
        this.handlePing(msg, conn);
        break;

      case 'PONG':
        this.discovery.handlePong(msg);
        break;

      case 'TASK_SUBMIT':
        this.handleTaskSubmit(msg);
        break;

      case 'TASK_CLAIM':
        this.handleTaskClaim(msg);
        break;

      case 'TASK_RESULT':
        this.handleTaskResult(msg);
        break;

      case 'VERIFY_REQUEST':
        this.handleVerifyRequest(msg, conn);
        break;

      case 'VERIFY_RESPONSE':
        this.handleVerifyResponse(msg);
        break;

      case 'STAKE_ANNOUNCE':
        this.handleStakeAnnounce(msg);
        break;

      case 'CHAIN_SYNC':
        this.handleChainSync(msg, conn);
        break;

      case 'HILL_CHAT':
        this.handleHillChat(msg);
        break;

      case 'CHAIN_ENTRIES':
        // Future: handle incoming chain entries for cross-verification
        break;

      case 'UPDATE_ANNOUNCE':
        this.handleUpdateAnnounce(msg);
        break;

      case 'UPDATE_REQUEST':
        this.handleUpdateRequest(msg, conn);
        break;

      case 'UPDATE_RESPONSE':
        this.handleUpdateResponse(msg);
        break;

      case 'UPDATE_APPLIED':
        this.handleUpdateApplied(msg);
        break;

      case 'DISCONNECT':
        this.handleDisconnect(msg, conn);
        break;

      default:
        console.warn(`[network] Unknown message type: ${msg.type}`);
    }
  }

  private handlePeerRequest(conn: PeerConnection): void {
    const peers = this.peerStore.list().map(p => ({
      botId: p.botId,
      shortId: p.shortId,
      publicKey: p.publicKey,
      host: p.host,
      port: p.port,
      reputation: p.reputation,
    }));

    const msg = createMessage('PEER_LIST', { peers });
    const key = conn.botId || `${conn.host}:${conn.port}`;
    this.transport.send(key, msg);
  }

  private handlePing(msg: NetworkMessage, conn: PeerConnection): void {
    const pong = createMessage('PONG', {});
    const key = conn.botId || `${conn.host}:${conn.port}`;
    this.transport.send(key, pong);
    if (conn.botId) {
      this.peerStore.touch(conn.botId);
    }
  }

  private handleTaskSubmit(msg: NetworkMessage): void {
    const payload = msg.payload as TaskSubmitPayload;

    // Verify sender
    const peer = this.peerStore.get(msg.senderId);
    if (!peer || !verifyMessage(msg, peer.publicKey)) return;

    // Store the task locally
    this.taskRelay.createTask(payload.description, payload.requesterBotId);

    if (this.broadcast) {
      this.broadcast({ type: 'task_received', data: payload });
    }
  }

  private handleTaskClaim(msg: NetworkMessage): void {
    const payload = msg.payload as TaskClaimPayload;
    const peer = this.peerStore.get(msg.senderId);
    if (!peer || !verifyMessage(msg, peer.publicKey)) return;

    this.taskRelay.claimTask(payload.taskId, payload.claimerBotId);
  }

  private handleTaskResult(msg: NetworkMessage): void {
    const payload = msg.payload as TaskResultPayload;
    const peer = this.peerStore.get(msg.senderId);
    if (!peer || !verifyMessage(msg, peer.publicKey)) return;

    // Verify the result signature
    const verified = this.taskRelay.verifyResult(payload.taskId, peer.publicKey);
    if (verified) {
      this.taskRelay.markVerified(payload.taskId);
      this.reputation.taskCompleted(msg.senderId);
      this.hashChain.append('TASK_COMPLETE', JSON.stringify({ taskId: payload.taskId, claimer: msg.senderId }));
    } else {
      this.reputation.verifyFailed(msg.senderId);
    }
  }

  private handleVerifyRequest(msg: NetworkMessage, conn: PeerConnection): void {
    const payload = msg.payload as VerifyRequestPayload;

    const valid = this.hashChain.verifyEntry(payload.chainIndex);
    const entry = this.hashChain.get(payload.chainIndex);

    const response = createMessage('VERIFY_RESPONSE', {
      chainIndex: payload.chainIndex,
      valid,
      hash: entry?.hash ?? '',
    } satisfies VerifyResponsePayload);

    const key = conn.botId || `${conn.host}:${conn.port}`;
    this.transport.send(key, response);
  }

  private handleVerifyResponse(msg: NetworkMessage): void {
    const payload = msg.payload as VerifyResponsePayload;

    if (payload.valid) {
      this.reputation.verifySuccess(msg.senderId);
    } else {
      this.reputation.verifyFailed(msg.senderId);
    }

    if (this.broadcast) {
      this.broadcast({ type: 'verify_result', data: { peerId: msg.senderId, ...payload } });
    }
  }

  private handleStakeAnnounce(msg: NetworkMessage): void {
    const payload = msg.payload as StakeAnnouncePayload;
    const peer = this.peerStore.get(msg.senderId);
    if (!peer) return;

    if (this.broadcast) {
      this.broadcast({ type: 'stake_announce', data: payload });
    }
  }

  private handleChainSync(msg: NetworkMessage, conn: PeerConnection): void {
    const payload = msg.payload as ChainSyncPayload;
    const entries = this.hashChain.getRange(payload.fromIndex, payload.toIndex);

    const response = createMessage('CHAIN_ENTRIES', {
      entries: entries.map(e => ({
        idx: e.idx,
        timestamp: e.timestamp,
        action: e.action,
        dataHash: e.dataHash,
        previousHash: e.previousHash,
        hash: e.hash,
      })),
    } satisfies ChainEntriesPayload);

    const key = conn.botId || `${conn.host}:${conn.port}`;
    this.transport.send(key, response);
  }

  /** Send a chat message to The Hill (broadcast to all peers) */
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

    // Broadcast to all peers
    const msg = createMessage('HILL_CHAT', payload);
    this.transport.broadcastToAll(msg);

    // Record in hash chain
    this.hashChain.append('CHAT', JSON.stringify({ id: payload.id, to: 'hill' }));

    // Notify dashboard via WebSocket
    if (this.broadcast) {
      this.broadcast({ type: 'hill_chat', data: payload });
    }

    return payload;
  }

  /** Get unread hill chat messages (after last ack) */
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

  /** Acknowledge hill messages up to a given timestamp */
  ackHillMessages(timestamp: number, botId?: string): void {
    const id = botId ?? getIdentity().botId;
    this.db.prepare(
      'INSERT INTO hill_read_state (bot_id, last_read_timestamp) VALUES (?, ?) ON CONFLICT(bot_id) DO UPDATE SET last_read_timestamp = excluded.last_read_timestamp'
    ).run(id, timestamp);
  }

  /** Get count of unread hill messages */
  getHillUnreadCount(botId?: string): number {
    const id = botId ?? getIdentity().botId;
    const readState = this.db.prepare(
      'SELECT last_read_timestamp FROM hill_read_state WHERE bot_id = ?'
    ).get(id) as { last_read_timestamp: number } | undefined;

    const lastRead = readState?.last_read_timestamp ?? 0;

    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM hill_messages WHERE timestamp > ?'
    ).get(lastRead) as { cnt: number };

    return row.cnt;
  }

  /** Get hill chat messages */
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

  private handleHillChat(msg: NetworkMessage): void {
    const payload = msg.payload as HillChatPayload;

    // Verify sender
    const peer = this.peerStore.get(msg.senderId);
    if (!peer || !verifyMessage(msg, peer.publicKey)) return;

    // Deduplicate
    const existing = this.db.prepare('SELECT id FROM hill_messages WHERE id = ?').get(payload.id);
    if (existing) return;

    // Store locally
    this.db.prepare(
      'INSERT INTO hill_messages (id, sender_bot_id, sender_short_id, display_name, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(payload.id, payload.senderBotId, payload.senderShortId, payload.displayName ?? null, payload.content, payload.timestamp);

    // Notify dashboard via WebSocket
    if (this.broadcast) {
      this.broadcast({ type: 'hill_chat', data: payload });
    }

    console.log(`[hill] Message from ${payload.senderShortId}: ${payload.content.slice(0, 80)}`);
  }

  private handleDisconnect(msg: NetworkMessage, conn: PeerConnection): void {
    if (conn.botId) {
      console.log(`[network] Peer ${conn.botId} disconnected gracefully`);
      this.hashChain.append('PEER_DISCONNECT', conn.botId);
    }
    const key = conn.botId || `${conn.host}:${conn.port}`;
    this.transport.disconnect(key);
  }

  // --- Update Handlers ---

  private handleUpdateAnnounce(msg: NetworkMessage): void {
    const payload = msg.payload as UpdateAnnouncePayload;
    const peer = this.peerStore.get(msg.senderId);
    if (!peer || !verifyMessage(msg, peer.publicKey)) return;
    this.updates.handleUpdateAnnounce(payload, msg.signature);
  }

  private handleUpdateRequest(msg: NetworkMessage, conn: PeerConnection): void {
    const payload = msg.payload as UpdateRequestPayload;
    const peer = this.peerStore.get(msg.senderId);
    if (!peer || !verifyMessage(msg, peer.publicKey)) return;

    const response = this.updates.getUpdateFiles(payload.updateId, payload.requestedFiles);
    const responseMsg = createMessage('UPDATE_RESPONSE', response);
    const key = conn.botId || `${conn.host}:${conn.port}`;
    this.transport.send(key, responseMsg);
  }

  private handleUpdateResponse(msg: NetworkMessage): void {
    const payload = msg.payload as UpdateResponsePayload;
    // Store files and mark update as ready to apply
    // For now, auto-apply if the update is in 'downloading' state
    const update = this.updates.getUpdate(payload.updateId);
    if (update && update.status === 'available') {
      this.updates.applyUpdate(payload.updateId, payload.files);
      // Announce we applied it
      const identity = getIdentity();
      const appliedMsg = createMessage('UPDATE_APPLIED', {
        updateId: payload.updateId,
        appliedByBotId: identity.botId,
        newCodebaseHash: this.updates.getCurrentHash(),
      } satisfies UpdateAppliedPayload);
      this.transport.broadcastToAll(appliedMsg);
    }
  }

  private handleUpdateApplied(msg: NetworkMessage): void {
    const payload = msg.payload as UpdateAppliedPayload;
    console.log(`[updates] Peer ${msg.senderShortId} applied update ${payload.updateId}`);
    if (this.broadcast) {
      this.broadcast({ type: 'update_applied_by_peer', data: payload });
    }
  }

  /** Announce an update to the network */
  announceUpdate(description: string): UpdateAnnouncePayload | null {
    const payload = this.updates.createUpdate(description);
    if (!payload) return null;

    const msg = createMessage('UPDATE_ANNOUNCE', payload);
    this.transport.broadcastToAll(msg);
    this.hashChain.append('TASK_SUBMIT', JSON.stringify({ type: 'update', id: payload.updateId, description }));

    return payload;
  }

  /** Request update files from the originating peer */
  requestUpdate(updateId: string): void {
    const update = this.updates.getUpdate(updateId);
    if (!update) return;

    const changedFiles = JSON.parse(update.changedFiles) as Array<{ path: string; action: string }>;
    const filesToRequest = changedFiles.filter(f => f.action !== 'delete').map(f => f.path);

    const msg = createMessage('UPDATE_REQUEST', {
      updateId,
      requestedFiles: filesToRequest,
    } satisfies UpdateRequestPayload);

    // Send to the originating peer
    this.transport.send(update.fromBotId, msg);
  }
}

// Re-export types
export { PeerStore, type Peer } from './peer.js';
export { HashChain, type ChainEntry, type ChainAction } from './hash-chain.js';
export { ReputationManager, type ReputationChange } from './reputation.js';
export { TaskRelay, type NetworkTask } from './task-relay.js';
export { Transport, type PeerConnection } from './transport.js';
export { Discovery, type SeedPeer } from './discovery.js';
