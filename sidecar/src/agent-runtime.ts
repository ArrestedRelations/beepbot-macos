#!/usr/bin/env node
/**
 * Agent Runtime — The Brain
 *
 * This process manages the Claude SDK agent sessions. It NEVER gets
 * self-modified by the agent. When the agent edits sidecar code, only
 * the API Server (index.ts) restarts — this process stays alive.
 *
 * Communication with the API Server is via Unix socket IPC.
 */

import { createDb } from './db.js';
import { Agent, type AgentEvent, type ToolCall } from './agent.js';
import { clearCachedAuth } from './auth.js';
import { IPCServer } from './ipc.js';

const db = createDb();
const ipc = new IPCServer();

// ===== Agent State =====
let activeAgent: Agent | null = null;
let chatRunning = false;
let chatQueue: Array<{ content: string; voice?: boolean; id: string }> = [];

// ===== Settings (loaded from DB) =====
let agentMode: 'autonomous' | 'ask' | 'stop' = 'autonomous';
let permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' = 'bypassPermissions';
let sandboxEnabled = true;

function loadSettings(): void {
  const modeRow = db.prepare("SELECT value FROM settings WHERE key = 'agent_mode'").get() as { value: string } | undefined;
  const v = modeRow?.value;
  if (v === 'autonomous' || v === 'on') agentMode = 'autonomous';
  else if (v === 'ask' || v === 'pause') agentMode = 'ask';
  else if (v === 'stop' || v === 'off') agentMode = 'stop';

  const permRow = db.prepare("SELECT value FROM settings WHERE key = 'permission_mode'").get() as { value: string } | undefined;
  if (permRow?.value === 'default') permissionMode = 'default';
  else if (permRow?.value === 'acceptEdits') permissionMode = 'acceptEdits';

  const sandboxRow = db.prepare("SELECT value FROM settings WHERE key = 'sandbox_enabled'").get() as { value: string } | undefined;
  if (sandboxRow?.value === 'false') sandboxEnabled = false;
}

loadSettings();

// ===== Agent Management =====

function getOrCreateAgent(): Agent {
  const activeConv = db.prepare("SELECT value FROM settings WHERE key = 'last_conversation_id'")
    .get() as { value: string } | undefined;
  const convId = activeConv?.value;

  if (activeAgent && convId) {
    if (activeAgent.getConversationId() === convId) {
      return activeAgent;
    }
    activeAgent.close();
  }

  if (convId) {
    activeAgent = Agent.fromConversation(db, convId, undefined, permissionMode, sandboxEnabled);
    if (activeAgent) return activeAgent;
  }

  activeAgent = new Agent(db, undefined, undefined, permissionMode, sandboxEnabled);
  return activeAgent;
}

