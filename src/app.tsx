import { useState, useEffect, useCallback } from 'react';
import { ChatView } from './chat-view';
import { VoiceOverlay } from './components/voice-overlay';
import { ConversationList } from './components/conversation-list';
import { SubAgentTabs } from './components/sub-agent-tabs';
import { SubAgentDetailPanel } from './components/sub-agent-detail-panel';
import { SettingsOverlay } from './components/settings-overlay';
import { useAppStore } from './stores/app-store';
import { useAgent } from './hooks/use-agent';
import { useSpeech } from './hooks/use-speech';
import { useTts } from './hooks/use-tts';
import { History, Settings, Maximize2, ArrowLeft } from 'lucide-react';

const DASHBOARD_URL = 'http://beepbotai:7432';

function App() {
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

  // Wire TTS callback
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

  // Start/stop speech when voice mode toggles
  useEffect(() => {
    if (voiceMode) {
      startSpeech();
    } else {
      stopSpeech();
      stopTts();
      setTranscript('');
    }
  }, [voiceMode, startSpeech, stopSpeech, stopTts]);

  const openDashboard = async () => {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(DASHBOARD_URL);
    } catch {
      window.open(DASHBOARD_URL, '_blank');
    }
  };

  // ===== VOICE MODE TAKEOVER =====
  if (voiceMode) {
    return <VoiceOverlay onClose={exitVoiceMode} transcript={transcript} />;
  }

  // Conversation sidebar overlay
  if (sidebarOpen) {
    return (
      <div className="h-screen flex flex-col" style={{ background: 'var(--bb-bg)', color: 'var(--bb-text)' }}>
        <header
          className="flex items-center justify-between px-4 shrink-0"
          style={{ height: 'var(--bb-topbar-h)', borderBottom: '1px solid var(--bb-border)', background: 'var(--bb-bg)' }}
          data-tauri-drag-region
        >
          <button
            onClick={toggleSidebar}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            style={{ color: 'var(--bb-text-muted)' }}
            title="Back to chat"
          >
            <ArrowLeft size={15} />
          </button>
          <span className="text-sm font-semibold select-none" style={{ color: 'var(--bb-text)' }} data-tauri-drag-region>
            Conversations
          </span>
          <div className="w-7" />
        </header>
        <div className="flex-1 overflow-hidden">
          <ConversationList
            onNewConversation={() => { newConversation(); toggleSidebar(); }}
            onSwitchConversation={(id) => { switchConversation(id); toggleSidebar(); }}
            onDeleteConversation={deleteConversation}
          />
        </div>
      </div>
    );
  }

  // Main condensed chat view
  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--bb-bg)', color: 'var(--bb-text)' }}>
      {/* Settings overlay (full-page, above everything) */}
      <SettingsOverlay sendRaw={sendRaw} />

      {/* Title bar */}
      <header
        className="flex items-center justify-between px-4 shrink-0"
        style={{
          height: 'var(--bb-topbar-h)',
          borderBottom: '1px solid var(--bb-border)',
          background: 'var(--bb-bg)',
        }}
        data-tauri-drag-region
      >
        {/* Left controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleSidebar}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            style={{ color: 'var(--bb-text-muted)' }}
            title="Conversations"
          >
            <History size={15} />
          </button>
          <button
            onClick={openDashboard}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            style={{ color: 'var(--bb-text-muted)' }}
            title="Open dashboard"
          >
            <Maximize2 size={14} />
          </button>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1.5">
          {/* Agent mode toggle */}
          <button
            onClick={() => {
              const next = agentMode === 'autonomous' ? 'ask' : agentMode === 'ask' ? 'stop' : 'autonomous';
              fetch('http://127.0.0.1:3004/api/agent/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: next }),
              }).catch(() => {});
            }}
            className="bb-pill cursor-pointer transition-colors"
            title={
              agentMode === 'autonomous'
                ? (status === 'thinking' || status === 'tool_call'
                    ? `Active${activeToolCall ? ` — ${activeToolCall}` : ''} · click to switch to Ask mode`
                    : 'Autonomous — full agent · click to switch to Ask mode')
                : agentMode === 'ask'
                  ? 'Ask — brainstorm only, no actions · click to stop'
                  : 'Stopped — click to enable autonomous mode'
            }
          >
            <span className={`bb-dot ${
              agentMode === 'stop' ? 'bb-dot-muted'
                : agentMode === 'ask' ? 'bb-dot-warn'
                : (status === 'thinking' || status === 'tool_call') ? 'bb-dot-ok'
                : status === 'error' ? 'bb-dot-danger'
                : 'bb-dot-ok'
            }`} style={{ width: 6, height: 6 }} />
            <span style={{
              color: agentMode === 'stop' ? 'var(--bb-text-faint)'
                : agentMode === 'ask' ? 'var(--bb-warn)'
                : status === 'error' ? 'var(--bb-danger)'
                : 'var(--bb-ok)',
            }}>
              {agentMode === 'stop' ? 'Stop'
                : agentMode === 'ask' ? 'Ask'
                : status === 'thinking' || status === 'tool_call' ? 'Active'
                : 'Auto'}
            </span>
          </button>

          {/* Settings gear */}
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

      {/* Sub-agent tabs */}
      <SubAgentTabs />

      {/* Either sub-agent detail or chat */}
      {selectedSubAgentId ? (
        <SubAgentDetailPanel />
      ) : (
        <main className="flex-1 overflow-hidden">
          <ChatView sendMessage={sendMessage} sendRaw={sendRaw} stopAgent={stopAgent} />
        </main>
      )}
    </div>
  );
}

export default App;
