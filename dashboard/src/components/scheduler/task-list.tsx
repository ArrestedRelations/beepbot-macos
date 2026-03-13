import { useState } from 'react';
import { Play, Trash2, Plus, Clock, ToggleLeft, ToggleRight } from 'lucide-react';
import { useSchedulerStore, type ScheduledTask } from '../../stores/scheduler-store';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timeUntil(dateStr: string | null): string {
  if (!dateStr) return '-';
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) return 'overdue';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

function TaskItem({ task }: { task: ScheduledTask }) {
  const { updateTask, deleteTask, runTask } = useSchedulerStore();
  const [running, setRunning] = useState(false);

  async function handleRun() {
    setRunning(true);
    await runTask(task.id);
    setRunning(false);
  }

  return (
    <div
      className="rounded-lg p-3"
      style={{ border: '1px solid var(--bb-border)', background: 'var(--bb-bg-elevated)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium" style={{ color: task.enabled ? 'var(--bb-text-strong)' : 'var(--bb-text-muted)' }}>
              {task.name}
            </span>
            <span
              className="bb-chip"
              style={{
                background: task.task_type === 'agent_turn' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                color: task.task_type === 'agent_turn' ? '#3b82f6' : '#22c55e',
              }}
            >
              {task.task_type === 'agent_turn' ? 'Agent' : 'System'}
            </span>
          </div>
          <div className="text-[11px] font-mono mt-1" style={{ color: 'var(--bb-text-faint)' }}>{task.cron_expr}</div>
          <div className="flex items-center gap-3 text-[11px] mt-1.5" style={{ color: 'var(--bb-text-faint)' }}>
            <span className="flex items-center gap-1">
              <Clock size={10} />
              Last: {timeAgo(task.last_run)}
            </span>
            <span>Next: {timeUntil(task.next_run)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleRun}
            disabled={running}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors disabled:opacity-50"
            style={{ color: 'var(--bb-text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bb-ok)'; e.currentTarget.style.background = 'var(--bb-bg-card-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bb-text-muted)'; e.currentTarget.style.background = 'transparent'; }}
            title="Run now"
          >
            <Play size={13} />
          </button>
          <button
            onClick={() => updateTask(task.id, { enabled: !task.enabled })}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            title={task.enabled ? 'Disable' : 'Enable'}
          >
            {task.enabled
              ? <ToggleRight size={16} style={{ color: 'var(--bb-ok)' }} />
              : <ToggleLeft size={16} style={{ color: 'var(--bb-text-muted)' }} />
            }
          </button>
          <button
            onClick={() => deleteTask(task.id)}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            style={{ color: 'var(--bb-text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bb-danger)'; e.currentTarget.style.background = 'var(--bb-bg-card-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bb-text-muted)'; e.currentTarget.style.background = 'transparent'; }}
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function TaskList() {
  const { tasks, createTask } = useSchedulerStore();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 * * * *');
  const [taskType, setTaskType] = useState<'agent_turn' | 'system_check'>('agent_turn');
  const [prompt, setPrompt] = useState('');

  async function handleCreate() {
    if (!name.trim() || !cron.trim()) return;
    await createTask({
      name: name.trim(),
      cron_expr: cron.trim(),
      task_type: taskType,
      task_payload: taskType === 'agent_turn' ? JSON.stringify({ prompt: prompt.trim() || name.trim() }) : '{}',
    });
    setName('');
    setCron('0 * * * *');
    setPrompt('');
    setShowForm(false);
  }

  const inputStyle = {
    background: 'var(--bb-bg)',
    border: '1px solid var(--bb-border)',
    color: 'var(--bb-text)',
  };

  return (
    <div className="bb-card bb-rise bb-stagger-10">
      <div className="flex items-center justify-between mb-4">
        <span className="bb-card-title" style={{ marginBottom: 0 }}>Scheduled Tasks</span>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 text-[12px] font-medium transition-colors"
          style={{ color: 'var(--bb-text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bb-text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bb-text-muted)'; }}
        >
          <Plus size={13} />
          Add
        </button>
      </div>

      {showForm && (
        <div
          className="rounded-lg p-3 mb-4 space-y-2.5"
          style={{ background: 'var(--bb-bg-elevated)', border: '1px solid var(--bb-border)' }}
        >
          <input
            type="text"
            placeholder="Task name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md px-3 py-2 text-[13px] outline-none"
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Cron expression (e.g. 0 * * * *)"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            className="w-full rounded-md px-3 py-2 text-[13px] font-mono outline-none"
            style={inputStyle}
          />
          <div className="flex gap-2">
            <button
              onClick={() => setTaskType('agent_turn')}
              className="flex-1 text-[13px] py-2 rounded-md border transition-colors"
              style={{
                borderColor: taskType === 'agent_turn' ? 'rgba(59, 130, 246, 0.3)' : 'var(--bb-border)',
                background: taskType === 'agent_turn' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                color: taskType === 'agent_turn' ? '#3b82f6' : 'var(--bb-text-muted)',
              }}
            >
              Agent Turn
            </button>
            <button
              onClick={() => setTaskType('system_check')}
              className="flex-1 text-[13px] py-2 rounded-md border transition-colors"
              style={{
                borderColor: taskType === 'system_check' ? 'rgba(34, 197, 94, 0.3)' : 'var(--bb-border)',
                background: taskType === 'system_check' ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
                color: taskType === 'system_check' ? '#22c55e' : 'var(--bb-text-muted)',
              }}
            >
              System Check
            </button>
          </div>
          {taskType === 'agent_turn' && (
            <textarea
              placeholder="Prompt for the agent..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full rounded-md px-3 py-2 text-[13px] resize-none h-16 outline-none"
              style={inputStyle}
            />
          )}
          <button
            onClick={handleCreate}
            disabled={!name.trim() || !cron.trim()}
            className="w-full py-2 rounded-md text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'var(--bb-accent-subtle)',
              color: 'var(--bb-accent)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
            }}
          >
            Create Task
          </button>
        </div>
      )}

      {tasks.length === 0 && !showForm ? (
        <div className="bb-empty">No scheduled tasks</div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
