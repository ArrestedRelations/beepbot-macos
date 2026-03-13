import { create } from 'zustand';

const SIDECAR = 'http://127.0.0.1:3004';

export interface AgentTool {
  name: string;
  description: string;
}

export interface WorkspaceFile {
  name: string;
  exists: boolean;
  size: number;
  modified: string | null;
  description: string;
}

export interface McpServer {
  name: string;
  command?: string;
  args?: string[];
}

interface AgentState {
  tools: AgentTool[];
  workspaceFiles: WorkspaceFile[];
  mcpServers: McpServer[];
  agentStatus: {
    agentMode: string;
    permissionMode: string;
    sandboxEnabled: boolean;
    chatRunning: boolean;
    hasActiveAgent: boolean;
    conversationId: string | null;
    uptime: number;
  } | null;
  loading: boolean;

  fetchTools: () => Promise<void>;
  fetchWorkspaceFiles: () => Promise<void>;
  fetchMcpServers: () => Promise<void>;
  fetchAgentState: () => Promise<void>;
  fetchAll: () => Promise<void>;
}

export const useAgentStore = create<AgentState>((set) => ({
  tools: [],
  workspaceFiles: [],
  mcpServers: [],
  agentStatus: null,
  loading: false,

  fetchTools: async () => {
    try {
      const res = await fetch(`${SIDECAR}/api/agent/tools`);
      const data = await res.json();
      set({ tools: Array.isArray(data) ? data : [] });
    } catch { /* ignore */ }
  },

  fetchWorkspaceFiles: async () => {
    try {
      const res = await fetch(`${SIDECAR}/api/workspace`);
      const data = await res.json();
      set({ workspaceFiles: Array.isArray(data) ? data : [] });
    } catch { /* ignore */ }
  },

  fetchMcpServers: async () => {
    try {
      const res = await fetch(`${SIDECAR}/api/mcp/config`);
      const data = await res.json();
      const servers = Object.entries(data.mcpServers || {}).map(([name, cfg]) => {
        const c = cfg as Record<string, unknown>;
        return {
          name,
          command: c.command as string | undefined,
          args: c.args as string[] | undefined,
        };
      });
      set({ mcpServers: servers });
    } catch { /* ignore */ }
  },

  fetchAgentState: async () => {
    try {
      const res = await fetch(`${SIDECAR}/api/agent/state`);
      const data = await res.json();
      set({ agentStatus: data });
    } catch { /* ignore */ }
  },

  fetchAll: async () => {
    set({ loading: true });
    const store = useAgentStore.getState();
    await Promise.all([
      store.fetchTools(),
      store.fetchWorkspaceFiles(),
      store.fetchMcpServers(),
      store.fetchAgentState(),
    ]);
    set({ loading: false });
  },
}));
