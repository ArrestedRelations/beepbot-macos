import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { randomUUID } from 'crypto';
import { spawn, execFile, type ChildProcess } from 'child_process';
import { execSync } from 'child_process';
import { promisify } from 'util';
import { statSync, existsSync } from 'fs';
import { join } from 'path';
import { createDb, getDataDir } from './db.js';
import { getAuthMethod, isAuthenticated, clearCachedAuth } from './auth.js';
import { maskKey, getProviderKey, setProviderKey, deleteProviderKey } from './crypto.js';
import { synthesizeSpeech } from './tts.js';
import { transcribeAudio } from './stt.js';
import { IPCClient } from './ipc.js';
import { Scheduler, type ScheduledTask } from './scheduler.js';
import { listMemoryFiles, readMemoryFile, writeMemoryFile } from './memory.js';
import { runDailySynthesis } from './memory-system.js';
import { BackgroundTaskManager } from './background-tasks.js';
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile } from './workspace.js';
import { listSkills } from './skills.js';
import { FileWatcher } from './file-watcher.js';
import { initIdentity, getIdentity } from './identity.js';
import { NetworkManager } from './network/index.js';
import { logUsage } from './usage-tracker.js';

// WebSocket client type
interface WsClient { send: (data: string) => void }

const PORT = parseInt(process.env.PORT || '3004', 10);
const startedAt = Date.now();

// Login process state
let loginProcess: ChildProcess | null = null;
let loginCancelled = false;

// Initialize database
const db = createDb();

// Track connected WebSocket clients
const wsClients = new Set<WsClient>();

function broadcast(data: Record<string, unknown>): void {
  const json = JSON.stringify(data);
  for (const ws of wsClients) {
    try { ws.send(json); } catch { /* disconnected */ }
  }
}

// ===== IPC Client (connects to Agent Runtime) =====
const agentIPC = new IPCClient();
let chatRunning = false;

// Forward agent events from runtime to WebSocket clients
agentIPC.on('event', (type: string, payload: unknown) => {
  const event = payload as Record<string, unknown>;

  switch (event.type) {
    case 'status':
      broadcast({ type: 'status', data: event.data });
      if (event.data === 'idle') chatRunning = false;
      if (event.data === 'thinking') chatRunning = true;
      break;
    case 'text':
      broadcast({ type: 'text', data: event.data });
      break;
    case 'thinking':
      broadcast({ type: 'thinking', data: event.data });
      break;
    case 'tool_call': {
      broadcast({ type: 'tool_call', data: event.data });
      const tc = event.data as { name: string };
      logActivity({ type: 'tool_call', summary: tc.name, conversationId: event.conversationId as string });
      network.recordAction('TOOL_CALL', tc.name, { conversationId: event.conversationId });
      break;
    }
    case 'tool_result':
      broadcast({ type: 'tool_result', data: event.data });
      break;
    case 'sub_agent': {
      broadcast({ type: 'sub_agent', data: event.data });
      const sa = event.data as { event: string; description?: string };
      if (sa.event === 'started' || sa.event === 'spawning') {
        logActivity({ type: 'sub_agent', summary: sa.description || 'Sub-agent spawned' });
      }
      break;
    }
    case 'ask_user':
      broadcast({ type: 'ask_user', data: event.data });
      break;
    case 'done':
      broadcast({ type: 'done', data: event.data });
      broadcast({ type: 'status', data: 'idle' });
      chatRunning = false;
      break;
    case 'error':
      broadcast({ type: 'error', data: event.data });
      logActivity({ type: 'error', summary: String(event.data).slice(0, 100) });
      break;
    case 'chat_started':
      logActivity({ type: 'chat', summary: (event.data as Record<string, string>).content, conversationId: (event.data as Record<string, string>).conversationId });
      network.recordAction('CHAT', (event.data as Record<string, string>).content?.slice(0, 200) || '', { conversationId: (event.data as Record<string, string>).conversationId });
      break;
    case 'chat_complete': {
      chatRunning = false;
      const cc = event.data as { conversationId: string; voice?: boolean };
      if (cc.voice) {
        void handleTTSForLastMessage(cc.conversationId);
      }
      break;
    }
  }
});

agentIPC.on('disconnected', () => {
  console.warn('[api-server] Lost connection to Agent Runtime');
  broadcast({ type: 'runtime_status', data: 'disconnected' });
});

agentIPC.on('connected', () => {
  console.log('[api-server] Reconnected to Agent Runtime');
  broadcast({ type: 'runtime_status', data: 'connected' });
});

async function handleTTSForLastMessage(conversationId: string): Promise<void> {
  try {
    const lastMsg = db.prepare(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1"
    ).get(conversationId) as { content: string } | undefined;
    if (lastMsg?.content) {
      const base64Audio = await synthesizeSpeech(db, lastMsg.content.slice(0, 2000));
      if (base64Audio) {
        broadcast({ type: 'tts_audio', data: base64Audio });
      }
    }
  } catch (err) {
    const ttsErr = err instanceof Error ? err.message : String(err);
    console.warn('[tts] Error:', ttsErr);
    broadcast({ type: 'tts_error', data: ttsErr });
  }
}

// ===== Agent Mode (read from DB for API responses) =====
function getAgentMode(): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'agent_mode'").get() as { value: string } | undefined;
  return row?.value || 'autonomous';
}

function getPermissionMode(): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'permission_mode'").get() as { value: string } | undefined;
  return row?.value || 'bypassPermissions';
}

function getSandboxEnabled(): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'sandbox_enabled'").get() as { value: string } | undefined;
  return row?.value !== 'false';
}

// ===== Scheduler =====
const scheduler = new Scheduler(db);
scheduler.setBroadcast(broadcast);

