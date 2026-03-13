import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { extractOAuthToken, refreshOAuthToken } from './auth.js';
import { getDataDir } from './db.js';
import { getMemoryContext } from './memory.js';
import { buildWorkspaceContext, readWorkspaceFile, parseIdentity } from './workspace.js';
import { buildSkillsContext } from './skills.js';
import {
  heuristicWorthRemembering,
  extractMemories,
  writeMemories,
  buildSmartContext
} from './memory-system.js';
import { logUsage } from './usage-tracker.js';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface ToolCall {
  id?: string;
  name: string;
  input: unknown;
}

export interface AgentEvent {
  type: 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'sub_agent' | 'ask_user' | 'status';
  data: unknown;
}

export type AgentEventCallback = (event: AgentEvent) => void;

// No static system prompt — we use the claude_code preset which provides
// the full Claude Code system prompt (CLAUDE.md loading, git conventions,
// security, coding style, tool docs) automatically.

// Push-based async channel for multi-turn input
function createInputChannel(): {
  iterable: AsyncIterable<unknown>;
  push: (msg: unknown) => void;
  close: () => void;
} {
  const queue: unknown[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  async function* generator(): AsyncGenerator<unknown> {
    while (!done) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((r) => { resolve = r; });
        resolve = null;
      }
    }
  }

  return {
    iterable: generator(),
    push: (msg: unknown) => { queue.push(msg); resolve?.(); },
    close: () => { done = true; resolve?.(); },
  };
}

// Shared SDK module (loaded once)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdkModule: any = null;

async function loadSDK() {
  if (!sdkModule) {
    sdkModule = await import('@anthropic-ai/claude-agent-sdk');
  }
  return sdkModule;
}

/** Generate a short title from the first user message */
export function generateTitle(message: string): string {
  const firstSentence = message.split(/[.!?\n]/)[0]?.trim() || message;
  if (firstSentence.length <= 50) return firstSentence;
  return firstSentence.slice(0, 47) + '...';
}

export class Agent {
  private static readonly CHAT_TIMEOUT_MS = 900_000; // 15 minutes for complex tasks

  private db: Database.Database;
  private conversationId: string;
  private model: string;
  private isFirstReply = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private session: any = null;
  private inputController: { push: (msg: unknown) => void; close: () => void } | null = null;
  private onEvent: AgentEventCallback | null = null;
  private resumeSession = false;
  private responseText = '';
  private toolCalls: ToolCall[] = [];
  private thinkingText = '';
  private lastResponseHadError = false;
  private sessionInputTokens = 0;
  private sessionTurnCount = 0;
  private closed = false;
  private retryCount = 0;
  private systemTurn = false;
  private permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' = 'bypassPermissions';
  private sandboxEnabled = true;

  /** Pending AskUserQuestion requests waiting for frontend answers */
  private pendingAskUser = new Map<string, { resolve: (answers: Record<string, string>) => void }>();

  /** Resettable chat timeout */
  private chatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private chatTimeoutReject: ((err: Error) => void) | null = null;

  /** Store last user message for memory extraction */
  private lastUserMessage = '';
  private turnStartedAt = 0;

