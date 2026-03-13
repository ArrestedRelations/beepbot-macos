import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { sign, verify } from '../identity.js';

export interface NetworkTask {
  id: string;
  description: string;
  requesterBotId: string;
  claimerBotId: string | null;
  status: 'pending' | 'claimed' | 'completed' | 'failed' | 'verified';
  result: string | null;
  resultSignature: string | null;
  createdAt: string;
  completedAt: string | null;
}

export class TaskRelay {
  private broadcast: ((data: Record<string, unknown>) => void) | null = null;

  constructor(private db: Database.Database) {}

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcast = fn;
  }

  /** Create a new task for the network */
  createTask(description: string, requesterBotId: string): NetworkTask {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO network_tasks (id, description, requester_bot_id, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(id, description, requesterBotId, createdAt);

    const task: NetworkTask = {
      id,
      description,
      requesterBotId,
      claimerBotId: null,
      status: 'pending',
      result: null,
      resultSignature: null,
      createdAt,
      completedAt: null,
    };

    if (this.broadcast) {
      this.broadcast({ type: 'task_created', data: task });
    }

    return task;
  }

  /** Claim a pending task */
  claimTask(taskId: string, claimerBotId: string): NetworkTask | null {
    const task = this.get(taskId);
    if (!task || task.status !== 'pending') return null;

    this.db.prepare(`
      UPDATE network_tasks SET claimer_bot_id = ?, status = 'claimed' WHERE id = ?
    `).run(claimerBotId, taskId);

    task.claimerBotId = claimerBotId;
    task.status = 'claimed';

    if (this.broadcast) {
      this.broadcast({ type: 'task_claimed', data: task });
    }

    return task;
  }

  /** Submit a task result (signed by the claimer) */
  submitResult(taskId: string, result: string, claimerBotId: string): NetworkTask | null {
    const task = this.get(taskId);
    if (!task || task.status !== 'claimed' || task.claimerBotId !== claimerBotId) return null;

    // Sign the result
    const resultSignature = sign(`${taskId}:${result}`);
    const completedAt = new Date().toISOString();

    this.db.prepare(`
      UPDATE network_tasks SET result = ?, result_signature = ?, status = 'completed', completed_at = ?
      WHERE id = ?
    `).run(result, resultSignature, completedAt, taskId);

    task.result = result;
    task.resultSignature = resultSignature;
    task.status = 'completed';
    task.completedAt = completedAt;

    if (this.broadcast) {
      this.broadcast({ type: 'task_completed', data: task });
    }

    return task;
  }

  /** Verify a task result's signature */
  verifyResult(taskId: string, claimerPublicKey: string): boolean {
    const task = this.get(taskId);
    if (!task || !task.result || !task.resultSignature) return false;

    const dataToVerify = `${taskId}:${task.result}`;
    return verify(dataToVerify, task.resultSignature, claimerPublicKey);
  }

  /** Mark a task as verified (after signature check) */
  markVerified(taskId: string): NetworkTask | null {
    const task = this.get(taskId);
    if (!task || task.status !== 'completed') return null;

    this.db.prepare("UPDATE network_tasks SET status = 'verified' WHERE id = ?").run(taskId);
    task.status = 'verified';

    if (this.broadcast) {
      this.broadcast({ type: 'task_verified', data: task });
    }

    return task;
  }

  /** Mark a task as failed */
  failTask(taskId: string): void {
    this.db.prepare("UPDATE network_tasks SET status = 'failed' WHERE id = ?").run(taskId);
  }

  /** Get a task by ID */
  get(taskId: string): NetworkTask | null {
    const row = this.db.prepare('SELECT * FROM network_tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  /** List tasks with optional status filter */
  list(status?: NetworkTask['status']): NetworkTask[] {
    if (status) {
      return (this.db.prepare('SELECT * FROM network_tasks WHERE status = ? ORDER BY created_at DESC').all(status) as TaskRow[]).map(rowToTask);
    }
    return (this.db.prepare('SELECT * FROM network_tasks ORDER BY created_at DESC').all() as TaskRow[]).map(rowToTask);
  }

  /** Get stats */
  stats(): { total: number; pending: number; claimed: number; completed: number; verified: number; failed: number } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) as claimed,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM network_tasks
    `).get() as Record<string, number>;
    return {
      total: row.total || 0,
      pending: row.pending || 0,
      claimed: row.claimed || 0,
      completed: row.completed || 0,
      verified: row.verified || 0,
      failed: row.failed || 0,
    };
  }
}

interface TaskRow {
  id: string;
  description: string;
  requester_bot_id: string;
  claimer_bot_id: string | null;
  status: string;
  result: string | null;
  result_signature: string | null;
  created_at: string;
  completed_at: string | null;
}

function rowToTask(row: TaskRow): NetworkTask {
  return {
    id: row.id,
    description: row.description,
    requesterBotId: row.requester_bot_id,
    claimerBotId: row.claimer_bot_id,
    status: row.status as NetworkTask['status'],
    result: row.result,
    resultSignature: row.result_signature,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
