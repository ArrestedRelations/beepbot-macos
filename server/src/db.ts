import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { initMemoryTables } from './memory-system.js';

const DATA_DIR = process.env.BEEPBOT_DATA_DIR
  || (process.platform === 'win32'
    ? path.join(process.env.APPDATA || os.homedir(), 'beepbot-v2')
    : path.join(os.homedir(), '.beepbot-v2'));

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

  // Task run history
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_runs (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      status      TEXT NOT NULL CHECK (status IN ('ok', 'error', 'skipped')),
      started_at  TEXT NOT NULL,
      duration_ms INTEGER,
      error       TEXT,
      manual      INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_runs_created ON task_runs(created_at DESC);
  `);

  // Conversations + messages
  migrateChat(db);

  // Network / P2P tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS peers (
      bot_id          TEXT PRIMARY KEY,
      short_id        TEXT NOT NULL,
      public_key      TEXT NOT NULL,
      peer_id         TEXT,
      multiaddrs      TEXT,
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

    CREATE TABLE IF NOT EXISTS ledger_events (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id       TEXT NOT NULL UNIQUE,
      bot_id         TEXT NOT NULL,
      sequence       INTEGER NOT NULL,
      timestamp      TEXT NOT NULL,
      action         TEXT NOT NULL,
      proof_hash     TEXT NOT NULL,
      previous_hash  TEXT NOT NULL,
      hash           TEXT NOT NULL,
      signature      TEXT NOT NULL DEFAULT '',
      metadata       TEXT,
      received_at    TEXT DEFAULT (datetime('now')),
      UNIQUE(bot_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_bot_seq ON ledger_events(bot_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_ledger_action ON ledger_events(action);
    CREATE INDEX IF NOT EXISTS idx_ledger_timestamp ON ledger_events(timestamp);

    CREATE TABLE IF NOT EXISTS merkle_anchors (
      id             TEXT PRIMARY KEY,
      bot_id         TEXT NOT NULL,
      merkle_root    TEXT NOT NULL,
      from_sequence  INTEGER NOT NULL,
      to_sequence    INTEGER NOT NULL,
      timestamp      TEXT NOT NULL,
      signature      TEXT NOT NULL,
      verified       INTEGER DEFAULT 0,
      created_at     TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_anchors_bot ON merkle_anchors(bot_id, to_sequence);

    CREATE TABLE IF NOT EXISTS agent_cards (
      bot_id         TEXT PRIMARY KEY,
      card_json      TEXT NOT NULL,
      verified       INTEGER DEFAULT 0,
      first_seen     TEXT DEFAULT (datetime('now')),
      last_seen      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_cards_last_seen ON agent_cards(last_seen);

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

    -- PoUW Economy tables

    CREATE TABLE IF NOT EXISTS token_balances (
      bot_id         TEXT PRIMARY KEY,
      balance        REAL NOT NULL DEFAULT 0,
      total_earned   REAL NOT NULL DEFAULT 0,
      total_spent    REAL NOT NULL DEFAULT 0,
      last_updated   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS improvement_reviews (
      id             TEXT PRIMARY KEY,
      update_id      TEXT NOT NULL,
      reviewer_bot_id TEXT NOT NULL,
      vote           TEXT NOT NULL CHECK (vote IN ('APPROVE', 'REJECT')),
      review_notes_hash TEXT NOT NULL,
      timestamp      TEXT NOT NULL,
      signature      TEXT NOT NULL,
      created_at     TEXT DEFAULT (datetime('now')),
      UNIQUE(update_id, reviewer_bot_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_update ON improvement_reviews(update_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON improvement_reviews(reviewer_bot_id);

    CREATE TABLE IF NOT EXISTS epoch_state (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      current_epoch  INTEGER NOT NULL DEFAULT 0,
      proof_count    INTEGER NOT NULL DEFAULT 0,
      last_boundary  TEXT
    );
    INSERT OR IGNORE INTO epoch_state (id, current_epoch, proof_count) VALUES (1, 0, 0);
  `);

  // Migrate peers table: add peer_id and multiaddrs columns if missing
  migratePeers(db);

  // Migrate ledger_events: rename data_hash -> proof_hash, add signature
  migrateLedgerEvents(db);

  // Vault tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_entries (
      id             TEXT PRIMARY KEY,
      category       TEXT NOT NULL,
      label          TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      iv             TEXT NOT NULL,
      auth_tag       TEXT NOT NULL DEFAULT '',
      icon           TEXT,
      favorite       INTEGER DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vault_entries_category ON vault_entries(category);
    CREATE INDEX IF NOT EXISTS idx_vault_entries_label ON vault_entries(label);
    CREATE INDEX IF NOT EXISTS idx_vault_entries_favorite ON vault_entries(favorite);

    CREATE TABLE IF NOT EXISTS vault_access_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id        TEXT NOT NULL,
      access_type     TEXT NOT NULL,
      accessor        TEXT NOT NULL,
      context         TEXT,
      conversation_id TEXT,
      task_id         TEXT,
      fields_accessed TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vault_access_entry ON vault_access_log(entry_id);
    CREATE INDEX IF NOT EXISTS idx_vault_access_time ON vault_access_log(created_at);

    CREATE TABLE IF NOT EXISTS vault_spending_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id        TEXT NOT NULL,
      amount_cents    INTEGER NOT NULL,
      merchant        TEXT,
      description     TEXT,
      status          TEXT NOT NULL DEFAULT 'completed',
      conversation_id TEXT,
      task_id         TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vault_spend_entry ON vault_spending_log(entry_id);
    CREATE INDEX IF NOT EXISTS idx_vault_spend_time ON vault_spending_log(created_at);

    CREATE TABLE IF NOT EXISTS vault_otp_requests (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id        TEXT NOT NULL,
      otp_method      TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      code            TEXT,
      requested_at    TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at     TEXT,
      conversation_id TEXT,
      task_id         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_vault_otp_entry ON vault_otp_requests(entry_id);
    CREATE INDEX IF NOT EXISTS idx_vault_otp_status ON vault_otp_requests(status);
  `);

  // Admin API usage cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_usage_cache (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type        TEXT NOT NULL DEFAULT 'messages',
      bucket_date        TEXT NOT NULL,
      model              TEXT NOT NULL DEFAULT '',
      input_tokens       INTEGER DEFAULT 0,
      output_tokens      INTEGER DEFAULT 0,
      cache_read_tokens  INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      estimated_cost_cents INTEGER DEFAULT 0,
      fetched_at         TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(report_type, bucket_date, model)
    );
    CREATE INDEX IF NOT EXISTS idx_admin_usage_date ON admin_usage_cache(bucket_date);

    CREATE TABLE IF NOT EXISTS admin_code_metrics (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_date        TEXT NOT NULL,
      actor_email        TEXT NOT NULL DEFAULT '',
      num_sessions       INTEGER DEFAULT 0,
      commits            INTEGER DEFAULT 0,
      pull_requests      INTEGER DEFAULT 0,
      lines_added        INTEGER DEFAULT 0,
      lines_removed      INTEGER DEFAULT 0,
      tool_actions       TEXT DEFAULT '{}',
      terminal_type      TEXT DEFAULT '',
      fetched_at         TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(metric_date, actor_email)
    );
    CREATE INDEX IF NOT EXISTS idx_admin_code_date ON admin_code_metrics(metric_date);
  `);

  // Memory system tables
  initMemoryTables(db);

  return db;
}

function migratePeers(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(peers)").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has('peer_id')) {
    db.exec('ALTER TABLE peers ADD COLUMN peer_id TEXT');
  }
  if (!colNames.has('multiaddrs')) {
    db.exec('ALTER TABLE peers ADD COLUMN multiaddrs TEXT');
  }
}

function migrateLedgerEvents(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(ledger_events)").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map(c => c.name));

  // Rename data_hash -> proof_hash (SQLite doesn't support RENAME COLUMN in older versions, so add new + copy)
  if (colNames.has('data_hash') && !colNames.has('proof_hash')) {
    db.exec('ALTER TABLE ledger_events ADD COLUMN proof_hash TEXT NOT NULL DEFAULT ""');
    db.exec('UPDATE ledger_events SET proof_hash = data_hash');
  }
  if (!colNames.has('signature')) {
    db.exec("ALTER TABLE ledger_events ADD COLUMN signature TEXT NOT NULL DEFAULT ''");
  }
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
