import { MessageSquare, Wrench, Users, Calendar, AlertCircle, Info } from 'lucide-react';
import type { ActivityEntry } from '../../stores/dashboard-store';

const typeIcons: Record<string, { icon: typeof MessageSquare; color: string }> = {
  chat: { icon: MessageSquare, color: '#3b82f6' },
  tool_call: { icon: Wrench, color: '#f59e0b' },
  sub_agent: { icon: Users, color: '#a855f7' },
  scheduler: { icon: Calendar, color: '#06b6d4' },
  error: { icon: AlertCircle, color: '#ef4444' },
  system: { icon: Info, color: '#71717a' },
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function ActivityFeed({ activity }: { activity: ActivityEntry[] }) {
  if (activity.length === 0) {
    return (
      <div className="bb-card bb-rise bb-stagger-9">
        <div className="bb-card-title">Recent Activity</div>
        <div className="bb-empty">No activity yet</div>
      </div>
    );
  }

  return (
    <div className="bb-card bb-rise bb-stagger-9">
      <div className="bb-card-title">Recent Activity</div>
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {activity.slice(0, 20).map((entry) => {
          const config = typeIcons[entry.type] || typeIcons.system;
          const Icon = config.icon;
          return (
            <div
              key={entry.id}
              className="flex items-center gap-2.5 text-[13px] px-2 py-1.5 rounded-lg transition-colors cursor-default"
              style={{ color: 'var(--bb-text)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bb-bg-card-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon size={13} style={{ color: config.color, flexShrink: 0 }} />
              <span className="flex-1 truncate" style={{ color: 'var(--bb-text)' }}>{entry.summary}</span>
              <span className="shrink-0 text-[11px]" style={{ color: 'var(--bb-text-faint)' }}>{timeAgo(entry.timestamp)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