// Task executor: runs scheduled tasks through the agent
scheduler.setExecutor(async (task: ScheduledTask) => {
  if (task.task_type === 'agent_turn') {
    const payload = JSON.parse(task.task_payload) as { prompt?: string };
    const prompt = payload.prompt || `Run scheduled task: ${task.name}`;
    await runChat(prompt);
  } else if (task.task_type === 'system_check') {
    // System health checks — just broadcast the status
    broadcast({ type: 'scheduler_event', data: { event: 'system_check', name: task.name, status: 'ok' } });
  }
});

scheduler.start();

// ===== Daily Memory Synthesis =====
// Check every hour if daily synthesis is needed
setInterval(() => {
  void runDailySynthesis(db);
}, 3600_000); // 1 hour

// ===== Background Task Manager =====
const bgTasks = new BackgroundTaskManager();
bgTasks.setBroadcast(broadcast);

// ===== File Watcher =====
const fileWatcher = new FileWatcher();
fileWatcher.setBroadcast(broadcast);
fileWatcher.start();

// ===== Bot Identity =====
const botIdentity = initIdentity();
console.log(`[identity] Bot ID: ${botIdentity.shortId}`);

// ===== P2P Network =====
const P2P_PORT = parseInt(process.env.BEEPBOT_P2P_PORT || '3005', 10);
const PROJECT_ROOT = join(process.cwd(), '..');  // sidecar/ -> project root
const network = new NetworkManager(db, P2P_PORT, PROJECT_ROOT);
network.setBroadcast(broadcast);

// ===== Activity Log (in-memory ring buffer) =====
interface ActivityEntry {
  id: string;
  timestamp: string;
  type: 'chat' | 'tool_call' | 'sub_agent' | 'scheduler' | 'error' | 'system';
  summary: string;
  conversationId?: string;
}

const activityLog: ActivityEntry[] = [];
const MAX_ACTIVITY = 200;

function logActivity(entry: Omit<ActivityEntry, 'id' | 'timestamp'>): void {
  activityLog.push({ ...entry, id: randomUUID(), timestamp: new Date().toISOString() });
  if (activityLog.length > MAX_ACTIVITY) activityLog.shift();
}

// ===== Log Buffer (in-memory ring buffer for streaming logs) =====
interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
}

const logBuffer: LogEntry[] = [];
const MAX_LOGS = 500;

function addLog(level: LogEntry['level'], message: string, source?: string): void {
  const entry: LogEntry = { id: randomUUID(), timestamp: new Date().toISOString(), level, message, source };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  broadcast({ type: 'log', data: entry });
}

// Override console methods to capture logs
const origConsoleLog = console.log.bind(console);
const origConsoleWarn = console.warn.bind(console);
const origConsoleError = console.error.bind(console);

console.log = (...args: unknown[]) => {
  origConsoleLog(...args);
  addLog('info', args.map(String).join(' '), 'sidecar');
};
console.warn = (...args: unknown[]) => {
  origConsoleWarn(...args);
  addLog('warn', args.map(String).join(' '), 'sidecar');
};
console.error = (...args: unknown[]) => {
  origConsoleError(...args);
  addLog('error', args.map(String).join(' '), 'sidecar');
};

// ===== Chat Runner (via IPC to Agent Runtime) =====

async function runChat(content: string, voice?: boolean): Promise<void> {
  if (!agentIPC.isConnected()) {
    broadcast({ type: 'error', data: 'Agent Runtime not connected. Please wait...' });
    return;
  }
  try {
    const id = randomUUID();
    await agentIPC.request('chat', { content, voice, id });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[chat] Error:', errMsg);
    broadcast({ type: 'error', data: errMsg });
  }
}

// ===== Fastify server =====
const app = Fastify({ logger: false });
await app.register(fastifyWebsocket);

// Allow cross-origin requests from the local dashboard (localhost:3003)
app.addHook('onRequest', async (_req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type');
});
app.options('*', async (_req, reply) => { reply.send(); });

// --- Health ---
// --- System Restart ---
app.post('/api/system/restart', async () => {
  broadcast({ type: 'system', data: 'Restarting BeepBot...' });

  // Spawn detached restart process that outlives us
  const restartScript = `sleep 1 && cd "${join(process.cwd(), '..')}" && npm run kill-tauri && sleep 1 && npm run start-tauri`;
  spawn('bash', ['-c', restartScript], {
    detached: true,
    stdio: 'ignore',
    cwd: join(process.cwd(), '..'),
  }).unref();

  // Give WebSocket time to deliver the message
  setTimeout(() => process.exit(0), 500);

  return { ok: true, message: 'Restarting...' };
});

app.get('/api/health', async () => ({
  ok: true,
  version: '0.1.0',
  authenticated: isAuthenticated(),
  agentMode: getAgentMode(),
  runtimeConnected: agentIPC.isConnected(),
}));

// --- Auth ---
app.get('/api/auth/status', async () => ({
  authenticated: isAuthenticated(),
  method: getAuthMethod(),
}));

app.post('/api/auth/api-key', async (req) => {
  const { key } = req.body as { key: string };
  if (!key) return { error: 'Missing key' };
  setProviderKey(db, 'anthropic', key);
  process.env.ANTHROPIC_API_KEY = key;
  clearCachedAuth();
  return { ok: true, masked: maskKey(key) };
});

app.post('/api/auth/refresh', async () => {
  clearCachedAuth();
  return { authenticated: isAuthenticated(), method: getAuthMethod() };
});

app.post('/api/auth/logout', async () => {
  // Delete OAuth credentials from macOS Keychain
  try {
    execSync('security delete-generic-password -s "Claude Code-credentials"', {
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000,
    });
  } catch { /* may not exist */ }
  // Also clear any stored API key
  deleteProviderKey(db, 'anthropic');
  delete process.env.ANTHROPIC_API_KEY;
  clearCachedAuth();
  // Tell Agent Runtime to refresh auth
  if (agentIPC.isConnected()) {
    agentIPC.send('refresh_auth', {});
  }
  return { ok: true };
});

