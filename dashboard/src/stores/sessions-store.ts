import { create } from 'zustand';

const SERVER_URL = `${window.location.protocol}//${window.location.host}`;

export interface SessionEntry {
  id: string;
  title: string;
  model: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message: string | null;
  total_tokens_in: number;
  total_tokens_out: number;
}

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: string;
  thinking?: string;
  tokens_in: number | null;
  tokens_out: number | null;
  model: string | null;
  created_at: string;
}

interface SessionsState {
  sessions: SessionEntry[];
  selectedSessionId: string | null;
  selectedMessages: SessionMessage[];
  filter: 'all' | 'active';
  loading: boolean;

  fetchSessions: () => Promise<void>;
  selectSession: (id: string | null) => void;
  fetchMessages: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  setFilter: (filter: 'all' | 'active') => void;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  selectedSessionId: null,
  selectedMessages: [],
  filter: 'all',
  loading: false,

  fetchSessions: async () => {
    set({ loading: true });
    try {
      const res = await fetch(`${SERVER_URL}/api/conversations/stats`);
      const data = await res.json();
      set({ sessions: data.conversations ?? [] });
    } catch { /* ignore */ }
    set({ loading: false });
  },

  selectSession: (id) => {
    set({ selectedSessionId: id, selectedMessages: [] });
    if (id) get().fetchMessages(id);
  },

  fetchMessages: async (id) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/conversations/${id}/messages`);
      const data = await res.json();
      const messages = Array.isArray(data) ? data : (data.messages ?? []);
      set({ selectedMessages: messages });
    } catch { /* ignore */ }
  },

  deleteSession: async (id) => {
    try {
      await fetch(`${SERVER_URL}/api/conversations/${id}`, { method: 'DELETE' });
      const state = get();
      if (state.selectedSessionId === id) {
        set({ selectedSessionId: null, selectedMessages: [] });
      }
      await state.fetchSessions();
    } catch { /* ignore */ }
  },

  setFilter: (filter) => set({ filter }),
}));
