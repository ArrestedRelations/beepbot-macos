import type Database from 'better-sqlite3';

export interface Peer {
  botId: string;
  shortId: string;
  publicKey: string;    // base64 DER
  host: string;
  port: number;
  reputation: number;
  lastSeen: string;
  hashChainHead: string | null;
  connected: boolean;   // runtime state, not persisted
}

export class PeerStore {
  constructor(private db: Database.Database) {}

  /** Upsert a peer */
  upsert(peer: Omit<Peer, 'connected'>): void {
    this.db.prepare(`
      INSERT INTO peers (bot_id, short_id, public_key, host, port, reputation, last_seen, hash_chain_head, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(bot_id) DO UPDATE SET
        host = excluded.host,
        port = excluded.port,
        last_seen = excluded.last_seen,
        hash_chain_head = excluded.hash_chain_head,
        updated_at = datetime('now')
    `).run(peer.botId, peer.shortId, peer.publicKey, peer.host, peer.port, peer.reputation, peer.lastSeen, peer.hashChainHead);
  }

  /** Get a peer by bot ID */
  get(botId: string): Peer | null {
    const row = this.db.prepare('SELECT * FROM peers WHERE bot_id = ?').get(botId) as PeerRow | undefined;
    if (!row) return null;
    return rowToPeer(row);
  }

  /** List all known peers */
  list(): Peer[] {
    const rows = this.db.prepare('SELECT * FROM peers ORDER BY last_seen DESC').all() as PeerRow[];
    return rows.map(rowToPeer);
  }

  /** Update reputation */
  updateReputation(botId: string, delta: number, reason: string): { oldRep: number; newRep: number } | null {
    const peer = this.get(botId);
    if (!peer) return null;
    const oldRep = peer.reputation;
    const newRep = Math.max(0, Math.min(1000, oldRep + delta));
    this.db.prepare('UPDATE peers SET reputation = ?, updated_at = datetime(\'now\') WHERE bot_id = ?').run(newRep, botId);
    return { oldRep, newRep };
  }

  /** Update last seen */
  touch(botId: string): void {
    this.db.prepare("UPDATE peers SET last_seen = datetime('now'), updated_at = datetime('now') WHERE bot_id = ?").run(botId);
  }

  /** Update hash chain head */
  updateChainHead(botId: string, head: string): void {
    this.db.prepare("UPDATE peers SET hash_chain_head = ?, updated_at = datetime('now') WHERE bot_id = ?").run(head, botId);
  }

  /** Remove a peer */
  remove(botId: string): boolean {
    const result = this.db.prepare('DELETE FROM peers WHERE bot_id = ?').run(botId);
    return result.changes > 0;
  }

  /** Get peers with reputation above threshold */
  getActive(minReputation = 10): Peer[] {
    const rows = this.db.prepare('SELECT * FROM peers WHERE reputation >= ? ORDER BY reputation DESC').all(minReputation) as PeerRow[];
    return rows.map(rowToPeer);
  }
}

interface PeerRow {
  bot_id: string;
  short_id: string;
  public_key: string;
  host: string;
  port: number;
  reputation: number;
  last_seen: string;
  hash_chain_head: string | null;
}

function rowToPeer(row: PeerRow): Peer {
  return {
    botId: row.bot_id,
    shortId: row.short_id,
    publicKey: row.public_key,
    host: row.host,
    port: row.port,
    reputation: row.reputation,
    lastSeen: row.last_seen,
    hashChainHead: row.hash_chain_head,
    connected: false,
  };
}
