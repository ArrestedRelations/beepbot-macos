import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { Send, Mic, Square } from 'lucide-react';
import { useAppStore } from '../../stores/app-store';

const SERVER_URL = `${window.location.protocol}//${window.location.host}`;

const MODEL_ORDER = ['haiku', 'sonnet', 'opus'];

const PERMISSION_LABELS: Record<string, string> = {
  bypassPermissions: 'Autonomous',
  acceptEdits: 'Supervised',
  plan: 'Plan',
};

const PERMISSION_CYCLE = ['bypassPermissions', 'acceptEdits', 'plan'] as const;

interface InputBarProps {
  onSend: (message: string) => void;
  onStop: () => void;
}

export const InputBar = memo(function InputBar({ onSend, onStop }: InputBarProps) {
  const [input, setInput] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rafRef = useRef<number>(0);
  const composingRef = useRef(false);
  const status = useAppStore((s) => s.status);
  const agentMode = useAppStore((s) => s.agentMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const activeModel = useAppStore((s) => s.activeModel);
  const enterVoiceMode = useAppStore((s) => s.enterVoiceMode);
  const conversationId = useAppStore((s) => s.activeConversationId);
  const isAgentActive = status === 'thinking' || status === 'tool_call';
  const isStopped = agentMode === 'stop';

  // Load saved draft on conversation switch
  useEffect(() => {
    if (!conversationId) return;
    const saved = localStorage.getItem(`beepbot:draft:${conversationId}`);
    setInput(saved ?? '');
  }, [conversationId]);

  // Debounce-save draft
  useEffect(() => {
    if (!conversationId) return;
    const timer = setTimeout(() => {
      if (input) {
        localStorage.setItem(`beepbot:draft:${conversationId}`, input);
      } else {
        localStorage.removeItem(`beepbot:draft:${conversationId}`);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [input, conversationId]);

  // Fetch available models from API
  useEffect(() => {
    fetch(`${SERVER_URL}/api/agent/models`)
      .then(r => r.json())
      .then(data => { if (data.models) setAvailableModels(data.models); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const resizeTextarea = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 160) + 'px';
      }
    });
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || isStopped) return;
    if (isAgentActive) {
      onStop();
    }
    onSend(trimmed);
    setInput('');
    if (conversationId) localStorage.removeItem(`beepbot:draft:${conversationId}`);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (!composingRef.current) {
      setInput(e.target.value);
    }
  }

  function handleCompositionStart() {
    composingRef.current = true;
  }

  function handleCompositionEnd(e: React.CompositionEvent<HTMLTextAreaElement>) {
    composingRef.current = false;
    setInput(e.currentTarget.value);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function cycleModel() {
    const models = availableModels.length > 0
      ? [...availableModels].sort((a, b) => {
          const ai = MODEL_ORDER.indexOf(a);
          const bi = MODEL_ORDER.indexOf(b);
          return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
        })
      : MODEL_ORDER;
    const currentIdx = models.indexOf(activeModel);
    const next = models[(currentIdx + 1) % models.length];
    fetch(`${SERVER_URL}/api/agent/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: next }),
    }).catch(() => {});
  }

  function cyclePermission() {
    const currentIdx = PERMISSION_CYCLE.indexOf(permissionMode);
    const next = PERMISSION_CYCLE[(currentIdx + 1) % PERMISSION_CYCLE.length];
    fetch(`${SERVER_URL}/api/agent/permission-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    }).catch(() => {});
  }

  return (
    <div className="border-t border-zinc-800 px-8 py-3">
      <div className="flex items-end gap-2 bg-zinc-800/50 rounded-xl px-3 py-2">
        <div className="flex-shrink-0 flex items-center gap-1.5 self-center">
          <button
            onClick={cycleModel}
            className="text-xs font-medium px-1.5 py-0.5 rounded transition-colors cursor-pointer"
            style={{
              color: activeModel === 'opus' ? 'var(--bb-accent)' : 'var(--bb-text-muted)',
              background: 'transparent',
            }}
            title={`Model: ${activeModel}. Click to cycle.`}
          >
            <span className="capitalize">{activeModel}</span>
          </button>
          <span style={{ color: 'var(--bb-border)' }}>·</span>
          <button
            onClick={cyclePermission}
            className="text-xs font-medium px-1.5 py-0.5 rounded transition-colors cursor-pointer"
            style={{
              color: permissionMode === 'bypassPermissions'
                ? 'var(--bb-ok, #22c55e)'
                : permissionMode === 'acceptEdits'
                  ? 'var(--bb-warn, #f59e0b)'
                  : 'var(--bb-accent, #3b82f6)',
              background: 'transparent',
            }}
            title={`${PERMISSION_LABELS[permissionMode]}. Click to cycle.`}
          >
            {PERMISSION_LABELS[permissionMode]}
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={handleKeyDown}
          placeholder={isStopped ? 'Agent is stopped' : 'Message BeepBot...'}
          disabled={isStopped}
          rows={1}
          className="flex-1 bg-transparent text-zinc-100 text-sm placeholder-zinc-500 outline-none resize-none min-h-[24px] max-h-[160px] disabled:opacity-50"
        />
        {isAgentActive && !input.trim() ? (
          <button
            onClick={onStop}
            className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-500 text-white flex items-center justify-center hover:bg-red-400 transition-colors"
            title="Stop agent"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : input.trim() ? (
          <button
            onClick={handleSubmit}
            disabled={isStopped}
            className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-500 text-white flex items-center justify-center hover:bg-blue-400 disabled:opacity-30 disabled:hover:bg-blue-500 transition-colors"
          >
            <Send size={16} />
          </button>
        ) : (
          <button
            onClick={enterVoiceMode}
            disabled={isStopped}
            className="flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-400 disabled:opacity-30 transition-colors"
            title="Voice mode"
          >
            <Mic size={16} />
          </button>
        )}
      </div>
    </div>
  );
});
