import { useEffect } from 'react';
import { TaskList } from '../../components/scheduler/task-list';
import { useSchedulerStore } from '../../stores/scheduler-store';

export function CronView() {
  const { fetchTasks } = useSchedulerStore();

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  return (
    <div className="p-6">
      <TaskList />
    </div>
  );
}
