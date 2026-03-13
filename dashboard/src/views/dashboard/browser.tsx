import { useEffect, useState, useCallback } from 'react';
import { Globe, RefreshCw, Wifi, WifiOff, Monitor } from 'lucide-react';
import { api } from '../../lib/api';

interface BrowserStatus {
  ok: boolean;
  connected: boolean;
  tabs: number;
}

interface BrowserTab {
  id: number;
  url: string;
  title: string;
  active: boolean;
}

export function BrowserView() {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const s = await api<BrowserStatus>('/browser/status');
      setStatus(s);
      if (s.connected) {
        const res = await api<{ ok: boolean; tabs?: BrowserTab[] }>('/browser/tabs');
        if (res.ok && res.tabs) setTabs(res.tabs);
      } else {
        setTabs([]);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 5000);
    return () => clearInterval(timer);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--bb-text-faint)' }} />
      </div>
    );
  }

  const connected = status?.connected ?? false;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--bb-border)' }}>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--bb-accent-subtle)' }}
          >
            <Globe size={20} style={{ color: 'var(--bb-accent)' }} />
          </div>
          <div>
            <h2 className="text-sm font-bold" style={{ color: 'var(--bb-text-strong)' }}>
              Browser Control
            </h2>
            <p className="text-xs" style={{ color: 'var(--bb-text-muted)' }}>
              Chrome extension bridge for browser automation
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {connected ? (
              <Wifi size={14} style={{ color: 'var(--bb-ok)' }} />
            ) : (
              <WifiOff size={14} style={{ color: 'var(--bb-danger)' }} />
            )}
            <span className="text-xs font-medium" style={{ color: connected ? 'var(--bb-ok)' : 'var(--bb-danger)' }}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
            <button
              onClick={fetchData}
              className="p-1.5 rounded-md ml-2"
              style={{ color: 'var(--bb-text-muted)' }}
              title="Refresh"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Connection status card */}
        <div className="rounded-xl p-4" style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)' }}>
          <div className="flex items-center gap-3 mb-3">
            <Monitor size={16} style={{ color: 'var(--bb-text-muted)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--bb-text-strong)' }}>Extension Status</span>
          </div>

          {connected ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--bb-text-muted)' }}>Open Tabs</span>
                <span className="text-xs font-mono font-bold" style={{ color: 'var(--bb-text-strong)' }}>{tabs.length}</span>
              </div>
              <p className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>
                The BeepBot Bridge extension is connected. The agent can navigate, read pages, click elements, type text, and manage tabs.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: 'var(--bb-text-muted)' }}>
                The Chrome extension is not connected. Follow these steps to set it up:
              </p>
              <ol className="text-xs space-y-1.5 list-decimal list-inside" style={{ color: 'var(--bb-text-muted)' }}>
                <li>Open Chrome and go to <button
                    className="font-mono underline cursor-pointer bg-transparent border-none p-0 inline"
                    style={{ color: 'var(--bb-accent)', fontSize: 'inherit' }}
                    onClick={() => {
                      navigator.clipboard.writeText('chrome://extensions');
                      alert('Copied chrome://extensions to clipboard — paste it into Chrome\'s address bar.');
                    }}
                    title="Click to copy URL"
                  >chrome://extensions</button></li>
                <li>Enable <strong>Developer mode</strong> (top right toggle)</li>
                <li>Click <strong>Load unpacked</strong></li>
                <li>Select the <span className="font-mono text-[10px]" style={{ color: 'var(--bb-text-strong)' }}>extensions/beep-bridge</span> folder from the BeepBot project</li>
                <li>The extension will auto-connect to BeepBot</li>
              </ol>
            </div>
          )}
        </div>

        {/* Open tabs */}
        {connected && tabs.length > 0 && (
          <div>
            <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--bb-text-strong)' }}>Open Tabs</h3>
            <div className="space-y-1">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className="flex items-center gap-2 p-2 rounded-lg"
                  style={{
                    background: tab.active ? 'var(--bb-accent-subtle)' : 'var(--bb-bg-accent)',
                    border: tab.active ? '1px solid var(--bb-accent)' : '1px solid var(--bb-border)',
                  }}
                >
                  <Globe size={12} style={{ color: tab.active ? 'var(--bb-accent)' : 'var(--bb-text-faint)', flexShrink: 0 }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--bb-text-strong)' }}>
                      {tab.title || 'Untitled'}
                    </div>
                    <div className="text-[10px] truncate" style={{ color: 'var(--bb-text-faint)' }}>
                      {tab.url}
                    </div>
                  </div>
                  {tab.active && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0"
                      style={{ background: 'var(--bb-accent)', color: '#fff' }}>
                      Active
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Capabilities */}
        <div>
          <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--bb-text-strong)' }}>Agent Capabilities</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Navigate', desc: 'Go to URLs, open new tabs' },
              { label: 'Read Pages', desc: 'Parse accessibility tree, extract text' },
              { label: 'Click Elements', desc: 'Human-like clicks on buttons, links' },
              { label: 'Type Text', desc: 'Character-by-character typing with delays' },
              { label: 'Scroll', desc: 'Smooth page scrolling' },
              { label: 'Manage Tabs', desc: 'Open, close, switch between tabs' },
            ].map(({ label, desc }) => (
              <div key={label} className="p-2.5 rounded-lg" style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)' }}>
                <div className="text-xs font-medium" style={{ color: 'var(--bb-text-strong)' }}>{label}</div>
                <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
