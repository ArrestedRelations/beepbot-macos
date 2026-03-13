import { create } from 'zustand';

export interface AskUserData {
  id: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  answered: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'ask_user';
  content: string;
  toolCalls?: Array<{ name: string; input: unknown; result?: string }>;
  thinking?: string;
  tokensIn?: number;
  tokensOut?: number;
  provider?: string;
  model?: string;
  createdAt: string;
  askUserData?: AskUserData;
}

export interface ConversationSummary {
  id: string;
  title: string;
  model?: string;
  last_message?: string;
  message_count?: number;
  created_at: string;
  updated_at: string;
}

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

export type EyeState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'tool_use' | 'speaking' | 'active' | 'awake';

interface AppState {
  // Messages
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  appendToLastMessage: (text: string) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  clearMessages: () => void;
  markAskUserAnswered: (askId: string) => void;
  updateLastAssistantMeta: (meta: { tokensIn?: number; tokensOut?: number; provider?: string; model?: string }) => void;

  // Conversations
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  setConversations: (convs: ConversationSummary[]) => void;
  setActiveConversation: (id: string | null) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // Agent status
  status: AgentStatus;
  activeToolCall: string | null;
  setStatus: (status: AgentStatus, tool?: string | null) => void;

  // Agent mode
  agentMode: 'autonomous' | 'ask' | 'stop';
  setAgentMode: (mode: 'autonomous' | 'ask' | 'stop') => void;

  // Permission mode
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
  setPermissionMode: (mode: 'default' | 'acceptEdits' | 'bypassPermissions') => void;

  // Sandbox
  sandboxEnabled: boolean;
  setSandboxEnabled: (enabled: boolean) => void;

  // Auth
  authStatus: 'loading' | 'authenticated' | 'unauthenticated';
  authMethod: 'oauth' | 'api_key' | 'none';
  loginStatus: 'idle' | 'in_progress' | 'success' | 'error';
  setAuth: (status: 'authenticated' | 'unauthenticated', method: 'oauth' | 'api_key' | 'none') => void;
  setLoginStatus: (status: 'idle' | 'in_progress' | 'success' | 'error') => void;

  // Voice mode
  voiceMode: boolean;
  eyeState: EyeState;
  enterVoiceMode: () => void;
  exitVoiceMode: () => void;
  setEyeState: (state: EyeState) => void;

  // Sub-agents
  subAgents: SubAgentInfo[];
  addSubAgent: (agent: SubAgentInfo) => void;
  updateSubAgent: (id: string, update: Partial<SubAgentInfo>) => void;
  removeSubAgent: (id: string) => void;
  selectedSubAgentId: string | null;
  selectSubAgent: (id: string | null) => void;

  // Ask user
  activeAskUser: AskUserData | null;
  setActiveAskUser: (data: AskUserData | null) => void;

  // View
  showSettings: boolean;
  toggleSettings: () => void;

  // Condensed mode overlay
  settingsPage: null | 'main' | 'auth' | 'model' | 'voice' | 'security' | 'agent';
  setSettingsPage: (page: null | 'main' | 'auth' | 'model' | 'voice' | 'security' | 'agent') => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Messages
  messages: [],
  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),
  appendToLastMessage: (text) =>
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + text };
      }
      return { messages: msgs };
    }),
  setMessages: (msgs) => set({ messages: msgs }),
  clearMessages: () => set({ messages: [] }),
  markAskUserAnswered: (askId) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.askUserData?.id === askId
          ? { ...m, askUserData: { ...m.askUserData, answered: true } }
          : m
      ),
    })),
  updateLastAssistantMeta: (meta) =>
    set((state) => {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], ...meta };
          break;
        }
      }
      return { messages: msgs };
    }),

  // Conversations
  conversations: [],
  activeConversationId: null,
  setConversations: (conversations) => set({ conversations }),
  setActiveConversation: (activeConversationId) => set({ activeConversationId }),
  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  // Status
  status: 'idle',
  activeToolCall: null,
  setStatus: (status, tool = null) => set({ status, activeToolCall: tool }),

  // Agent mode
  agentMode: 'autonomous',
  setAgentMode: (agentMode) => set({ agentMode }),

  // Permission mode
  permissionMode: 'bypassPermissions',
  setPermissionMode: (permissionMode) => set({ permissionMode }),

  // Sandbox
  sandboxEnabled: true,
  setSandboxEnabled: (sandboxEnabled) => set({ sandboxEnabled }),

  // Auth
  authStatus: 'loading',
  authMethod: 'none',
  loginStatus: 'idle',
  setAuth: (authStatus, authMethod) => set({ authStatus, authMethod }),
  setLoginStatus: (loginStatus) => set({ loginStatus }),

  // Voice mode
  voiceMode: false,
  eyeState: 'idle' as EyeState,
  enterVoiceMode: () => set({ voiceMode: true, eyeState: 'connecting' }),
  exitVoiceMode: () => set({ voiceMode: false, eyeState: 'idle' }),
  setEyeState: (eyeState) => set({ eyeState }),

  // Sub-agents
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
    set((s) => ({
      subAgents: s.subAgents.filter((a) => a.id !== id),
      selectedSubAgentId: s.selectedSubAgentId === id ? null : s.selectedSubAgentId,
    })),
  selectedSubAgentId: null,
  selectSubAgent: (selectedSubAgentId) => set({ selectedSubAgentId }),

  // Ask user
  activeAskUser: null,
  setActiveAskUser: (activeAskUser) => set({ activeAskUser }),

  // View
  showSettings: false,
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),

  // Condensed settings overlay
  settingsPage: null,
  setSettingsPage: (settingsPage) => set({ settingsPage }),
}));
