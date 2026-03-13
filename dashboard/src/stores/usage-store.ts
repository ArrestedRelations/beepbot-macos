import { create } from 'zustand';

const SERVER_URL = `${window.location.protocol}//${window.location.host}`;

export interface UsageByDay {
  day: string;
  tokens_in: number;
  tokens_out: number;
  api_calls: number;
}

export interface UsageByModel {
  model: string;
  tokens_in: number;
  tokens_out: number;
  api_calls: number;
}

export interface UsageTotals {
  tokens_in: number;
  tokens_out: number;
  api_calls: number;
}

// Standard Claude pricing (per 1M tokens)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4 },
  sonnet: { input: 3, output: 15 },
  opus: { input: 15, output: 75 },
  haiku: { input: 0.80, output: 4 },
};

export interface UsageTransaction {
  id: number;
  model: string;
  provider: string;
  tokens_in: number;
  tokens_out: number;
  slot: string | null;
  conversation_id: string | null;
  cache_read_tokens: number;
  cache_write_tokens: number;
  duration_ms: number;
  created_at: string;
}

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const key = Object.keys(PRICING).find(k => model.toLowerCase().includes(k.toLowerCase())) ?? 'sonnet';
  const pricing = PRICING[key] ?? PRICING.sonnet;
  return (tokensIn / 1_000_000) * pricing.input + (tokensOut / 1_000_000) * pricing.output;
}

// --- Admin API types ---

export interface AdminUsageByDay {
  day: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  estimated_cost_cents: number;
}

export interface AdminUsageByModel {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  estimated_cost_cents: number;
}

export interface AdminCodeMetrics {
  metric_date: string;
  actor_email: string;
  num_sessions: number;
  commits: number;
  pull_requests: number;
  lines_added: number;
  lines_removed: number;
  tool_actions: Record<string, { accepted: number; rejected: number }>;
  terminal_type: string;
}

interface UsageState {
  usageToday: UsageTotals | null;
  usageTotal: UsageTotals | null;
  usageByDay: UsageByDay[];
  usageByModel: UsageByModel[];
  transactions: UsageTransaction[];
  loading: boolean;
  transactionsLoading: boolean;

  // Admin API state
  adminByDay: AdminUsageByDay[];
  adminByModel: AdminUsageByModel[];
  adminCodeMetrics: AdminCodeMetrics[];
  adminLastRefresh: string | null;
  adminAvailable: boolean;
  adminLoading: boolean;
  adminRefreshing: boolean;
  adminError: string | null;

  fetchUsage: () => Promise<void>;
  fetchTransactions: () => Promise<void>;
  fetchAdminUsage: () => Promise<void>;
  refreshAdminUsage: () => Promise<void>;
}

export const useUsageStore = create<UsageState>((set) => ({
  usageToday: null,
  usageTotal: null,
  usageByDay: [],
  usageByModel: [],
  transactions: [],
  loading: false,
  transactionsLoading: false,

  adminByDay: [],
  adminByModel: [],
  adminCodeMetrics: [],
  adminLastRefresh: null,
  adminAvailable: true,
  adminLoading: false,
  adminRefreshing: false,
  adminError: null,

  fetchUsage: async () => {
    set({ loading: true });
    try {
      const res = await fetch(`${SERVER_URL}/api/dashboard/stats`);
      const data = await res.json();
      set({
        usageToday: data.usageToday,
        usageTotal: data.usageTotal,
        usageByDay: data.usageByDay ?? [],
        usageByModel: data.usageByModel ?? [],
      });
    } catch { /* ignore */ }
    set({ loading: false });
  },

  fetchTransactions: async () => {
    set({ transactionsLoading: true });
    try {
      const res = await fetch(`${SERVER_URL}/api/usage/transactions?limit=100`);
      const data = await res.json();
      set({ transactions: data.transactions ?? [] });
    } catch { /* ignore */ }
    set({ transactionsLoading: false });
  },

  fetchAdminUsage: async () => {
    set({ adminLoading: true });
    try {
      const res = await fetch(`${SERVER_URL}/api/admin-usage`);
      const data = await res.json();
      set({
        adminByDay: data.byDay ?? [],
        adminByModel: data.byModel ?? [],
        adminCodeMetrics: data.codeMetrics ?? [],
        adminLastRefresh: data.lastRefresh ?? null,
        adminAvailable: data.available !== false,
      });
    } catch { /* ignore */ }
    set({ adminLoading: false });
  },

  refreshAdminUsage: async () => {
    set({ adminRefreshing: true, adminError: null });
    try {
      const res = await fetch(`${SERVER_URL}/api/admin-usage/refresh`, { method: 'POST' });
      const data = await res.json();
      set({
        adminByDay: data.byDay ?? [],
        adminByModel: data.byModel ?? [],
        adminCodeMetrics: data.codeMetrics ?? [],
        adminLastRefresh: data.lastRefresh ?? null,
        adminAvailable: data.available !== false,
        adminError: data.error ?? null,
      });
    } catch (e) {
      set({ adminError: e instanceof Error ? e.message : 'Failed to reach server' });
    }
    set({ adminRefreshing: false });
  },
}));
