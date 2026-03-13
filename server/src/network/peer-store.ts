import type Database from 'better-sqlite3';

export interface Peer {
  botId: string;
  shortId: string;
  publicKey: string;
  peerId: string | null;
  multiaddrs: string[];
  host: string;
  port: number;
  reputation: number;
  lastSeen: string;
  hashChainHead: string | null;
  connected: boolean;
}

export class PeerStore {
  constructor(private db: Database.Database) {}

  upsert(peer: Omit<Peer, 'connected'>): void {
    const multiaddrsJson = JSON.stringify(peer.multiaddrs);
    this.db.prepare(`
      INSERT INTO peers (bot_id, short_id, public_key, peer_id, multiaddrs, host, port, reputation, last_seen, hash_chain_head, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(bot_id) DO UPDATE SET
        peer_id = excluded.peer_id,
        multiaddrs = excluded.multiaddrs,
        host = excluded.host,
        port = excluded.port,
        last_seen = excluded.last_seen,
        hash_chain_head = excluded.hash_chain_head,
        updated_at = datetime('now')
    `).run(
      peer.botId, peer.shortId, peer.publicKey, peer.peerId, multiaddrsJson,
      peer.host, peer.port, peer.reputation, peer.lastSeen, peer.hashChainHead,
    );
  }

  get(botId: string): Peer | null {
    const row = this.db.prepare('SELECT * FROM peers WHERE bot_id = ?').get(botId) as PeerRow | undefined;
    return row ? rowToPeer(row) : null;
  }

  getByPeerId(peerId: string): Peer | null {
    const row = this.db.prepare('SELECT * FROM peers WHERE peer_id = ?').get(peerId) as PeerRow | undefined;
    return row ? rowToPeer(row) : null;
  }

  list(): Peer[] {
    return (this.db.prepare('SELECT * FROM peers ORDER BY last_seen DESC').all() as PeerRow[]).map(rowToPeer);
  }

  updateReputation(botId: string, delta: number, reason: string): { oldRep: number; newRep: number } | null {
    const peer = this.get(botId);
    if (!peer) return null;
    const oldRep = peer.reputation;
    const newRep = Math.max(0, Math.min(1000, oldRep + delta));
    this.db.prepare("UPDATE peers SET reputation = ?, updated_at = datetime('now') WHERE bot_id = ?").run(newRep, botId);
    return { oldRep, newRep };
  }

  touch(botId: string): void {
    this.db.prepare("UPDATE peers SET last_seen = datetime('now'), updated_at = datetime('now') WHERE bot_id = ?").run(botId);
  }

  updateChainHead(botId: string, head: string): void {
    this.db.prepare("UPDATE peers SET hash_chain_head = ?, updated_at = datetime('now') WHERE bot_id = ?").run(head, botId);
  }

  remove(botId: string): boolean {
    return this.db.prepare('DELETE FROM peers WHERE bot_id = ?').run(botId).changes > 0;
  }

  getActive(minReputation = 10): Peer[] {
    return (this.db.prepare('SELECT * FROM peers WHERE reputation >= ? ORDER BY reputation DESC').all(minReputation) as PeerRow[]).map(rowToPeer);
  }
}

interface PeerRow {
  bot_id: string;
  short_id: string;
  public_key: string;
  peer_id: string | null;
  multiaddrs: string | null;
  host: string;
  port: number;
  reputation: number;
  last_seen: string;
  hash_chain_head: string | null;
}

function rowToPeer(row: PeerRow): Peer {
  let multiaddrs: string[] = [];
  if (row.multiaddrs) {
    try { multiaddrs = JSON.parse(row.multiaddrs); } catch { /* ignore */ }
  }
  return {
    botId: row.bot_id,
    shortId: row.short_id,
    publicKey: row.public_key,
    peerId: row.peer_id,
    multiaddrs,
    host: row.host,
    port: row.port,
    reputation: row.reputation,
    lastSeen: row.last_seen,
    hashChainHead: row.hash_chain_head,
    connected: false,
  };
}
