import { useEffect, useState, useRef, useCallback } from 'react';
import { Send, Mountain, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { api, connectWs, disconnectWs } from '../../lib/api';

interface HillMessage {
  id: string;
  senderBotId: string;
  senderShortId: string;
  displayName?: string;
  content: string;
  timestamp: number;
}

interface NetworkStats {
  identity: { botId: string; shortId: string };
  connections: number;
  knownPeers: number;
}

export function HillView() {
  const [messages, setMessages] = useState<HillMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const msgs = await api<HillMessage[]>('/network/hill?limit=200');
      setMessages(msgs);
    } catch { /* ignore */ }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const s = await api<NetworkStats>('/network/stats');
      setStats(s);
    } catch { /* ignore */ }
  }, []);

  // Initial load
  useEffect(() => {
    Promise.all([fetchMessages(), fetchStats()]).finally(() => setLoading(false));
  }, [fetchMessages, fetchStats]);

  // Listen for real-time hill_chat messages via WebSocket
  useEffect(() => {
    connectWs((msg) => {
      if (msg.type === 'hill_chat' && msg.data) {
        const chatMsg = msg.data as HillMessage;
        setMessages((prev) => {
          if (prev.some((m) => m.id === chatMsg.id)) return prev;
          return [...prev, chatMsg];
        });
      }
    });
    return () => {
      // Use proper cleanup function for singleton WebSocket
      disconnectWs();
    };
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Refresh stats every 10s
  useEffect(() => {
    const timer = setInterval(fetchStats, 10_000);
    return () => clearInterval(timer);
  }, [fetchStats]);

  const sendMessage = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await api('/network/hill', {
        method: 'POST',
        body: JSON.stringify({ content: draft.trim(), displayName: 'Chris' }),
      });
      setDraft('');
    } catch { /* ignore */ }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // Dashboard is always Chris (human). All messages from this dashboard are human messages.
  const isMe = (msg: HillMessage) => msg.displayName === 'Chris';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--bb-text-faint)' }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-6 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--bb-border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--bb-accent-subtle)' }}
          >
            <Mountain size={16} style={{ color: 'var(--bb-accent)' }} />
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--bb-text-strong)' }}>
              The Hill
            </div>
            <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
              {stats?.connections ?? 0} connected · {stats?.knownPeers ?? 0} peers known
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(stats?.connections ?? 0) > 0 ? (
            <Wifi size={14} style={{ color: 'var(--bb-ok)' }} />
          ) : (
            <WifiOff size={14} style={{ color: 'var(--bb-text-faint)' }} />
          )}
          <button
            onClick={() => { fetchMessages(); fetchStats(); }}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: 'var(--bb-text-muted)' }}
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Mountain size={40} style={{ color: 'var(--bb-text-faint)', opacity: 0.3 }} />
            <p className="text-sm" style={{ color: 'var(--bb-text-faint)' }}>
              No messages yet. Say hello to the network.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const me = isMe(msg);
            return (
              <div key={msg.id} className={`flex ${me ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[75%] rounded-xl px-4 py-2.5"
                  style={{
                    background: me ? 'var(--bb-accent)' : 'var(--bb-bg-accent)',
                    border: me ? 'none' : '1px solid var(--bb-border)',
                  }}
                >
                  {!me && (
                    <div className="mb-1">
                      {msg.displayName && (
                        <div className="text-[11px] font-semibold" style={{ color: 'var(--bb-text-muted)' }}>
                          {msg.displayName}
                        </div>
                      )}
                      <div className="text-[10px] font-mono" style={{ color: 'var(--bb-text-faint)' }}>
                        {msg.senderShortId}
                      </div>
                    </div>
                  )}
                  {me && (
                    <div className="mb-1 text-right">
                      {msg.displayName && (
                        <div className="text-[11px] font-semibold" style={{ color: 'rgba(255,255,255,0.8)' }}>
                          {msg.displayName}
                        </div>
                      )}
                      <div className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.5)' }}>
                        {msg.senderShortId}
                      </div>
                    </div>
                  )}
                  <div
                    className="text-sm whitespace-pre-wrap break-words"
                    style={{ color: me ? '#fff' : 'var(--bb-text)' }}
                  >
                    {msg.content}
                  </div>
                  <div
                    className="text-[10px] mt-1 text-right"
                    style={{ color: me ? 'rgba(255,255,255,0.6)' : 'var(--bb-text-faint)' }}
                  >
                    {formatTime(msg.timestamp)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        className="shrink-0 px-6 py-4"
        style={{ borderTop: '1px solid var(--bb-border)', background: 'var(--bb-bg-accent)' }}
      >
        <div className="flex items-end gap-3">
          <div className="flex-1 relative">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Send a message to The Hill..."
              rows={1}
              className="w-full resize-none rounded-xl px-4 py-2.5 text-sm outline-none"
              style={{
                background: 'var(--bb-bg)',
                border: '1px solid var(--bb-border)',
                color: 'var(--bb-text)',
              }}
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={!draft.trim() || sending}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-30"
            style={{ background: 'var(--bb-accent)', color: '#fff' }}
            title="Send"
          >
            <Send size={15} />
          </button>
        </div>
        {stats?.identity && (
          <div className="text-[10px] mt-2 font-mono" style={{ color: 'var(--bb-text-faint)' }}>
            You: {stats.identity.shortId}
          </div>
        )}
      </div>
    </div>
  );
}
