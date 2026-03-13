import { useEffect, useRef } from 'react';
import { DashboardShell } from './views/dashboard-shell';
import { useAppStore } from './stores/app-store';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

export default function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as Record<string, unknown>;
          const store = useAppStore.getState();

          switch (msg.type) {
            case 'status':
              store.setStatus(msg.data as 'idle' | 'thinking' | 'tool_call' | 'error');
              break;
            case 'tool_call':
              store.setStatus('tool_call', (msg.data as { name?: string })?.name ?? null);
              break;
            case 'done':
            case 'error':
              store.setStatus('idle');
              break;
            case 'agent_mode':
              store.setAgentMode(msg.mode as 'autonomous' | 'ask' | 'stop');
              break;
            case 'permission_mode':
              store.setPermissionMode((msg.mode === 'default' ? 'bypassPermissions' : msg.mode) as 'bypassPermissions' | 'acceptEdits' | 'plan');
              break;
            case 'sandbox':
              store.setSandboxEnabled(msg.enabled as boolean);
              break;
            case 'sub_agent': {
              const sa = msg.data as { event: string; id?: string; description?: string; status?: string; lastTool?: string; summary?: string };
              if (sa.event === 'spawning' || sa.event === 'started') {
                store.addSubAgent({
                  id: sa.id ?? crypto.randomUUID(),
                  description: sa.description ?? '',
                  status: 'active',
                  startedAt: Date.now(),
                  activityLog: [],
                });
              } else if (sa.event === 'completed' || sa.event === 'failed' || sa.event === 'stopped') {
                store.updateSubAgent(sa.id ?? '', { status: sa.event as 'completed' | 'failed' | 'stopped', summary: sa.summary });
                setTimeout(() => store.removeSubAgent(sa.id ?? ''), 5000);
              } else if (sa.event === 'tool_call' && sa.id) {
                store.updateSubAgent(sa.id, { lastTool: sa.lastTool, status: 'active' });
              }
              break;
            }
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        reconnectTimer.current = setTimeout(connect, 3000);
      };
    }

    connect();

    // Fetch initial agent state
    fetch(`${window.location.protocol}//${window.location.host}/api/agent/state`)
      .then(r => r.json())
      .then(data => {
        const store = useAppStore.getState();
        store.setAgentMode(data.agentMode);
        store.setPermissionMode(data.permissionMode);
        store.setSandboxEnabled(data.sandboxEnabled);
      })
      .catch(() => {});

    // Fetch auth status
    fetch(`${window.location.protocol}//${window.location.host}/api/auth/status`)
      .then(r => r.json())
      .then(data => {
        useAppStore.getState().setAuth(
          data.authenticated ? 'authenticated' : 'unauthenticated',
          data.method,
        );
      })
      .catch(() => useAppStore.getState().setAuth('unauthenticated', 'none'));

    return () => {
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, []);

  const sendRaw = (data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  };

  return <DashboardShell sendRaw={sendRaw} />;
}
