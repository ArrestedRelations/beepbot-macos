import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';

export type TaskStatus = 'running' | 'completed' | 'failed' | 'killed';

export interface BackgroundTask {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  status: TaskStatus;
  pid?: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string | null;
  label?: string;
}

type BroadcastFn = (data: Record<string, unknown>) => void;

const MAX_OUTPUT_BYTES = 512_000; // 512 KB per stream

/**
 * Manages background shell processes — spawn, track, poll, kill.
 * Streams progress updates via WebSocket broadcast.
 */
export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();
  private processes = new Map<string, ChildProcess>();
  private onBroadcast: BroadcastFn | null = null;

  setBroadcast(fn: BroadcastFn): void {
    this.onBroadcast = fn;
  }

  /** Spawn a background shell command and track it */
  spawn(params: {
    command: string;
    args?: string[];
    cwd?: string;
    label?: string;
  }): BackgroundTask {
    const id = randomUUID();
    const args = params.args ?? [];
    const cwd = params.cwd ?? process.cwd();

    const task: BackgroundTask = {
      id,
      command: params.command,
      args,
      cwd,
      status: 'running',
      exitCode: null,
      stdout: '',
      stderr: '',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      label: params.label,
    };

    this.tasks.set(id, task);

    const child = spawn(params.command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      // Don't use shell to avoid injection
    });

    task.pid = child.pid;
    this.processes.set(id, child);

    this.onBroadcast?.({
      type: 'background_task',
      data: { event: 'started', taskId: id, label: task.label, pid: child.pid },
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (task.stdout.length < MAX_OUTPUT_BYTES) {
        task.stdout += text;
      }
      this.onBroadcast?.({
        type: 'background_task',
        data: { event: 'stdout', taskId: id, text },
      });
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (task.stderr.length < MAX_OUTPUT_BYTES) {
        task.stderr += text;
      }
      this.onBroadcast?.({
        type: 'background_task',
        data: { event: 'stderr', taskId: id, text },
      });
    });

    child.on('close', (code, signal) => {
      task.exitCode = code;
      task.finishedAt = new Date().toISOString();
      task.status = code === 0 ? 'completed' : 'failed';
      this.processes.delete(id);

      this.onBroadcast?.({
        type: 'background_task',
        data: {
          event: 'finished',
          taskId: id,
          label: task.label,
          status: task.status,
          exitCode: code,
          signal,
        },
      });
    });

    child.on('error', (err) => {
      task.status = 'failed';
      task.finishedAt = new Date().toISOString();
      task.stderr += `\nProcess error: ${err.message}`;
      this.processes.delete(id);

      this.onBroadcast?.({
        type: 'background_task',
        data: { event: 'error', taskId: id, error: err.message },
      });
    });

    return task;
  }

  /** Get a task by ID */
  get(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  /** List all tasks (optionally filter by status) */
  list(status?: TaskStatus): BackgroundTask[] {
    const all = Array.from(this.tasks.values());
    if (status) return all.filter(t => t.status === status);
    return all;
  }

  /** Get just the output tail of a task */
  getOutput(id: string, tailLines?: number): { stdout: string; stderr: string } | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    if (!tailLines) return { stdout: task.stdout, stderr: task.stderr };
    const tailStr = (s: string, n: number) => s.split('\n').slice(-n).join('\n');
    return { stdout: tailStr(task.stdout, tailLines), stderr: tailStr(task.stderr, tailLines) };
  }

  /** Kill a running task */
  kill(id: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const child = this.processes.get(id);
    const task = this.tasks.get(id);
    if (!child || !task) return false;
    task.status = 'killed';
    child.kill(signal);
    return true;
  }

  /** Remove a finished task from tracking */
  remove(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status === 'running') return false;
    this.tasks.delete(id);
    return true;
  }

  /** Kill all running tasks */
  killAll(): void {
    for (const [id] of this.processes) {
      this.kill(id);
    }
  }

  /** Summary stats for dashboard */
  stats(): { running: number; completed: number; failed: number; killed: number; total: number } {
    let running = 0, completed = 0, failed = 0, killed = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'running') running++;
      else if (task.status === 'completed') completed++;
      else if (task.status === 'failed') failed++;
      else if (task.status === 'killed') killed++;
    }
    return { running, completed, failed, killed, total: this.tasks.size };
  }
}
