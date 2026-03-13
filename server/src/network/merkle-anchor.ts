import { createHash, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { BeepBotNode } from './node.js';
import type { GossipRouter } from './gossip.js';
import type { DistributedLedger } from './ledger.js';
import type { ReputationManager } from './reputation.js';
import { getIdentity, sign } from '../identity.js';
import {
  createGossipEnvelope,
  verifyGossipEnvelope,
  TOPIC_ANCHORS,
  type GossipEnvelope,
  type MerkleAnchorPayload,
} from './protocols.js';
import type { PeerStore } from './peer-store.js';

export interface MerkleAnchor {
  id: string;
  botId: string;
  merkleRoot: string;
  fromSequence: number;
  toSequence: number;
  timestamp: string;
  signature: string;
  verified: boolean;
}

export class MerkleAnchorManager {
  private anchorInterval: ReturnType<typeof setInterval> | null = null;
  private broadcast: ((data: Record<string, unknown>) => void) | null = null;

  constructor(
    private db: Database.Database,
    private node: BeepBotNode,
    private gossip: GossipRouter,
    private ledger: DistributedLedger,
    private reputation: ReputationManager,
    private peerStore: PeerStore,
  ) {}

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcast = fn;
  }

  /** Start periodic anchoring (every 5 minutes) */
  start(): void {
    this.anchorInterval = setInterval(() => {
      this.publishAnchor().catch(err => {
        console.warn('[anchor] Publish failed:', (err as Error).message);
      });
    }, 300_000);
  }

  stop(): void {
    if (this.anchorInterval) {
      clearInterval(this.anchorInterval);
      this.anchorInterval = null;
    }
  }

  /** Compute Merkle root from a list of hashes */
  computeMerkleRoot(hashes: string[]): string {
    if (hashes.length === 0) return GENESIS_HASH;
    if (hashes.length === 1) return hashes[0];

    let layer = [...hashes];

    while (layer.length > 1) {
      const nextLayer: string[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = i + 1 < layer.length ? layer[i + 1] : layer[i]; // duplicate last if odd
        nextLayer.push(
          createHash('sha256').update(left + right).digest('hex')
        );
      }
      layer = nextLayer;
    }

    return layer[0];
  }

  /** Publish an anchor for our local chain */
  async publishAnchor(): Promise<MerkleAnchor | null> {
    const identity = getIdentity();

    // Get the last anchor we published
    const lastAnchor = this.db.prepare(
      'SELECT to_sequence FROM merkle_anchors WHERE bot_id = ? ORDER BY to_sequence DESC LIMIT 1'
    ).get(identity.botId) as { to_sequence: number } | undefined;

    const fromSequence = (lastAnchor?.to_sequence ?? 0) + 1;
    const entries = this.ledger.getChainEntries(identity.botId, fromSequence);

    if (entries.length === 0) return null;

    const hashes = entries.map(e => e.hash);
    const merkleRoot = this.computeMerkleRoot(hashes);
    const toSequence = entries[entries.length - 1].sequence;
    const timestamp = new Date().toISOString();
    const id = randomUUID();

    // Sign the anchor
    const dataToSign = `${id}:${merkleRoot}:${fromSequence}:${toSequence}:${timestamp}`;
    const signature = sign(dataToSign);

    // Store locally
    this.db.prepare(`
      INSERT INTO merkle_anchors (id, bot_id, merkle_root, from_sequence, to_sequence, timestamp, signature, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(id, identity.botId, merkleRoot, fromSequence, toSequence, timestamp, signature);

    const anchor: MerkleAnchor = { id, botId: identity.botId, merkleRoot, fromSequence, toSequence, timestamp, signature, verified: true };

    // Publish to DHT
    const dhtKey = new TextEncoder().encode(`/beepbot/anchors/${identity.botId}/${toSequence}`);
    const dhtValue = new TextEncoder().encode(JSON.stringify(anchor));
    try {
      await this.node.services.dht.put(dhtKey, dhtValue);
    } catch (err) {
      console.warn('[anchor] DHT put failed:', (err as Error).message);
    }

    // Broadcast via GossipSub
    const payload: MerkleAnchorPayload = {
      anchorId: id, botId: identity.botId, merkleRoot,
      fromSequence, toSequence, timestamp, signature,
    };
    const envelope = createGossipEnvelope('MERKLE_ANCHOR', payload);
    await this.gossip.publish(TOPIC_ANCHORS, envelope);

    console.log(`[anchor] Published anchor: root=${merkleRoot.slice(0, 16)}... seq=${fromSequence}-${toSequence}`);

    if (this.broadcast) {
      this.broadcast({ type: 'anchor_published', data: anchor });
    }

    return anchor;
  }

  /** Verify a peer's anchor against our local copy of their ledger */
  verifyAnchor(anchor: MerkleAnchor): boolean {
    // Get our local copy of the peer's entries in the same range
    const entries = this.ledger.getChainEntries(anchor.botId, anchor.fromSequence, anchor.toSequence);

    if (entries.length === 0) {
      // We don't have their data — can't verify
      return true;
    }

    const hashes = entries.map(e => e.hash);
    const localRoot = this.computeMerkleRoot(hashes);

    if (localRoot === anchor.merkleRoot) {
      this.reputation.anchorMatch(anchor.botId);
      return true;
    } else {
      console.warn(`[anchor] Mismatch for ${anchor.botId}: local=${localRoot.slice(0, 16)} remote=${anchor.merkleRoot.slice(0, 16)}`);
      this.reputation.anchorMismatch(anchor.botId);
      return false;
    }
  }

  /** Handle incoming anchor announcement from GossipSub */
  handleAnchorAnnouncement(envelope: GossipEnvelope<MerkleAnchorPayload>): void {
    const payload = envelope.payload;
    const identity = getIdentity();
    if (payload.botId === identity.botId) return;

    // Verify envelope
    const peer = this.peerStore.get(envelope.senderId);
    if (peer && !verifyGossipEnvelope(envelope, peer.publicKey)) return;

    // Store the anchor
    const verified = this.verifyAnchor({
      id: payload.anchorId,
      botId: payload.botId,
      merkleRoot: payload.merkleRoot,
      fromSequence: payload.fromSequence,
      toSequence: payload.toSequence,
      timestamp: payload.timestamp,
      signature: payload.signature,
      verified: false,
    });

    this.db.prepare(`
      INSERT OR REPLACE INTO merkle_anchors (id, bot_id, merkle_root, from_sequence, to_sequence, timestamp, signature, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(payload.anchorId, payload.botId, payload.merkleRoot, payload.fromSequence, payload.toSequence, payload.timestamp, payload.signature, verified ? 1 : 0);

    if (this.broadcast) {
      this.broadcast({ type: 'anchor_received', data: { ...payload, verified } });
    }
  }

  /** Get anchors, optionally filtered by botId */
  getAnchors(botId?: string, limit = 50): MerkleAnchor[] {
    const rows = botId
      ? this.db.prepare('SELECT * FROM merkle_anchors WHERE bot_id = ? ORDER BY to_sequence DESC LIMIT ?').all(botId, limit) as AnchorRow[]
      : this.db.prepare('SELECT * FROM merkle_anchors ORDER BY created_at DESC LIMIT ?').all(limit) as AnchorRow[];
    return rows.map(rowToAnchor);
  }
}

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

interface AnchorRow {
  id: string;
  bot_id: string;
  merkle_root: string;
  from_sequence: number;
  to_sequence: number;
  timestamp: string;
  signature: string;
  verified: number;
}

function rowToAnchor(row: AnchorRow): MerkleAnchor {
  return {
    id: row.id,
    botId: row.bot_id,
    merkleRoot: row.merkle_root,
    fromSequence: row.from_sequence,
    toSequence: row.to_sequence,
    timestamp: row.timestamp,
    signature: row.signature,
    verified: row.verified === 1,
  };
}
