import type Database from 'better-sqlite3';
import type { BeepBotNode } from './node.js';
import type { PeerStore } from './peer-store.js';
import { getIdentity, sign, verify } from '../identity.js';
import { getListenAddrs } from './node.js';

// === Agent Card ===
export interface AgentCard {
  botId: string;
  shortId: string;
  publicKey: string;
  peerId: string;
  version: string;
  capabilities: string[];
  multiaddrs: string[];
  hashChainHead: string | null;
  codebaseHash: string | null;
  reputation: number;
  publishedAt: number;
  ttl: number;
  signature: string;
}

export class DiscoveryManager {
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private bootstrapPeers: string[] = [];
  private broadcast: ((data: Record<string, unknown>) => void) | null = null;

  constructor(
    private node: BeepBotNode,
    private peerStore: PeerStore,
    private db: Database.Database,
  ) {
    // Load bootstrap peers from settings
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'bootstrap_peers'").get() as { value: string } | undefined;
    if (row?.value) {
      try { this.bootstrapPeers = JSON.parse(row.value); } catch { /* ignore */ }
    }
  }

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcast = fn;
  }

  async start(): Promise<void> {
    // Listen for peer discovery events from libp2p
    this.node.addEventListener('peer:discovery', (evt) => {
      const peerInfo = evt.detail;
      console.log(`[discovery] Discovered peer: ${peerInfo.id.toString()}`);

      // Try to connect
      this.node.dial(peerInfo.id).then(() => {
        console.log(`[discovery] Connected to discovered peer: ${peerInfo.id.toString()}`);
        if (this.broadcast) {
          this.broadcast({ type: 'peer_discovered', data: { peerId: peerInfo.id.toString() } });
        }
      }).catch(err => {
        console.warn(`[discovery] Failed to dial discovered peer: ${(err as Error).message}`);
      });
    });

    // Listen for peer connections
    this.node.addEventListener('peer:connect', (evt) => {
      const peerId = evt.detail.toString();
      console.log(`[discovery] Peer connected: ${peerId}`);
      if (this.broadcast) {
        this.broadcast({ type: 'peer_connected', data: { peerId } });
      }
    });

    // Listen for peer disconnections
    this.node.addEventListener('peer:disconnect', (evt) => {
      const peerId = evt.detail.toString();
      console.log(`[discovery] Peer disconnected: ${peerId}`);
      if (this.broadcast) {
        this.broadcast({ type: 'peer_disconnected', data: { peerId } });
      }
    });

    // Publish our Agent Card to DHT
    await this.publishAgentCard();

    // Start heartbeat: republish Agent Card every TTL/2 (2.5 minutes)
    this.heartbeatInterval = setInterval(() => {
      this.publishAgentCard().catch(err => {
        console.warn('[discovery] Heartbeat publish failed:', (err as Error).message);
      });
    }, 150_000);

    // Connect to bootstrap peers
    for (const multiaddr of this.bootstrapPeers) {
      this.connectToPeer(multiaddr).catch(() => {});
    }

    console.log('[discovery] Discovery started');
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /** Build and sign our Agent Card */
  buildAgentCard(hashChainHead?: string | null, codebaseHash?: string | null): AgentCard {
    const identity = getIdentity();
    const multiaddrs = getListenAddrs(this.node);

    const card: AgentCard = {
      botId: identity.botId,
      shortId: identity.shortId,
      publicKey: identity.publicKey,
      peerId: this.node.peerId.toString(),
      version: '0.1.0',
      capabilities: ['chat', 'task-relay', 'code-updates', 'hill'],
      multiaddrs,
      hashChainHead: hashChainHead ?? null,
      codebaseHash: codebaseHash ?? null,
      reputation: 100,
      publishedAt: Date.now(),
      ttl: 300,
      signature: '', // will be set below
    };

    // Sign the card (without the signature field)
    const { signature: _, ...cardWithoutSig } = card;
    const dataToSign = JSON.stringify(cardWithoutSig);
    card.signature = sign(dataToSign);

    return card;
  }

  /** Verify an Agent Card's signature */
  static verifyAgentCard(card: AgentCard): boolean {
    const { signature, ...cardWithoutSig } = card;
    const dataToVerify = JSON.stringify(cardWithoutSig);
    return verify(dataToVerify, signature, card.publicKey);
  }

  /** Publish our Agent Card to the DHT */
  async publishAgentCard(hashChainHead?: string | null): Promise<void> {
    const card = this.buildAgentCard(hashChainHead);
    const key = new TextEncoder().encode(`/beepbot/agents/${card.botId}`);
    const value = new TextEncoder().encode(JSON.stringify(card));

    try {
      await this.node.services.dht.put(key, value);
      console.log(`[discovery] Published Agent Card to DHT`);
    } catch (err) {
      console.warn('[discovery] DHT put failed:', (err as Error).message);
    }

    // Also cache locally
    this.db.prepare(`
      INSERT INTO agent_cards (bot_id, card_json, verified, last_seen)
      VALUES (?, ?, 1, datetime('now'))
      ON CONFLICT(bot_id) DO UPDATE SET card_json = excluded.card_json, last_seen = datetime('now')
    `).run(card.botId, JSON.stringify(card));
  }

  /** Look up a bot's Agent Card from the DHT */
  async lookupAgent(botId: string): Promise<AgentCard | null> {
    const key = new TextEncoder().encode(`/beepbot/agents/${botId}`);

    try {
      for await (const event of this.node.services.dht.get(key)) {
        if (event.name === 'VALUE') {
          const json = new TextDecoder().decode(event.value);
          const card = JSON.parse(json) as AgentCard;

          if (DiscoveryManager.verifyAgentCard(card)) {
            // Cache it
            this.db.prepare(`
              INSERT INTO agent_cards (bot_id, card_json, verified, last_seen)
              VALUES (?, ?, 1, datetime('now'))
              ON CONFLICT(bot_id) DO UPDATE SET card_json = excluded.card_json, verified = 1, last_seen = datetime('now')
            `).run(card.botId, JSON.stringify(card));

            return card;
          }
        }
      }
    } catch (err) {
      console.warn(`[discovery] DHT lookup failed for ${botId}:`, (err as Error).message);
    }

    // Fall back to local cache
    const cached = this.db.prepare('SELECT card_json FROM agent_cards WHERE bot_id = ?').get(botId) as { card_json: string } | undefined;
    if (cached) {
      return JSON.parse(cached.card_json) as AgentCard;
    }

    return null;
  }

  /** Get cached Agent Cards */
  getCachedCards(): AgentCard[] {
    const rows = this.db.prepare('SELECT card_json FROM agent_cards ORDER BY last_seen DESC').all() as Array<{ card_json: string }>;
    return rows.map(r => JSON.parse(r.card_json) as AgentCard);
  }

  /** Connect to a peer by multiaddr */
  async connectToPeer(multiaddr: string): Promise<void> {
    const { multiaddr: ma } = await import('@multiformats/multiaddr');
    const addr = ma(multiaddr);
    await this.node.dial(addr);
  }

  /** Add a bootstrap peer */
  addBootstrapPeer(multiaddr: string): void {
    if (!this.bootstrapPeers.includes(multiaddr)) {
      this.bootstrapPeers.push(multiaddr);
      this.saveBootstrapPeers();
    }
  }

  /** Remove a bootstrap peer */
  removeBootstrapPeer(multiaddr: string): void {
    this.bootstrapPeers = this.bootstrapPeers.filter(p => p !== multiaddr);
    this.saveBootstrapPeers();
  }

  /** Get bootstrap peers */
  getBootstrapPeers(): string[] {
    return [...this.bootstrapPeers];
  }

  private saveBootstrapPeers(): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('bootstrap_peers', ?, datetime('now'))"
    ).run(JSON.stringify(this.bootstrapPeers));
  }
}
