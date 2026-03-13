import { useAppStore, type ConversationSummary } from '../stores/app-store';
import { Plus, Trash2, MessageSquare } from 'lucide-react';

interface ConversationListProps {
  onNewConversation: () => void;
  onSwitchConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr + 'Z').getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function ConversationItem({
  conv,
  isActive,
  onSwitch,
  onDelete,
}: {
  conv: ConversationSummary;
  isActive: boolean;
  onSwitch: () => void;
  onDelete: () => void;
}) {
  return (
    <button
      onClick={onSwitch}
      className={`group w-full text-left px-3 py-2.5 rounded-lg transition-colors relative ${
        isActive
          ? 'bg-zinc-800 text-zinc-100'
          : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <MessageSquare size={14} className="mt-0.5 shrink-0 opacity-50" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{conv.title || 'New Conversation'}</div>
          {conv.last_message && (
            <div className="text-xs text-zinc-500 truncate mt-0.5">
              {conv.last_message.slice(0, 60)}
            </div>
          )}
          <div className="text-[11px] text-zinc-600 mt-0.5">{timeAgo(conv.updated_at)}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400 transition-all shrink-0"
          title="Delete conversation"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </button>
  );
}

export function ConversationList({ onNewConversation, onSwitchConversation, onDeleteConversation }: ConversationListProps) {
  const conversations = useAppStore((s) => s.conversations);
  const activeId = useAppStore((s) => s.activeConversationId);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-zinc-800/50">
        <button
          onClick={onNewConversation}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition-colors"
        >
          <Plus size={15} />
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {conversations.map((conv) => (
          <ConversationItem
            key={conv.id}
            conv={conv}
            isActive={conv.id === activeId}
            onSwitch={() => onSwitchConversation(conv.id)}
            onDelete={() => onDeleteConversation(conv.id)}
          />
        ))}
      </div>
    </div>
  );
}
