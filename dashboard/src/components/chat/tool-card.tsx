import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Check, AlertCircle } from 'lucide-react';

interface ToolCardProps {
  id: string;
  name: string;
  input: unknown;
  status: 'running' | 'done' | 'error';
}

const TOOL_LABELS: Record<string, string> = {
  Read: 'Reading file',
  Write: 'Writing file',
  Edit: 'Editing file',
  Bash: 'Running command',
  Glob: 'Searching files',
  Grep: 'Searching content',
  WebSearch: 'Searching web',
  WebFetch: 'Fetching URL',
  Agent: 'Running sub-agent',
  TodoWrite: 'Updating tasks',
};

function getToolLabel(name: string, input: unknown): string {
  const inp = input as Record<string, unknown> | null;
  if (name === 'Read' && inp?.file_path) {
    const path = inp.file_path as string;
    return `Read ${path.split('/').pop()}`;
  }
  if (name === 'Edit' && inp?.file_path) {
    const path = inp.file_path as string;
    return `Edit ${path.split('/').pop()}`;
  }
  if (name === 'Write' && inp?.file_path) {
    const path = inp.file_path as string;
    return `Write ${path.split('/').pop()}`;
  }
  if (name === 'Bash' && inp?.command) {
    const cmd = (inp.command as string).slice(0, 60);
    return `$ ${cmd}${(inp.command as string).length > 60 ? '...' : ''}`;
  }
  if (name === 'Grep' && inp?.pattern) {
    return `Grep "${inp.pattern}"`;
  }
  if (name === 'Glob' && inp?.pattern) {
    return `Glob ${inp.pattern}`;
  }
  return TOOL_LABELS[name] || name;
}

export function ToolCard({ name, input, status }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const label = getToolLabel(name, input);
  const hasInput = !!(input && typeof input === 'object' && Object.keys(input as Record<string, unknown>).length > 0);

  return (
    <div
      className="rounded-lg my-1 text-xs font-mono"
      style={{
        background: 'var(--bb-bg-accent)',
        border: `1px solid ${status === 'error' ? 'rgba(239,68,68,0.3)' : 'var(--bb-border)'}`,
      }}
    >
      <button
        onClick={() => hasInput && setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left"
        style={{ color: 'var(--bb-text-muted)' }}
      >
        {status === 'running' && <Loader2 size={12} className="animate-spin shrink-0" style={{ color: 'var(--bb-accent)' }} />}
        {status === 'done' && <Check size={12} className="shrink-0" style={{ color: 'rgb(34,197,94)' }} />}
        {status === 'error' && <AlertCircle size={12} className="shrink-0" style={{ color: 'rgb(239,68,68)' }} />}
        <span className="truncate flex-1">{label}</span>
        {hasInput && (
          expanded
            ? <ChevronDown size={12} className="shrink-0" />
            : <ChevronRight size={12} className="shrink-0" />
        )}
      </button>
      {expanded && hasInput && (
        <pre
          className="px-3 pb-2 text-[10px] break-all whitespace-pre-wrap max-h-40 overflow-y-auto"
          style={{ color: 'var(--bb-text-faint)', borderTop: '1px solid var(--bb-border)' }}
        >
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  );
}
