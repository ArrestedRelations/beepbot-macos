import { Layers } from 'lucide-react';
import type { CompactionEntry } from '../../stores/dashboard-store';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function CompactionLog({ compactions }: { compactions: CompactionEntry[] }) {
  if (compactions.length === 0) {
    return (
      <div className="bb-card bb-rise bb-stagger-11">
        <div className="bb-card-title">Compaction Log</div>
        <div className="bb-empty">No compactions yet</div>
      </div>
    );
  }

  return (
    <div className="bb-card bb-rise bb-stagger-11">
      <div className="bb-card-title">Compaction Log</div>
      <div className="space-y-3 max-h-56 overflow-y-auto">
        {compactions.slice(0, 10).map((entry) => (
          <div
            key={entry.id}
            className="pb-3 last:pb-0"
            style={{ borderBottom: '1px solid var(--bb-border)' }}
          >
            <div className="flex items-center gap-2.5 text-[13px]">
              <Layers size={13} style={{ color: '#a855f7', flexShrink: 0 }} />
              <span className="truncate flex-1" style={{ color: 'var(--bb-text)' }}>
                {entry.conversation_title || entry.conversation_id.slice(0, 8)}
              </span>
              <span className="shrink-0 text-[11px] font-mono" style={{ color: 'var(--bb-text-faint)' }}>
                {formatTokens(entry.tokens_before)} tok
              </span>
            </div>
            <div className="text-[12px] mt-1 line-clamp-2 pl-[25px]" style={{ color: 'var(--bb-text-muted)' }}>
              {entry.summary.slice(0, 120)}
            </div>
            <div className="text-[11px] mt-0.5 pl-[25px]" style={{ color: 'var(--bb-text-faint)' }}>
              {timeAgo(entry.created_at)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