  constructor(
    db: Database.Database,
    conversationId?: string,
    model?: string,
    permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' = 'bypassPermissions',
    sandboxEnabled = true,
  ) {
    this.db = db;
    this.model = model || 'claude-sonnet-4-5';
    this.permissionMode = permissionMode;
    this.sandboxEnabled = sandboxEnabled;

    if (conversationId) {
      this.conversationId = conversationId;
      const msgCount = (db.prepare(
        'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND role = ?'
      ).get(conversationId, 'assistant') as { cnt: number })?.cnt ?? 0;
      this.isFirstReply = msgCount === 0;
      this.resumeSession = msgCount > 0;
    } else {
      this.conversationId = randomUUID();
      this.db.prepare(
        'INSERT INTO conversations (id, title) VALUES (?, ?)'
      ).run(this.conversationId, 'New Conversation');
    }

    // Persist as last active conversation
    this.db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('last_conversation_id', ?, datetime('now'))"
    ).run(this.conversationId);
  }

  static fromConversation(
    db: Database.Database,
    conversationId: string,
    model?: string,
    permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' = 'bypassPermissions',
    sandboxEnabled = true,
  ): Agent | null {
    const row = db.prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId);
    if (!row) return null;
    return new Agent(db, conversationId, model, permissionMode, sandboxEnabled);
  }

  private buildAppendPrompt(): string {
    let prompt = `\n## Identity
You are BeepBot, an autonomous AI assistant running as a desktop app on the user's computer.

## How to Execute Tasks
When asked to build or modify code:
1. Read existing files FIRST to understand patterns and conventions
2. Make targeted edits — don't rewrite entire files
3. For complex multi-file tasks, use the "coder" sub-agent
4. After TypeScript edits, verify with type-check: cd server && npx tsc --noEmit
5. Be autonomous — don't ask the user for clarification, just do your best
6. Report results clearly when done

## Project Layout
- /Users/emma/Documents/apps/beepbot/ — project root
- server/src/ — Fastify 5 backend (Claude Agent SDK, SQLite)
- dashboard/src/ — Dashboard React app (served by server)
- CLAUDE.md — project rules and architecture

## Vault (Secure Storage)
BeepBot has an encrypted vault for storing credentials, payment methods, and secrets.
The vault requires a master password to unlock. Use these local REST endpoints via Bash curl:

- \`curl http://localhost:3004/api/vault/status\` — Check if vault is locked/unlocked
- \`curl -X POST http://localhost:3004/api/vault/unlock -H 'Content-Type: application/json' -d '{"password":"..."}'\` — Unlock vault
- \`curl -X POST http://localhost:3004/api/vault/lock\` — Lock the vault
- \`curl http://localhost:3004/api/vault/entries?category=login\` — List entries (categories: payment_method, login, identity, address, personal_info, secure_note, api_key)
- \`curl http://localhost:3004/api/vault/entries/ENTRY_ID\` — Get decrypted entry detail
- \`curl -X POST http://localhost:3004/api/vault/entries -H 'Content-Type: application/json' -d '{"category":"login","label":"...","data":{...}}'\` — Create entry
- \`curl -X PUT http://localhost:3004/api/vault/entries/ENTRY_ID -H 'Content-Type: application/json' -d '{"label":"...","data":{...}}'\` — Update entry
- \`curl -X DELETE http://localhost:3004/api/vault/entries/ENTRY_ID\` — Delete entry
- \`curl http://localhost:3004/api/vault/spending\` — Spending stats

When making purchases, ALWAYS retrieve payment details from the vault. Never ask the user for card numbers directly.
When logging into sites, check the vault for stored credentials first.
Mask sensitive values (card numbers, passwords) when displaying to the user.

## Browser Control
BeepBot can control the user's Chrome browser via the BeepBot Bridge extension.
Check status: \`curl http://localhost:3004/api/browser/status\`
List tabs: \`curl http://localhost:3004/api/browser/tabs\`
`;

    // Inject workspace context (SOUL.md, USER.md, AGENTS.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md)
    const workspaceCtx = buildWorkspaceContext();
    if (workspaceCtx) {
      prompt += workspaceCtx;
    }

    // Inject skills context
    const skillsCtx = buildSkillsContext();
    if (skillsCtx) {
      prompt += skillsCtx;
    }

    // Inject static memory context (for compatibility with REST APIs)
    // Smart context with FTS search will be injected per-turn in chat method
    const memoryCtx = getMemoryContext();
    if (memoryCtx) {
      prompt += memoryCtx;
    }

    return prompt;
  }

  private loadMcpServers(): Record<string, unknown> | undefined {
    try {
      const configPath = join(getDataDir(), 'mcp.json');
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
      return config.mcpServers || undefined;
    } catch {
      return undefined;
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.session) return;

    const sdk = await loadSDK();

    const channel = createInputChannel();
    this.inputController = { push: channel.push, close: channel.close };

    // Clean env so SDK doesn't think it's inside Claude Code
    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    // Set OAuth token
    const oauthToken = extractOAuthToken();
    if (oauthToken) {
      cleanEnv.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
    }

    // Use project root as cwd (parent of server/), not server dir
    const projectRoot = join(process.cwd(), '..');
    const agentCwd = this.sandboxEnabled ? projectRoot : homedir();

    this.session = sdk.query({
      prompt: channel.iterable,
      options: {
        model: this.model,
        cwd: agentCwd,
        ...(this.sandboxEnabled ? {} : { additionalDirectories: ['/'] }),
        systemPrompt: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: this.buildAppendPrompt(),
        },
        tools: { type: 'preset' as const, preset: 'claude_code' as const },
        mcpServers: this.loadMcpServers(),
        agents: {
          coder: {
            description: 'Coding agent for building features, editing files, running commands, and managing the codebase. Use for any task that involves writing or modifying code.',
            tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite'],
            prompt: `You are a coding agent for BeepBot. You work in the BeepBot project directory.

Project structure:
- server/src/ — Fastify 5 + Claude Agent SDK backend (Node.js)
- dashboard/src/ — Dashboard React app (served by server)

Rules:
- Read existing files FIRST to understand patterns before editing
- Make minimal, targeted edits — don't rewrite entire files
- After editing TypeScript, run type-check: cd server && npx tsc --noEmit
- Use existing CSS variable patterns and component conventions
- Report what you built when done

Complete the task efficiently. Be autonomous — don't ask questions, just build it.`,
            model: this.getSubAgentModel('coder'),
          },
          executor: {
            description: 'General-purpose executor for shell commands, web searches, file operations, and quick tasks.',
            tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
            prompt: 'You are an executor agent for BeepBot. Complete the task described in your prompt efficiently and report results. Be concise and autonomous.',
            model: this.getSubAgentModel('executor'),
          },
        },
        permissionMode: this.permissionMode,
        allowDangerouslySkipPermissions: this.permissionMode === 'bypassPermissions',
        canUseTool: async (toolName: string, input: Record<string, unknown>) => {
          if (toolName === 'AskUserQuestion') {
            const answers = await this.askUserViaWebSocket(input);
            return { behavior: 'allow' as const, updatedInput: { ...input, answers } };
          }
          if (toolName === 'Agent') {
            // Strip model-chosen max_turns so sub-agents run unlimited
            const { max_turns, ...rest } = input;
            return { behavior: 'allow' as const, updatedInput: rest };
          }
          return { behavior: 'allow' as const, updatedInput: input };
        },
        persistSession: true,
        continue: this.resumeSession,
        env: cleanEnv,
      },
    });

    this.consumeStream();
  }

  private async consumeStream(): Promise<void> {
    if (!this.session) return;
    try {
      for await (const msg of this.session) {
        if (!this.session) break;
        this.handleSDKMessage(msg as Record<string, unknown>);
      }
      this.retryCount = 0;
      console.log('Agent SDK stream ended naturally');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Agent SDK stream error:', errMsg);

      // Transient error retry with exponential backoff
      if (this.isTransientError(errMsg) && this.retryCount < 5) {
        // Try refreshing OAuth token on auth errors
        if (/oauth|token.*expired|unauthorized|401/i.test(errMsg)) {
          console.log('[agent] Auth error detected — attempting token refresh');
          try {
            await refreshOAuthToken();
          } catch {
            console.warn('[agent] Token refresh failed');
          }
        }
        const delay = this.computeBackoff();
        this.retryCount++;
        console.warn(`[agent] Transient error (attempt ${this.retryCount}/5), retrying in ${delay}ms: ${errMsg}`);
        this.onEvent?.({ type: 'error', data: `Transient error — retrying in ${Math.round(delay / 1000)}s...` });
        await sleep(delay);
        this.session = null;
        this.inputController = null;
        void this.consumeStream();
        return;
      }

      this.retryCount = 0;
      this.lastResponseHadError = true;
      this.onEvent?.({ type: 'error', data: errMsg });

      // Auto-recover from "prompt too long" — let SDK handle compaction on resume
      if (errMsg.includes('prompt is too long') || errMsg.includes('Prompt is too long')) {
        console.log('[agent] Prompt too long — resetting session for resume');
        try { this.session?.close(); } catch { /* ignore */ }
        this.session = null;
        this.inputController = null;
        this.resumeSession = true;
      }

      // Fatal SDK errors — reset session
      if (errMsg.includes('not valid JSON') || errMsg.includes('exited with') || errMsg.includes('process exited')) {
        console.log('[agent] Fatal SDK error — resetting session for recovery');
        try { this.session?.close(); } catch { /* ignore */ }
        this.session = null;
        this.inputController = null;
        this.resumeSession = true;
        this.onEvent?.({ type: 'done', data: { text: '', provider: 'anthropic', model: this.model, tokensIn: 0, tokensOut: 0 } });
      }
    }
  }

  private isTransientError(msg: string): boolean {
    return /429|overloaded|503|502|500|timeout|ECONNRESET|ECONNREFUSED|rate.?limit|oauth|token.*expired|unauthorized|401/i.test(msg);
  }

  private computeBackoff(): number {
    const base = 2000;
    const exp = Math.min(this.retryCount, 6);
    return base * Math.pow(2, exp) + Math.random() * base;
  }

  private handleSDKMessage(m: Record<string, unknown>): void {
    switch (m.type) {
      case 'assistant': {
        this.resetChatTimeout();
        const message = m.message as Record<string, unknown> | undefined;
        const content = message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>;
            if (b.type === 'text' && typeof b.text === 'string') {
              // Mark any running tool calls as done when text arrives
              if (this.toolCalls.length > 0) {
                const lastTool = this.toolCalls[this.toolCalls.length - 1];
                if (lastTool.id) {
                  this.onEvent?.({ type: 'tool_result', data: { toolUseId: lastTool.id, name: lastTool.name, status: 'done' } });
                }
              }
              this.responseText += b.text;
              this.onEvent?.({ type: 'text', data: b.text });
            }
            if (b.type === 'thinking' && typeof b.thinking === 'string') {
              this.thinkingText += b.thinking;
              this.onEvent?.({ type: 'thinking', data: b.thinking });
            }
            if (b.type === 'tool_use') {
              // Mark any previously running tool calls as done
              if (this.toolCalls.length > 0) {
                const lastTool = this.toolCalls[this.toolCalls.length - 1];
                if (lastTool.id) {
                  this.onEvent?.({ type: 'tool_result', data: { toolUseId: lastTool.id, name: lastTool.name, status: 'done' } });
                }
              }
              const toolCall: ToolCall = { id: b.id as string, name: b.name as string, input: b.input || {} };
              this.toolCalls.push(toolCall);
              this.onEvent?.({ type: 'tool_call', data: toolCall });

              if (b.name === 'Agent') {
                const input = b.input as Record<string, unknown>;
                this.onEvent?.({ type: 'sub_agent', data: {
                  event: 'spawning',
                  description: (input?.description as string) || '',
                  prompt: (input?.prompt as string) || '',
                }});
              }
            }
          }
        }
        break;
      }

      case 'system': {
        const subtype = m.subtype as string;
        if (subtype === 'task_started') {
          this.onEvent?.({ type: 'sub_agent', data: {
            event: 'started',
            taskId: m.task_id as string,
            description: (m.description as string) || '',
            prompt: (m.prompt as string) || '',
          }});
        }
        if (subtype === 'task_progress') {
          this.resetChatTimeout();
          this.onEvent?.({ type: 'sub_agent', data: {
            event: 'progress',
            taskId: m.task_id as string,
            description: (m.description as string) || '',
            lastTool: (m.last_tool_name as string) || undefined,
            usage: m.usage || undefined,
          }});
        }
        if (subtype === 'compact_boundary') {
          const meta = m.compact_metadata as { trigger: string; pre_tokens: number } | undefined;
          console.log(`[agent] Native compaction occurred (trigger: ${meta?.trigger}, pre_tokens: ${meta?.pre_tokens})`);

          // Log to compaction_log table
          this.db.prepare(
            `INSERT INTO compaction_log (id, conversation_id, summary, tokens_before, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
          ).run(randomUUID(), this.conversationId, `Native SDK compaction (${meta?.trigger || 'unknown'})`, meta?.pre_tokens ?? 0);

          // Inject lightweight context refresh
          const refresh = this.buildCompactionRefresh();
          if (refresh) {
            this.injectMessage(`Context was just compacted. Here is refreshed context to maintain continuity:\n\n${refresh}`);
          }
        }
        if (subtype === 'status') {
          const status = m.status as string | null;
          if (status === 'compacting') {
            console.log('[agent] SDK compaction in progress');
            this.onEvent?.({ type: 'status', data: { status: 'compacting' } });
          }
        }
        if (subtype === 'task_notification') {
          // Log sub-agent cumulative usage (coder, executor, etc.)
          const saUsage = m.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;
          if (saUsage && (saUsage.input_tokens || saUsage.output_tokens)) {
            logUsage(this.db, {
              model: this.model,
              inputTokens: saUsage.input_tokens ?? 0,
              outputTokens: saUsage.output_tokens ?? 0,
              conversationId: this.conversationId,
              slot: 'sub_agent',
              cacheReadTokens: saUsage.cache_read_input_tokens ?? 0,
              cacheWriteTokens: saUsage.cache_creation_input_tokens ?? 0,
            });
          }

          this.onEvent?.({ type: 'sub_agent', data: {
            event: 'completed',
            taskId: m.task_id as string,
            status: (m.status as string) || 'completed',
            summary: (m.summary as string) || '',
            usage: m.usage || undefined,
          }});
        }
        break;
      }

      case 'tool_progress': {
        this.resetChatTimeout();
        const taskId = m.task_id as string;
        if (taskId) {
          this.onEvent?.({ type: 'sub_agent', data: {
            event: 'tool_activity',
            taskId,
            toolName: m.tool_name as string,
            elapsed: m.elapsed_time_seconds as number,
          }});
        }
        break;
      }

      case 'result': {
        // Mark any remaining running tool calls as done
        if (this.toolCalls.length > 0) {
          const lastTool = this.toolCalls[this.toolCalls.length - 1];
          if (lastTool.id) {
            this.onEvent?.({ type: 'tool_result', data: { toolUseId: lastTool.id, name: lastTool.name, status: 'done' } });
          }
        }

        if (!this.responseText && typeof m.result === 'string') {
          this.responseText = m.result;
          this.onEvent?.({ type: 'text', data: this.responseText });
        }

        if (this.responseText.includes('Prompt is too long') || this.responseText.includes('prompt is too long')) {
          console.log('[agent] Prompt too long detected in result — resetting for resume');
          this.onEvent?.({ type: 'error', data: 'Context limit reached — resuming with compacted context' });
          try { this.session?.close(); } catch { /* ignore */ }
          this.session = null;
          this.inputController = null;
          this.resumeSession = true;
          break;
        }

        const usage = m.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;
        const tokensIn = usage?.input_tokens ?? 0;
        const tokensOut = usage?.output_tokens ?? 0;
        const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
        const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0;

        this.sessionInputTokens += tokensIn;
        this.sessionTurnCount++;

        // Save assistant response to DB (skip for system/cron turns)
        if (this.responseText) {
          if (!this.systemTurn) {
            this.db.prepare(
              `INSERT INTO messages (id, conversation_id, role, content, tool_calls, thinking, tokens_in, tokens_out, model)
               VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`
            ).run(
              randomUUID(),
              this.conversationId,
              this.responseText,
              this.toolCalls.length > 0 ? JSON.stringify(this.toolCalls) : null,
              this.thinkingText || null,
              tokensIn,
              tokensOut,
              this.model,
            );

            this.db.prepare(
              "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?"
            ).run(this.conversationId);

            if (this.isFirstReply) {
              this.isFirstReply = false;
              const firstUserMsg = this.db.prepare(
                "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1"
              ).get(this.conversationId) as { content: string } | undefined;
              if (firstUserMsg) {
                const title = generateTitle(firstUserMsg.content);
                this.db.prepare(
                  'UPDATE conversations SET title = ? WHERE id = ?'
                ).run(title, this.conversationId);
              }
            }
          }

          // Always log usage (even for cron — we want to track token spend)
          logUsage(this.db, {
            model: this.model,
            inputTokens: tokensIn,
            outputTokens: tokensOut,
            conversationId: this.conversationId,
            slot: this.systemTurn ? 'cron' : 'chat',
            cacheReadTokens,
            cacheWriteTokens,
            durationMs: this.turnStartedAt > 0 ? Date.now() - this.turnStartedAt : 0,
          });

          // Automatic memory extraction (non-blocking)
          if (this.responseText) {
            void this.extractAndStoreMemories(this.responseText);
          }
        }

        this.onEvent?.({ type: 'done', data: { text: this.responseText, provider: 'anthropic', model: this.model, tokensIn, tokensOut } });

        this.lastResponseHadError = false;
        this.responseText = '';
        this.toolCalls = [];
        this.thinkingText = '';
        this.onEvent = null;

        break;
      }
    }
  }

  /** Switch model mid-session using SDK's setModel() */
  async switchModel(model: string): Promise<void> {
    if (!this.session?.setModel) {
      throw new Error('Session not initialized or setModel not available');
    }
    await this.session.setModel(model);
    this.model = model;
    console.log(`[agent] Model switched to: ${model}`);
  }

  /** Get the current model */
  getModel(): string {
    return this.model;
  }

  /** Get sub-agent model from DB settings, falling back to chat model */
  private getSubAgentModel(role: string): string {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key = 'sub_agent_models'").get() as { value: string } | undefined;
      if (row?.value) {
        const models = JSON.parse(row.value) as Record<string, string>;
        if (models[role]) return models[role];
      }
    } catch { /* fall through */ }
    return this.model;
  }

  /** Get supported models from the SDK */
  async getSupportedModels(): Promise<string[]> {
    if (!this.session?.supportedModels) {
      return ['sonnet', 'opus', 'haiku'];
    }
    try {
      return await this.session.supportedModels();
    } catch {
      return ['sonnet', 'opus', 'haiku'];
    }
  }

  async stop(): Promise<void> {
    if (this.session?.interrupt) {
      try {
        await this.session.interrupt();
      } catch {
        // session may already be idle
      }
    }
  }

  async chat(userMessage: string, onEvent: AgentEventCallback, options?: { system?: boolean }): Promise<string> {
    await this.ensureSession();

    this.systemTurn = !!options?.system;

    // Store user message for memory extraction
    this.lastUserMessage = userMessage;

    // Save user message to DB (skip for system/cron-triggered messages)
    if (!options?.system) {
      this.db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)'
      ).run(randomUUID(), this.conversationId, 'user', userMessage);

      this.db.prepare(
        "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?"
      ).run(this.conversationId);
    }

    this.responseText = '';
    this.toolCalls = [];
    this.thinkingText = '';
    this.turnStartedAt = Date.now();

    return new Promise<string>((resolve, reject) => {
      this.chatTimeoutReject = reject;
      this.resetChatTimeout();

      this.onEvent = (event) => {
        onEvent(event);
        if (event.type === 'done' || event.type === 'error') {
          this.clearChatTimeout();
          resolve(typeof event.data === 'string' ? event.data : '');
        }
      };

      // Build smart context with relevant memories
      const smartContext = buildSmartContext(this.db, userMessage);
      const enhancedMessage = smartContext ? `${smartContext}\n\n## User Message\n${userMessage}` : userMessage;

      this.inputController!.push({
        type: 'user',
        message: { role: 'user', content: enhancedMessage },
        parent_tool_use_id: null,
        session_id: '',
      });
    });
  }

  getConversationId(): string {
    return this.conversationId;
  }

  private askUserViaWebSocket(input: Record<string, unknown>): Promise<Record<string, string>> {
    const id = randomUUID();
    this.clearChatTimeout();
    this.onEvent?.({ type: 'ask_user', data: { id, questions: input.questions } });
    return new Promise((resolve) => {
      this.pendingAskUser.set(id, { resolve });
    });
  }

  resolveAskUser(id: string, answers: Record<string, string>): void {
    const pending = this.pendingAskUser.get(id);
    if (pending) {
      pending.resolve(answers);
      this.pendingAskUser.delete(id);
      this.resetChatTimeout();
    }
  }

  private resetChatTimeout(): void {
    this.clearChatTimeout();
    this.chatTimeoutTimer = setTimeout(() => {
      this.chatTimeoutReject?.(new Error('Agent.chat() timed out after 15 minutes'));
    }, Agent.CHAT_TIMEOUT_MS);
  }

  private clearChatTimeout(): void {
    if (this.chatTimeoutTimer) {
      clearTimeout(this.chatTimeoutTimer);
      this.chatTimeoutTimer = null;
    }
  }

  /** Extract and store memories from the last response (non-blocking) */
  private async extractAndStoreMemories(responseText: string): Promise<void> {
    try {
      if (!this.lastUserMessage || !responseText) return;

      // Check if this conversation turn is worth remembering
      if (!heuristicWorthRemembering(responseText, this.lastUserMessage)) {
        return;
      }

      // Extract structured memories using Haiku
      const facts = await extractMemories(this.db, responseText, this.lastUserMessage);
      if (facts.length === 0) return;

      // Generate daily file path
      const dateStr = new Date().toISOString().slice(0, 10);
      const dailyFilePath = `memory/${dateStr}.md`;

      // Write memories to database and files
      await writeMemories(this.db, facts, dailyFilePath);
    } catch (err) {
      // Memory extraction should never crash the agent
      console.warn('[agent] Memory extraction failed:', err instanceof Error ? err.message : err);
    }
  }

  /** Build a lightweight context refresh after native SDK compaction */
  private buildCompactionRefresh(): string {
    const parts: string[] = [];

    // Re-inject identity essence
    const identityContent = readWorkspaceFile('IDENTITY.md');
    if (identityContent) {
      const identity = parseIdentity(identityContent);
      const idParts = [`You are ${identity.name || 'BeepBot'}`];
      if (identity.emoji) idParts[0] += ` ${identity.emoji}`;
      if (identity.vibe) idParts.push(`Vibe: ${identity.vibe}`);
      parts.push(idParts.join('. ') + '.');
    }

    // Key user preferences (compact)
    const userContent = readWorkspaceFile('USER.md');
    if (userContent) {
      parts.push(`Key user context:\n${userContent.slice(0, 500)}`);
    }

    // What was being worked on
    if (this.lastUserMessage) {
      parts.push(`The user's most recent request before context compaction was: "${this.lastUserMessage.slice(0, 300)}"`);
    }

    return parts.join('\n\n');
  }

  /** Inject a steering message into the active session */
  injectMessage(message: string): void {
    if (!this.inputController) return;
    this.inputController.push({
      type: 'user',
      message: { role: 'user', content: `[STEERING] ${message}` },
      parent_tool_use_id: null,
      session_id: '',
    });
    console.log(`[agent] Injected steering message: ${message.slice(0, 80)}`);
  }

  close(): void {
    this.closed = true;
    this.onEvent = null;
    try { this.session?.close(); } catch { /* ignore */ }
    this.inputController?.close();
    this.session = null;
    this.inputController = null;
  }
}
