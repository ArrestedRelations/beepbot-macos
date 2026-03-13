import { useState, useEffect, useCallback } from 'react';
import { Terminal, Square, Trash2, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

const SERVER_URL = `${window.location.protocol}//${window.location.host}`;

interface BackgroundTask {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  pid?: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string | null;
  label?: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

const statusStyles: Record<string, { bg: string; color: string }> = {
  running: { bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' },
  completed: { bg: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' },
  failed: { bg: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' },
  killed: { bg: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' },
};

function StatusBadge({ status }: { status: BackgroundTask['status'] }) {
  const s = statusStyles[status] || statusStyles.completed;
  return (
    <span
      className="bb-chip"
      style={{ background: s.bg, color: s.color }}
    >
      {status}
    </span>
  );
}

function TaskRow({ task, onKill, onRemove }: {
  task: BackgroundTask;
  onKill: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg"
      style={{ border: '1px solid var(--bb-border)', background: 'var(--bb-bg-elevated)' }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="transition-colors"
          style={{ color: 'var(--bb-text-muted)' }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <Terminal size={13} style={{ color: 'var(--bb-text-faint)', flexShrink: 0 }} />
        <span className="text-[13px] flex-1 truncate font-mono" style={{ color: 'var(--bb-text)' }}>
          {task.label || `${task.command} ${task.args.join(' ')}`}
        </span>
        <StatusBadge status={task.status} />
        <span className="text-[11px]" style={{ color: 'var(--bb-text-faint)' }}>{timeAgo(task.startedAt)}</span>
        {task.status === 'running' ? (
          <button
            onClick={() => onKill(task.id)}
            className="transition-colors"
            style={{ color: 'var(--bb-text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bb-danger)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bb-text-muted)'; }}
            title="Kill"
          >
            <Square size={12} />
          </button>
        ) : (
          <button
            onClick={() => onRemove(task.id)}
            className="transition-colors"
            style={{ color: 'var(--bb-text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bb-danger)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bb-text-muted)'; }}
            title="Remove"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid var(--bb-border)' }}>
          <div className="text-[11px] pt-2 font-mono" style={{ color: 'var(--bb-text-faint)' }}>
            PID: {task.pid ?? '-'} | CWD: {task.cwd}
            {task.exitCode !== null && ` | Exit: ${task.exitCode}`}
          </div>
          {(task.stdout || task.stderr) && (
            <pre
              className="text-[11px] font-mono rounded-lg p-3 max-h-44 overflow-auto whitespace-pre-wrap"
              style={{
                background: 'var(--bb-bg)',
                border: '1px solid var(--bb-border)',
                color: 'var(--bb-text-muted)',
              }}
            >
              {(task.stdout + task.stderr).slice(-4000)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function BackgroundTasksPanel() {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/tasks`);
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchTasks();
    const timer = setInterval(fetchTasks, 5000);
    return () => clearInterval(timer);
  }, [fetchTasks]);

  async function killTask(id: string) {
    await fetch(`${SERVER_URL}/api/tasks/${id}/kill`, { method: 'POST' }).catch(() => {});
    fetchTasks();
  }

  async function removeTask(id: string) {
    await fetch(`${SERVER_URL}/api/tasks/${id}`, { method: 'DELETE' }).catch(() => {});
    fetchTasks();
  }

  const running = tasks.filter(t => t.status === 'running').length;

  return (
    <div className="bb-card bb-rise bb-stagger-9">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="bb-card-title" style={{ marginBottom: 0 }}>Background Tasks</span>
          {running > 0 && (
            <span className="bb-chip" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
              {running} running
            </span>
          )}
        </div>
        <button
          onClick={fetchTasks}
          className="transition-colors"
          style={{ color: 'var(--bb-text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bb-text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bb-text-muted)'; }}
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {tasks.length === 0 ? (
        <div className="bb-empty">No background tasks</div>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => (
            <TaskRow key={task.id} task={task} onKill={killTask} onRemove={removeTask} />
          ))}
        </div>
      )}
    </div>
  );
}
