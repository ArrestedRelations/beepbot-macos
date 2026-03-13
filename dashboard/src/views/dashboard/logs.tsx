import { useEffect, useRef } from 'react';
import { useLogsStore } from '../../stores/logs-store';
import { Pause, Play, Trash2 } from 'lucide-react';

const LEVEL_COLORS: Record<string, string> = {
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  debug: 'text-zinc-500',
};

export function LogsView() {
  const { logs, levelFilter, paused, loading, fetchLogs, setLevelFilter, togglePause, clearLogs } = useLogsStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, paused]);

  const filtered = levelFilter === 'all' ? logs : logs.filter((l) => l.level === levelFilter);

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-between px-6 py-3" style={{ borderBottom: '1px solid var(--bb-border)' }}>
        <div className="flex items-center gap-2">
          {(['all', 'info', 'warn', 'error'] as const).map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter(level)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors capitalize ${
                levelFilter === level
                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                  : 'border-zinc-700/50 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={togglePause}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            style={{ color: paused ? 'var(--bb-warn)' : 'var(--bb-text-muted)' }}
            title={paused ? 'Resume' : 'Pause'}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            onClick={clearLogs}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            style={{ color: 'var(--bb-text-muted)' }}
            title="Clear"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-2 font-mono text-[11px] leading-[1.7]">
        {loading && <p style={{ color: 'var(--bb-text-muted)' }}>Loading...</p>}
        {filtered.map((entry) => (
          <div key={entry.id} className="flex items-start gap-2">
            <span style={{ color: 'var(--bb-text-faint)' }} className="shrink-0">
              {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className={`shrink-0 w-10 uppercase ${LEVEL_COLORS[entry.level] ?? 'text-zinc-500'}`}>
              {entry.level}
            </span>
            {entry.source && (
              <span className="shrink-0" style={{ color: 'var(--bb-text-faint)' }}>[{entry.source}]</span>
            )}
            <span style={{ color: 'var(--bb-text)' }} className="break-all">{entry.message}</span>
          </div>
        ))}
        {filtered.length === 0 && !loading && (
          <p style={{ color: 'var(--bb-text-faint)' }} className="text-center py-8">No logs</p>
        )}
      </div>
    </div>
  );
}
