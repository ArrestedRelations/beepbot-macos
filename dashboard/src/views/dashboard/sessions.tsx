import { useEffect } from 'react';
import { Trash2, MessageSquare, ArrowLeft } from 'lucide-react';
import { useSessionsStore, type SessionMessage } from '../../stores/sessions-store';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function SessionsView() {
  const { sessions, selectedSessionId, selectedMessages, filter, loading, fetchSessions, selectSession, deleteSession, setFilter } = useSessionsStore();

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const filtered = filter === 'active'
    ? sessions.filter((s) => s.message_count > 0)
    : sessions;

  // Detail view for a selected session
  if (selectedSessionId) {
    const session = sessions.find((s) => s.id === selectedSessionId);
    return (
      <div className="p-6 space-y-4">
        <button
          onClick={() => selectSession(null)}
          className="flex items-center gap-2 text-sm transition-colors"
          style={{ color: 'var(--bb-text-muted)' }}
        >
          <ArrowLeft size={14} /> Back to sessions
        </button>
        {session && (
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--bb-text-strong)' }}>
              {session.title || 'Untitled'}
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--bb-text-faint)' }}>
              {session.message_count} messages · {formatTokens(session.total_tokens_in + session.total_tokens_out)} tokens
            </p>
          </div>
        )}
        <div className="space-y-2">
          {selectedMessages.map((msg: SessionMessage) => (
            <div
              key={msg.id}
              className={`bb-card ${msg.role === 'user' ? '!bg-blue-500/5' : ''}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] uppercase font-semibold tracking-wider ${
                  msg.role === 'user' ? 'text-blue-400' : msg.role === 'assistant' ? 'text-emerald-400' : 'text-zinc-500'
                }`}>{msg.role}</span>
                <span className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>{formatDate(msg.created_at)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--bb-text)' }}>
                {msg.content.slice(0, 2000)}{msg.content.length > 2000 ? '...' : ''}
              </p>
              {(msg.tokens_in || msg.tokens_out) && (
                <div className="flex gap-3 mt-2 text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
                  {msg.tokens_in ? <span>In: {formatTokens(msg.tokens_in)}</span> : null}
                  {msg.tokens_out ? <span>Out: {formatTokens(msg.tokens_out)}</span> : null}
                  {msg.model && <span>{msg.model}</span>}
                </div>
              )}
            </div>
          ))}
          {selectedMessages.length === 0 && (
            <p className="bb-empty">No messages in this session</p>
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="p-6 space-y-4">
      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {(['all', 'active'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors capitalize ${
              filter === f
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                : 'border-zinc-700/50 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {f} ({f === 'active' ? sessions.filter((s) => s.message_count > 0).length : sessions.length})
          </button>
        ))}
      </div>

      {loading && <p className="text-sm" style={{ color: 'var(--bb-text-muted)' }}>Loading...</p>}

      <div className="space-y-2">
        {filtered.map((session) => (
          <div
            key={session.id}
            className="bb-card flex items-center gap-3 cursor-pointer hover:border-zinc-600 transition-colors"
            onClick={() => selectSession(session.id)}
          >
            <MessageSquare size={16} style={{ color: 'var(--bb-text-faint)' }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: 'var(--bb-text)' }}>
                {session.title || 'Untitled'}
              </div>
              {session.last_message && (
                <div className="text-xs truncate mt-0.5" style={{ color: 'var(--bb-text-faint)' }}>
                  {session.last_message.slice(0, 80)}
                </div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
                {session.message_count} msgs
              </div>
              <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
                {formatTokens(session.total_tokens_in + session.total_tokens_out)} tok
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors opacity-0 hover:opacity-100"
              style={{ color: 'var(--bb-text-faint)' }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {filtered.length === 0 && <p className="bb-empty">No sessions</p>}
      </div>
    </div>
  );
}
