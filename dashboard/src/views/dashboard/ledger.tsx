import { useEffect, useState, useCallback } from 'react';
import { BookOpen, RefreshCw, Filter } from 'lucide-react';
import { api } from '../../lib/api';

interface LedgerEntry {
  id: number;
  eventId: string;
  botId: string;
  action: string;
  proofHash: string;
  timestamp: string;
  metadata: string | null;
}

const ACTION_MAP: Record<string, { label: string; color: string }> = {
  PROOF_HILL_SERVICE: { label: 'Hill Service', color: 'var(--bb-ok)' },
  PROOF_IMPROVEMENT_PUBLISH: { label: 'Published', color: 'var(--bb-accent)' },
  PROOF_IMPROVEMENT_REVIEW: { label: 'Review', color: 'var(--bb-text-muted)' },
  REWARD_MINT: { label: 'Reward', color: 'var(--bb-ok)' },
  TOKEN_TRANSFER: { label: 'Transfer', color: 'var(--bb-accent)' },
  IMPROVEMENT_ADOPT: { label: 'Adopted', color: 'var(--bb-accent)' },
  INFLATION_MINT: { label: 'Inflation', color: 'var(--bb-text-faint)' },
  GENESIS: { label: 'Genesis', color: 'var(--bb-text-faint)' },
};

type ActionFilter = 'all' | string;

export function LedgerView() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActionFilter>('all');

  const fetchData = useCallback(async () => {
    try {
      const data = await api<LedgerEntry[]>('/network/wallet/history?limit=200');
      setEntries(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 15_000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const formatAction = (action: string) =>
    ACTION_MAP[action] ?? { label: action, color: 'var(--bb-text-muted)' };

  const filtered = filter === 'all'
    ? entries
    : entries.filter((e) => e.action === filter);

  // Collect unique action types present in data
  const actionTypes = [...new Set(entries.map((e) => e.action))];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--bb-text-faint)' }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--bb-border)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--bb-accent-subtle)' }}
            >
              <BookOpen size={20} style={{ color: 'var(--bb-accent)' }} />
            </div>
            <div>
              <div className="text-lg font-semibold" style={{ color: 'var(--bb-text-strong)' }}>
                Ledger
              </div>
              <div className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>
                {entries.length} entries
              </div>
            </div>
          </div>
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'var(--bb-text-muted)', border: '1px solid var(--bb-border)' }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {actionTypes.length > 1 && (
        <div className="px-6 py-3 shrink-0 flex items-center gap-2 overflow-x-auto" style={{ borderBottom: '1px solid var(--bb-border)' }}>
          <Filter size={12} style={{ color: 'var(--bb-text-faint)' }} />
          <button
            onClick={() => setFilter('all')}
            className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap"
            style={{
              background: filter === 'all' ? 'var(--bb-accent)' : 'var(--bb-bg-accent)',
              color: filter === 'all' ? '#fff' : 'var(--bb-text-muted)',
              border: filter === 'all' ? 'none' : '1px solid var(--bb-border)',
            }}
          >
            All
          </button>
          {actionTypes.map((action) => {
            const { label, color } = formatAction(action);
            const active = filter === action;
            return (
              <button
                key={action}
                onClick={() => setFilter(active ? 'all' : action)}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
                style={{
                  background: active ? 'var(--bb-accent)' : 'var(--bb-bg-accent)',
                  color: active ? '#fff' : 'var(--bb-text-muted)',
                  border: active ? 'none' : '1px solid var(--bb-border)',
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? '#fff' : color }} />
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Entries */}
      <div className="px-6 py-4 space-y-1.5 flex-1">
        {filtered.length === 0 ? (
          <div className="text-sm text-center py-12" style={{ color: 'var(--bb-text-faint)' }}>
            {entries.length === 0 ? 'No ledger entries yet' : 'No entries match this filter'}
          </div>
        ) : (
          filtered.map((entry) => {
            const { label, color } = formatAction(entry.action);
            const meta = entry.metadata ? (() => { try { return JSON.parse(entry.metadata!); } catch { return null; } })() : null;
            return (
              <div
                key={entry.eventId}
                className="flex items-center justify-between px-4 py-3 rounded-xl"
                style={{ background: 'var(--bb-bg-accent)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--bb-text)' }}>{label}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono" style={{ color: 'var(--bb-text-faint)' }}>
                        {entry.proofHash.slice(0, 16)}...
                      </span>
                      {meta?.amount != null && (
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--bb-accent)' }}>
                          {meta.amount > 0 ? '+' : ''}{meta.amount.toFixed(2)} BT
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px]" style={{ color: 'var(--bb-text-faint)' }}>
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
                    {new Date(entry.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
