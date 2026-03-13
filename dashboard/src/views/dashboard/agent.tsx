import { useEffect } from 'react';
import { useAgentStore } from '../../stores/agent-store';
import { useAppStore } from '../../stores/app-store';
import { Wrench, Server, FolderOpen } from 'lucide-react';

const SIDECAR = 'http://127.0.0.1:3004';

export function AgentView() {
  const { tools, workspaceFiles, mcpServers, agentStatus, loading, fetchAll } = useAgentStore();
  const agentMode = useAppStore((s) => s.agentMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const sandboxEnabled = useAppStore((s) => s.sandboxEnabled);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  function setMode(mode: string) {
    fetch(`${SIDECAR}/api/agent/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).catch(() => {});
  }

  function setPermMode(mode: string) {
    fetch(`${SIDECAR}/api/agent/permission-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).catch(() => {});
  }

  return (
    <div className="p-6 space-y-6">
      {loading && <p className="text-sm" style={{ color: 'var(--bb-text-muted)' }}>Loading...</p>}

      {/* Agent identity + status */}
      <div className="bb-card bb-rise bb-stagger-1">
        <div className="bb-card-title">Agent Status</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="bb-stat-label">Mode</div>
            <div className="text-lg font-bold capitalize" style={{ color: 'var(--bb-text-strong)' }}>{agentMode}</div>
          </div>
          <div>
            <div className="bb-stat-label">Permission</div>
            <div className="text-lg font-bold" style={{ color: 'var(--bb-text-strong)' }}>
              {permissionMode === 'bypassPermissions' ? 'Full Auto' : permissionMode === 'acceptEdits' ? 'Accept Edits' : 'Default'}
            </div>
          </div>
          <div>
            <div className="bb-stat-label">Sandbox</div>
            <div className="text-lg font-bold" style={{ color: sandboxEnabled ? 'var(--bb-ok)' : 'var(--bb-warn)' }}>
              {sandboxEnabled ? 'On' : 'Off'}
            </div>
          </div>
          <div>
            <div className="bb-stat-label">Chat Running</div>
            <div className="text-lg font-bold" style={{ color: agentStatus?.chatRunning ? 'var(--bb-ok)' : 'var(--bb-text-muted)' }}>
              {agentStatus?.chatRunning ? 'Yes' : 'No'}
            </div>
          </div>
        </div>
      </div>

      {/* Mode selector */}
      <div className="bb-card bb-rise bb-stagger-2">
        <div className="bb-card-title">Agent Mode</div>
        <div className="flex gap-2">
          {(['autonomous', 'ask', 'stop'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setMode(mode)}
              className={`flex-1 text-xs py-2.5 rounded-lg border transition-colors capitalize ${
                agentMode === mode
                  ? mode === 'autonomous'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : mode === 'ask'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      : 'bg-zinc-700/50 border-zinc-600/30 text-zinc-400'
                  : 'border-zinc-700/50 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {mode === 'autonomous' ? 'Auto' : mode}
            </button>
          ))}
        </div>
      </div>

      {/* Permission mode */}
      <div className="bb-card bb-rise bb-stagger-3">
        <div className="bb-card-title">Permission Mode</div>
        <div className="flex gap-2">
          {(['default', 'acceptEdits', 'bypassPermissions'] as const).map((mode) => {
            const labels: Record<string, string> = { default: 'Default', acceptEdits: 'Accept Edits', bypassPermissions: 'Full Auto' };
            return (
              <button
                key={mode}
                onClick={() => setPermMode(mode)}
                className={`flex-1 text-xs py-2.5 rounded-lg border transition-colors ${
                  permissionMode === mode
                    ? mode === 'default'
                      ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                      : mode === 'acceptEdits'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : 'border-zinc-700/50 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {labels[mode]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tools */}
      <div className="bb-card bb-rise bb-stagger-4">
        <div className="bb-card-title flex items-center gap-2"><Wrench size={13} /> Available Tools</div>
        <div className="space-y-1.5">
          {tools.map((t) => (
            <div key={t.name} className="flex items-center justify-between py-1">
              <span className="text-sm font-medium font-mono" style={{ color: 'var(--bb-text)' }}>{t.name}</span>
              <span className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>{t.description}</span>
            </div>
          ))}
          {tools.length === 0 && <p className="bb-empty">No tools loaded</p>}
        </div>
      </div>

      {/* Workspace files */}
      <div className="bb-card bb-rise bb-stagger-5">
        <div className="bb-card-title flex items-center gap-2"><FolderOpen size={13} /> Workspace Files</div>
        <div className="space-y-1.5">
          {workspaceFiles.map((f) => (
            <div key={f.name} className="flex items-center justify-between py-1">
              <span className="text-sm font-mono" style={{ color: f.exists ? 'var(--bb-text)' : 'var(--bb-text-faint)' }}>
                {f.name}
              </span>
              <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
                {f.exists && <span>{(f.size / 1024).toFixed(1)} KB</span>}
                {!f.exists && <span className="text-zinc-600">missing</span>}
              </div>
            </div>
          ))}
          {workspaceFiles.length === 0 && <p className="bb-empty">No workspace files</p>}
        </div>
      </div>

      {/* MCP Servers */}
      <div className="bb-card bb-rise bb-stagger-6">
        <div className="bb-card-title flex items-center gap-2"><Server size={13} /> MCP Servers</div>
        {mcpServers.length === 0 ? (
          <p className="bb-empty">No MCP servers configured</p>
        ) : (
          <div className="space-y-2">
            {mcpServers.map((s) => (
              <div key={s.name} className="p-3 rounded-lg" style={{ background: 'var(--bb-bg)' }}>
                <div className="text-sm font-medium font-mono" style={{ color: 'var(--bb-text)' }}>{s.name}</div>
                {s.command && (
                  <div className="text-[10px] font-mono mt-1" style={{ color: 'var(--bb-text-faint)' }}>
                    {s.command} {s.args?.join(' ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