// --- Provider Keys ---
app.get('/api/keys', async () => {
  const rows = db.prepare('SELECT slug, created_at, updated_at FROM provider_keys').all() as Array<{
    slug: string; created_at: string; updated_at: string;
  }>;
  return rows.map(r => {
    const plain = getProviderKey(db, r.slug);
    return { slug: r.slug, masked: plain ? maskKey(plain) : null, created_at: r.created_at };
  });
});

app.post('/api/keys/:slug', async (req) => {
  const { slug } = req.params as { slug: string };
  const { key } = req.body as { key: string };
  if (!key) return { error: 'Missing key' };
  setProviderKey(db, slug, key);
  return { ok: true, masked: maskKey(key) };
});

app.delete('/api/keys/:slug', async (req) => {
  const { slug } = req.params as { slug: string };
  deleteProviderKey(db, slug);
  return { ok: true };
});

// --- Agent Mode ---
app.get('/api/agent/mode', async () => ({ mode: getAgentMode() }));

app.post('/api/agent/mode', async (req) => {
  const { mode } = req.body as { mode: string };
  if (!['autonomous', 'ask', 'stop'].includes(mode)) return { error: 'Invalid mode' };
  if (agentIPC.isConnected()) {
    await agentIPC.request('set_mode', { mode });
  }
  broadcast({ type: 'agent_mode', mode });
  return { ok: true, mode };
});

// --- Permission Mode ---
app.get('/api/agent/permission-mode', async () => ({ mode: getPermissionMode() }));

app.post('/api/agent/permission-mode', async (req) => {
  const { mode } = req.body as { mode: string };
  if (!['default', 'acceptEdits', 'bypassPermissions'].includes(mode)) return { error: 'Invalid mode' };
  if (agentIPC.isConnected()) {
    await agentIPC.request('set_permission_mode', { mode });
  }
  broadcast({ type: 'permission_mode', mode });
  return { ok: true, mode };
});

// --- Sandbox ---
app.get('/api/agent/sandbox', async () => ({ enabled: getSandboxEnabled() }));

app.post('/api/agent/sandbox', async (req) => {
  const { enabled } = req.body as { enabled: boolean };
  if (agentIPC.isConnected()) {
    await agentIPC.request('set_sandbox', { enabled });
  }
  broadcast({ type: 'sandbox', enabled });
  return { ok: true, enabled };
});

// --- Settings (generic key-value) ---
app.get('/api/settings/:key', async (req) => {
  const { key } = req.params as { key: string };
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return { key, value: row?.value ?? null };
});

app.post('/api/settings/:key', async (req) => {
  const { key } = req.params as { key: string };
  const { value } = req.body as { value: string };
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, value);
  return { ok: true };
});

// --- Conversations ---
app.get('/api/conversations', async () => {
  return db.prepare(`
    SELECT c.id, c.title, c.model, c.created_at, c.updated_at,
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at
    FROM conversations c
    ORDER BY c.updated_at DESC
  `).all();
});

app.get('/api/conversations/active', async () => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'last_conversation_id'")
    .get() as { value: string } | undefined;
  return { id: row?.value || null };
});

app.post('/api/conversations', async () => {
  const id = randomUUID();
  db.prepare("INSERT INTO conversations (id) VALUES (?)").run(id);
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('last_conversation_id', ?, datetime('now'))").run(id);
  // Tell Agent Runtime to reset agent for new conversation
  if (agentIPC.isConnected()) {
    agentIPC.send('new_conversation', {});
  }
  broadcast({ type: 'conversation_created', data: { id } });
  return { id };
});

app.get('/api/conversations/:id/messages', async (req) => {
  const { id } = req.params as { id: string };
  return db.prepare(
    'SELECT id, role, content, tool_calls, thinking, tokens_in, tokens_out, model, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(id);
});

app.post('/api/conversations/:id/activate', async (req) => {
  const { id } = req.params as { id: string };
  const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id);
  if (!conv) return { error: 'Not found' };
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('last_conversation_id', ?, datetime('now'))").run(id);

  // Tell Agent Runtime to switch conversations
  if (agentIPC.isConnected()) {
    agentIPC.send('switch_conversation', { id });
  }

  const messages = db.prepare(
    'SELECT id, role, content, tool_calls, thinking, tokens_in, tokens_out, model, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(id);

  broadcast({ type: 'conversation_switched', data: { id, messages } });
  return { ok: true };
});

app.patch('/api/conversations/:id', async (req) => {
  const { id } = req.params as { id: string };
  const { title } = req.body as { title: string };
  db.prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, id);
  return { ok: true };
});

app.delete('/api/conversations/:id', async (req) => {
  const { id } = req.params as { id: string };
  // Tell Agent Runtime to close agent if this is the active conversation
  if (agentIPC.isConnected()) {
    agentIPC.send('switch_conversation', { id: '' });
  }
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  broadcast({ type: 'conversation_deleted' });
  return { ok: true };
});

