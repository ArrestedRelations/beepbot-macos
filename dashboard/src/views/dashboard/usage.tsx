import { useEffect } from 'react';
import { useUsageStore, estimateCost } from '../../stores/usage-store';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatCost(dollars: number): string {
  return '$' + dollars.toFixed(4);
}

export function UsageView() {
  const { usageToday, usageTotal, usageByDay, usageByModel, loading, fetchUsage } = useUsageStore();

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  // Calculate max for bar chart scaling
  const maxDaily = Math.max(...usageByDay.map((d) => d.tokens_in + d.tokens_out), 1);

  return (
    <div className="p-6 space-y-6">
      {loading && <p className="text-sm" style={{ color: 'var(--bb-text-muted)' }}>Loading...</p>}

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
    </div>
  );
}
