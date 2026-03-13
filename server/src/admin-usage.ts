import type Database from 'better-sqlite3';
import { getAuthConfig } from './auth.js';
import { getProviderKey } from './crypto.js';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MessagesResult {
  api_key_id: string;
  model: string;
  output_tokens: number;
  uncached_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number };
  context_window: string | null;
  service_tier: string | null;
  workspace_id: string | null;
  inference_geo: string | null;
  speed: string | null;
  server_tool_use: { web_search_requests: number };
}

interface MessagesBucket {
  starting_at: string;
  ending_at: string;
  results: MessagesResult[];
}

interface MessagesResponse {
  data: MessagesBucket[];
  has_more: boolean;
  next_page: string | null;
}

interface ClaudeCodeRecord {
  date: string;
  actor: { type: string; email_address?: string; api_key_name?: string };
  core_metrics: {
    num_sessions: number;
    commits_by_claude_code: number;
    pull_requests_by_claude_code: number;
    lines_of_code: { added: number; removed: number };
  };
  model_breakdown: Array<{
    model: string;
    tokens: { input: number; output: number; cache_read: number; cache_creation: number };
    estimated_cost: { amount: number; currency: string };
  }>;
  tool_actions: Record<string, { accepted: number; rejected: number }>;
  terminal_type: string;
  customer_type: string;
  organization_id: string;
}

interface ClaudeCodeResponse {
  data: ClaudeCodeRecord[];
  has_more: boolean;
  next_page: string | null;
}

// ─── Cached data shapes ─────────────────────────────────────────────────────

export interface AdminUsageByDay {
  day: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  estimated_cost_cents: number;
}

export interface AdminUsageByModel {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  estimated_cost_cents: number;
}

export interface AdminCodeMetrics {
  metric_date: string;
  actor_email: string;
  num_sessions: number;
  commits: number;
  pull_requests: number;
  lines_added: number;
  lines_removed: number;
  tool_actions: Record<string, { accepted: number; rejected: number }>;
  terminal_type: string;
}

