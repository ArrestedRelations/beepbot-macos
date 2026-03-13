import { useAppStore } from '../../stores/app-store';
import { Loader2, Wrench, AlertCircle } from 'lucide-react';

export function StatusBar() {
  const status = useAppStore((s) => s.status);
  const activeToolCall = useAppStore((s) => s.activeToolCall);

  if (status === 'idle') return null;

  return (
    <div className="px-8 py-2 flex items-center gap-2 text-xs">
      {status === 'thinking' && (
        <>
          <Loader2 size={14} className="animate-spin text-blue-400" />
          <span className="text-zinc-400">Thinking...</span>
        </>
      )}
      {status === 'tool_call' && (
        <>
          <Wrench size={14} className="text-amber-400" />
          <span className="text-zinc-400">
            Using <span className="text-amber-300 font-medium">{activeToolCall}</span>
          </span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle size={14} className="text-red-400" />
          <span className="text-red-400">Something went wrong</span>
        </>
      )}
    </div>
  );
}
