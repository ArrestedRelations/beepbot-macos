import { MessageSquare, Cpu, Clock, Calendar, Layers, Zap } from 'lucide-react';
import type { DashboardStats } from '../../stores/dashboard-store';

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

export function StatsCards({ stats }: { stats: DashboardStats }) {
  const cards = [
    {
      label: 'Conversations',
      value: stats.conversations.toString(),
      icon: MessageSquare,
      accent: '#3b82f6',
    },
    {
      label: 'Messages',
      value: stats.messages.toString(),
      icon: Layers,
      accent: '#a855f7',
    },
    {
      label: 'Tokens Today',
      value: formatTokens(stats.usageToday.tokens_in + stats.usageToday.tokens_out),
      icon: Cpu,
      accent: '#f59e0b',
    },
    {
      label: 'API Calls',
      value: stats.usageToday.api_calls.toString(),
      icon: Zap,
      accent: '#22c55e',
    },
    {
      label: 'Uptime',
      value: formatUptime(stats.uptime),
      icon: Clock,
      accent: '#06b6d4',
    },
    {
      label: 'Scheduled',
      value: stats.scheduledTasks.toString(),
      icon: Calendar,
      accent: '#f43f5e',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((card, i) => (
        <div
          key={card.label}
          className={`bb-card bb-rise bb-stagger-${i + 1}`}
          style={{ padding: 16 }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="bb-stat-label">{card.label}</span>
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: `${card.accent}15` }}
            >
              <card.icon size={14} style={{ color: card.accent }} />
            </div>
          </div>
          <div className="bb-stat-value">{card.value}</div>
        </div>
      ))}
    </div>
  );
}
