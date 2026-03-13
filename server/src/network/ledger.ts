import { createHash } from 'crypto';
import type Database from 'better-sqlite3';
import { getIdentity, sign } from '../identity.js';
import type { GossipRouter } from './gossip.js';
import type { PeerStore } from './peer-store.js';
import {
  createGossipEnvelope,
  verifyGossipEnvelope,
  TOPIC_LEDGER,
  type GossipEnvelope,
  type LedgerEventPayload,
} from './protocols.js';

export type LedgerAction =
  | 'GENESIS'
  | 'PROOF_HILL_SERVICE'
  | 'PROOF_IMPROVEMENT_PUBLISH'
  | 'PROOF_IMPROVEMENT_REVIEW'
  | 'REWARD_MINT'
  | 'TOKEN_TRANSFER'
  | 'IMPROVEMENT_ADOPT'
  | 'INFLATION_MINT';

export interface LedgerEntry {
  id: number;
  eventId: string;
  botId: string;
  sequence: number;
  timestamp: string;
  action: LedgerAction;
  proofHash: string;
  previousHash: string;
  hash: string;
  signature: string;
  metadata: string | null;
  receivedAt: string;
}

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export class DistributedLedger {
  private localHeadHash: string = GENESIS_HASH;
  private localSequence = 0;
  private chainHeads = new Map<string, string>(); // botId -> latest hash

  constructor(
    private db: Database.Database,
    private gossip: GossipRouter | null,
    private peerStore: PeerStore,
  ) {
    // Load our local chain head
    const identity = getIdentity();
    const lastLocal = this.db.prepare(
      'SELECT hash, sequence FROM ledger_events WHERE bot_id = ? ORDER BY sequence DESC LIMIT 1'
    ).get(identity.botId) as { hash: string; sequence: number } | undefined;

    if (lastLocal) {
      this.localHeadHash = lastLocal.hash;
      this.localSequence = lastLocal.sequence;
    }

    // Load all known chain heads
    const heads = this.db.prepare(
      'SELECT bot_id, hash, sequence FROM ledger_events WHERE (bot_id, sequence) IN (SELECT bot_id, MAX(sequence) FROM ledger_events GROUP BY bot_id)'
    ).all() as Array<{ bot_id: string; hash: string; sequence: number }>;

    for (const h of heads) {
      this.chainHeads.set(h.bot_id, h.hash);
    }
  }

  setGossip(gossip: GossipRouter): void {
    this.gossip = gossip;
  }

  /** Append a local event and broadcast via GossipSub */
  append(action: LedgerAction, data: string, metadata?: Record<string, unknown>): LedgerEntry {
    const identity = getIdentity();
    const timestamp = new Date().toISOString();
    const sequence = this.localSequence + 1;
    const proofHash = createHash('sha256').update(data).digest('hex');
    const previousHash = this.localHeadHash;

    const hash = createHash('sha256')
      .update(`${timestamp}:${action}:${proofHash}:${previousHash}`)
      .digest('hex');

    const entrySig = sign(hash);
    const eventId = `${identity.botId}:${sequence}`;
    const metaJson = metadata ? JSON.stringify(metadata) : null;

    const result = this.db.prepare(`
      INSERT INTO ledger_events (event_id, bot_id, sequence, timestamp, action, data_hash, previous_hash, hash, signature, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(eventId, identity.botId, sequence, timestamp, action, proofHash, previousHash, hash, entrySig, metaJson);

    this.localHeadHash = hash;
    this.localSequence = sequence;
    this.chainHeads.set(identity.botId, hash);

    const entry: LedgerEntry = {
      id: result.lastInsertRowid as number,
      eventId,
      botId: identity.botId,
      sequence,
      timestamp,
      action,
      proofHash,
      previousHash,
      hash,
      signature: entrySig,
      metadata: metaJson,
      receivedAt: timestamp,
    };

    // Broadcast to network
    if (this.gossip) {
      const payload: LedgerEventPayload = {
        eventId, botId: identity.botId, sequence, action,
        proofHash, previousHash, hash, timestamp, signature: entrySig,
        ...(metadata ? { metadata } : {}),
      };
      const envelope = createGossipEnvelope('LEDGER_EVENT', payload);
      this.gossip.publish(TOPIC_LEDGER, envelope).catch(err => {
        console.warn('[ledger] Failed to broadcast event:', (err as Error).message);
      });
    }

    return entry;
  }

  /** Receive and validate a remote event from GossipSub */
  receiveRemoteEvent(envelope: GossipEnvelope<LedgerEventPayload>): boolean {
    const payload = envelope.payload;

    // Don't store our own events from gossip
    const identity = getIdentity();
    if (payload.botId === identity.botId) return false;

    // Verify envelope signature
    const peer = this.peerStore.get(envelope.senderId);
    if (peer && !verifyGossipEnvelope(envelope, peer.publicKey)) {
      console.warn(`[ledger] Invalid envelope signature from ${envelope.senderShortId}`);
      return false;
    }

    // Deduplicate
    const existing = this.db.prepare('SELECT id FROM ledger_events WHERE event_id = ?').get(payload.eventId);
    if (existing) return false;

    // Verify hash computation
    const expectedHash = createHash('sha256')
      .update(`${payload.timestamp}:${payload.action}:${payload.proofHash}:${payload.previousHash}`)
      .digest('hex');

    if (payload.hash !== expectedHash) {
      console.warn(`[ledger] Hash mismatch for event ${payload.eventId}`);
      return false;
    }

    // Verify entry signature (the bot that created this entry signed the hash)
    const entryPeer = this.peerStore.get(payload.botId);
    if (entryPeer) {
      const { verify } = require('../identity.js');
      if (!verify(payload.hash, payload.signature, entryPeer.publicKey)) {
        console.warn(`[ledger] Invalid entry signature for event ${payload.eventId}`);
        return false;
      }
    }

    // Check chain continuity
    const currentHead = this.chainHeads.get(payload.botId);
    if (currentHead && payload.previousHash !== currentHead) {
      console.warn(`[ledger] Chain gap detected for ${payload.botId}: expected prev=${currentHead}, got prev=${payload.previousHash}`);
    }

    // Store
    const metaJson = payload.metadata ? JSON.stringify(payload.metadata) : null;
    this.db.prepare(`
      INSERT OR IGNORE INTO ledger_events (event_id, bot_id, sequence, timestamp, action, proof_hash, previous_hash, hash, signature, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(payload.eventId, payload.botId, payload.sequence, payload.timestamp, payload.action, payload.proofHash, payload.previousHash, payload.hash, payload.signature, metaJson);

    this.chainHeads.set(payload.botId, payload.hash);

    // Update peer's chain head
    this.peerStore.updateChainHead(payload.botId, payload.hash);

    return true;
  }

  /** Get this bot's local chain head */
  getLocalHead(): string {
    return this.localHeadHash;
  }

  /** Get a specific bot's chain head */
  getChainHead(botId: string): string {
    return this.chainHeads.get(botId) ?? GENESIS_HASH;
  }

  /** Get entries from a specific bot's chain */
  getChainEntries(botId: string, fromSequence: number, toSequence?: number): LedgerEntry[] {
    if (toSequence !== undefined) {
      return (this.db.prepare(
        'SELECT * FROM ledger_events WHERE bot_id = ? AND sequence >= ? AND sequence <= ? ORDER BY sequence ASC'
      ).all(botId, fromSequence, toSequence) as LedgerRow[]).map(rowToEntry);
    }
    return (this.db.prepare(
      'SELECT * FROM ledger_events WHERE bot_id = ? AND sequence >= ? ORDER BY sequence ASC'
    ).all(botId, fromSequence) as LedgerRow[]).map(rowToEntry);
  }

  /** Get all recent entries across all bots */
  recentAll(limit = 50): LedgerEntry[] {
    return (this.db.prepare(
      'SELECT * FROM ledger_events ORDER BY id DESC LIMIT ?'
    ).all(limit) as LedgerRow[]).map(rowToEntry).reverse();
  }

  /** Get this bot's local chain entries (backward compat) */
  recent(limit = 50): LedgerEntry[] {
    const identity = getIdentity();
    return (this.db.prepare(
      'SELECT * FROM ledger_events WHERE bot_id = ? ORDER BY sequence DESC LIMIT ?'
    ).all(identity.botId, limit) as LedgerRow[]).map(rowToEntry).reverse();
  }

  /** Get entry by local auto-increment id */
  get(idx: number): LedgerEntry | null {
    const row = this.db.prepare('SELECT * FROM ledger_events WHERE id = ?').get(idx) as LedgerRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  /** Get entries in a range by id */
  getRange(fromIdx: number, toIdx?: number): LedgerEntry[] {
    if (toIdx !== undefined) {
      return (this.db.prepare(
        'SELECT * FROM ledger_events WHERE id >= ? AND id <= ? ORDER BY id ASC'
      ).all(fromIdx, toIdx) as LedgerRow[]).map(rowToEntry);
    }
    return (this.db.prepare(
      'SELECT * FROM ledger_events WHERE id >= ? ORDER BY id ASC'
    ).all(fromIdx) as LedgerRow[]).map(rowToEntry);
  }

  /** Total ledger entries (all bots) */
  length(): number {
    return (this.db.prepare('SELECT COUNT(*) as cnt FROM ledger_events').get() as { cnt: number }).cnt;
  }

  /** Local chain length */
  localLength(): number {
    const identity = getIdentity();
    return (this.db.prepare('SELECT COUNT(*) as cnt FROM ledger_events WHERE bot_id = ?').get(identity.botId) as { cnt: number }).cnt;
  }

  /** Verify integrity of a specific bot's chain */
  verifyChain(botId: string): { valid: boolean; brokenAt?: number; expected?: string; actual?: string } {
    const entries = this.db.prepare(
      'SELECT * FROM ledger_events WHERE bot_id = ? ORDER BY sequence ASC'
    ).all(botId) as LedgerRow[];

    let prevHash = GENESIS_HASH;
    for (const row of entries) {
      if (row.previous_hash !== prevHash) {
        return { valid: false, brokenAt: row.sequence, expected: prevHash, actual: row.previous_hash };
      }
      const expectedHash = createHash('sha256')
        .update(`${row.timestamp}:${row.action}:${row.proof_hash}:${row.previous_hash}`)
        .digest('hex');
      if (row.hash !== expectedHash) {
        return { valid: false, brokenAt: row.sequence, expected: expectedHash, actual: row.hash };
      }
      prevHash = row.hash;
    }
    return { valid: true };
  }

  /** Verify our local chain (backward compat) */
  verifyIntegrity(): { valid: boolean; brokenAt?: number; expected?: string; actual?: string } {
    const identity = getIdentity();
    return this.verifyChain(identity.botId);
  }

  /** Get the local sequence number */
  getLocalSequence(): number {
    return this.localSequence;
  }

  /** Get all known bot IDs in the ledger */
  getKnownBots(): string[] {
    return (this.db.prepare('SELECT DISTINCT bot_id FROM ledger_events').all() as Array<{ bot_id: string }>).map(r => r.bot_id);
  }

  /** Get the latest sequence for a bot */
  getLatestSequence(botId: string): number {
    const row = this.db.prepare('SELECT MAX(sequence) as seq FROM ledger_events WHERE bot_id = ?').get(botId) as { seq: number | null };
    return row.seq ?? 0;
  }

  /** Import entries from chain sync (validates each) */
  importEntries(entries: LedgerEventPayload[]): number {
    let imported = 0;
    for (const e of entries) {
      const existing = this.db.prepare('SELECT id FROM ledger_events WHERE event_id = ?').get(e.eventId);
      if (existing) continue;

      const expectedHash = createHash('sha256')
        .update(`${e.timestamp}:${e.action}:${e.proofHash}:${e.previousHash}`)
        .digest('hex');
      if (e.hash !== expectedHash) continue;

      const metaJson = e.metadata ? JSON.stringify(e.metadata) : null;
      this.db.prepare(`
        INSERT OR IGNORE INTO ledger_events (event_id, bot_id, sequence, timestamp, action, proof_hash, previous_hash, hash, signature, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(e.eventId, e.botId, e.sequence, e.timestamp, e.action, e.proofHash, e.previousHash, e.hash, e.signature, metaJson);

      this.chainHeads.set(e.botId, e.hash);
      imported++;
    }
    return imported;
  }

  /** Count proof entries across all bots (for epoch tracking) */
  countProofs(): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM ledger_events WHERE action IN ('PROOF_HILL_SERVICE', 'PROOF_IMPROVEMENT_PUBLISH', 'PROOF_IMPROVEMENT_REVIEW')"
    ).get() as { cnt: number };
    return row.cnt;
  }

  /** Count proofs for a specific bot in a sequence range */
  countBotProofs(botId: string, fromId?: number, toId?: number): number {
    if (fromId !== undefined && toId !== undefined) {
      const row = this.db.prepare(
        "SELECT COUNT(*) as cnt FROM ledger_events WHERE bot_id = ? AND id >= ? AND id <= ? AND action IN ('PROOF_HILL_SERVICE', 'PROOF_IMPROVEMENT_PUBLISH', 'PROOF_IMPROVEMENT_REVIEW')"
      ).get(botId, fromId, toId) as { cnt: number };
      return row.cnt;
    }
    const row = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM ledger_events WHERE bot_id = ? AND action IN ('PROOF_HILL_SERVICE', 'PROOF_IMPROVEMENT_PUBLISH', 'PROOF_IMPROVEMENT_REVIEW')"
    ).get(botId) as { cnt: number };
    return row.cnt;
  }

  /** Get entries by action type */
  getByAction(action: LedgerAction, limit = 100): LedgerEntry[] {
    return (this.db.prepare(
      'SELECT * FROM ledger_events WHERE action = ? ORDER BY id DESC LIMIT ?'
    ).all(action, limit) as LedgerRow[]).map(rowToEntry);
  }

  /** Get entries involving a bot (as sender or referenced in metadata) */
  getForBot(botId: string, actions?: LedgerAction[], limit = 100): LedgerEntry[] {
    if (actions && actions.length > 0) {
      const placeholders = actions.map(() => '?').join(',');
      return (this.db.prepare(
        `SELECT * FROM ledger_events WHERE bot_id = ? AND action IN (${placeholders}) ORDER BY id DESC LIMIT ?`
      ).all(botId, ...actions, limit) as LedgerRow[]).map(rowToEntry);
    }
    return (this.db.prepare(
      'SELECT * FROM ledger_events WHERE bot_id = ? ORDER BY id DESC LIMIT ?'
    ).all(botId, limit) as LedgerRow[]).map(rowToEntry);
  }
}

interface LedgerRow {
  id: number;
  event_id: string;
  bot_id: string;
  sequence: number;
  timestamp: string;
  action: string;
  proof_hash: string;
  previous_hash: string;
  hash: string;
  signature: string;
  metadata: string | null;
  received_at: string;
}

function rowToEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    eventId: row.event_id,
    botId: row.bot_id,
    sequence: row.sequence,
    timestamp: row.timestamp,
    action: row.action as LedgerAction,
    proofHash: row.proof_hash,
    previousHash: row.previous_hash,
    hash: row.hash,
    signature: row.signature,
    metadata: row.metadata,
    receivedAt: row.received_at,
  };
}
