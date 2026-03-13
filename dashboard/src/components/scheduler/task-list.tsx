import { useState } from 'react';
import { Play, Trash2, Plus, Clock, ToggleLeft, ToggleRight, History } from 'lucide-react';
import { useSchedulerStore, type ScheduledTask, type TaskRun } from '../../stores/scheduler-store';
import { useAppStore } from '../../stores/app-store';
import { timeAgo, timeUntil, formatDuration, STATUS_STYLES, intervalToCron } from './cron-utils';

function RunHistory({ runs }: { runs: TaskRun[] }) {
  if (runs.length === 0) {
    return <div className="text-[11px] py-2" style={{ color: 'var(--bb-text-faint)' }}>No runs yet</div>;
  }

  return (
    <div className="space-y-1">
      {runs.map((run) => {
        const s = STATUS_STYLES[run.status] ?? STATUS_STYLES.ok;
        return (
          <div key={run.id} className="flex items-center gap-2 text-[11px] py-0.5">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: s.dot }}
              title={s.label}
            />
            <span style={{ color: 'var(--bb-text-muted)' }}>{timeAgo(run.started_at)}</span>
            <span className="font-mono" style={{ color: 'var(--bb-text-faint)' }}>
              {formatDuration(run.duration_ms)}
            </span>
            {run.manual === 1 && (
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}
              >
                manual
              </span>
            )}
            {run.error && (
              <span
                className="truncate"
                style={{ color: 'var(--bb-danger, #ef4444)', maxWidth: 200 }}
                title={run.error}
              >
                {run.error}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TaskItem({ task }: { task: ScheduledTask }) {
  const { updateTask, deleteTask, runTask, fetchRuns, runs } = useSchedulerStore();
  const agentMode = useAppStore((s) => s.agentMode);
  const isPaused = agentMode === 'ask' || agentMode === 'stop';
  const [running, setRunning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  async function handleRun() {
    setRunning(true);
    await runTask(task.id);
    setRunning(false);
    if (showHistory) fetchRuns(task.id);
  }

  function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next) fetchRuns(task.id);
  }

  const taskRuns = runs[task.id] ?? [];

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
            onClick={toggleHistory}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            style={{ color: showHistory ? 'var(--bb-accent)' : 'var(--bb-text-muted)' }}
            onMouseEnter={(e) => { if (!showHistory) { e.currentTarget.style.color = 'var(--bb-accent)'; e.currentTarget.style.background = 'var(--bb-bg-card-hover)'; } }}
            onMouseLeave={(e) => { if (!showHistory) { e.currentTarget.style.color = 'var(--bb-text-muted)'; e.currentTarget.style.background = 'transparent'; } }}
            title="Run history"
          >
            <History size={13} />
          </button>
          <button
            onClick={handleRun}
            disabled={running || isPaused}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors disabled:opacity-50"
            style={{ color: 'var(--bb-text-muted)' }}
            onMouseEnter={(e) => { if (!isPaused) { e.currentTarget.style.color = 'var(--bb-ok)'; e.currentTarget.style.background = 'var(--bb-bg-card-hover)'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bb-text-muted)'; e.currentTarget.style.background = 'transparent'; }}
            title={isPaused ? 'Bot is paused' : 'Run now'}
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

      {showHistory && (
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--bb-border)' }}>
          <RunHistory runs={taskRuns} />
        </div>
      )}
    </div>
  );
}

type ScheduleMode = 'every' | 'cron';

export function TaskList() {
  const { tasks, createTask } = useSchedulerStore();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('every');
  const [everyAmount, setEveryAmount] = useState('1');
  const [everyUnit, setEveryUnit] = useState<'minutes' | 'hours' | 'days'>('hours');
  const [cron, setCron] = useState('0 * * * *');
  const [taskType, setTaskType] = useState<'agent_turn' | 'system_check'>('agent_turn');
  const [prompt, setPrompt] = useState('');

  function getCronExpr(): string {
    if (scheduleMode === 'every') {
      return intervalToCron(parseInt(everyAmount, 10) || 1, everyUnit);
    }
    return cron.trim();
  }

  async function handleCreate() {
    const cronExpr = getCronExpr();
    if (!name.trim() || !cronExpr) return;
    await createTask({
      name: name.trim(),
      cron_expr: cronExpr,
      task_type: taskType,
      task_payload: taskType === 'agent_turn' ? JSON.stringify({ prompt: prompt.trim() || name.trim() }) : '{}',
    });
    setName('');
    setEveryAmount('1');
    setEveryUnit('hours');
    setCron('0 * * * *');
    setPrompt('');
    setShowForm(false);
  }

  const inputStyle = {
    background: 'var(--bb-bg)',
    border: '1px solid var(--bb-border)',
    color: 'var(--bb-text)',
  };

  const modeBtn = (mode: ScheduleMode, label: string) => (
    <button
      onClick={() => setScheduleMode(mode)}
      className="flex-1 text-[12px] py-1.5 rounded-md transition-colors"
      style={{
        background: scheduleMode === mode ? 'var(--bb-accent-subtle)' : 'transparent',
        color: scheduleMode === mode ? 'var(--bb-accent)' : 'var(--bb-text-muted)',
        border: `1px solid ${scheduleMode === mode ? 'rgba(59, 130, 246, 0.2)' : 'var(--bb-border)'}`,
      }}
    >
      {label}
    </button>
  );

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

          {/* Schedule mode */}
          <div>
            <div className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--bb-text-faint)' }}>Schedule</div>
            <div className="flex gap-1.5 mb-2">
              {modeBtn('every', 'Every...')}
              {modeBtn('cron', 'Cron Expression')}
            </div>
            {scheduleMode === 'every' ? (
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  value={everyAmount}
                  onChange={(e) => setEveryAmount(e.target.value)}
                  className="w-20 rounded-md px-3 py-2 text-[13px] font-mono outline-none"
                  style={inputStyle}
                />
                <select
                  value={everyUnit}
                  onChange={(e) => setEveryUnit(e.target.value as 'minutes' | 'hours' | 'days')}
                  className="flex-1 rounded-md px-3 py-2 text-[13px] outline-none"
                  style={inputStyle}
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
            ) : (
              <input
                type="text"
                placeholder="0 * * * *"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                className="w-full rounded-md px-3 py-2 text-[13px] font-mono outline-none"
                style={inputStyle}
              />
            )}
            <div className="text-[10px] mt-1 font-mono" style={{ color: 'var(--bb-text-faint)' }}>
              {getCronExpr()}
            </div>
          </div>

          {/* Task type */}
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
            disabled={!name.trim()}
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
