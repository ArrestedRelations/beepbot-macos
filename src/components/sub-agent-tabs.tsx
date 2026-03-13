import { useAppStore, type SubAgentInfo } from '../stores/app-store';
import { Check, X, Loader2 } from 'lucide-react';

export function SubAgentTabs() {
  const subAgents = useAppStore((s) => s.subAgents);

  if (subAgents.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-zinc-800/50 bg-zinc-950/80 overflow-x-auto">
      {subAgents.map((agent) => (
        <SubAgentTab key={agent.id} agent={agent} />
      ))}
    </div>
  );
}

function SubAgentTab({ agent }: { agent: SubAgentInfo }) {
  const selectedId = useAppStore((s) => s.selectedSubAgentId);
  const selectSubAgent = useAppStore((s) => s.selectSubAgent);
  const isSelected = selectedId === agent.id;
  const isActive = agent.status === 'spawning' || agent.status === 'active';
  const isCompleted = agent.status === 'completed';
  const isFailed = agent.status === 'failed' || agent.status === 'stopped';

  return (
    <button
      onClick={() => selectSubAgent(isSelected ? null : agent.id)}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
        isActive
          ? 'bg-sky-500/15 text-sky-400'
          : isCompleted
            ? 'bg-emerald-500/15 text-emerald-400 opacity-70'
            : 'bg-red-500/15 text-red-400 opacity-70'
      } ${isSelected ? 'ring-1 ring-sky-500/50' : 'hover:brightness-125'}`}
    >
      {isActive && (
        <Loader2 size={12} className="animate-spin shrink-0" />
      )}
      {isCompleted && <Check size={12} className="shrink-0" />}
      {isFailed && <X size={12} className="shrink-0" />}

      <span className="truncate max-w-[200px]">
        {agent.description || 'executor'}
      </span>

      {isActive && agent.lastTool && (
        <span className="text-[10px] text-sky-400/60 truncate max-w-[120px]">
          {agent.lastTool}
        </span>
      )}
    </button>
  );
}
