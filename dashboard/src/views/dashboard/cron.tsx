import { useEffect, useState } from 'react';
import { TaskList } from '../../components/scheduler/task-list';
import { RunHistoryPanel } from '../../components/scheduler/run-history';
import { useSchedulerStore } from '../../stores/scheduler-store';

type CronTab = 'jobs' | 'history';

export function CronView() {
  const { fetchTasks } = useSchedulerStore();
  const [tab, setTab] = useState<CronTab>('jobs');

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const tabBtn = (id: CronTab, label: string) => {
    const active = tab === id;
    return (
      <button
        onClick={() => setTab(id)}
        className="px-4 py-2 text-[13px] font-medium transition-colors relative"
        style={{
          color: active ? 'var(--bb-accent)' : 'var(--bb-text-muted)',
          borderBottom: active ? '2px solid var(--bb-accent)' : '2px solid transparent',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--bb-border)' }}>
        {tabBtn('jobs', 'Jobs')}
        {tabBtn('history', 'Run History')}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'jobs' && <TaskList />}
        {tab === 'history' && <RunHistoryPanel />}
      </div>
    </div>
  );
}