export interface AdminUsageCached {
  byDay: AdminUsageByDay[];
  byModel: AdminUsageByModel[];
  codeMetrics: AdminCodeMetrics[];
  lastRefresh: string | null;
  available: boolean;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

function getAuthCredential(db: Database.Database): { type: 'api_key' | 'oauth'; token: string } | null {
  const config = getAuthConfig();
  if (config.apiKey) return { type: 'api_key', token: config.apiKey };
  if (config.authToken) return { type: 'oauth', token: config.authToken };
  // Direct env fallback
  if (process.env.ANTHROPIC_API_KEY) return { type: 'api_key', token: process.env.ANTHROPIC_API_KEY };
  // Check encrypted provider_keys table (handles "sdk" auth where key is stored but not in env)
  const storedKey = getProviderKey(db, 'anthropic');
  if (storedKey) return { type: 'api_key', token: storedKey };
  return null;
}

function buildHeaders(cred: { type: 'api_key' | 'oauth'; token: string }): Record<string, string> {
  const headers: Record<string, string> = {
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
  };
  if (cred.type === 'oauth') {
    headers['authorization'] = `Bearer ${cred.token}`;
  } else {
    headers['x-api-key'] = cred.token;
  }
  return headers;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Fetch Messages Usage ────────────────────────────────────────────────────

export async function fetchAdminMessages(db: Database.Database): Promise<{ success: boolean; error?: string }> {
  const cred = getAuthCredential(db);
  if (!cred) return { success: false, error: 'No API key configured' };

  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 14);

  // Build query string manually — URLSearchParams doesn't handle array params well
  const baseParams = new URLSearchParams({
    starting_at: start.toISOString(),
    ending_at: now.toISOString(),
    bucket_width: '1d',
    limit: '31',
  });
  // Append group_by as array parameter (API expects group_by[]=model)
  baseParams.append('group_by[]', 'model');

  try {
    let allBuckets: MessagesBucket[] = [];
    let page: string | null = null;

    do {
      const url = `${ANTHROPIC_API_BASE}/v1/organizations/usage_report/messages?${baseParams}${page ? `&page=${encodeURIComponent(page)}` : ''}`;
      const resp = await fetch(url, { headers: buildHeaders(cred) });

      if (resp.status === 403 || resp.status === 401) {
        return { success: false, error: `Auth failed (${resp.status})` };
      }
      if (!resp.ok) {
        const text = await resp.text();
        return { success: false, error: `API error ${resp.status}: ${text.slice(0, 200)}` };
      }

      const body = await resp.json() as MessagesResponse;
      allBuckets = allBuckets.concat(body.data);
      page = body.has_more ? body.next_page ?? null : null;
    } while (page);

    // Upsert into cache
    const upsert = db.prepare(`
      INSERT INTO admin_usage_cache (report_type, bucket_date, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, estimated_cost_cents, fetched_at)
      VALUES ('messages', ?, ?, ?, ?, ?, ?, 0, datetime('now'))
      ON CONFLICT(report_type, bucket_date, model) DO UPDATE SET
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        cache_write_tokens = excluded.cache_write_tokens,
        fetched_at = excluded.fetched_at
    `);

    const tx = db.transaction(() => {
      for (const bucket of allBuckets) {
        const day = bucket.starting_at.slice(0, 10);
        for (const r of bucket.results) {
          const model = r.model || 'unknown';
          const cacheWrite = (r.cache_creation?.ephemeral_5m_input_tokens ?? 0) + (r.cache_creation?.ephemeral_1h_input_tokens ?? 0);
          upsert.run(
            day,
            model,
            r.uncached_input_tokens ?? 0,
            r.output_tokens ?? 0,
            r.cache_read_input_tokens ?? 0,
            cacheWrite,
          );
        }
      }
    });
    tx();

    // Update last refresh timestamp
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('admin_usage_last_refresh', datetime('now'), datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')
    `).run();

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Fetch Claude Code Metrics ───────────────────────────────────────────────

export async function fetchAdminClaudeCode(db: Database.Database): Promise<{ success: boolean; error?: string }> {
  const cred = getAuthCredential(db);
  if (!cred) return { success: false, error: 'No API key configured' };

  // Fetch last 14 days, one day at a time (API takes a single date)
  const now = new Date();
  const upsert = db.prepare(`
    INSERT INTO admin_code_metrics (metric_date, actor_email, num_sessions, commits, pull_requests, lines_added, lines_removed, tool_actions, terminal_type, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(metric_date, actor_email) DO UPDATE SET
      num_sessions = excluded.num_sessions,
      commits = excluded.commits,
      pull_requests = excluded.pull_requests,
      lines_added = excluded.lines_added,
      lines_removed = excluded.lines_removed,
      tool_actions = excluded.tool_actions,
      terminal_type = excluded.terminal_type,
      fetched_at = excluded.fetched_at
  `);

  try {
    const tx = db.transaction((records: Array<{ date: string; email: string; r: ClaudeCodeRecord }>) => {
      for (const { date, email, r } of records) {
        upsert.run(
          date,
          email,
          r.core_metrics.num_sessions,
          r.core_metrics.commits_by_claude_code,
          r.core_metrics.pull_requests_by_claude_code,
          r.core_metrics.lines_of_code.added,
          r.core_metrics.lines_of_code.removed,
          JSON.stringify(r.tool_actions ?? {}),
          r.terminal_type ?? '',
        );
      }
    });

    const allRecords: Array<{ date: string; email: string; r: ClaudeCodeRecord }> = [];

    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      const dateStr = toISODate(d);

      let page: string | null = null;
      do {
        const params = new URLSearchParams({ starting_at: dateStr, limit: '1000' });
        if (page) params.set('page', page);

        const url = `${ANTHROPIC_API_BASE}/v1/organizations/usage_report/claude_code?${params}`;
        const resp = await fetch(url, { headers: buildHeaders(cred) });

        if (resp.status === 403 || resp.status === 401) {
          return { success: false, error: `Auth failed (${resp.status})` };
        }
        if (!resp.ok) {
          // Non-fatal for individual days — skip
          break;
        }

        const body = await resp.json() as ClaudeCodeResponse;
        for (const r of body.data) {
          const email = r.actor?.type === 'user_actor' ? r.actor.email_address ?? '' : r.actor?.api_key_name ?? 'api';
          allRecords.push({ date: dateStr, email, r });
        }
        page = body.has_more ? body.next_page ?? null : null;
      } while (page);
    }

    tx(allRecords);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Read Cached Data ────────────────────────────────────────────────────────

export function getAdminUsageCached(db: Database.Database): AdminUsageCached {
  const lastRefreshRow = db.prepare("SELECT value FROM settings WHERE key = 'admin_usage_last_refresh'").get() as { value: string } | undefined;
  const lastRefresh = lastRefreshRow?.value ?? null;

  if (!lastRefresh) {
    return { byDay: [], byModel: [], codeMetrics: [], lastRefresh: null, available: true };
  }

  const byDay = db.prepare(`
    SELECT bucket_date as day,
           SUM(input_tokens) as input_tokens,
           SUM(output_tokens) as output_tokens,
           SUM(cache_read_tokens) as cache_read_tokens,
           SUM(cache_write_tokens) as cache_write_tokens,
           SUM(estimated_cost_cents) as estimated_cost_cents
    FROM admin_usage_cache
    WHERE report_type = 'messages' AND bucket_date >= date('now', '-14 days')
    GROUP BY bucket_date
    ORDER BY bucket_date ASC
  `).all() as AdminUsageByDay[];

  const byModel = db.prepare(`
    SELECT model,
           SUM(input_tokens) as input_tokens,
           SUM(output_tokens) as output_tokens,
           SUM(cache_read_tokens) as cache_read_tokens,
           SUM(cache_write_tokens) as cache_write_tokens,
           SUM(estimated_cost_cents) as estimated_cost_cents
    FROM admin_usage_cache
    WHERE report_type = 'messages'
    GROUP BY model
    ORDER BY (input_tokens + output_tokens) DESC
  `).all() as AdminUsageByModel[];

  const codeRows = db.prepare(`
    SELECT metric_date, actor_email, num_sessions, commits, pull_requests,
           lines_added, lines_removed, tool_actions, terminal_type
    FROM admin_code_metrics
    WHERE metric_date >= date('now', '-14 days')
    ORDER BY metric_date DESC
  `).all() as Array<Omit<AdminCodeMetrics, 'tool_actions'> & { tool_actions: string }>;

  const codeMetrics: AdminCodeMetrics[] = codeRows.map(r => ({
    ...r,
    tool_actions: JSON.parse(r.tool_actions || '{}'),
  }));

  return { byDay, byModel, codeMetrics, lastRefresh, available: true };
}
