import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useDashboardStore } from '../../stores/dashboard-store';
import { useSchedulerStore } from '../../stores/scheduler-store';
import { useAppStore } from '../../stores/app-store';
import { StatsCards } from '../../components/dashboard/stats-cards';
import { UsageChart } from '../../components/dashboard/usage-chart';
import { ActivityFeed } from '../../components/dashboard/activity-feed';
import { SystemHealthPanel } from '../../components/dashboard/system-health';
import { ModelUsage } from '../../components/dashboard/model-usage';
import { BackgroundTasksPanel } from '../../components/dashboard/background-tasks';

export function OverviewView() {
  const { stats, activity, health, loading, fetchAll } = useDashboardStore();
  const { fetchTasks } = useSchedulerStore();
  const status = useAppStore((s) => s.status);
  const agentMode = useAppStore((s) => s.agentMode);

  useEffect(() => {
    fetchAll();
    fetchTasks();
  }, [fetchAll, fetchTasks]);

  // Auto-refresh every 15s
  useEffect(() => {
    const timer = setInterval(() => {
      useDashboardStore.getState().fetchStats();
      useDashboardStore.getState().fetchActivity();
      useDashboardStore.getState().fetchHealth();
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="p-6 space-y-6">
      {/* Status pill + refresh */}
      <div className="flex items-center justify-between">
        <div className="bb-pill">
          <span className={`bb-dot ${
            agentMode === 'stop' ? 'bb-dot-muted'
              : (status === 'thinking' || status === 'tool_call') ? 'bb-dot-ok'
              : status === 'error' ? 'bb-dot-danger'
              : 'bb-dot-muted'
          }`} style={{ width: 6, height: 6 }} />
          <span>
            {agentMode === 'stop' ? 'Stopped' : status === 'thinking' ? 'Thinking' : status === 'tool_call' ? 'Working' : status === 'error' ? 'Error' : 'Idle'}
          </span>
        </div>
        <button
          onClick={() => { fetchAll(); fetchTasks(); }}
          disabled={loading}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50"
          style={{ color: 'var(--bb-text-muted)' }}
          title="Refresh"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {stats && <StatsCards stats={stats} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {stats && <UsageChart data={stats.usageByDay} />}
        {stats && <ModelUsage data={stats.usageByModel} />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ActivityFeed activity={activity} />
        {health && <SystemHealthPanel health={health} />}
      </div>

      <BackgroundTasksPanel />
    </div>
  );
}