// --- Dashboard Stats ---
app.get('/api/dashboard/stats', async () => {
  const conversationCount = (db.prepare('SELECT COUNT(*) as cnt FROM conversations').get() as { cnt: number }).cnt;
  const messageCount = (db.prepare('SELECT COUNT(*) as cnt FROM messages').get() as { cnt: number }).cnt;

  // Usage stats from api_usage_log
  const usageToday = db.prepare(`
    SELECT COALESCE(SUM(tokens_in), 0) as tokens_in, COALESCE(SUM(tokens_out), 0) as tokens_out,
           COUNT(*) as api_calls
    FROM api_usage_log WHERE created_at >= date('now')
  `).get() as { tokens_in: number; tokens_out: number; api_calls: number };

  const usageTotal = db.prepare(`
    SELECT COALESCE(SUM(tokens_in), 0) as tokens_in, COALESCE(SUM(tokens_out), 0) as tokens_out,
           COUNT(*) as api_calls
    FROM api_usage_log
  `).get() as { tokens_in: number; tokens_out: number; api_calls: number };

  // Usage by day (last 14 days)
  const usageByDay = db.prepare(`
    SELECT date(created_at) as day,
           COALESCE(SUM(tokens_in), 0) as tokens_in,
           COALESCE(SUM(tokens_out), 0) as tokens_out,
           COUNT(*) as api_calls
    FROM api_usage_log
    WHERE created_at >= date('now', '-14 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all();

  // Usage by model
  const usageByModel = db.prepare(`
    SELECT model,
           COALESCE(SUM(tokens_in), 0) as tokens_in,
           COALESCE(SUM(tokens_out), 0) as tokens_out,
           COUNT(*) as api_calls
    FROM api_usage_log
    GROUP BY model
    ORDER BY api_calls DESC
  `).all();

  const compactionCount = (db.prepare('SELECT COUNT(*) as cnt FROM compaction_log').get() as { cnt: number }).cnt;
  const scheduledTaskCount = (db.prepare('SELECT COUNT(*) as cnt FROM scheduled_tasks WHERE enabled = 1').get() as { cnt: number }).cnt;

  return {
    conversations: conversationCount,
    messages: messageCount,
    compactions: compactionCount,
    scheduledTasks: scheduledTaskCount,
    usageToday,
    usageTotal,
    usageByDay,
    usageByModel,
    uptime: Date.now() - startedAt,
    agentMode: getAgentMode(),
    agentStatus: chatRunning ? 'running' : 'idle',
    runtimeConnected: agentIPC.isConnected(),
  };
});

// --- Usage API ---
app.get('/api/usage', async () => {
  const usageToday = db.prepare(`
    SELECT COALESCE(SUM(tokens_in), 0) as tokens_in, COALESCE(SUM(tokens_out), 0) as tokens_out,
           COUNT(*) as api_calls
    FROM api_usage_log WHERE created_at >= date('now')
  `).get() as { tokens_in: number; tokens_out: number; api_calls: number };

  const usageTotal = db.prepare(`
    SELECT COALESCE(SUM(tokens_in), 0) as tokens_in, COALESCE(SUM(tokens_out), 0) as tokens_out,
           COUNT(*) as api_calls
    FROM api_usage_log
  `).get() as { tokens_in: number; tokens_out: number; api_calls: number };

  const usageByDay = db.prepare(`
    SELECT date(created_at) as day,
           COALESCE(SUM(tokens_in), 0) as tokens_in,
           COALESCE(SUM(tokens_out), 0) as tokens_out,
           COUNT(*) as api_calls
    FROM api_usage_log
    WHERE created_at >= date('now', '-14 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all();

  const usageByModel = db.prepare(`
    SELECT model,
           COALESCE(SUM(tokens_in), 0) as tokens_in,
           COALESCE(SUM(tokens_out), 0) as tokens_out,
           COUNT(*) as api_calls
    FROM api_usage_log
    GROUP BY model
    ORDER BY api_calls DESC
  `).all();

  const activeSessions = (db.prepare(`
    SELECT COUNT(DISTINCT conversation_id) as cnt
    FROM api_usage_log WHERE created_at >= date('now')
  `).get() as { cnt: number }).cnt;

  return {
    totalTokens: usageTotal.tokens_in + usageTotal.tokens_out,
    totalCost: 0, // cost is estimated client-side from model pricing
    byModel: usageByModel,
    byDay: usageByDay,
    activeSessions,
    usageToday,
    usageTotal,
    usageByDay,
    usageByModel,
  };
});

app.post('/api/usage/log', async (req) => {
  const { model, provider, tokens_in, tokens_out, conversation_id, slot, cache_read_tokens, cache_write_tokens, duration_ms } = req.body as {
    model: string;
    provider?: string;
    tokens_in?: number;
    tokens_out?: number;
    conversation_id?: string;
    slot?: string;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    duration_ms?: number;
  };
  if (!model) return { error: 'Missing model' };

  logUsage(db, {
    model,
    inputTokens: tokens_in ?? 0,
    outputTokens: tokens_out ?? 0,
    conversationId: conversation_id,
    slot: slot ?? 'chat',
    provider: provider ?? 'anthropic',
    cacheReadTokens: cache_read_tokens ?? 0,
    cacheWriteTokens: cache_write_tokens ?? 0,
    durationMs: duration_ms ?? 0,
  });

  return { ok: true };
});

app.get('/api/usage/transactions', async (req) => {
  const rawLimit = (req.query as { limit?: string }).limit;
  const limit = Math.min(Math.max(parseInt(rawLimit || '100', 10) || 100, 1), 500);

  const transactions = db.prepare(`
    SELECT id, model, provider, tokens_in, tokens_out, slot,
           conversation_id, cache_read_tokens, cache_write_tokens,
           duration_ms, created_at
    FROM api_usage_log
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);

  return { transactions, count: transactions.length };
});

// --- Dashboard Activity Feed ---
app.get('/api/dashboard/activity', async () => {
  return activityLog.slice().reverse().slice(0, 50);
});

// --- Compaction Log ---
app.get('/api/dashboard/compactions', async () => {
  return db.prepare(`
    SELECT cl.id, cl.conversation_id, cl.summary, cl.tokens_before, cl.created_at,
           c.title as conversation_title
    FROM compaction_log cl
    LEFT JOIN conversations c ON c.id = cl.conversation_id
    ORDER BY cl.created_at DESC
    LIMIT 50
  `).all();
});

// --- Scheduler CRUD ---
app.get('/api/scheduler/tasks', async () => {
  return scheduler.list();
});

app.get('/api/scheduler/tasks/:id', async (req) => {
  const { id } = req.params as { id: string };
  const task = scheduler.get(id);
  if (!task) return { error: 'Not found' };
  return task;
});

app.post('/api/scheduler/tasks', async (req) => {
  const body = req.body as {
    name: string; cron_expr: string; task_type: 'agent_turn' | 'system_check';
    task_payload?: string; enabled?: boolean;
  };
  if (!body.name || !body.cron_expr || !body.task_type) return { error: 'Missing required fields' };
  return scheduler.create(body);
});

app.patch('/api/scheduler/tasks/:id', async (req) => {
  const { id } = req.params as { id: string };
  const body = req.body as { name?: string; cron_expr?: string; task_type?: string; task_payload?: string; enabled?: boolean };
  const task = scheduler.update(id, body);
  if (!task) return { error: 'Not found' };
  return task;
});

app.delete('/api/scheduler/tasks/:id', async (req) => {
  const { id } = req.params as { id: string };
  return { ok: scheduler.delete(id) };
});

app.post('/api/scheduler/tasks/:id/run', async (req) => {
  const { id } = req.params as { id: string };
  try {
    await scheduler.runNow(id);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// --- Memory ---
app.get('/api/memory', async () => {
  return listMemoryFiles();
});

app.get('/api/memory/:filename', async (req) => {
  const { filename } = req.params as { filename: string };
  const content = readMemoryFile(decodeURIComponent(filename));
  if (content === null) return { error: 'Not found' };
  return { filename, content };
});

app.put('/api/memory/:filename', async (req) => {
  const { filename } = req.params as { filename: string };
  const { content } = req.body as { content: string };
  const ok = writeMemoryFile(decodeURIComponent(filename), content);
  return { ok };
});

// --- System Health ---
app.get('/api/system/project-path', async () => {
  return { ok: true, path: join(process.cwd(), '..') };
});

app.get('/api/system/health', async () => {
  let dbSize = 0;
  try {
    const dbPath = join(getDataDir(), 'beepbot.db');
    dbSize = statSync(dbPath).size;
  } catch { /* ignore */ }

  return {
    ok: true,
    uptime: Date.now() - startedAt,
    dbSizeBytes: dbSize,
    dbSizeMB: Math.round(dbSize / 1024 / 1024 * 100) / 100,
    wsClients: wsClients.size,
    chatRunning,
    agentMode: getAgentMode(),
    permissionMode: getPermissionMode(),
    sandboxEnabled: getSandboxEnabled(),
    runtimeConnected: agentIPC.isConnected(),
    schedulerRunning: true,
    memoryFiles: listMemoryFiles().length,
    backgroundTasks: bgTasks.stats(),
    watchedPaths: fileWatcher.getWatchedPaths().length,
  };
});

// --- Background Tasks ---
app.get('/api/tasks', async (req) => {
  const { status } = (req.query || {}) as { status?: string };
  const validStatuses = ['running', 'completed', 'failed', 'killed'] as const;
  if (status && validStatuses.includes(status as typeof validStatuses[number])) {
    return bgTasks.list(status as typeof validStatuses[number]);
  }
  return bgTasks.list();
});

app.get('/api/tasks/stats', async () => {
  return bgTasks.stats();
});

app.get('/api/tasks/:id', async (req) => {
  const { id } = req.params as { id: string };
  const task = bgTasks.get(id);
  if (!task) return { error: 'Not found' };
  return task;
});

app.get('/api/tasks/:id/output', async (req) => {
  const { id } = req.params as { id: string };
  const { tail } = (req.query || {}) as { tail?: string };
  const output = bgTasks.getOutput(id, tail ? parseInt(tail, 10) : undefined);
  if (!output) return { error: 'Not found' };
  return output;
});

app.post('/api/tasks', async (req) => {
  const body = req.body as { command: string; args?: string[]; cwd?: string; label?: string };
  if (!body.command) return { error: 'Missing command' };
  const task = bgTasks.spawn({
    command: body.command,
    args: body.args,
    cwd: body.cwd,
    label: body.label,
  });
  logActivity({ type: 'system', summary: `Background task started: ${body.label || body.command}` });
  return task;
});

app.post('/api/tasks/:id/kill', async (req) => {
  const { id } = req.params as { id: string };
  const ok = bgTasks.kill(id);
  if (!ok) return { error: 'Task not found or not running' };
  return { ok: true };
});

app.delete('/api/tasks/:id', async (req) => {
  const { id } = req.params as { id: string };
  return { ok: bgTasks.remove(id) };
});

// --- Workspace Files ---
app.get('/api/workspace', async () => {
  return listWorkspaceFiles();
});

app.get('/api/workspace/:filename', async (req) => {
  const { filename } = req.params as { filename: string };
  const content = readWorkspaceFile(decodeURIComponent(filename));
  if (content === null) return { error: 'Not found' };
  return { filename, content };
});

app.put('/api/workspace/:filename', async (req) => {
  const { filename } = req.params as { filename: string };
  const { content } = req.body as { content: string };
  const ok = writeWorkspaceFile(decodeURIComponent(filename), content);
  return { ok };
});

// --- Skills ---
app.get('/api/skills', async () => {
  return listSkills();
});

// --- File Watcher ---
app.get('/api/watcher/paths', async () => {
  return fileWatcher.getWatchedPaths();
});

app.post('/api/watcher/paths', async (req) => {
  const { path: watchPath } = req.body as { path: string };
  if (!watchPath) return { error: 'Missing path' };
  const ok = fileWatcher.addPath(watchPath);
  return { ok };
});

app.delete('/api/watcher/paths', async (req) => {
  const { path: watchPath } = req.body as { path: string };
  if (!watchPath) return { error: 'Missing path' };
  const ok = fileWatcher.removePath(watchPath);
  return { ok };
});

app.get('/api/watcher/events', async () => {
  return fileWatcher.getRecentEvents();
});

// --- MCP Config Viewer ---
app.get('/api/mcp/config', async () => {
  try {
    const configPath = join(getDataDir(), 'mcp.json');
    const { readFileSync } = await import('fs');
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { mcpServers: {} };
  }
});

// --- Identity ---
app.get('/api/identity', async () => {
  return getIdentity();
});

// --- Network / P2P ---
app.get('/api/network/peers', async () => {
  return network.peerStore.list();
});

app.get('/api/network/stats', async () => {
  return { ...network.getStats(), hillUnreadCount: network.getHillUnreadCount() };
});

app.post('/api/network/connect', async (req) => {
  const { host, port } = req.body as { host: string; port: number };
  if (!host || !port) return { error: 'Missing host or port' };
  try {
    await network.connectToPeer(host, port);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

app.post('/api/network/disconnect', async (req) => {
  const { botId } = req.body as { botId: string };
  if (!botId) return { error: 'Missing botId' };
  network.disconnectPeer(botId);
  return { ok: true };
});

app.get('/api/network/chain', async (req) => {
  const { limit: limitStr } = (req.query || {}) as { limit?: string };
  const limit = limitStr ? parseInt(limitStr, 10) : 50;
  return network.hashChain.recent(limit);
});

app.get('/api/network/chain/verify', async () => {
  return network.hashChain.verifyIntegrity();
});

app.post('/api/network/task', async (req) => {
  const { description } = req.body as { description: string };
  if (!description) return { error: 'Missing description' };
  return network.submitTask(description);
});

app.get('/api/network/tasks', async (req) => {
  const { status } = (req.query || {}) as { status?: string };
  if (status) return network.taskRelay.list(status as 'pending' | 'claimed' | 'completed' | 'failed' | 'verified');
  return network.taskRelay.list();
});

app.get('/api/network/reputation', async () => {
  return network.reputation.getLeaderboard();
});

// --- Updates ---
app.get('/api/network/updates', async (req) => {
  const { status } = (req.query || {}) as { status?: string };
  if (status) return network.updates.listUpdates(status as 'available' | 'applied' | 'rejected' | 'failed');
  return network.updates.listUpdates();
});

app.get('/api/network/updates/stats', async () => {
  return network.updates.getStats();
});

app.post('/api/network/updates/announce', async (req) => {
  const { description } = req.body as { description: string };
  if (!description) return { error: 'Missing description' };
  const payload = network.announceUpdate(description);
  if (!payload) return { error: 'No changes detected' };
  return payload;
});

app.post('/api/network/updates/:id/request', async (req) => {
  const { id } = req.params as { id: string };
  network.requestUpdate(id);
  return { ok: true };
});

app.post('/api/network/updates/:id/apply', async (req) => {
  const { id } = req.params as { id: string };
  const { files } = req.body as { files: Array<{ path: string; content: string; hash: string }> };
  if (!files) return { error: 'Missing files' };
  const success = network.updates.applyUpdate(id, files);
  return { ok: success };
});

app.post('/api/network/updates/:id/reject', async (req) => {
  const { id } = req.params as { id: string };
  network.updates.rejectUpdate(id);
  return { ok: true };
});

app.get('/api/network/updates/codebase-hash', async () => {
  return { hash: network.updates.getCurrentHash() };
});

app.post('/api/network/seed-peer', async (req) => {
  const { host, port } = req.body as { host: string; port: number };
  if (!host || !port) return { error: 'Missing host or port' };
  network.discovery.addSeedPeer(host, port);
  return { ok: true, seedPeers: network.discovery.getSeedPeers() };
});

app.delete('/api/network/seed-peer', async (req) => {
  const { host, port } = req.body as { host: string; port: number };
  if (!host || !port) return { error: 'Missing host or port' };
  network.discovery.removeSeedPeer(host, port);
  return { ok: true, seedPeers: network.discovery.getSeedPeers() };
});

// --- The Hill (inter-bot chat) ---
app.get('/api/network/hill', async (req) => {
  const { limit: limitStr } = (req.query || {}) as { limit?: string };
  const limit = limitStr ? parseInt(limitStr, 10) : 100;
  return network.getHillMessages(limit);
});

app.post('/api/network/hill', async (req) => {
  const { content, displayName } = req.body as { content: string; displayName?: string };
  if (!content?.trim()) return { error: 'Missing content' };
  const msg = network.sendHillChat(content.trim(), displayName);
  return { ok: true, message: msg };
});

app.get('/api/network/hill/unread', async () => {
  return network.getHillUnread();
});


app.post('/api/network/hill/ack', async (req) => {
  const { timestamp } = req.body as { timestamp: number };
  if (typeof timestamp !== 'number') return { error: 'Missing or invalid timestamp' };
  network.ackHillMessages(timestamp);
  return { ok: true };
});

// --- Logs ---
app.get('/api/logs', async (req) => {
  const { level, limit: limitStr } = (req.query || {}) as { level?: string; limit?: string };
  const limit = limitStr ? parseInt(limitStr, 10) : 100;
  let logs = logBuffer.slice().reverse();
  if (level && ['info', 'warn', 'error', 'debug'].includes(level)) {
    logs = logs.filter(l => l.level === level);
  }
  return logs.slice(0, limit);
});

// --- Agent Tools ---
app.get('/api/agent/tools', async () => {
  // Return the list of tools available to the agent
  const tools = [
    { name: 'Bash', description: 'Execute shell commands' },
    { name: 'Read', description: 'Read files from the filesystem' },
    { name: 'Write', description: 'Write files to the filesystem' },
    { name: 'Edit', description: 'Edit files with search/replace' },
    { name: 'Glob', description: 'Find files matching glob patterns' },
    { name: 'Grep', description: 'Search file contents with regex' },
    { name: 'WebFetch', description: 'Fetch and process web content' },
    { name: 'Task', description: 'Launch sub-agents for complex tasks' },
    { name: 'TodoWrite', description: 'Manage structured task lists' },
    { name: 'NotebookEdit', description: 'Edit Jupyter notebooks' },
  ];
  return tools;
});

// --- Agent State (for frontend) ---
app.get('/api/agent/state', async () => {
  let runtimeState: Record<string, unknown> = {};
  if (agentIPC.isConnected()) {
    try {
      runtimeState = await agentIPC.request('get_state', {}) as Record<string, unknown>;
    } catch { /* runtime unavailable */ }
  }
  return {
    agentMode: getAgentMode(),
    permissionMode: getPermissionMode(),
    sandboxEnabled: getSandboxEnabled(),
    chatRunning,
    runtimeConnected: agentIPC.isConnected(),
    runtimePid: runtimeState.pid || null,
    hasActiveAgent: runtimeState.hasActiveAgent || false,
    conversationId: runtimeState.conversationId || null,
    uptime: Date.now() - startedAt,
  };
});

// --- Conversations with token stats ---
app.get('/api/conversations/stats', async () => {
  const convs = db.prepare(`
    SELECT c.id, c.title, c.model, c.created_at, c.updated_at,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT COALESCE(SUM(tokens_in), 0) FROM messages WHERE conversation_id = c.id) as total_tokens_in,
      (SELECT COALESCE(SUM(tokens_out), 0) FROM messages WHERE conversation_id = c.id) as total_tokens_out
    FROM conversations c
    ORDER BY c.updated_at DESC
  `).all();
  return { conversations: convs };
});

// --- GitHub Integration ---
const execFileAsync = promisify(execFile);
const GIT_ROOT = join(process.cwd(), '..'); // sidecar/ -> project root

async function gitExec(args: string[], usePat = false): Promise<{ stdout: string; stderr: string }> {
  if (usePat) {
    const pat = getProviderKey(db, 'github-pat');
    if (pat) {
      return execFileAsync(
        'git',
        ['-c', `credential.helper=!f() { echo "username=git"; echo "password=${pat}"; }; f`, ...args],
        { cwd: GIT_ROOT, timeout: 30000 },
      );
    }
  }
  return execFileAsync('git', args, { cwd: GIT_ROOT, timeout: 30000 });
}

// --- GitHub PAT ---
app.post('/api/github/pat', async (req) => {
  const { token } = req.body as { token?: string };
  if (!token?.trim()) return { ok: false, error: 'Missing token' };
  setProviderKey(db, 'github-pat', token.trim());
  return { ok: true };
});

app.get('/api/github/pat', async () => {
  const pat = getProviderKey(db, 'github-pat');
  return { ok: true, configured: pat !== null };
});

app.delete('/api/github/pat', async () => {
  deleteProviderKey(db, 'github-pat');
  return { ok: true };
});

app.get('/api/github/status', async () => {
  try {
    const [branchRes, statusRes, remoteRes, logRes] = await Promise.all([
      gitExec(['rev-parse', '--abbrev-ref', 'HEAD']),
      gitExec(['status', '--porcelain']),
      gitExec(['remote', 'get-url', 'origin']).catch(() => ({ stdout: '', stderr: '' })),
      gitExec(['log', '-1', '--format=%H%n%s%n%ai']).catch(() => ({ stdout: '', stderr: '' })),
    ]);

    const branch = branchRes.stdout.trim();
    const dirty = statusRes.stdout.trim().length > 0;
    const remoteUrl = remoteRes.stdout.trim();
    const logLines = logRes.stdout.trim().split('\n');

    return {
      ok: true,
      branch,
      clean: !dirty,
      remoteUrl,
      lastCommit: logLines[0]
        ? { hash: logLines[0], message: logLines[1] || '', date: logLines[2] || '' }
        : null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

app.get('/api/github/log', async () => {
  try {
    const { stdout } = await gitExec(['log', '-10', '--format=%H%x1f%s%x1f%ai%x1f%an']);
    const commits = stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [hash, message, date, author] = line.split('\x1f');
      return { hash, message, date, author };
    });
    return { ok: true, commits };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

app.post('/api/github/pull', async () => {
  try {
    const { stdout, stderr } = await gitExec(['pull'], true);
    return { ok: true, output: stdout + stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, error: e.message, output: (e.stdout || '') + (e.stderr || '') };
  }
});

app.post('/api/github/push', async () => {
  try {
    const { stdout, stderr } = await gitExec(['push', '-u', 'origin', 'HEAD'], true);
    return { ok: true, output: stdout + stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, error: e.message, output: (e.stdout || '') + (e.stderr || '') };
  }
});

app.post('/api/github/commit', async (req) => {
  const { message } = req.body as { message: string };
  if (!message?.trim()) return { ok: false, error: 'Missing commit message' };
  try {
    const { stdout: addOut } = await gitExec(['add', '-A']);
    const { stdout: commitOut, stderr: commitErr } = await gitExec(['commit', '-m', message.trim()]);
    return { ok: true, output: addOut + commitOut + commitErr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, error: e.message, output: (e.stdout || '') + (e.stderr || '') };
  }
});

app.post('/api/github/clone', async (req) => {
  const { url } = req.body as { url: string };
  if (!url?.trim()) return { ok: false, error: 'Missing URL' };
  try {
    // Check if already a git repo
    if (existsSync(join(GIT_ROOT, '.git'))) {
      return { ok: false, error: 'Directory is already a git repository' };
    }
    const { stdout, stderr } = await execFileAsync('git', ['clone', url.trim(), '.'], {
      cwd: GIT_ROOT, timeout: 60000,
    });
    return { ok: true, output: stdout + stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, error: e.message, output: (e.stdout || '') + (e.stderr || '') };
  }
});

app.post('/api/github/remote', async (req) => {
  const { url } = req.body as { url: string };
  if (!url?.trim()) return { ok: false, error: 'Missing URL' };
  try {
    // Try to set, fall back to add if origin doesn't exist
    try {
      await gitExec(['remote', 'set-url', 'origin', url.trim()]);
    } catch {
      await gitExec(['remote', 'add', 'origin', url.trim()]);
    }
    return { ok: true, url: url.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// --- WebSocket ---
app.register(async function (fastify) {
  console.log('[ws] Registering WebSocket route at /ws');
  fastify.get('/ws', { websocket: true }, (socket, request) => {
    console.log(`[ws] NEW CONNECTION from ${request.socket.remoteAddress}`);
    wsClients.add(socket);
    console.log(`[ws] client connected (total: ${wsClients.size})`);

    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; [k: string]: unknown };

        switch (msg.type) {
          case 'chat': {
            const content = (msg.content || msg.message || msg.text) as string;
            if (!content) break;
            void runChat(content, msg.voice as boolean | undefined);
            break;
          }

          case 'stop':
            if (agentIPC.isConnected()) {
              agentIPC.send('stop', {});
            }
            broadcast({ type: 'status', data: 'idle' });
            break;

          case 'steer': {
            const content = msg.content as string;
            if (content && agentIPC.isConnected()) {
              agentIPC.send('steer', { content });
            }
            break;
          }

          case 'ask_user_response': {
            const askId = msg.id as string;
            const answers = msg.answers as Record<string, string>;
            if (askId && answers && agentIPC.isConnected()) {
              agentIPC.send('ask_user_response', { id: askId, answers });
            }
            break;
          }

          case 'login': {
            if (loginProcess) {
              socket.send(JSON.stringify({ type: 'login_output', data: 'Login already in progress.\n' }));
              break;
            }

            socket.send(JSON.stringify({ type: 'login_started' }));

            // Remove CLAUDECODE env var so claude CLI doesn't refuse to run
            const loginEnv = { ...process.env };
            delete loginEnv.CLAUDECODE;

            loginProcess = spawn('claude', ['auth', 'login'], {
              stdio: ['pipe', 'pipe', 'pipe'],
              env: loginEnv,
            });

            loginProcess.stdout?.on('data', (chunk: Buffer) => {
              try {
                socket.send(JSON.stringify({ type: 'login_output', data: chunk.toString() }));
              } catch { /* client disconnected */ }
            });

            loginProcess.stderr?.on('data', (chunk: Buffer) => {
              try {
                socket.send(JSON.stringify({ type: 'login_output', data: chunk.toString() }));
              } catch { /* client disconnected */ }
            });

            loginProcess.on('close', (code) => {
              loginProcess = null;
              if (loginCancelled) {
                loginCancelled = false;
                return;
              }
              clearCachedAuth();
              // Tell Agent Runtime to refresh auth
              if (agentIPC.isConnected()) {
                agentIPC.send('refresh_auth', {});
              }
              try {
                socket.send(JSON.stringify({
                  type: 'login_complete',
                  data: { exitCode: code, authenticated: isAuthenticated(), method: getAuthMethod() },
                }));
              } catch { /* client disconnected */ }
            });

            loginProcess.on('error', (err) => {
              loginProcess = null;
              try {
                socket.send(JSON.stringify({ type: 'login_error', data: err.message }));
              } catch { /* client disconnected */ }
            });
            break;
          }

          case 'login_cancel': {
            if (loginProcess) {
              loginCancelled = true;
              loginProcess.kill('SIGTERM');
            }
            socket.send(JSON.stringify({ type: 'login_cancelled' }));
            break;
          }

          case 'bg_spawn': {
            const cmd = msg.command as string;
            const args = (msg.args || []) as string[];
            const cwd = msg.cwd as string | undefined;
            const label = msg.label as string | undefined;
            if (!cmd) break;
            const task = bgTasks.spawn({ command: cmd, args, cwd, label });
            logActivity({ type: 'system', summary: `Background task: ${label || cmd}` });
            socket.send(JSON.stringify({ type: 'bg_task_started', data: { id: task.id, pid: task.pid, label: task.label } }));
            break;
          }

          case 'bg_kill': {
            const taskId = msg.taskId as string;
            if (taskId) bgTasks.kill(taskId);
            break;
          }

          case 'bg_list': {
            const tasks = bgTasks.list();
            socket.send(JSON.stringify({ type: 'bg_task_list', data: tasks }));
            break;
          }

          case 'stt_audio': {
            const audioData = msg.data as string;
            if (!audioData) break;
            transcribeAudio(db, audioData)
              .then((text) => {
                if (text) {
                  socket.send(JSON.stringify({ type: 'stt_result', data: text }));
                } else {
                  socket.send(JSON.stringify({ type: 'stt_error', data: 'No transcription result' }));
                }
              })
              .catch((err) => {
                const errMsg = err instanceof Error ? err.message : String(err);
                console.warn('[stt] Error:', errMsg);
                socket.send(JSON.stringify({ type: 'stt_error', data: errMsg }));
              });
            break;
          }

          default:
            console.log(`[ws] unknown message type: ${msg.type}`);
        }
      } catch {
        // ignore malformed messages
      }
    });

    socket.on('close', () => {
      wsClients.delete(socket);
      console.log(`[ws] client disconnected (total: ${wsClients.size})`);
    });
  });
});

// WebSocket test endpoint
app.get('/ws-test', async () => {
  return { 
    websocketSupported: true, 
    wsUrl: 'ws://127.0.0.1:3004/ws',
    connectedClients: wsClients.size 
  };
});

const API_HOST = process.env.BEEPBOT_API_HOST || '0.0.0.0';
await app.listen({ port: PORT, host: API_HOST });
console.log(`BeepBot API Server running on http://${API_HOST}:${PORT}`);

// Connect to Agent Runtime via IPC
console.log('[api-server] Connecting to Agent Runtime...');
agentIPC.connectWithRetry(30, 1000).then(() => {
  console.log('[api-server] Connected to Agent Runtime');
}).catch((err) => {
  console.error('[api-server] Failed to connect to Agent Runtime:', err instanceof Error ? err.message : String(err));
  console.error('[api-server] Chat will be unavailable until Agent Runtime starts');
});

// Start P2P network after HTTP is ready
try {
  await network.start();
  console.log(`[network] P2P network active on port ${P2P_PORT}`);
} catch (err) {
  console.error('[network] Failed to start P2P network:', err instanceof Error ? err.message : String(err));
}
