import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { EyeState, HalFeedEvent, HalFeedKind } from '../stores/app-store';
import { useAppStore } from '../stores/app-store';

// Eye state → accent color (dark mode only)
const EYE_COLORS: Record<EyeState, string> = {
  idle:       'hsl(0 0% 35%)',
  connecting: 'hsl(0 85% 45%)',
  listening:  'hsl(140 80% 45%)',
  thinking:   'hsl(25 95% 50%)',
  tool_use:   'hsl(270 70% 55%)',
  speaking:   'hsl(140 80% 45%)',
  active:     'hsl(0 85% 50%)',
  awake:      'hsl(140 80% 45%)',
};

type FeedTab = 'all' | 'tools' | 'agents' | 'thinking' | 'speaking' | 'tokens';

const TAB_FILTER: Record<FeedTab, HalFeedKind[]> = {
  all:      [],
  tools:    ['tool_call', 'tool_done'],
  agents:   ['agent_start', 'agent_end'],
  thinking: ['thinking_start', 'thinking_done', 'status_running', 'status_idle'],
  speaking: ['speaking_start', 'speaking_done'],
  tokens:   ['token_usage'],
};

const TABS: FeedTab[] = ['all', 'tools', 'agents', 'thinking', 'speaking', 'tokens'];

const KIND_LABEL: Record<HalFeedKind, { text: string; className: string }> = {
  status_running:  { text: 'SYS',   className: 'text-stone-500/60' },
  status_idle:     { text: 'SYS',   className: 'text-stone-500/40' },
  agent_start:     { text: 'AGENT', className: 'text-sky-400/70' },
  agent_end:       { text: 'AGENT', className: 'text-sky-400/50' },
  tool_call:       { text: 'TOOL',  className: 'text-violet-400/70' },
  tool_done:       { text: 'TOOL',  className: 'text-violet-400/50' },
  thinking_start:  { text: 'THINK', className: 'text-amber-400/70' },
  thinking_done:   { text: 'THINK', className: 'text-amber-400/50' },
  speaking_start:  { text: 'SPEAK', className: 'text-green-400/70' },
  speaking_done:   { text: 'SPEAK', className: 'text-green-400/50' },
  token_usage:     { text: 'TOKEN', className: 'text-teal-400/60' },
};

function clock(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

const MASK = 'linear-gradient(to top, black 0%, black 50%, rgba(0,0,0,0.4) 80%, rgba(0,0,0,0.05) 100%)';

interface HalActivityFeedProps {
  eyeState: EyeState;
}

export function HalActivityFeed({ eyeState }: HalActivityFeedProps) {
  const events = useAppStore((s) => s.halFeedEvents);
  const status = useAppStore((s) => s.status);
  const [activeTab, setActiveTab] = useState<FeedTab>('all');

  const accentColor = EYE_COLORS[eyeState];
  const idleColor = EYE_COLORS.idle;

  const filtered = useMemo(() => {
    if (activeTab === 'all') return events;
    const kinds = TAB_FILTER[activeTab];
    return events.filter((ev: HalFeedEvent) => kinds.includes(ev.kind));
  }, [events, activeTab]);

  const isActive = status === 'thinking' || status === 'tool_call';

  return (
    <div
      className="h-full w-full overflow-hidden"
      style={{ maskImage: MASK, WebkitMaskImage: MASK }}
    >
      <div className="h-full flex flex-col justify-end overflow-hidden px-4 pb-20 pt-8">
        {filtered.map((ev) => (
          <motion.div
            key={ev.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="flex items-baseline gap-2 py-[1px] shrink-0"
          >
            <span className="shrink-0 text-[9px] font-mono text-stone-400/70 tabular-nums">
              {clock()}
            </span>

            <span className="shrink-0 text-[10px] w-3 text-center">
              {ev.kind === 'status_running'  && <span style={{ color: accentColor, opacity: 0.8 }}>▶</span>}
              {ev.kind === 'status_idle'     && <span style={{ color: idleColor, opacity: 0.4 }}>■</span>}
              {ev.kind === 'agent_start'     && <span className="text-sky-400">↳</span>}
              {ev.kind === 'agent_end'       && <span className={ev.ok === false ? 'text-red-400' : 'text-emerald-400'}>✓</span>}
              {ev.kind === 'tool_call'       && <span className="text-violet-400/90">⚙</span>}
              {ev.kind === 'tool_done'       && <span className={ev.ok === false ? 'text-red-400/90' : 'text-stone-400/70'}>·</span>}
              {ev.kind === 'thinking_start'  && <span className="text-amber-400/90">◆</span>}
              {ev.kind === 'thinking_done'   && <span className="text-amber-400/70">◇</span>}
              {ev.kind === 'speaking_start'  && <span className="text-green-400/90">▸</span>}
              {ev.kind === 'speaking_done'   && <span className="text-green-400/70">▹</span>}
              {ev.kind === 'token_usage'     && <span className="text-teal-400/80">≡</span>}
            </span>

            <span className={`shrink-0 text-[8px] font-mono font-semibold w-7 uppercase tracking-wider ${KIND_LABEL[ev.kind].className}`}>
              {KIND_LABEL[ev.kind].text}
            </span>

            <span
              className={`text-[10px] font-mono leading-tight ${
                ev.kind === 'agent_start'    ? 'text-stone-200/90'
                : ev.kind === 'agent_end'    ? (ev.ok === false ? 'text-red-400/90' : 'text-stone-200/80')
                : ev.kind === 'tool_call'    ? 'text-stone-200/90'
                : ev.kind === 'tool_done'    ? (ev.ok === false ? 'text-red-400/90' : 'text-stone-300/80')
                : ev.kind === 'thinking_start' ? 'text-amber-300/80'
                : ev.kind === 'thinking_done'  ? 'text-amber-200/70'
                : ev.kind === 'speaking_start' ? 'text-green-300/80'
                : ev.kind === 'speaking_done'  ? 'text-green-200/70'
                : ev.kind === 'token_usage'    ? 'text-teal-300/70'
                : ''
              }`}
              style={
                ev.kind === 'status_running' ? { color: accentColor, opacity: 0.9 }
                : ev.kind === 'status_idle'  ? { color: idleColor, opacity: 0.5 }
                : undefined
              }
            >
              {ev.text}
              {ev.sub && <span className="text-stone-300/70"> · {ev.sub}</span>}
            </span>
          </motion.div>
        ))}

        {/* Tab filter bar */}
        <div className="flex items-center gap-3 mt-2 mb-1 shrink-0 pointer-events-auto">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`text-[9px] font-mono uppercase tracking-wider transition-colors ${
                activeTab === tab
                  ? 'text-stone-200/90'
                  : 'text-stone-500/40 hover:text-stone-400/60'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Status line */}
        <div className="flex items-center gap-2 mt-0.5 shrink-0">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full transition-all duration-500 ${isActive ? 'animate-pulse' : ''}`}
            style={{
              backgroundColor: isActive ? accentColor : idleColor,
              boxShadow: isActive ? `0 0 6px 2px ${accentColor}66` : 'none',
              opacity: isActive ? 1 : 0.5,
            }}
          />
          <span
            className="text-[10px] font-mono font-semibold tracking-[0.12em] uppercase transition-all duration-500"
            style={{
              color: isActive ? accentColor : idleColor,
              opacity: isActive ? 1 : 0.5,
            }}
          >
            {isActive ? 'Active' : 'Idle'}
          </span>
        </div>
      </div>
    </div>
  );
}
