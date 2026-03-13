import { createHash } from 'crypto';
import type Database from 'better-sqlite3';

export type ChainAction = 'CHAT' | 'TOOL_CALL' | 'TASK_COMPLETE' | 'PEER_CONNECT' | 'PEER_DISCONNECT' | 'TASK_SUBMIT' | 'TASK_CLAIM' | 'IDENTITY_INIT';

export interface ChainEntry {
  idx: number;
  timestamp: string;
  action: ChainAction;
  dataHash: string;
  previousHash: string;
  hash: string;
  metadata: string | null;
}

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export class HashChain {
  private headHash: string = GENESIS_HASH;

  constructor(private db: Database.Database) {
    // Load the latest hash from the chain
    const last = this.db.prepare('SELECT hash FROM hash_chain ORDER BY idx DESC LIMIT 1').get() as { hash: string } | undefined;
    if (last) {
      this.headHash = last.hash;
    }
  }

  /** Append a new entry to the chain */
  append(action: ChainAction, data: string, metadata?: Record<string, unknown>): ChainEntry {
    const timestamp = new Date().toISOString();
    const dataHash = createHash('sha256').update(data).digest('hex');
    const previousHash = this.headHash;

    // hash = SHA-256(timestamp + action + dataHash + previousHash)
    const hash = createHash('sha256')
      .update(`${timestamp}:${action}:${dataHash}:${previousHash}`)
      .digest('hex');

    const metaJson = metadata ? JSON.stringify(metadata) : null;

    const result = this.db.prepare(`
      INSERT INTO hash_chain (timestamp, action, data_hash, previous_hash, hash, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(timestamp, action, dataHash, previousHash, hash, metaJson);

    this.headHash = hash;

    return {
      idx: result.lastInsertRowid as number,
      timestamp,
      action,
      dataHash,
      previousHash,
      hash,
      metadata: metaJson,
    };
  }

  /** Get the current chain head hash */
  getHead(): string {
    return this.headHash;
  }

  /** Get a chain entry by index */
  get(idx: number): ChainEntry | null {
    const row = this.db.prepare('SELECT * FROM hash_chain WHERE idx = ?').get(idx) as ChainRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  /** Get entries in a range */
  getRange(fromIdx: number, toIdx?: number): ChainEntry[] {
    if (toIdx !== undefined) {
      return (this.db.prepare('SELECT * FROM hash_chain WHERE idx >= ? AND idx <= ? ORDER BY idx ASC').all(fromIdx, toIdx) as ChainRow[]).map(rowToEntry);
    }
    return (this.db.prepare('SELECT * FROM hash_chain WHERE idx >= ? ORDER BY idx ASC').all(fromIdx) as ChainRow[]).map(rowToEntry);
  }

  /** Get the last N entries */
  recent(limit = 50): ChainEntry[] {
    return (this.db.prepare('SELECT * FROM hash_chain ORDER BY idx DESC LIMIT ?').all(limit) as ChainRow[]).map(rowToEntry).reverse();
  }

  /** Get total chain length */
  length(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM hash_chain').get() as { cnt: number };
    return row.cnt;
  }

  /** Verify the entire chain integrity */
  verifyIntegrity(): { valid: boolean; brokenAt?: number; expected?: string; actual?: string } {
    const entries = this.db.prepare('SELECT * FROM hash_chain ORDER BY idx ASC').all() as ChainRow[];
    let prevHash = GENESIS_HASH;

    for (const row of entries) {
      // Check previousHash links correctly
      if (row.previous_hash !== prevHash) {
        return { valid: false, brokenAt: row.idx, expected: prevHash, actual: row.previous_hash };
      }

      // Recompute hash
      const expectedHash = createHash('sha256')
        .update(`${row.timestamp}:${row.action}:${row.data_hash}:${row.previous_hash}`)
        .digest('hex');

      if (row.hash !== expectedHash) {
        return { valid: false, brokenAt: row.idx, expected: expectedHash, actual: row.hash };
      }

      prevHash = row.hash;
    }

    return { valid: true };
  }

  /** Verify a single entry against the previous one */
  verifyEntry(idx: number): boolean {
    const entry = this.get(idx);
    if (!entry) return false;

    const prevEntry = idx > 1 ? this.get(idx - 1) : null;
    const expectedPrev = prevEntry ? prevEntry.hash : GENESIS_HASH;

    if (entry.previousHash !== expectedPrev) return false;

    const expectedHash = createHash('sha256')
      .update(`${entry.timestamp}:${entry.action}:${entry.dataHash}:${entry.previousHash}`)
      .digest('hex');

    return entry.hash === expectedHash;
  }
}

interface ChainRow {
  idx: number;
  timestamp: string;
  action: string;
  data_hash: string;
  previous_hash: string;
  hash: string;
  metadata: string | null;
}

function rowToEntry(row: ChainRow): ChainEntry {
  return {
    idx: row.idx,
    timestamp: row.timestamp,
    action: row.action as ChainAction,
    dataHash: row.data_hash,
    previousHash: row.previous_hash,
    hash: row.hash,
    metadata: row.metadata,
  };
}
