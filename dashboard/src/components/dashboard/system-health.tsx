import { HardDrive, Wifi, Shield, Clock, Server } from 'lucide-react';
import type { SystemHealth } from '../../stores/dashboard-store';

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m ${seconds % 60}s`;
}

export function SystemHealthPanel({ health }: { health: SystemHealth }) {
  const items = [
    {
      icon: Server,
      label: 'Status',
      value: health.ok ? 'Healthy' : 'Error',
      valueColor: health.ok ? 'var(--bb-ok)' : 'var(--bb-danger)',
      dot: health.ok ? 'bb-dot-ok' : 'bb-dot-danger',
    },
    {
      icon: Clock,
      label: 'Uptime',
      value: formatUptime(health.uptime),
      valueColor: 'var(--bb-text)',
    },
    {
      icon: HardDrive,
      label: 'Database',
      value: `${health.dbSizeMB} MB`,
      valueColor: 'var(--bb-text)',
    },
    {
      icon: Wifi,
      label: 'WS Clients',
      value: health.wsClients.toString(),
      valueColor: 'var(--bb-text)',
    },
    {
      icon: Shield,
      label: 'Sandbox',
      value: health.sandboxEnabled ? 'Enabled' : 'Disabled',
      valueColor: health.sandboxEnabled ? 'var(--bb-ok)' : 'var(--bb-warn)',
    },
  ];

  return (
    <div className="bb-card bb-rise bb-stagger-10">
      <div className="bb-card-title">System Health</div>
      <div className="space-y-3">
        {items.map(({ icon: Icon, label, value, valueColor, dot }) => (
          <div key={label} className="flex items-center justify-between">
            <span className="flex items-center gap-2.5 text-[13px]" style={{ color: 'var(--bb-text-muted)' }}>
              <Icon size={14} />
              {label}
            </span>
            <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: valueColor }}>
              {dot && <span className={`bb-dot ${dot}`} style={{ width: 6, height: 6 }} />}
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
