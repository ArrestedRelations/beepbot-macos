import type Database from 'better-sqlite3';

export interface UsageEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  conversationId?: string;
  slot?: string;
  provider?: string;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
}

/**
 * Log a Claude API call's token usage into the api_usage_log table.
 *
 * This is the single place all usage tracking flows through — chat turns,
 * compaction summaries, memory extraction, daily synthesis, etc.
 */
export function logUsage(db: Database.Database, entry: UsageEntry): void {
  try {
    db.prepare(
      `INSERT INTO api_usage_log (conversation_id, provider, model, slot, tokens_in, tokens_out, cache_read_tokens, cache_write_tokens, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.conversationId ?? null,
      entry.provider ?? 'anthropic',
      entry.model,
      entry.slot ?? 'chat',
      entry.inputTokens,
      entry.outputTokens,
      entry.cacheReadTokens ?? 0,
      entry.cacheWriteTokens ?? 0,
      entry.durationMs ?? 0,
    );
  } catch (err) {
    console.warn('[usage-tracker] Failed to log usage:', err instanceof Error ? err.message : err);
  }
}
