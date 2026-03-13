import { create } from 'zustand';

const SIDECAR = 'http://127.0.0.1:3004';

export interface Skill {
  name: string;
  description: string;
  path: string;
  category?: string;
}

interface SkillsState {
  skills: Skill[];
  loading: boolean;

  fetchSkills: () => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set) => ({
  skills: [],
  loading: false,

  fetchSkills: async () => {
    set({ loading: true });
    try {
      const res = await fetch(`${SIDECAR}/api/skills`);
      const data = await res.json();
      set({ skills: Array.isArray(data) ? data : [] });
    } catch { /* ignore */ }
    set({ loading: false });
  },
}));
