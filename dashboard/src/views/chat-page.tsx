import { useState, useEffect, useCallback } from 'react';
import { ChatView } from '../components/chat/chat-view';
import { VoiceOverlay } from '../components/voice-overlay';
import { ConversationList } from '../components/conversation-list';
import { SubAgentTabs } from '../components/sub-agent-tabs';
import { SubAgentDetailPanel } from '../components/sub-agent-detail-panel';
import { SettingsOverlay } from '../components/settings-overlay';
import { useAppStore } from '../stores/app-store';
import { useAgent } from '../hooks/use-agent';
import { useSpeech } from '../hooks/use-speech';
import { useTts } from '../hooks/use-tts';
import { History, Settings } from 'lucide-react';

interface ChatPageProps {
  sendRaw: (data: Record<string, unknown>) => void;
}

export function ChatPage(_props: ChatPageProps) {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const voiceMode = useAppStore((s) => s.voiceMode);
  const exitVoiceMode = useAppStore((s) => s.exitVoiceMode);
  const status = useAppStore((s) => s.status);
  const activeToolCall = useAppStore((s) => s.activeToolCall);
  const agentMode = useAppStore((s) => s.agentMode);
  const selectedSubAgentId = useAppStore((s) => s.selectedSubAgentId);
  const settingsPage = useAppStore((s) => s.settingsPage);
  const setSettingsPage = useAppStore((s) => s.setSettingsPage);
  const { sendMessage, sendVoiceMessage, sendRaw, setTtsCallback, newConversation, switchConversation, deleteConversation, stopAgent } = useAgent();

  const [transcript, setTranscript] = useState('');
  const { play: playTts, stop: stopTts } = useTts();

  useEffect(() => {
    setTtsCallback(playTts);
  }, [setTtsCallback, playTts]);

  const handleSpeechResult = useCallback((text: string) => {
    setTranscript('');
    stopTts();
    sendVoiceMessage(text);
  }, [sendVoiceMessage, stopTts]);

  const handleInterim = useCallback((text: string) => {
    setTranscript(text);
  }, []);

  const { start: startSpeech, stop: stopSpeech } = useSpeech({
    onResult: handleSpeechResult,
    onInterim: handleInterim,
  });

  useEffect(() => {
    if (voiceMode) {
      startSpeech();
    } else {
      stopSpeech();
      stopTts();
      setTranscript('');
    }
  }, [voiceMode, startSpeech, stopSpeech, stopTts]);

  const SERVER_URL = `${window.location.protocol}//${window.location.host}`;

  if (voiceMode) {
    return <VoiceOverlay onClose={exitVoiceMode} transcript={transcript} />;
  }

  return (
    <div className="h-full flex">
      {/* Conversation sidebar */}
      {sidebarOpen && (
        <div
          className="shrink-0 flex flex-col border-r overflow-hidden"
          style={{
            width: 280,
            background: 'var(--bb-bg-accent)',
            borderColor: 'var(--bb-border)',
          }}
        >
          <div className="px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--bb-border)' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--bb-text-muted)' }}>Conversations</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <ConversationList
              onNewConversation={newConversation}
              onSwitchConversation={switchConversation}
              onDeleteConversation={deleteConversation}
            />
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <SettingsOverlay sendRaw={sendRaw} />

        {/* Chat toolbar */}
        <header
          className="flex items-center justify-between px-4 shrink-0"
          style={{
            height: 'var(--bb-topbar-h)',
            borderBottom: '1px solid var(--bb-border)',
            background: 'var(--bb-bg)',
          }}
        >
          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleSidebar}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
              style={{ color: sidebarOpen ? 'var(--bb-accent)' : 'var(--bb-text-muted)' }}
              title="Conversations"
            >
              <History size={15} />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                const next = agentMode === 'autonomous' ? 'ask' : agentMode === 'ask' ? 'stop' : 'autonomous';
                fetch(`${SERVER_URL}/api/agent/mode`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ mode: next }),
                }).catch(() => {});
              }}
              className="bb-pill cursor-pointer transition-colors"
              title={
                agentMode === 'autonomous'
                  ? (status === 'thinking' || status === 'tool_call'
                      ? `Active${activeToolCall ? ` — ${activeToolCall}` : ''}`
                      : 'Running')
                  : agentMode === 'ask'
                    ? 'Paused'
                    : 'Stopped'
              }
            >
              <span className={`bb-dot ${
                agentMode === 'stop' ? 'bb-dot-danger'
                  : agentMode === 'ask' ? 'bb-dot-warn'
                  : (status === 'thinking' || status === 'tool_call') ? 'bb-dot-ok'
                  : status === 'error' ? 'bb-dot-danger'
                  : 'bb-dot-ok'
              }`} style={{ width: 6, height: 6 }} />
              <span style={{
                color: agentMode === 'stop' ? 'var(--bb-danger)'
                  : agentMode === 'ask' ? 'var(--bb-warn)'
                  : status === 'error' ? 'var(--bb-danger)'
                  : 'var(--bb-ok)',
              }}>
                {agentMode === 'stop' ? 'Stopped'
                  : agentMode === 'ask' ? 'Paused'
                  : status === 'thinking' || status === 'tool_call' ? 'Active'
                  : 'Running'}
              </span>
            </button>

            <button
              onClick={() => setSettingsPage(settingsPage ? null : 'main')}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
              style={{ color: settingsPage ? 'var(--bb-accent)' : 'var(--bb-text-muted)' }}
              title="Settings"
            >
              <Settings size={15} />
            </button>
          </div>
        </header>

        <SubAgentTabs />

        {selectedSubAgentId ? (
          <SubAgentDetailPanel />
        ) : (
          <main className="flex-1 overflow-hidden">
            <ChatView sendMessage={sendMessage} sendRaw={sendRaw} stopAgent={stopAgent} />
          </main>
        )}
      </div>
    </div>
  );
}
