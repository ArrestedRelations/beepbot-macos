import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { Send, Mic, Square, Eye, FileEdit, Zap } from 'lucide-react';
import { useAppStore } from './stores/app-store';

interface InputBarProps {
  onSend: (message: string) => void;
  onStop: () => void;
}

export const InputBar = memo(function InputBar({ onSend, onStop }: InputBarProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rafRef = useRef<number>(0);
  const composingRef = useRef(false);
  const status = useAppStore((s) => s.status);
  const agentMode = useAppStore((s) => s.agentMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const enterVoiceMode = useAppStore((s) => s.enterVoiceMode);
  const conversationId = useAppStore((s) => s.activeConversationId);
  const isAgentActive = status === 'thinking' || status === 'tool_call';
  const isStopped = agentMode === 'stop';
  const isDefault = permissionMode === 'default';
  const isAcceptEdits = permissionMode === 'acceptEdits';

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

  return (
    <div className="border-t border-zinc-800 px-8 py-3">
      <div className="flex items-end gap-2 bg-zinc-800/50 rounded-xl px-3 py-2">
        <button
          onClick={() => {
            const next = isDefault ? 'acceptEdits' : isAcceptEdits ? 'bypassPermissions' : 'default';
            fetch('http://127.0.0.1:3004/api/agent/permission-mode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode: next }),
            }).catch(() => {});
          }}
          className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            isDefault
              ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
              : isAcceptEdits
                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                : 'text-zinc-500 hover:text-amber-400 hover:bg-zinc-700/50'
          }`}
          title={
            isDefault
              ? 'Default — prompts for dangerous ops. Click for accept-edits.'
              : isAcceptEdits
                ? 'Accept edits — auto-accept file edits. Click for full auto.'
                : 'Full auto — all actions permitted. Click for default.'
          }
        >
          {isDefault ? <Eye size={16} /> : isAcceptEdits ? <FileEdit size={16} /> : <Zap size={16} />}
        </button>
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
