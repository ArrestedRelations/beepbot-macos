import { create } from 'zustand';

const SERVER_URL = `${window.location.protocol}//${window.location.host}`;

export interface TaskRun {
  id: string;
  task_id: string;
  task_name: string | null;
  status: 'ok' | 'error' | 'skipped';
  started_at: string;
  duration_ms: number | null;
  error: string | null;
  manual: number;
  created_at: string;
}

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
  runs: Record<string, TaskRun[]>;
  allRuns: TaskRun[];
  allRunsLoading: boolean;

  fetchTasks: () => Promise<void>;
  createTask: (data: { name: string; cron_expr: string; task_type: 'agent_turn' | 'system_check'; task_payload?: string }) => Promise<void>;
  updateTask: (id: string, data: Partial<Pick<ScheduledTask, 'name' | 'cron_expr' | 'task_type' | 'task_payload'> & { enabled: boolean }>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  runTask: (id: string) => Promise<void>;
  fetchRuns: (taskId: string) => Promise<void>;
  fetchAllRuns: (params?: { taskId?: string; status?: string; limit?: number }) => Promise<void>;
}

export const useSchedulerStore = create<SchedulerState>((set) => ({
  tasks: [],
  loading: false,
  runs: {},
  allRuns: [],
  allRunsLoading: false,

  fetchTasks: async () => {
    set({ loading: true });
    try {
      const res = await fetch(`${SERVER_URL}/api/scheduler/tasks`);
      const data = await res.json();
      set({ tasks: Array.isArray(data) ? data : [] });
    } catch { /* ignore */ }
    set({ loading: false });
  },

  createTask: async (data) => {
    try {
      await fetch(`${SERVER_URL}/api/scheduler/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      await useSchedulerStore.getState().fetchTasks();
    } catch { /* ignore */ }
  },

  updateTask: async (id, data) => {
    try {
      await fetch(`${SERVER_URL}/api/scheduler/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      await useSchedulerStore.getState().fetchTasks();
    } catch { /* ignore */ }
  },

  deleteTask: async (id) => {
    try {
      await fetch(`${SERVER_URL}/api/scheduler/tasks/${id}`, { method: 'DELETE' });
      await useSchedulerStore.getState().fetchTasks();
    } catch { /* ignore */ }
  },

  runTask: async (id) => {
    try {
      await fetch(`${SERVER_URL}/api/scheduler/tasks/${id}/run`, { method: 'POST' });
    } catch { /* ignore */ }
  },

  fetchRuns: async (taskId) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/scheduler/tasks/${taskId}/runs?limit=20`);
      const data = await res.json();
      set((s) => ({ runs: { ...s.runs, [taskId]: Array.isArray(data) ? data : [] } }));
    } catch { /* ignore */ }
  },

  fetchAllRuns: async (params) => {
    set({ allRunsLoading: true });
    try {
      const q = new URLSearchParams();
      if (params?.taskId) q.set('task_id', params.taskId);
      if (params?.status) q.set('status', params.status);
      q.set('limit', String(params?.limit ?? 100));
      const res = await fetch(`${SERVER_URL}/api/scheduler/runs?${q}`);
      const data = await res.json();
      set({ allRuns: Array.isArray(data) ? data : [] });
    } catch { /* ignore */ }
    set({ allRunsLoading: false });
  },
}));
