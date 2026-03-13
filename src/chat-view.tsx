import { useEffect, useRef } from 'react';
import { useAppStore } from './stores/app-store';
import { Message } from './message';
import { InputBar } from './input-bar';
import { StatusBar } from './status-bar';
import { AskUserModal } from './components/ask-user-modal';
import { Bot } from 'lucide-react';

interface ChatViewProps {
  sendMessage: (content: string) => void;
  sendRaw: (data: Record<string, unknown>) => void;
  stopAgent: () => void;
}

export function ChatView({ sendMessage, sendRaw, stopAgent }: ChatViewProps) {
  const messages = useAppStore((s) => s.messages);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full relative">
      <AskUserModal sendRaw={sendRaw} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-10">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mb-4">
              <Bot size={32} className="text-zinc-400" />
            </div>
            <h2 className="text-lg font-medium text-zinc-200 mb-2">BeepBot</h2>
            <p className="text-sm text-zinc-500 max-w-[280px]">
              Your autonomous AI assistant. Ask me to do anything — search the web, manage files, run commands, or just chat.
            </p>
          </div>
        ) : (
          <div className="py-4">
            {messages.map((msg) => (
              <Message key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>

      <StatusBar />
      <InputBar onSend={sendMessage} onStop={stopAgent} />
    </div>
  );
}
