import { useEffect, useRef, useCallback } from 'react';
import { useAppStore, type ChatMessage, type ConversationSummary, type SubAgentInfo, type AskUserData } from '../stores/app-store';

const SIDECAR_URL = 'http://127.0.0.1:3004';
const SIDECAR_WS = 'ws://127.0.0.1:3004/ws';

/** Map a DB message row to a ChatMessage */
function mapDbMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    role: row.role as 'user' | 'assistant' | 'system',
    content: (row.content as string) || '',
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls as string) : undefined,
    thinking: (row.thinking as string) || undefined,
    tokensIn: (row.tokens_in as number) || undefined,
    tokensOut: (row.tokens_out as number) || undefined,
    model: (row.model as string) || undefined,
    provider: row.model ? 'anthropic' : undefined,
    createdAt: row.created_at as string,
  };
}

async function fetchConversations(): Promise<ConversationSummary[]> {
  try {
    const res = await fetch(`${SIDECAR_URL}/api/conversations`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  try {
    const res = await fetch(`${SIDECAR_URL}/api/conversations/${conversationId}/messages`);
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map(mapDbMessage);
  } catch {
    return [];
  }
}

export function useAgent() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ttsCallbackRef = useRef<((base64: string) => void) | null>(null);
  const { addMessage, appendToLastMessage, updateLastAssistantMeta, setStatus, setMessages, setConversations, setActiveConversation } = useAppStore();

  const loadInitialState = useCallback(async () => {
    try {
      const activeRes = await fetch(`${SIDECAR_URL}/api/conversations/active`);
      const activeData = await activeRes.json();
      const activeId = activeData.id as string | null;

      if (activeId) {
        setActiveConversation(activeId);
        const messages = await fetchMessages(activeId);
        setMessages(messages);
      }

      const conversations = await fetchConversations();
      setConversations(conversations);
    } catch {
      // Sidecar may not be fully ready
    }
  }, [setActiveConversation, setMessages, setConversations]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(SIDECAR_WS);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to sidecar');
      setStatus('idle');

      // Fetch initial state in parallel
      fetch(`${SIDECAR_URL}/api/auth/status`)
        .then(r => r.json())
        .then(data => {
          useAppStore.getState().setAuth(
            data.authenticated ? 'authenticated' : 'unauthenticated',
            data.method
          );
        })
        .catch(() => {
          useAppStore.getState().setAuth('unauthenticated', 'none');
        });

      fetch(`${SIDECAR_URL}/api/agent/mode`)
        .then(r => r.json())
        .then(data => { if (data.mode) useAppStore.getState().setAgentMode(data.mode); })
        .catch(() => {});

      fetch(`${SIDECAR_URL}/api/agent/permission-mode`)
        .then(r => r.json())
        .then(data => { if (data.mode) useAppStore.getState().setPermissionMode(data.mode); })
        .catch(() => {});

      fetch(`${SIDECAR_URL}/api/agent/sandbox`)
        .then(r => r.json())
        .then(data => { if (typeof data.enabled === 'boolean') useAppStore.getState().setSandboxEnabled(data.enabled); })
        .catch(() => {});

      loadInitialState();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'status':
            setStatus(msg.data === 'thinking' ? 'thinking' : 'idle');
            if (useAppStore.getState().voiceMode) {
              useAppStore.getState().setEyeState(msg.data === 'thinking' ? 'thinking' : 'listening');
            }
            break;

          case 'thinking':
            setStatus('thinking');
            if (useAppStore.getState().voiceMode) {
              useAppStore.getState().setEyeState('thinking');
            }
            break;

          case 'text': {
            const store = useAppStore.getState();
            const last = store.messages[store.messages.length - 1];
            if (last?.role === 'assistant' && !last.content.includes('[DONE]')) {
              appendToLastMessage(msg.data);
            } else {
              addMessage({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: msg.data,
                createdAt: new Date().toISOString(),
              });
            }
            break;
          }

          case 'tool_call':
            setStatus('tool_call', msg.data.name);
            if (useAppStore.getState().voiceMode) {
              useAppStore.getState().setEyeState('tool_use');
            }
            break;

          case 'tool_result':
            break;

          case 'done': {
            setStatus('idle');
            const doneData = msg.data as Record<string, unknown> | undefined;
            if (doneData) {
              const meta: { tokensIn?: number; tokensOut?: number; provider?: string; model?: string } = {};
              if (doneData.tokensIn) meta.tokensIn = doneData.tokensIn as number;
              if (doneData.tokensOut) meta.tokensOut = doneData.tokensOut as number;
              if (doneData.provider) meta.provider = doneData.provider as string;
              if (doneData.model) meta.model = doneData.model as string;
              if (Object.keys(meta).length > 0) updateLastAssistantMeta(meta);
            }
            if (useAppStore.getState().voiceMode) {
              setTimeout(() => {
                const s = useAppStore.getState();
                if (s.voiceMode && s.eyeState !== 'speaking') {
                  s.setEyeState('listening');
                }
              }, 500);
            }
            fetchConversations().then(convs => useAppStore.getState().setConversations(convs));
            break;
          }

          case 'tts_audio':
            ttsCallbackRef.current?.(msg.data as string);
            break;

          case 'tts_error':
            console.warn('TTS error:', msg.data);
            if (useAppStore.getState().voiceMode) {
              useAppStore.getState().setEyeState('listening');
            }
            break;

          case 'error':
            setStatus('error');
            addMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content: `Error: ${msg.data}`,
              createdAt: new Date().toISOString(),
            });
            break;

          case 'conversation_switched': {
            const { id, messages: msgs } = msg.data;
            useAppStore.getState().setActiveConversation(id);
            useAppStore.getState().setMessages((msgs ?? []).map(mapDbMessage));
            fetchConversations().then(convs => useAppStore.getState().setConversations(convs));
            break;
          }

          case 'conversation_created':
            useAppStore.getState().setActiveConversation(msg.data.id);
            useAppStore.getState().setMessages([]);
            fetchConversations().then(convs => useAppStore.getState().setConversations(convs));
            break;

          case 'conversation_deleted':
          case 'conversations_updated':
            fetchConversations().then(convs => useAppStore.getState().setConversations(convs));
            break;

          case 'agent_mode':
            useAppStore.getState().setAgentMode(msg.mode);
            break;

          case 'permission_mode':
            useAppStore.getState().setPermissionMode(msg.mode);
            break;

          case 'sandbox':
            useAppStore.getState().setSandboxEnabled(msg.enabled);
            break;

          case 'login_started':
            useAppStore.getState().setLoginStatus('in_progress');
            break;

          case 'login_output':
            console.log('[login]', msg.data);
            break;

          case 'login_complete': {
            const { authenticated, method } = msg.data;
            useAppStore.getState().setLoginStatus(authenticated ? 'success' : 'error');
            useAppStore.getState().setAuth(
              authenticated ? 'authenticated' : 'unauthenticated',
              method
            );
            break;
          }

          case 'login_error':
            console.warn('[login] Error:', msg.data);
            useAppStore.getState().setLoginStatus('error');
            break;

          case 'login_cancelled':
            useAppStore.getState().setLoginStatus('idle');
            break;

          case 'ask_user': {
            const data = msg.data as { id: string; questions: AskUserData['questions'] };
            useAppStore.getState().setActiveAskUser({
              id: data.id,
              questions: data.questions,
              answered: false,
            });
            break;
          }

          case 'background_task': {
            // Handled by dashboard polling — just trigger a refresh signal
            break;
          }

          case 'file_change': {
            // File watcher events — dashboard can poll for latest
            break;
          }

          case 'sub_agent': {
            const d = msg.data as Record<string, unknown>;
            const store = useAppStore.getState();

            switch (d.event) {
              case 'spawning': {
                const tempId = 'pending-' + Date.now();
                store.addSubAgent({
                  id: tempId,
                  description: (d.description as string) || 'Working...',
                  status: 'spawning',
                  startedAt: Date.now(),
                  prompt: (d.prompt as string) || undefined,
                  activityLog: [],
                });
                break;
              }
              case 'started': {
                const taskId = d.taskId as string;
                const pending = [...store.subAgents].reverse().find((a: SubAgentInfo) => a.status === 'spawning');
                if (pending) {
                  store.removeSubAgent(pending.id);
                  store.addSubAgent({
                    ...pending,
                    id: taskId,
                    status: 'active',
                    description: (d.description as string) || pending.description,
                    prompt: (d.prompt as string) || pending.prompt,
                    activityLog: pending.activityLog || [],
                  });
                } else {
                  store.addSubAgent({
                    id: taskId,
                    description: (d.description as string) || 'Working...',
                    status: 'active',
                    startedAt: Date.now(),
                    prompt: (d.prompt as string) || undefined,
                    activityLog: [],
                  });
                }
                break;
              }
              case 'progress': {
                const taskId = d.taskId as string;
                const description = (d.description as string) || '';
                const toolName = (d.lastTool as string) || '';
                const agent = store.subAgents.find((a: SubAgentInfo) => a.id === taskId);
                const update: Partial<SubAgentInfo> = {
                  lastTool: toolName || undefined,
                  usage: d.usage as SubAgentInfo['usage'],
                };
                if (agent && (toolName || description)) {
                  update.activityLog = [...agent.activityLog, {
                    tool: description || toolName,
                    timestamp: Date.now(),
                  }];
                }
                store.updateSubAgent(taskId, update);
                break;
              }
              case 'tool_activity': {
                const taskId = d.taskId as string;
                const agent = store.subAgents.find((a: SubAgentInfo) => a.id === taskId);
                if (agent) {
                  store.updateSubAgent(taskId, {
                    lastTool: d.toolName as string,
                    activityLog: [...agent.activityLog, {
                      tool: d.toolName as string,
                      timestamp: Date.now(),
                      elapsed: d.elapsed as number,
                    }],
                  });
                }
                break;
              }
              case 'completed': {
                const taskId = d.taskId as string;
                const status = d.status as string;
                store.updateSubAgent(taskId, {
                  status: status === 'failed' ? 'failed' : status === 'stopped' ? 'stopped' : 'completed',
                  summary: (d.summary as string) || undefined,
                  usage: d.usage as SubAgentInfo['usage'],
                  lastTool: undefined,
                });
                setTimeout(() => useAppStore.getState().removeSubAgent(taskId), 5000);
                break;
              }
            }
            break;
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from sidecar, reconnecting...');
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [addMessage, appendToLastMessage, updateLastAssistantMeta, setStatus, loadInitialState]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback((content: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected');
      return;
    }
    addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    });
    wsRef.current.send(JSON.stringify({ type: 'chat', content }));
  }, [addMessage]);

  const sendRaw = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected');
      return;
    }
    wsRef.current.send(JSON.stringify(data));
  }, []);

  const newConversation = useCallback(async () => {
    try {
      await fetch(`${SIDECAR_URL}/api/conversations`, { method: 'POST' });
    } catch {
      console.warn('Failed to create new conversation');
    }
  }, []);

  const switchConversation = useCallback(async (id: string) => {
    try {
      await fetch(`${SIDECAR_URL}/api/conversations/${id}/activate`, { method: 'POST' });
    } catch {
      console.warn('Failed to switch conversation');
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await fetch(`${SIDECAR_URL}/api/conversations/${id}`, { method: 'DELETE' });
    } catch {
      console.warn('Failed to delete conversation');
    }
  }, []);

  const sendVoiceMessage = useCallback((content: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    });
    wsRef.current.send(JSON.stringify({ type: 'chat', content, voice: true }));
  }, [addMessage]);

  const setTtsCallback = useCallback((cb: (base64: string) => void) => {
    ttsCallbackRef.current = cb;
  }, []);

  const stopAgent = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'stop' }));
  }, []);

  return { sendMessage, sendVoiceMessage, sendRaw, setTtsCallback, newConversation, switchConversation, deleteConversation, stopAgent };
}
