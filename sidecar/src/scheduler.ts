import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface ScheduledTask {
  id: string;
  name: string;
  cron_expr: string;
  task_type: 'agent_turn' | 'system_check';
  task_payload: string;
  enabled: number;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
}

export type TaskExecutor = (task: ScheduledTask) => Promise<void>;

/** Minimal cron expression parser supporting: minute hour day month weekday */
function parseCron(expr: string): { minute: number[]; hour: number[]; day: number[]; month: number[]; weekday: number[] } {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron: ${expr}`);

  function parseField(field: string, min: number, max: number): number[] {
    if (field === '*') return Array.from({ length: max - min + 1 }, (_, i) => min + i);

    const values = new Set<number>();
    for (const part of field.split(',')) {
      const stepMatch = part.match(/^(.+)\/(\d+)$/);
      if (stepMatch) {
        const [, range, stepStr] = stepMatch;
        const step = parseInt(stepStr, 10);
        const rangeValues = range === '*'
          ? Array.from({ length: max - min + 1 }, (_, i) => min + i)
          : parseRange(range, min, max);
        const start = rangeValues[0];
        for (let i = start; i <= max; i += step) values.add(i);
      } else {
        for (const v of parseRange(part, min, max)) values.add(v);
      }
    }
    return [...values].sort((a, b) => a - b);
  }

  function parseRange(s: string, min: number, max: number): number[] {
    const rangeMatch = s.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter(v => v >= min && v <= max);
    }
    const val = parseInt(s, 10);
    if (isNaN(val) || val < min || val > max) throw new Error(`Invalid cron value: ${s}`);
    return [val];
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    day: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    weekday: parseField(parts[4], 0, 6),
  };
}

/** Get the next run time after `after` for a cron expression */
export function getNextRun(cronExpr: string, after: Date = new Date()): Date {
  const cron = parseCron(cronExpr);
  const d = new Date(after.getTime() + 60_000); // start from next minute
  d.setSeconds(0, 0);

  // Search up to 1 year ahead
  const limit = new Date(d.getTime() + 366 * 24 * 60 * 60_000);

  while (d < limit) {
    if (
      cron.month.includes(d.getMonth() + 1) &&
      cron.day.includes(d.getDate()) &&
      cron.weekday.includes(d.getDay()) &&
      cron.hour.includes(d.getHours()) &&
      cron.minute.includes(d.getMinutes())
    ) {
      return d;
    }
    d.setMinutes(d.getMinutes() + 1);
  }

  return limit;
}

export class Scheduler {
  private db: Database.Database;
  private timer: ReturnType<typeof setInterval> | null = null;
  private executor: TaskExecutor | null = null;
  private onBroadcast: ((data: Record<string, unknown>) => void) | null = null;

  constructor(db: Database.Database) {
    this.db = db;
  }

  setExecutor(executor: TaskExecutor): void {
    this.executor = executor;
  }

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.onBroadcast = fn;
  }

  start(): void {
    if (this.timer) return;
    console.log('[scheduler] Started (checking every 30s)');
    this.timer = setInterval(() => void this.tick(), 30_000);
    // Run first check immediately
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[scheduler] Stopped');
    }
  }

  private async tick(): Promise<void> {
    const now = new Date().toISOString();
    const dueTasks = this.db.prepare(
      `SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?`
    ).all(now) as ScheduledTask[];

    for (const task of dueTasks) {
      console.log(`[scheduler] Running task: ${task.name} (${task.task_type})`);
      this.onBroadcast?.({ type: 'scheduler_event', data: { event: 'task_started', taskId: task.id, name: task.name } });

      try {
        if (this.executor) {
          await this.executor(task);
        }

        const nextRun = getNextRun(task.cron_expr, new Date());
        this.db.prepare(
          `UPDATE scheduled_tasks SET last_run = datetime('now'), next_run = ? WHERE id = ?`
        ).run(nextRun.toISOString(), task.id);

        this.onBroadcast?.({ type: 'scheduler_event', data: { event: 'task_completed', taskId: task.id, name: task.name } });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler] Task ${task.name} failed:`, errMsg);
        this.onBroadcast?.({ type: 'scheduler_event', data: { event: 'task_failed', taskId: task.id, name: task.name, error: errMsg } });

        // Still update next_run so it doesn't repeatedly fail
        const nextRun = getNextRun(task.cron_expr, new Date());
        this.db.prepare(
          `UPDATE scheduled_tasks SET last_run = datetime('now'), next_run = ? WHERE id = ?`
        ).run(nextRun.toISOString(), task.id);
      }
    }
  }

  // CRUD operations

  list(): ScheduledTask[] {
    return this.db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all() as ScheduledTask[];
  }

  get(id: string): ScheduledTask | undefined {
    return this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTask | undefined;
  }

  create(data: { name: string; cron_expr: string; task_type: 'agent_turn' | 'system_check'; task_payload?: string; enabled?: boolean }): ScheduledTask {
    const id = randomUUID();
    const nextRun = getNextRun(data.cron_expr, new Date());
    const enabled = data.enabled !== false ? 1 : 0;

    this.db.prepare(
      `INSERT INTO scheduled_tasks (id, name, cron_expr, task_type, task_payload, enabled, next_run)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, data.name, data.cron_expr, data.task_type, data.task_payload || '{}', enabled, nextRun.toISOString());

    return this.get(id)!;
  }

  update(id: string, data: { name?: string; cron_expr?: string; task_type?: string; task_payload?: string; enabled?: boolean }): ScheduledTask | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    if (data.name !== undefined) {
      this.db.prepare('UPDATE scheduled_tasks SET name = ? WHERE id = ?').run(data.name, id);
    }
    if (data.cron_expr !== undefined) {
      const nextRun = getNextRun(data.cron_expr, new Date());
      this.db.prepare('UPDATE scheduled_tasks SET cron_expr = ?, next_run = ? WHERE id = ?').run(data.cron_expr, nextRun.toISOString(), id);
    }
    if (data.task_type !== undefined) {
      this.db.prepare('UPDATE scheduled_tasks SET task_type = ? WHERE id = ?').run(data.task_type, id);
    }
    if (data.task_payload !== undefined) {
      this.db.prepare('UPDATE scheduled_tasks SET task_payload = ? WHERE id = ?').run(data.task_payload, id);
    }
    if (data.enabled !== undefined) {
      this.db.prepare('UPDATE scheduled_tasks SET enabled = ? WHERE id = ?').run(data.enabled ? 1 : 0, id);
      if (data.enabled) {
        const cronExpr = data.cron_expr || existing.cron_expr;
        const nextRun = getNextRun(cronExpr, new Date());
        this.db.prepare('UPDATE scheduled_tasks SET next_run = ? WHERE id = ?').run(nextRun.toISOString(), id);
      }
    }

    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async runNow(id: string): Promise<void> {
    const task = this.get(id);
    if (!task) throw new Error('Task not found');
    if (!this.executor) throw new Error('No executor configured');

    this.onBroadcast?.({ type: 'scheduler_event', data: { event: 'task_started', taskId: task.id, name: task.name, manual: true } });

    try {
      await this.executor(task);
      this.db.prepare(`UPDATE scheduled_tasks SET last_run = datetime('now') WHERE id = ?`).run(id);
      this.onBroadcast?.({ type: 'scheduler_event', data: { event: 'task_completed', taskId: task.id, name: task.name, manual: true } });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.onBroadcast?.({ type: 'scheduler_event', data: { event: 'task_failed', taskId: task.id, name: task.name, error: errMsg, manual: true } });
      throw err;
    }
  }
}
