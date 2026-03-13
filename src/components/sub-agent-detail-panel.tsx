import { useAppStore } from '../stores/app-store';
import { X, Clock, Cpu, Wrench, Loader2, Check, AlertCircle } from 'lucide-react';

export function SubAgentDetailPanel() {
  const selectedId = useAppStore((s) => s.selectedSubAgentId);
  const selectSubAgent = useAppStore((s) => s.selectSubAgent);
  const agent = useAppStore((s) => s.subAgents.find((a) => a.id === selectedId));

  if (!selectedId || !agent) return null;

  const isActive = agent.status === 'spawning' || agent.status === 'active';
  const isCompleted = agent.status === 'completed';
  const elapsed = agent.usage?.duration_ms
    ? (agent.usage.duration_ms / 1000).toFixed(1)
    : ((Date.now() - agent.startedAt) / 1000).toFixed(0);

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 overflow-hidden">
      <div className="flex items-start justify-between px-4 py-3 border-b border-zinc-800/50">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {isActive && <Loader2 size={14} className="animate-spin text-sky-400" />}
            {isCompleted && <Check size={14} className="text-emerald-400" />}
            {!isActive && !isCompleted && <AlertCircle size={14} className="text-red-400" />}
            <span className="text-sm font-semibold text-zinc-200">{agent.description || 'executor'}</span>
          </div>
          <div className="flex items-center gap-2 pl-[22px]">
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              isActive ? 'bg-sky-500/15 text-sky-400'
                : isCompleted ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-red-500/15 text-red-400'
            }`}>
              {agent.status}
            </span>
            <span className="text-xs text-zinc-600 flex items-center gap-1">
              <Clock size={11} />
              {elapsed}s
            </span>
            {agent.usage && (
              <>
                <span className="text-xs text-zinc-600 flex items-center gap-1">
                  <Cpu size={11} />
                  {agent.usage.total_tokens.toLocaleString()}
                </span>
                <span className="text-xs text-zinc-600 flex items-center gap-1">
                  <Wrench size={11} />
                  {agent.usage.tool_uses} tools
                </span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={() => selectSubAgent(null)}
          className="w-7 h-7 rounded-md hover:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {agent.description && (
          <div className="px-5 py-3 border-b border-zinc-800/30">
            <div className="text-[11px] uppercase tracking-wider text-zinc-600 mb-1">Task</div>
            <div className="text-sm text-zinc-300">{agent.description}</div>
          </div>
        )}

        {agent.prompt && (
          <div className="px-5 py-3 border-b border-zinc-800/30">
            <div className="text-[11px] uppercase tracking-wider text-zinc-600 mb-1">Prompt</div>
            <div className="text-sm text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">
              {agent.prompt}
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-b border-zinc-800/30">
          <div className="text-[11px] uppercase tracking-wider text-zinc-600 mb-3">Activity</div>
          {agent.activityLog.length === 0 ? (
            <div className="text-sm text-zinc-600 italic">
              {isActive ? 'Waiting for tool calls...' : 'No tool calls recorded'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {agent.activityLog.map((entry, i) => {
                const isLast = i === agent.activityLog.length - 1;
                const isCurrentTool = isLast && isActive;
                return (
                  <div key={i} className="flex items-center gap-2.5 text-sm">
                    {isCurrentTool ? (
                      <Loader2 size={12} className="animate-spin text-sky-400 shrink-0" />
                    ) : (
                      <Check size={12} className="text-emerald-500/60 shrink-0" />
                    )}
                    <span className={isCurrentTool ? 'text-sky-400 font-medium' : 'text-zinc-400'}>
                      {entry.tool}
                    </span>
                    <span className="text-zinc-600 ml-auto text-xs">
                      {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {agent.summary && (
          <div className="px-5 py-3">
            <div className="text-[11px] uppercase tracking-wider text-zinc-600 mb-1">Summary</div>
            <div className="text-sm text-zinc-300 leading-relaxed">
              {agent.summary}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
