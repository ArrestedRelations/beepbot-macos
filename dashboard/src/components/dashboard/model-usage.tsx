import type { UsageByModel } from '../../stores/dashboard-store';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

const modelColors: Record<string, string> = {
  sonnet: '#3b82f6',
  haiku: '#22c55e',
  opus: '#a855f7',
};

export function ModelUsage({ data }: { data: UsageByModel[] }) {
  if (data.length === 0) {
    return (
      <div className="bb-card bb-rise bb-stagger-8">
        <div className="bb-card-title">Usage by Model</div>
        <div className="bb-empty">No data</div>
      </div>
    );
  }

  const maxCalls = Math.max(...data.map(d => d.api_calls), 1);

  return (
    <div className="bb-card bb-rise bb-stagger-8">
      <div className="bb-card-title">Usage by Model</div>
      <div className="space-y-4">
        {data.map((model) => {
          const barWidth = (model.api_calls / maxCalls) * 100;
          const color = modelColors[model.model] || '#71717a';
          return (
            <div key={model.model}>
              <div className="flex items-center justify-between text-[13px] mb-1.5">
                <span style={{ color: 'var(--bb-text-strong)' }} className="font-medium capitalize">{model.model || 'unknown'}</span>
                <span style={{ color: 'var(--bb-text-muted)' }} className="text-[12px]">{model.api_calls} calls</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bb-bg-elevated)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${barWidth}%`, background: color, opacity: 0.6 }}
                />
              </div>
              <div className="flex justify-between text-[11px] mt-1" style={{ color: 'var(--bb-text-faint)' }}>
                <span>In: {formatTokens(model.tokens_in)}</span>
                <span>Out: {formatTokens(model.tokens_out)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
