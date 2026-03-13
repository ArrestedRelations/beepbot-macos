import { create } from 'zustand';

const SIDECAR = 'http://127.0.0.1:3004';

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

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const key = Object.keys(PRICING).find(k => model.toLowerCase().includes(k.toLowerCase())) ?? 'sonnet';
  const pricing = PRICING[key] ?? PRICING.sonnet;
  return (tokensIn / 1_000_000) * pricing.input + (tokensOut / 1_000_000) * pricing.output;
}

interface UsageState {
  usageToday: UsageTotals | null;
  usageTotal: UsageTotals | null;
  usageByDay: UsageByDay[];
  usageByModel: UsageByModel[];
  loading: boolean;

  fetchUsage: () => Promise<void>;
}

export const useUsageStore = create<UsageState>((set) => ({
  usageToday: null,
  usageTotal: null,
  usageByDay: [],
  usageByModel: [],
  loading: false,

  fetchUsage: async () => {
    set({ loading: true });
    try {
      const res = await fetch(`${SIDECAR}/api/dashboard/stats`);
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
}));
