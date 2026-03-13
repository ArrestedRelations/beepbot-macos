import type { UsageByDay } from '../../stores/dashboard-store';

function formatDay(day: string): string {
  const d = new Date(day + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
}

export function UsageChart({ data }: { data: UsageByDay[] }) {
  if (data.length === 0) {
    return (
      <div className="bb-card bb-rise bb-stagger-7">
        <div className="bb-card-title">Token Usage (14 days)</div>
        <div className="bb-empty">No usage data yet</div>
      </div>
    );
  }

  const maxTokens = Math.max(...data.map(d => d.tokens_in + d.tokens_out), 1);

  return (
    <div className="bb-card bb-rise bb-stagger-7">
      <div className="bb-card-title">Token Usage (14 days)</div>
      <div className="flex items-end gap-1 h-28">
        {data.map((d) => {
          const total = d.tokens_in + d.tokens_out;
          const height = Math.max((total / maxTokens) * 100, 2);
          const inPct = total > 0 ? (d.tokens_in / total) * height : 0;
          const outPct = height - inPct;
          return (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              <div className="w-full flex flex-col justify-end" style={{ height: '112px' }}>
                <div
                  className="w-full rounded-t"
                  style={{ height: `${outPct}%`, background: 'rgba(59, 130, 246, 0.5)' }}
                />
                <div
                  className="w-full rounded-b"
                  style={{ height: `${inPct}%`, background: 'rgba(59, 130, 246, 0.2)' }}
                />
              </div>
              {/* Tooltip */}
              <div
                className="absolute -top-9 left-1/2 -translate-x-1/2 hidden group-hover:block rounded px-2 py-1 text-[10px] whitespace-nowrap z-10"
                style={{
                  background: 'var(--bb-bg-elevated)',
                  border: '1px solid var(--bb-border-strong)',
                  color: 'var(--bb-text)',
                }}
              >
                {formatDay(d.day)}: {formatTokens(total)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
        <span>{data.length > 0 ? formatDay(data[0].day) : ''}</span>
        <span>{data.length > 0 ? formatDay(data[data.length - 1].day) : ''}</span>
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11px]" style={{ color: 'var(--bb-text-muted)' }}>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded" style={{ background: 'rgba(59, 130, 246, 0.2)' }} />
          Input
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded" style={{ background: 'rgba(59, 130, 246, 0.5)' }} />
          Output
        </span>
      </div>
    </div>
  );
}
