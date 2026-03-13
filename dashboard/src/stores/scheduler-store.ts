import { create } from 'zustand';

const SIDECAR = 'http://127.0.0.1:3004';

export interface ScheduledTask {
  id: string;
  name: string;
  cron_expr: string;
  task_type: 'agent_turn' | 'system_check';
  task_payload: string;
  enabled: number;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
}

interface SchedulerState {
  tasks: ScheduledTask[];
  loading: boolean;

  fetchTasks: () => Promise<void>;
  createTask: (data: { name: string; cron_expr: string; task_type: 'agent_turn' | 'system_check'; task_payload?: string }) => Promise<void>;
  updateTask: (id: string, data: Partial<Pick<ScheduledTask, 'name' | 'cron_expr' | 'task_type' | 'task_payload'> & { enabled: boolean }>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  runTask: (id: string) => Promise<void>;
}

export const useSchedulerStore = create<SchedulerState>((set) => ({
  tasks: [],
  loading: false,

  fetchTasks: async () => {
    set({ loading: true });
    try {
      const res = await fetch(`${SIDECAR}/api/scheduler/tasks`);
      const data = await res.json();
      set({ tasks: Array.isArray(data) ? data : [] });
    } catch { /* ignore */ }
    set({ loading: false });
  },

  createTask: async (data) => {
    try {
      await fetch(`${SIDECAR}/api/scheduler/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      await useSchedulerStore.getState().fetchTasks();
    } catch { /* ignore */ }
  },

  updateTask: async (id, data) => {
    try {
      await fetch(`${SIDECAR}/api/scheduler/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      await useSchedulerStore.getState().fetchTasks();
    } catch { /* ignore */ }
  },

  deleteTask: async (id) => {
    try {
      await fetch(`${SIDECAR}/api/scheduler/tasks/${id}`, { method: 'DELETE' });
      await useSchedulerStore.getState().fetchTasks();
    } catch { /* ignore */ }
  },

  runTask: async (id) => {
    try {
      await fetch(`${SIDECAR}/api/scheduler/tasks/${id}/run`, { method: 'POST' });
    } catch { /* ignore */ }
  },
}));
