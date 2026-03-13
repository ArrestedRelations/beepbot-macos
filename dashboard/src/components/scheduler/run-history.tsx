import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, Search, ArrowDownAZ, ArrowUpAZ } from 'lucide-react';
import { useSchedulerStore } from '../../stores/scheduler-store';
import { timeAgo, formatDuration, STATUS_STYLES } from './cron-utils';

type StatusFilter = 'all' | 'ok' | 'error' | 'skipped';

export function RunHistoryPanel() {
  const { tasks, allRuns, allRunsLoading, fetchAllRuns, fetchTasks } = useSchedulerStore();
  const [taskFilter, setTaskFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [sortNewest, setSortNewest] = useState(true);

  useEffect(() => {
    fetchTasks();
    fetchAllRuns();
  }, [fetchTasks, fetchAllRuns]);

  function refresh() {
    const params: { taskId?: string; status?: string } = {};
    if (taskFilter) params.taskId = taskFilter;
    if (statusFilter !== 'all') params.status = statusFilter;
    fetchAllRuns(params);
  }

  // Re-fetch when filters change
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskFilter, statusFilter]);

  const filtered = useMemo(() => {
    let runs = allRuns;
    if (search.trim()) {
      const q = search.toLowerCase();
      runs = runs.filter(
        (r) =>
          (r.task_name && r.task_name.toLowerCase().includes(q)) ||
          (r.error && r.error.toLowerCase().includes(q))
      );
    }
    if (!sortNewest) {
      runs = [...runs].reverse();
    }
    return runs;
  }, [allRuns, search, sortNewest]);

  const inputStyle = {
    background: 'var(--bb-bg)',
    border: '1px solid var(--bb-border)',
    color: 'var(--bb-text)',
  };

  const chipBtn = (value: StatusFilter, label: string) => {
    const active = statusFilter === value;
    return (
      <button
        onClick={() => setStatusFilter(value)}
        className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap"
        style={{
          background: active ? 'var(--bb-accent)' : 'var(--bb-bg-accent, var(--bb-bg-elevated))',
          color: active ? '#fff' : 'var(--bb-text-muted)',
          border: active ? 'none' : '1px solid var(--bb-border)',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="bb-card">
      {/* Filter bar */}
      <div className="space-y-2.5 mb-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--bb-text-faint)' }} />
            <input
              type="text"
              placeholder="Search runs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md pl-7 pr-3 py-1.5 text-[12px] outline-none"
              style={inputStyle}
            />
          </div>
          <button
            onClick={refresh}
            disabled={allRunsLoading}
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors"
            style={{ color: 'var(--bb-text-muted)', border: '1px solid var(--bb-border)' }}
            title="Refresh"
          >
            <RefreshCw size={12} className={allRunsLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setSortNewest(!sortNewest)}
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors"
            style={{ color: 'var(--bb-text-muted)', border: '1px solid var(--bb-border)' }}
            title={sortNewest ? 'Newest first' : 'Oldest first'}
          >
            {sortNewest ? <ArrowDownAZ size={12} /> : <ArrowUpAZ size={12} />}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={taskFilter}
            onChange={(e) => setTaskFilter(e.target.value)}
            className="rounded-md px-2.5 py-1.5 text-[12px] outline-none"
            style={inputStyle}
          >
            <option value="">All Jobs</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            {chipBtn('all', 'All')}
            {chipBtn('ok', 'OK')}
            {chipBtn('error', 'Error')}
            {chipBtn('skipped', 'Skipped')}
          </div>
        </div>
      </div>

      {/* Results count */}
      <div className="text-[10px] mb-2" style={{ color: 'var(--bb-text-faint)' }}>
        {filtered.length} run{filtered.length !== 1 ? 's' : ''}
      </div>

      {/* Run list */}
      {allRunsLoading && filtered.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <RefreshCw size={16} className="animate-spin" style={{ color: 'var(--bb-text-faint)' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bb-empty">No runs found</div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((run) => {
            const s = STATUS_STYLES[run.status] ?? STATUS_STYLES.ok;
            return (
              <div
                key={run.id}
                className="flex items-center justify-between rounded-lg px-3 py-2.5"
                style={{ background: 'var(--bb-bg-elevated)', border: '1px solid var(--bb-border)' }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: s.dot }}
                    title={s.label}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium truncate" style={{ color: 'var(--bb-text)' }}>
                        {run.task_name || 'Deleted task'}
                      </span>
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
                        style={{
                          background: run.status === 'ok' ? 'rgba(34, 197, 94, 0.1)' : run.status === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(156, 163, 175, 0.1)',
                          color: s.dot,
                        }}
                      >
                        {s.label}
                      </span>
                      {run.manual === 1 && (
                        <span
                          className="text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}
                        >
                          manual
                        </span>
                      )}
                    </div>
                    {run.error && (
                      <div
                        className="text-[10px] mt-0.5 truncate"
                        style={{ color: 'var(--bb-danger, #ef4444)', maxWidth: 400 }}
                        title={run.error}
                      >
                        {run.error}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-[11px]" style={{ color: 'var(--bb-text-faint)' }}>
                  <span className="font-mono">{formatDuration(run.duration_ms)}</span>
                  <span>{timeAgo(run.started_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
