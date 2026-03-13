import { useEffect, useState, useRef } from 'react';
import { useAppStore } from '../../stores/app-store';
import { useDashboardStore } from '../../stores/dashboard-store';

interface WsEvent {
  id: string;
  timestamp: string;
  type: string;
  preview: string;
}

export function DebugView() {
  const status = useAppStore((s) => s.status);
  const agentMode = useAppStore((s) => s.agentMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const sandboxEnabled = useAppStore((s) => s.sandboxEnabled);
  const subAgents = useAppStore((s) => s.subAgents);
  const health = useDashboardStore((s) => s.health);
  const fetchHealth = useDashboardStore((s) => s.fetchHealth);
  const [events, setEvents] = useState<WsEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  // Listen for WS events for the debug log
  useEffect(() => {
    const ws = new WebSocket('ws://127.0.0.1:3004/ws');
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;
        const entry: WsEvent = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type: String(msg.type || 'unknown'),
          preview: JSON.stringify(msg.data ?? msg).slice(0, 200),
        };
        setEvents((prev) => {
          const next = [entry, ...prev];
          return next.slice(0, 100);
        });
      } catch { /* ignore */ }
    };

    return () => { ws.close(); };
  }, []);

  return (
    <div className="p-6 space-y-6">
      {/* Agent state */}
      <div className="bb-card bb-rise bb-stagger-1">
        <div className="bb-card-title">Agent State</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <div className="bb-stat-label">Status</div>
            <div className="text-sm font-mono font-medium" style={{ color: 'var(--bb-text)' }}>{status}</div>
          </div>
          <div>
            <div className="bb-stat-label">Mode</div>
            <div className="text-sm font-mono font-medium" style={{ color: 'var(--bb-text)' }}>{agentMode}</div>
          </div>
          <div>
            <div className="bb-stat-label">Permissions</div>
            <div className="text-sm font-mono font-medium" style={{ color: 'var(--bb-text)' }}>{permissionMode}</div>
          </div>
          <div>
            <div className="bb-stat-label">Sandbox</div>
            <div className="text-sm font-mono font-medium" style={{ color: sandboxEnabled ? 'var(--bb-ok)' : 'var(--bb-warn)' }}>
              {String(sandboxEnabled)}
            </div>
          </div>
        </div>
      </div>

      {/* System health */}
      {health && (
        <div className="bb-card bb-rise bb-stagger-2">
          <div className="bb-card-title">System Health</div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="bb-stat-label">WS Clients</div>
              <div className="font-mono" style={{ color: 'var(--bb-text)' }}>{health.wsClients}</div>
            </div>
            <div>
              <div className="bb-stat-label">DB Size</div>
              <div className="font-mono" style={{ color: 'var(--bb-text)' }}>{health.dbSizeMB} MB</div>
            </div>
            <div>
              <div className="bb-stat-label">Memory Files</div>
              <div className="font-mono" style={{ color: 'var(--bb-text)' }}>{health.memoryFiles}</div>
            </div>
            <div>
              <div className="bb-stat-label">Uptime</div>
              <div className="font-mono" style={{ color: 'var(--bb-text)' }}>{Math.round(health.uptime / 60000)}m</div>
            </div>
          </div>
        </div>
      )}

      {/* Active sub-agents */}
      <div className="bb-card bb-rise bb-stagger-3">
        <div className="bb-card-title">Active Sub-Agents ({subAgents.length})</div>
        {subAgents.length === 0 ? (
          <p className="bb-empty">No active sub-agents</p>
        ) : (
          <div className="space-y-2">
            {subAgents.map((a) => (
              <div key={a.id} className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--bb-bg)' }}>
                <div>
                  <span className="text-sm font-mono" style={{ color: 'var(--bb-text)' }}>{a.description}</span>
                  <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${
                    a.status === 'active' ? 'bg-sky-500/15 text-sky-400'
                      : a.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-red-500/15 text-red-400'
                  }`}>{a.status}</span>
                </div>
                {a.lastTool && (
                  <span className="text-[10px] font-mono" style={{ color: 'var(--bb-text-faint)' }}>{a.lastTool}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* WebSocket event log */}
      <div className="bb-card bb-rise bb-stagger-4">
        <div className="bb-card-title">WebSocket Event Log</div>
        <div className="max-h-80 overflow-y-auto space-y-1">
          {events.length === 0 ? (
            <p className="bb-empty">Listening for events...</p>
          ) : (
            events.map((e) => (
              <div key={e.id} className="flex items-start gap-2 text-[11px] font-mono py-0.5">
                <span style={{ color: 'var(--bb-text-faint)' }} className="shrink-0">
                  {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="shrink-0 px-1.5 py-0.5 rounded" style={{ background: 'var(--bb-accent-subtle)', color: 'var(--bb-accent)' }}>
                  {e.type}
                </span>
                <span className="truncate" style={{ color: 'var(--bb-text-muted)' }}>{e.preview}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
