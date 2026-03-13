import { useEffect } from 'react';
import { useUsageStore, estimateCost } from '../../stores/usage-store';
import { RefreshCw, GitCommit, GitPullRequest, Code, Terminal } from 'lucide-react';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatCost(dollars: number): string {
  return '$' + dollars.toFixed(4);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function formatTimestamp(iso: string): string {
  const normalized = iso.endsWith('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatRelativeTime(iso: string): string {
  const normalized = iso.endsWith('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function shortModel(model: string): string {
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return model.length > 20 ? model.slice(0, 18) + '...' : model;
}

export function UsageView() {
  const {
    usageToday, usageTotal, usageByDay, usageByModel, loading, fetchUsage,
    transactions, transactionsLoading, fetchTransactions,
    adminByDay, adminByModel, adminCodeMetrics, adminLastRefresh, adminAvailable,
    adminLoading, adminRefreshing, adminError, fetchAdminUsage, refreshAdminUsage,
  } = useUsageStore();

  useEffect(() => {
    fetchUsage();
    fetchTransactions();
    fetchAdminUsage();
  }, [fetchUsage, fetchTransactions, fetchAdminUsage]);

  const totalTransactionTokens = transactions.reduce(
    (sum, t) => sum + t.tokens_in + t.tokens_out, 0
  );

  // Calculate max for local bar chart scaling
  const maxDaily = Math.max(...usageByDay.map((d) => d.tokens_in + d.tokens_out), 1);

  // Admin bar chart scaling
  const maxAdminDaily = Math.max(...adminByDay.map((d) => d.input_tokens + d.output_tokens), 1);

  // Aggregate admin totals
  const adminTotalInput = adminByDay.reduce((s, d) => s + d.input_tokens, 0);
  const adminTotalOutput = adminByDay.reduce((s, d) => s + d.output_tokens, 0);
  const adminTotalCacheRead = adminByDay.reduce((s, d) => s + d.cache_read_tokens, 0);

  // Aggregate code metrics
  const codeTotals = adminCodeMetrics.reduce((acc, m) => ({
    sessions: acc.sessions + m.num_sessions,
    commits: acc.commits + m.commits,
    pullRequests: acc.pullRequests + m.pull_requests,
    linesAdded: acc.linesAdded + m.lines_added,
    linesRemoved: acc.linesRemoved + m.lines_removed,
  }), { sessions: 0, commits: 0, pullRequests: 0, linesAdded: 0, linesRemoved: 0 });

  return (
    <div className="p-6 space-y-6">
      {loading && <p className="text-sm" style={{ color: 'var(--bb-text-muted)' }}>Loading...</p>}

      {/* ═══ Admin API Usage Section ═══ */}
      {adminAvailable && (
        <>
          {/* Admin header */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--bb-text-strong)' }}>API Usage</div>
              <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
                Source: Anthropic Admin API
                {adminLastRefresh && ` \u00b7 Updated ${formatRelativeTime(adminLastRefresh)}`}
              </div>
            </div>
            <button
              onClick={refreshAdminUsage}
              disabled={adminRefreshing}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
              style={{
                background: 'var(--bb-bg)',
                color: 'var(--bb-text-muted)',
                border: '1px solid var(--bb-border)',
              }}
            >
              <RefreshCw size={12} className={adminRefreshing ? 'animate-spin' : ''} />
              {adminLastRefresh ? 'Refresh' : 'Fetch Usage'}
            </button>
          </div>

          {adminLoading && !adminLastRefresh && (
            <p className="text-sm" style={{ color: 'var(--bb-text-muted)' }}>Loading API usage...</p>
          )}

          {adminError && (
            <div className="text-[11px] px-3 py-2 rounded-md" style={{ background: 'var(--bb-bg)', color: 'var(--bb-text-muted)', border: '1px solid var(--bb-border)' }}>
              {adminError}
            </div>
          )}

          {adminLastRefresh && (
            <>
              {/* Admin summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bb-card bb-rise bb-stagger-1">
                  <div className="bb-stat-label">API Input</div>
                  <div className="bb-stat-value">{formatTokens(adminTotalInput)}</div>
                </div>
                <div className="bb-card bb-rise bb-stagger-2">
                  <div className="bb-stat-label">API Output</div>
                  <div className="bb-stat-value">{formatTokens(adminTotalOutput)}</div>
                </div>
                <div className="bb-card bb-rise bb-stagger-3">
                  <div className="bb-stat-label">Cache Read</div>
                  <div className="bb-stat-value">{formatTokens(adminTotalCacheRead)}</div>
                </div>
                <div className="bb-card bb-rise bb-stagger-4">
                  <div className="bb-stat-label">Est. Cost</div>
                  <div className="bb-stat-value">
                    {formatCost(adminByModel.reduce((s, m) => s + estimateCost(m.model, m.input_tokens, m.output_tokens), 0))}
                  </div>
                </div>
              </div>

              {/* Admin daily bar chart */}
              <div className="bb-card">
                <div className="bb-card-title">API Daily Usage (14 days)</div>
                {adminByDay.length === 0 ? (
                  <p className="bb-empty">No API usage data</p>
                ) : (
                  <div className="space-y-1.5">
                    {adminByDay.map((day) => {
                      const total = day.input_tokens + day.output_tokens;
                      const pct = (total / maxAdminDaily) * 100;
                      const inPct = total > 0 ? (day.input_tokens / total) * pct : 0;
                      const outPct = pct - inPct;
                      return (
                        <div key={day.day} className="flex items-center gap-3">
                          <span className="text-[11px] w-16 shrink-0 text-right font-mono" style={{ color: 'var(--bb-text-faint)' }}>
                            {day.day.slice(5)}
                          </span>
                          <div className="flex-1 flex h-5 rounded overflow-hidden" style={{ background: 'var(--bb-bg)' }}>
                            <div className="h-full rounded-l" style={{ width: `${inPct}%`, background: 'var(--bb-accent)', opacity: 0.8 }} />
                            <div className="h-full rounded-r" style={{ width: `${outPct}%`, background: 'var(--bb-accent)', opacity: 0.4 }} />
                          </div>
                          <span className="text-[11px] w-16 shrink-0 font-mono" style={{ color: 'var(--bb-text-faint)' }}>
                            {formatTokens(total)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex gap-4 mt-3 text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded" style={{ background: 'var(--bb-accent)', opacity: 0.8 }} /> Input
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded" style={{ background: 'var(--bb-accent)', opacity: 0.4 }} /> Output
                  </span>
                </div>
              </div>

              {/* Admin model breakdown */}
              {adminByModel.length > 0 && (
                <div className="bb-card">
                  <div className="bb-card-title">API By Model</div>
                  <div className="space-y-3">
                    {adminByModel.map((m) => {
                      const cost = estimateCost(m.model, m.input_tokens, m.output_tokens);
                      return (
                        <div key={m.model} className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium" style={{ color: 'var(--bb-text)' }}>
                              {shortModel(m.model || 'unknown')}
                            </div>
                            <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
                              {formatTokens(m.input_tokens)} in · {formatTokens(m.output_tokens)} out
                              {m.cache_read_tokens > 0 && ` · ${formatTokens(m.cache_read_tokens)} cached`}
                            </div>
                          </div>
                          <span className="text-sm font-medium" style={{ color: 'var(--bb-text-muted)' }}>
                            ~{formatCost(cost)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Claude Code metrics */}
              {adminCodeMetrics.length > 0 && (
                <div className="bb-card">
                  <div className="bb-card-title">Claude Code Activity (14 days)</div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
                    <div className="flex items-center gap-2">
                      <Terminal size={14} style={{ color: 'var(--bb-accent)' }} />
                      <div>
                        <div className="text-sm font-medium" style={{ color: 'var(--bb-text)' }}>{codeTotals.sessions}</div>
                        <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>Sessions</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <GitCommit size={14} style={{ color: 'var(--bb-accent)' }} />
                      <div>
                        <div className="text-sm font-medium" style={{ color: 'var(--bb-text)' }}>{codeTotals.commits}</div>
                        <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>Commits</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <GitPullRequest size={14} style={{ color: 'var(--bb-accent)' }} />
                      <div>
                        <div className="text-sm font-medium" style={{ color: 'var(--bb-text)' }}>{codeTotals.pullRequests}</div>
                        <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>Pull Requests</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Code size={14} style={{ color: 'var(--bb-accent)' }} />
                      <div>
                        <div className="text-sm font-medium" style={{ color: 'var(--bb-text)' }}>
                          +{formatTokens(codeTotals.linesAdded)} / -{formatTokens(codeTotals.linesRemoved)}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>Lines Changed</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Divider between admin and local */}
          <div className="flex items-center gap-3" style={{ color: 'var(--bb-text-faint)' }}>
            <div className="flex-1 h-px" style={{ background: 'var(--bb-border)' }} />
            <span className="text-[10px] font-medium uppercase tracking-wider">Local Tracking</span>
            <div className="flex-1 h-px" style={{ background: 'var(--bb-border)' }} />
          </div>
        </>
      )}

      {/* ═══ Local Usage Section (existing) ═══ */}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bb-card bb-rise bb-stagger-1">
          <div className="bb-stat-label">Today Input</div>
          <div className="bb-stat-value">{formatTokens(usageToday?.tokens_in ?? 0)}</div>
        </div>
        <div className="bb-card bb-rise bb-stagger-2">
          <div className="bb-stat-label">Today Output</div>
          <div className="bb-stat-value">{formatTokens(usageToday?.tokens_out ?? 0)}</div>
        </div>
        <div className="bb-card bb-rise bb-stagger-3">
          <div className="bb-stat-label">Total Input</div>
          <div className="bb-stat-value">{formatTokens(usageTotal?.tokens_in ?? 0)}</div>
        </div>
        <div className="bb-card bb-rise bb-stagger-4">
          <div className="bb-stat-label">Total Output</div>
          <div className="bb-stat-value">{formatTokens(usageTotal?.tokens_out ?? 0)}</div>
        </div>
      </div>

      {/* Daily bar chart */}
      <div className="bb-card">
        <div className="bb-card-title">Daily Usage (14 days)</div>
        {usageByDay.length === 0 ? (
          <p className="bb-empty">No usage data</p>
        ) : (
          <div className="space-y-1.5">
            {usageByDay.map((day) => {
              const total = day.tokens_in + day.tokens_out;
              const pct = (total / maxDaily) * 100;
              const inPct = total > 0 ? (day.tokens_in / total) * pct : 0;
              const outPct = pct - inPct;
              return (
                <div key={day.day} className="flex items-center gap-3">
                  <span className="text-[11px] w-16 shrink-0 text-right font-mono" style={{ color: 'var(--bb-text-faint)' }}>
                    {day.day.slice(5)}
                  </span>
                  <div className="flex-1 flex h-5 rounded overflow-hidden" style={{ background: 'var(--bb-bg)' }}>
                    <div className="h-full rounded-l" style={{ width: `${inPct}%`, background: 'var(--bb-accent)', opacity: 0.7 }} />
                    <div className="h-full rounded-r" style={{ width: `${outPct}%`, background: 'var(--bb-accent)', opacity: 0.35 }} />
                  </div>
                  <span className="text-[11px] w-16 shrink-0 font-mono" style={{ color: 'var(--bb-text-faint)' }}>
                    {formatTokens(total)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex gap-4 mt-3 text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded" style={{ background: 'var(--bb-accent)', opacity: 0.7 }} /> Input
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded" style={{ background: 'var(--bb-accent)', opacity: 0.35 }} /> Output
          </span>
        </div>
      </div>

      {/* Model breakdown */}
      <div className="bb-card">
        <div className="bb-card-title">By Model</div>
        {usageByModel.length === 0 ? (
          <p className="bb-empty">No model data</p>
        ) : (
          <div className="space-y-3">
            {usageByModel.map((m) => {
              const cost = estimateCost(m.model, m.tokens_in, m.tokens_out);
              return (
                <div key={m.model} className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--bb-text)' }}>
                      {m.model || 'unknown'}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
                      {m.api_calls} calls · {formatTokens(m.tokens_in)} in · {formatTokens(m.tokens_out)} out
                    </div>
                  </div>
                  <span className="text-sm font-medium" style={{ color: 'var(--bb-text-muted)' }}>
                    ~{formatCost(cost)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Transactions table */}
      <div className="bb-card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="bb-card-title">Recent Transactions</div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--bb-text-faint)' }}>
              {transactions.length} transactions
              {totalTransactionTokens > 0 && ` \u00b7 ${formatTokens(totalTransactionTokens)} total tokens`}
            </div>
          </div>
          <button
            onClick={fetchTransactions}
            disabled={transactionsLoading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
            style={{
              background: 'var(--bb-bg)',
              color: 'var(--bb-text-muted)',
              border: '1px solid var(--bb-border)',
            }}
          >
            <RefreshCw size={12} className={transactionsLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {transactionsLoading && transactions.length === 0 ? (
          <p className="bb-empty">Loading transactions...</p>
        ) : transactions.length === 0 ? (
          <p className="bb-empty">No transactions yet</p>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-[11px]" style={{ color: 'var(--bb-text)' }}>
              <thead>
                <tr style={{ color: 'var(--bb-text-faint)', borderBottom: '1px solid var(--bb-border)' }}>
                  <th className="text-left font-medium py-1.5 pr-3">Time</th>
                  <th className="text-left font-medium py-1.5 pr-3">Model</th>
                  <th className="text-left font-medium py-1.5 pr-3">Slot</th>
                  <th className="text-right font-medium py-1.5 pr-3">In</th>
                  <th className="text-right font-medium py-1.5 pr-3">Out</th>
                  <th className="text-right font-medium py-1.5 pr-3">Total</th>
                  <th className="text-right font-medium py-1.5">Duration</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-t"
                    style={{ borderColor: 'var(--bb-border)' }}
                  >
                    <td className="py-1.5 pr-3 whitespace-nowrap font-mono" style={{ color: 'var(--bb-text-faint)' }}>
                      {formatTimestamp(tx.created_at)}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap font-medium" style={{ color: 'var(--bb-text-muted)' }}>
                      {shortModel(tx.model || 'unknown')}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: 'var(--bb-text-faint)' }}>
                      {tx.slot || '\u2014'}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono">
                      {formatTokens(tx.tokens_in)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono">
                      {formatTokens(tx.tokens_out)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono font-medium" style={{ color: 'var(--bb-accent)' }}>
                      {formatTokens(tx.tokens_in + tx.tokens_out)}
                    </td>
                    <td className="py-1.5 text-right font-mono" style={{ color: 'var(--bb-text-faint)' }}>
                      {tx.duration_ms ? formatDuration(tx.duration_ms) : '\u2014'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
