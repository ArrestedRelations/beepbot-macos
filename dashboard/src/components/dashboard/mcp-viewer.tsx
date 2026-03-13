import { Plug } from 'lucide-react';
import type { McpConfig } from '../../stores/dashboard-store';

export function McpViewer({ config }: { config: McpConfig }) {
  const servers = Object.entries(config.mcpServers || {});

  return (
    <div className="bb-card bb-rise bb-stagger-11">
      <div className="bb-card-title">MCP Servers</div>
      {servers.length === 0 ? (
        <div className="bb-empty">No MCP servers configured</div>
      ) : (
        <div className="space-y-3">
          {servers.map(([name, serverCfg]: [string, unknown]) => {
            const cfg = serverCfg as Record<string, unknown>;
            return (
              <div
                key={name}
                className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg transition-colors"
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bb-bg-card-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Plug size={14} style={{ color: '#06b6d4', marginTop: 2, flexShrink: 0 }} />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium" style={{ color: 'var(--bb-text-strong)' }}>{String(name)}</div>
                  {cfg.command != null && (
                    <div className="text-[11px] font-mono truncate mt-0.5" style={{ color: 'var(--bb-text-faint)' }}>
                      {String(cfg.command)} {Array.isArray(cfg.args) ? (cfg.args as string[]).join(' ') : ''}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
