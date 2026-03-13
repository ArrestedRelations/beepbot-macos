import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage } from './stores/app-store';
import { Bot } from 'lucide-react';

interface MessageProps {
  message: ChatMessage;
}

function formatTime(raw: string): string {
  const normalized = raw.endsWith('Z') || raw.includes('+') || raw.includes('T') ? raw : raw + 'Z';
  const d = new Date(normalized);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function Message({ message }: MessageProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const [showInfo, setShowInfo] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const hasMetadata = message.tokensIn || message.tokensOut || message.model;

  useEffect(() => {
    if (!showInfo) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowInfo(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showInfo]);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} px-8 py-2`}>
      <div className="max-w-[85%]">
        {!isUser && !isSystem && (
          <div className="pl-2 relative z-10 -mb-1.5" ref={popoverRef}>
            <div className="flex items-end gap-1.5">
              <button
                onClick={() => hasMetadata && setShowInfo(!showInfo)}
                className={`flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700/60 ${hasMetadata ? 'cursor-pointer hover:ring-1 hover:ring-zinc-500/50' : 'cursor-default'} transition-all`}
              >
                <Bot className="h-3 w-3 text-zinc-400" />
              </button>
            </div>
            {showInfo && hasMetadata && (
              <div className="absolute left-0 top-7 z-50 rounded-lg bg-zinc-900 border border-zinc-700/50 shadow-xl px-3 py-2.5 text-[11px] text-zinc-400 space-y-1.5 min-w-[180px]">
                {message.provider && (
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-500">Provider</span>
                    <span className="text-zinc-300 capitalize">{message.provider}</span>
                  </div>
                )}
                {message.model && (
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-500">Model</span>
                    <span className="text-zinc-300">{message.model}</span>
                  </div>
                )}
                {(message.tokensIn != null && message.tokensIn > 0) && (
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-500">Input tokens</span>
                    <span className="text-zinc-300">{message.tokensIn.toLocaleString()}</span>
                  </div>
                )}
                {(message.tokensOut != null && message.tokensOut > 0) && (
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-500">Output tokens</span>
                    <span className="text-zinc-300">{message.tokensOut.toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-blue-500/10 text-zinc-100'
              : isSystem
                ? 'bg-red-500/10 text-red-300 border border-red-500/20'
                : 'bg-white/5 border border-zinc-700/50 text-zinc-100'
          }`}
        >
          {isUser || isSystem ? (
            <p>{message.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {message.createdAt && (
          <p className={`text-[10px] text-zinc-600 mt-1 ${isUser ? 'text-right pr-1' : 'pl-1'}`}>
            {formatTime(message.createdAt)}
          </p>
        )}
      </div>
    </div>
  );
}
