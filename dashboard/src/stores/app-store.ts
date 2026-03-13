import { create } from 'zustand';

// Subset of the Tauri app-store interface needed by dashboard views
type AgentStatus = 'idle' | 'thinking' | 'tool_call' | 'error';

export interface SubAgentActivity {
  tool: string;
  timestamp: number;
  elapsed?: number;
}

export interface SubAgentInfo {
  id: string;
  description: string;
  status: 'spawning' | 'active' | 'completed' | 'failed' | 'stopped';
  lastTool?: string;
  summary?: string;
  prompt?: string;
  startedAt: number;
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number };
  activityLog: SubAgentActivity[];
}

interface AppState {
  status: AgentStatus;
  activeToolCall: string | null;
  setStatus: (status: AgentStatus, tool?: string | null) => void;

  agentMode: 'autonomous' | 'ask' | 'stop';
  setAgentMode: (mode: 'autonomous' | 'ask' | 'stop') => void;

  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
  setPermissionMode: (mode: 'default' | 'acceptEdits' | 'bypassPermissions') => void;

  sandboxEnabled: boolean;
  setSandboxEnabled: (enabled: boolean) => void;

  authStatus: 'loading' | 'authenticated' | 'unauthenticated';
  authMethod: 'oauth' | 'api_key' | 'none';
  loginStatus: 'idle' | 'in_progress' | 'success' | 'error';
  setAuth: (status: 'authenticated' | 'unauthenticated', method: 'oauth' | 'api_key' | 'none') => void;
  setLoginStatus: (status: 'idle' | 'in_progress' | 'success' | 'error') => void;

  subAgents: SubAgentInfo[];
  addSubAgent: (agent: SubAgentInfo) => void;
  updateSubAgent: (id: string, update: Partial<SubAgentInfo>) => void;
  removeSubAgent: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  status: 'idle',
  activeToolCall: null,
  setStatus: (status, tool = null) => set({ status, activeToolCall: tool }),

  agentMode: 'autonomous',
  setAgentMode: (agentMode) => set({ agentMode }),

  permissionMode: 'bypassPermissions',
  setPermissionMode: (permissionMode) => set({ permissionMode }),

  sandboxEnabled: true,
  setSandboxEnabled: (sandboxEnabled) => set({ sandboxEnabled }),

  authStatus: 'loading',
  authMethod: 'none',
  loginStatus: 'idle',
  setAuth: (authStatus, authMethod) => set({ authStatus, authMethod }),
  setLoginStatus: (loginStatus) => set({ loginStatus }),

  subAgents: [],
  addSubAgent: (agent) =>
    set((s) => ({
      subAgents: s.subAgents.some((a) => a.id === agent.id)
        ? s.subAgents.map((a) => a.id === agent.id ? { ...a, ...agent } : a)
        : [...s.subAgents, agent],
    })),
  updateSubAgent: (id, update) =>
    set((s) => ({
      subAgents: s.subAgents.map((a) => a.id === id ? { ...a, ...update } : a),
    })),
  removeSubAgent: (id) =>
    set((s) => ({ subAgents: s.subAgents.filter((a) => a.id !== id) })),
}));
