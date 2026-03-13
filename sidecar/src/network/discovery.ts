import type Database from 'better-sqlite3';
import type { PeerStore } from './peer.js';
import type { Transport, PeerConnection } from './transport.js';
import type { ReputationManager } from './reputation.js';
import { createMessage, verifyMessage, type NetworkMessage, type HelloPayload, type PeerListPayload } from './protocol.js';
import { getIdentity } from '../identity.js';

export interface SeedPeer {
  host: string;
  port: number;
}

export class Discovery {
  private seedPeers: SeedPeer[] = [];
  private peerExchangeInterval: ReturnType<typeof setInterval> | null = null;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private missedPings = new Map<string, number>();  // botId -> missed count
  private broadcast: ((data: Record<string, unknown>) => void) | null = null;

  constructor(
    private db: Database.Database,
    private peerStore: PeerStore,
    private transport: Transport,
    private reputation: ReputationManager,
  ) {
    // Load seed peers from settings
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'seed_peers'").get() as { value: string } | undefined;
    if (row?.value) {
      try {
        this.seedPeers = JSON.parse(row.value) as SeedPeer[];
      } catch { /* ignore */ }
    }
  }

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcast = fn;
  }

  /** Start discovery: connect to seeds, begin peer exchange and health checks */
  async start(): Promise<void> {
    // Connect to seed peers
    for (const seed of this.seedPeers) {
      this.connectToSeed(seed);
    }

    // Periodic peer exchange (every 60s)
    this.peerExchangeInterval = setInterval(() => {
      this.exchangePeers();
    }, 60_000);

    // Health check (every 30s)
    this.healthCheckInterval = setInterval(() => {
      this.healthCheck();
    }, 30_000);
  }

  /** Stop discovery */
  stop(): void {
    if (this.peerExchangeInterval) {
      clearInterval(this.peerExchangeInterval);
      this.peerExchangeInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /** Add a seed peer */
  addSeedPeer(host: string, port: number): void {
    // Avoid duplicates
    if (this.seedPeers.some(s => s.host === host && s.port === port)) return;
    this.seedPeers.push({ host, port });
    this.saveSeedPeers();
  }

  /** Remove a seed peer */
  removeSeedPeer(host: string, port: number): void {
    this.seedPeers = this.seedPeers.filter(s => !(s.host === host && s.port === port));
    this.saveSeedPeers();
  }

  /** Get seed peers */
  getSeedPeers(): SeedPeer[] {
    return [...this.seedPeers];
  }

  /** Handle a HELLO message from a peer */
  handleHello(msg: NetworkMessage, conn: PeerConnection): void {
    const payload = msg.payload as HelloPayload;

    // Verify the message signature
    if (!verifyMessage(msg, payload.publicKey)) {
      console.warn(`[discovery] Invalid HELLO signature from ${conn.host}:${conn.port}`);
      return;
    }

    // Associate botId with connection
    const hostPort = `${conn.host}:${conn.port}`;
    this.transport.associateBotId(hostPort, payload.botId);
    conn.botId = payload.botId;

    // Store peer
    this.peerStore.upsert({
      botId: payload.botId,
      shortId: payload.shortId,
      publicKey: payload.publicKey,
      host: conn.host,
      port: payload.port,  // their listen port, not connection port
      reputation: this.peerStore.get(payload.botId)?.reputation ?? 100,
      lastSeen: new Date().toISOString(),
      hashChainHead: payload.hashChainHead,
    });

    // Reset missed pings
    this.missedPings.delete(payload.botId);

    console.log(`[discovery] Peer registered: ${payload.shortId} (${conn.host}:${payload.port})`);

    if (this.broadcast) {
      this.broadcast({ type: 'peer_connected', data: { peer: this.peerStore.get(payload.botId) } });
    }

    // Send HELLO_ACK back if this was an incoming connection
    if (!conn.outbound) {
      this.sendHello(conn, 'HELLO_ACK');
    }
  }

  /** Handle a PEER_LIST response */
  handlePeerList(msg: NetworkMessage): void {
    const payload = msg.payload as PeerListPayload;

    for (const p of payload.peers) {
      const identity = getIdentity();
      // Don't add ourselves
      if (p.botId === identity.botId) continue;

      // Don't overwrite existing peer data, just add new ones
      if (!this.peerStore.get(p.botId)) {
        this.peerStore.upsert({
          botId: p.botId,
          shortId: p.shortId,
          publicKey: p.publicKey,
          host: p.host,
          port: p.port,
          reputation: p.reputation,
          lastSeen: new Date().toISOString(),
          hashChainHead: null,
        });

        // Try to connect to new peers
        this.connectToPeer(p.host, p.port);
      }
    }
  }

  /** Handle PONG (peer is alive) */
  handlePong(msg: NetworkMessage): void {
    this.missedPings.delete(msg.senderId);
    this.peerStore.touch(msg.senderId);
  }

  /** Send our HELLO to a connection */
  sendHello(conn: PeerConnection, type: 'HELLO' | 'HELLO_ACK' = 'HELLO'): void {
    const identity = getIdentity();
    const msg = createMessage(type, {
      botId: identity.botId,
      shortId: identity.shortId,
      publicKey: identity.publicKey,
      port: this.transport.getPort(),
      version: '0.1.0',
      hashChainHead: null, // will be set by network manager
    } satisfies HelloPayload);

    const key = conn.botId || `${conn.host}:${conn.port}`;
    this.transport.send(key, msg);
  }

  // --- Private ---

  private async connectToSeed(seed: SeedPeer): Promise<void> {
    try {
      const conn = await this.transport.connect(seed.host, seed.port);
      this.sendHello(conn);
    } catch (err) {
      console.warn(`[discovery] Failed to connect to seed ${seed.host}:${seed.port}:`, (err as Error).message);
    }
  }

  private async connectToPeer(host: string, port: number): Promise<void> {
    try {
      const conn = await this.transport.connect(host, port);
      this.sendHello(conn);
    } catch {
      // Peer unreachable, that's fine
    }
  }

  private exchangePeers(): void {
    // Request peer lists from all connected peers
    const msg = createMessage('PEER_REQUEST', {});
    this.transport.broadcastToAll(msg);

    // Also send our peer list to anyone who asked
    const peers = this.peerStore.list().map(p => ({
      botId: p.botId,
      shortId: p.shortId,
      publicKey: p.publicKey,
      host: p.host,
      port: p.port,
      reputation: p.reputation,
    }));

    if (peers.length > 0) {
      const listMsg = createMessage('PEER_LIST', { peers } satisfies PeerListPayload);
      this.transport.broadcastToAll(listMsg);
    }
  }

  private healthCheck(): void {
    // Send PING to all connected peers
    const pingMsg = createMessage('PING', {});
    const connections = this.transport.getConnections();

    for (const conn of connections) {
      if (!conn.botId) continue;

      const missed = this.missedPings.get(conn.botId) ?? 0;

      if (missed >= 3) {
        // Peer missed 3 pings — disconnect and slash reputation
        console.warn(`[discovery] Peer ${conn.botId} missed 3 pings, disconnecting`);
        this.reputation.ungracefulDisconnect(conn.botId);
        this.transport.disconnect(conn.botId);
        this.missedPings.delete(conn.botId);

        if (this.broadcast) {
          this.broadcast({ type: 'peer_disconnected', data: { botId: conn.botId, reason: 'missed_pings' } });
        }
      } else {
        this.missedPings.set(conn.botId, missed + 1);
        this.transport.send(conn.botId, pingMsg);
      }
    }
  }

  private saveSeedPeers(): void {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('seed_peers', ?, datetime('now'))").run(JSON.stringify(this.seedPeers));
  }
}