async function runChat(content: string, requestId: string, voice?: boolean): Promise<void> {
  if (chatRunning) {
    chatQueue.push({ content, voice, id: requestId });
    return;
  }

  chatRunning = true;

  try {
    if (agentMode === 'stop') {
      ipc.broadcast('agent_event', { type: 'error', data: 'Agent is stopped. Switch to autonomous or ask mode.' });
      return;
    }

    const agent = getOrCreateAgent();
    ipc.broadcast('agent_event', { type: 'status', data: 'thinking' });
    ipc.broadcast('agent_event', { type: 'chat_started', data: { content: content.slice(0, 100), conversationId: agent.getConversationId() } });

    const eventHandler = (event: AgentEvent): void => {
      // Forward all agent events to the API server via IPC
      ipc.broadcast('agent_event', {
        type: event.type,
        data: event.data,
        conversationId: agent.getConversationId(),
      });
    };

    await agent.chat(content, eventHandler);

    // Notify completion
    ipc.broadcast('agent_event', {
      type: 'chat_complete',
      data: { conversationId: agent.getConversationId(), voice },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[agent-runtime] Chat error:', errMsg);
    ipc.broadcast('agent_event', { type: 'error', data: errMsg });
    ipc.broadcast('agent_event', { type: 'status', data: 'idle' });
  } finally {
    chatRunning = false;
  }

  // Process queued messages
  if (chatQueue.length > 0) {
    const next = chatQueue.shift()!;
    void runChat(next.content, next.id, next.voice);
  }
}

// ===== IPC Handlers =====

// Chat request from API server
ipc.handle('chat', async (payload) => {
  const { content, voice, id } = payload as { content: string; voice?: boolean; id: string };
  if (!content) throw new Error('Missing content');
  void runChat(content, id, voice);
  return { queued: true };
});

// Stop the current agent
ipc.handle('stop', async () => {
  if (activeAgent) {
    await activeAgent.stop();
  }
  chatQueue = [];
  ipc.broadcast('agent_event', { type: 'status', data: 'idle' });
  return { ok: true };
});

// Steer the agent
ipc.handle('steer', async (payload) => {
  const { content } = payload as { content: string };
  if (content && activeAgent) {
    activeAgent.injectMessage(content);
  }
  return { ok: true };
});

// Ask user response
ipc.handle('ask_user_response', async (payload) => {
  const { id, answers } = payload as { id: string; answers: Record<string, string> };
  if (id && answers && activeAgent) {
    activeAgent.resolveAskUser(id, answers);
  }
  return { ok: true };
});

// Update agent mode
ipc.handle('set_mode', async (payload) => {
  const { mode } = payload as { mode: string };
  if (['autonomous', 'ask', 'stop'].includes(mode)) {
    agentMode = mode as typeof agentMode;
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('agent_mode', ?, datetime('now'))").run(mode);
  }
  return { mode: agentMode };
});

// Update permission mode
ipc.handle('set_permission_mode', async (payload) => {
  const { mode } = payload as { mode: string };
  if (['default', 'acceptEdits', 'bypassPermissions'].includes(mode)) {
    permissionMode = mode as typeof permissionMode;
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('permission_mode', ?, datetime('now'))").run(mode);
    if (activeAgent) {
      activeAgent.close();
      activeAgent = null;
    }
  }
  return { mode: permissionMode };
});

// Update sandbox
ipc.handle('set_sandbox', async (payload) => {
  const { enabled } = payload as { enabled: boolean };
  sandboxEnabled = enabled;
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('sandbox_enabled', ?, datetime('now'))").run(String(enabled));
  if (activeAgent) {
    activeAgent.close();
    activeAgent = null;
  }
  return { enabled: sandboxEnabled };
});

// Create new conversation
ipc.handle('new_conversation', async () => {
  if (activeAgent) {
    activeAgent.close();
    activeAgent = null;
  }
  return { ok: true };
});

// Switch conversation
ipc.handle('switch_conversation', async (payload) => {
  const { id } = payload as { id: string };
  if (activeAgent) {
    activeAgent.close();
    activeAgent = null;
  }
  return { ok: true };
});

// Get runtime state
ipc.handle('get_state', async () => {
  return {
    agentMode,
    permissionMode,
    sandboxEnabled,
    chatRunning,
    hasActiveAgent: !!activeAgent,
    conversationId: activeAgent?.getConversationId() || null,
    pid: process.pid,
  };
});

// Refresh auth
ipc.handle('refresh_auth', async () => {
  clearCachedAuth();
  if (activeAgent) {
    activeAgent.close();
    activeAgent = null;
  }
  return { ok: true };
});

// Health check
ipc.handle('ping', async () => {
  return { pong: true, pid: process.pid, uptime: process.uptime() };
});

// ===== Start =====

async function main(): Promise<void> {
  console.log('[agent-runtime] Starting Agent Runtime (PID:', process.pid, ')');
  await ipc.start();
  console.log('[agent-runtime] Ready — waiting for API Server connection');
}

main().catch((err) => {
  console.error('[agent-runtime] Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[agent-runtime] Shutting down...');
  if (activeAgent) activeAgent.close();
  ipc.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[agent-runtime] Interrupted');
  if (activeAgent) activeAgent.close();
  ipc.stop();
  process.exit(0);
});
