import { create } from 'zustand';

const SIDECAR = 'http://127.0.0.1:3004';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
}

interface LogsState {
  logs: LogEntry[];
  levelFilter: 'all' | 'info' | 'warn' | 'error';
  paused: boolean;
  loading: boolean;

  fetchLogs: () => Promise<void>;
  addLog: (entry: LogEntry) => void;
  setLevelFilter: (level: 'all' | 'info' | 'warn' | 'error') => void;
  togglePause: () => void;
  clearLogs: () => void;
}

export const useLogsStore = create<LogsState>((set, get) => ({
  logs: [],
  levelFilter: 'all',
  paused: false,
  loading: false,

  fetchLogs: async () => {
    set({ loading: true });
    try {
      const res = await fetch(`${SIDECAR}/api/logs?limit=200`);
      const data = await res.json();
      set({ logs: Array.isArray(data) ? data.reverse() : [] });
    } catch { /* ignore */ }
    set({ loading: false });
  },

  addLog: (entry) => {
    if (get().paused) return;
    set((state) => {
      const logs = [...state.logs, entry];
      if (logs.length > 500) logs.shift();
      return { logs };
    });
  },

  setLevelFilter: (levelFilter) => set({ levelFilter }),
  togglePause: () => set((s) => ({ paused: !s.paused })),
  clearLogs: () => set({ logs: [] }),
}));
