import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { initMemoryTables } from './memory-system.js';

const DATA_DIR = path.join(os.homedir(), '.beepbot-v2');

export function getDataDir(): string {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  return DATA_DIR;
}

export function createDb(): Database.Database {
  const dbPath = path.join(getDataDir(), 'beepbot.db');
  const db = new Database(dbPath);

  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('busy_timeout = 60000');
  try { db.exec('ANALYZE'); } catch { /* ok on first run */ }
  try { db.pragma('optimize'); } catch { /* ok on first run */ }
  console.log('[db] performance pragmas applied (WAL, 64MB cache, 256MB mmap)');

  // --- Core schema ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS provider_keys (
      slug       TEXT PRIMARY KEY,
      ciphertext TEXT NOT NULL,
      iv         TEXT NOT NULL,
      auth_tag   TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_usage_log (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id     TEXT,
      provider            TEXT NOT NULL,
      model               TEXT NOT NULL,
      slot                TEXT DEFAULT 'chat',
      tokens_in           INTEGER DEFAULT 0,
      tokens_out          INTEGER DEFAULT 0,
      cache_read_tokens   INTEGER DEFAULT 0,
      cache_write_tokens  INTEGER DEFAULT 0,
      duration_ms         INTEGER DEFAULT 0,
      created_at          TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_api_usage_provider ON api_usage_log(provider);

    CREATE TABLE IF NOT EXISTS compaction_log (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      summary         TEXT NOT NULL,
      tokens_before   INTEGER,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_compaction_conv ON compaction_log(conversation_id);
  `);

  // Scheduled tasks
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      cron_expr    TEXT NOT NULL,
      task_type    TEXT NOT NULL CHECK (task_type IN ('agent_turn', 'system_check')),
      task_payload TEXT DEFAULT '{}',
      enabled      INTEGER DEFAULT 1,
      last_run     TEXT,
      next_run     TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled ON scheduled_tasks(enabled);
  `);

  // Conversations + messages
  migrateChat(db);

  // Network / P2P tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS peers (
      bot_id          TEXT PRIMARY KEY,
      short_id        TEXT NOT NULL,
      public_key      TEXT NOT NULL,
      host            TEXT,
      port            INTEGER,
      reputation      REAL DEFAULT 100,
      last_seen       TEXT,
      hash_chain_head TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hash_chain (
      idx            INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp      TEXT NOT NULL,
      action         TEXT NOT NULL,
      data_hash      TEXT NOT NULL,
      previous_hash  TEXT NOT NULL,
      hash           TEXT NOT NULL UNIQUE,
      metadata       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hash_chain_action ON hash_chain(action);

    CREATE TABLE IF NOT EXISTS network_tasks (
      id                TEXT PRIMARY KEY,
      description       TEXT NOT NULL,
      requester_bot_id  TEXT NOT NULL,
      claimer_bot_id    TEXT,
      status            TEXT DEFAULT 'pending',
      result            TEXT,
      result_signature  TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      completed_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_network_tasks_status ON network_tasks(status);

    CREATE TABLE IF NOT EXISTS hill_messages (
      id              TEXT PRIMARY KEY,
      sender_bot_id   TEXT NOT NULL,
      sender_short_id TEXT NOT NULL,
      display_name    TEXT,
      content         TEXT NOT NULL,
      timestamp       INTEGER NOT NULL,
      received_at     TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_hill_messages_timestamp ON hill_messages(timestamp);

    CREATE TABLE IF NOT EXISTS updates (
      id              TEXT PRIMARY KEY,
      from_bot_id     TEXT NOT NULL,
      from_short_id   TEXT NOT NULL,
      description     TEXT NOT NULL,
      codebase_hash   TEXT NOT NULL,
      previous_hash   TEXT NOT NULL,
      changed_files   TEXT NOT NULL,
      status          TEXT DEFAULT 'available',
      signature       TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      applied_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_updates_status ON updates(status);
    CREATE INDEX IF NOT EXISTS idx_updates_from ON updates(from_bot_id);

    CREATE TABLE IF NOT EXISTS hill_read_state (
      bot_id TEXT PRIMARY KEY,
      last_read_timestamp INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Memory system tables
  initMemoryTables(db);

  return db;
}

function migrateChat(db: Database.Database): void {
  const hasConversations = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
  ).get();

  if (!hasConversations) {
    db.exec(`
      CREATE TABLE conversations (
        id          TEXT PRIMARY KEY,
        title       TEXT DEFAULT 'New Conversation',
        session_id  TEXT,
        model       TEXT DEFAULT 'sonnet',
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_conversations_updated ON conversations(updated_at);

      CREATE TABLE messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content         TEXT NOT NULL DEFAULT '',
        tool_calls      TEXT,
        thinking        TEXT,
        tokens_in       INTEGER DEFAULT 0,
        tokens_out      INTEGER DEFAULT 0,
        model           TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_messages_conv_created ON messages(conversation_id, created_at);
      CREATE INDEX idx_messages_created ON messages(created_at);
      CREATE INDEX idx_messages_conv_role ON messages(conversation_id, role, created_at DESC);
    `);
  }
}
