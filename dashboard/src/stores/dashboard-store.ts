import { create } from 'zustand';
import { api } from '../lib/api';

export type DashboardStats = {
  conversations: number;
  messages: number;
  compactions: number;
  scheduledTasks: number;
  usageToday: { tokens_in: number; tokens_out: number; api_calls: number };
  usageTotal: { tokens_in: number; tokens_out: number; api_calls: number };
  usageByDay: UsageByDay[];
  usageByModel: UsageByModel[];
  uptime: number;
  agentMode: string;
  agentStatus: string;
};

export type UsageByDay = {
  day: string;
  tokens_in: number;
  tokens_out: number;
  api_calls?: number;
};

export type UsageByModel = {
  model: string;
  api_calls: number;
  tokens_in: number;
  tokens_out: number;
};

export type ActivityEntry = {
  id: string;
  type: string;
  timestamp: string;
  summary: string;
};

export type CompactionEntry = {
  id: string;
  conversation_id: string;
  conversation_title?: string;
  tokens_before: number;
  summary: string;
  created_at: string;
};

export type SystemHealth = {
  ok: boolean;
  uptime: number;
  dbSizeMB: number;
  wsClients: number;
  sandboxEnabled: boolean;
  memoryFiles?: number;
};

export type MemoryFile = {
  path: string;
  name: string;
  size: number;
};

export type McpConfig = {
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
};

export type LogEntry = {
  ts: number;
  level: string;
  message: string;
};

interface DashboardStore {
  // State
  stats: DashboardStats | null;
  activity: ActivityEntry[];
  health: SystemHealth | null;
  loading: boolean;
  connected: boolean;
  logs: LogEntry[];

  // Setters
  setStats: (s: DashboardStats) => void;
  setActivity: (a: ActivityEntry[]) => void;
  setHealth: (h: SystemHealth) => void;
  setConnected: (c: boolean) => void;
  addLog: (entry: LogEntry) => void;
  clearLogs: () => void;

  // Fetchers
  fetchAll: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchActivity: () => Promise<void>;
  fetchHealth: () => Promise<void>;
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  stats: null,
  activity: [],
  health: null,
  loading: false,
  connected: false,
  logs: [],

  setStats: (stats) => set({ stats }),
  setActivity: (activity) => set({ activity }),
  setHealth: (health) => set({ health }),
  setConnected: (connected) => set({ connected }),
  addLog: (entry) => set((s) => ({ logs: [...s.logs.slice(-499), entry] })),
  clearLogs: () => set({ logs: [] }),

  fetchStats: async () => {
    try {
      const data = await api<DashboardStats>('/dashboard/stats');
      set({ stats: data });
    } catch { /* ignore */ }
  },

  fetchActivity: async () => {
    try {
      const data = await api<ActivityEntry[]>('/dashboard/activity');
      set({ activity: data });
    } catch { /* ignore */ }
  },

  fetchHealth: async () => {
    try {
      const raw = await api<Record<string, unknown>>('/system/health');
      set({
        health: {
          ok: true,
          uptime: (raw.uptime as number) ?? 0,
          dbSizeMB: ((raw.dbSizeBytes as number) ?? 0) / (1024 * 1024),
          wsClients: (raw.activeWsClients as number) ?? 0,
          sandboxEnabled: (raw.sandboxEnabled as boolean) ?? false,
          memoryFiles: (raw.memoryFiles as number) ?? undefined,
        },
      });
    } catch {
      set({ health: { ok: false, uptime: 0, dbSizeMB: 0, wsClients: 0, sandboxEnabled: false } });
    }
  },

  fetchAll: async () => {
    set({ loading: true });
    const s = get();
    await Promise.all([s.fetchStats(), s.fetchActivity(), s.fetchHealth()]);
    set({ loading: false });
  },
}));
