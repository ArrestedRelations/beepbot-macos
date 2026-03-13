import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { sign, verify } from '../identity.js';
import type { GossipRouter } from './gossip.js';
import type { PeerStore } from './peer-store.js';
import {
  createGossipEnvelope,
  verifyGossipEnvelope,
  TOPIC_TASKS,
  type GossipEnvelope,
  type TaskSubmitPayload,
  type TaskClaimPayload,
  type TaskResultPayload,
} from './protocols.js';

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

  constructor(
    private db: Database.Database,
    private gossip: GossipRouter | null,
    private peerStore: PeerStore,
  ) {}

  setGossip(gossip: GossipRouter): void {
    this.gossip = gossip;
  }

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcast = fn;
  }

  createTask(description: string, requesterBotId: string): NetworkTask {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO network_tasks (id, description, requester_bot_id, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(id, description, requesterBotId, createdAt);

    const task: NetworkTask = {
      id, description, requesterBotId,
      claimerBotId: null, status: 'pending',
      result: null, resultSignature: null,
      createdAt, completedAt: null,
    };

    if (this.broadcast) {
      this.broadcast({ type: 'task_created', data: task });
    }

    if (this.gossip) {
      const payload: TaskSubmitPayload = { id, description, requesterBotId };
      const envelope = createGossipEnvelope('TASK_SUBMIT', payload);
      this.gossip.publish(TOPIC_TASKS, envelope).catch(() => {});
    }

    return task;
  }

  claimTask(taskId: string, claimerBotId: string): NetworkTask | null {
    const task = this.get(taskId);
    if (!task || task.status !== 'pending') return null;

    this.db.prepare(
      "UPDATE network_tasks SET claimer_bot_id = ?, status = 'claimed' WHERE id = ?"
    ).run(claimerBotId, taskId);

    task.claimerBotId = claimerBotId;
    task.status = 'claimed';

    if (this.broadcast) {
      this.broadcast({ type: 'task_claimed', data: task });
    }

    if (this.gossip) {
      const payload: TaskClaimPayload = { taskId, claimerBotId };
      const envelope = createGossipEnvelope('TASK_CLAIM', payload);
      this.gossip.publish(TOPIC_TASKS, envelope).catch(() => {});
    }

    return task;
  }

  submitResult(taskId: string, result: string, claimerBotId: string): NetworkTask | null {
    const task = this.get(taskId);
    if (!task || task.status !== 'claimed' || task.claimerBotId !== claimerBotId) return null;

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

    if (this.gossip) {
      const payload: TaskResultPayload = { taskId, result, resultSignature };
      const envelope = createGossipEnvelope('TASK_RESULT', payload);
      this.gossip.publish(TOPIC_TASKS, envelope).catch(() => {});
    }

    return task;
  }

  verifyResult(taskId: string, claimerPublicKey: string): boolean {
    const task = this.get(taskId);
    if (!task || !task.result || !task.resultSignature) return false;
    return verify(`${taskId}:${task.result}`, task.resultSignature, claimerPublicKey);
  }

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

  failTask(taskId: string): void {
    this.db.prepare("UPDATE network_tasks SET status = 'failed' WHERE id = ?").run(taskId);
  }

  handleTaskGossip(envelope: GossipEnvelope): void {
    const peer = this.peerStore.get(envelope.senderId);
    if (peer && !verifyGossipEnvelope(envelope, peer.publicKey)) return;

    switch (envelope.type) {
      case 'TASK_SUBMIT': {
        const p = envelope.payload as TaskSubmitPayload;
        if (!this.get(p.id)) {
          this.db.prepare(`
            INSERT INTO network_tasks (id, description, requester_bot_id, status, created_at)
            VALUES (?, ?, ?, 'pending', datetime('now'))
          `).run(p.id, p.description, p.requesterBotId);
          if (this.broadcast) {
            this.broadcast({ type: 'task_received', data: p });
          }
        }
        break;
      }
      case 'TASK_CLAIM': {
        const p = envelope.payload as TaskClaimPayload;
        this.claimTask(p.taskId, p.claimerBotId);
        break;
      }
      case 'TASK_RESULT': {
        const p = envelope.payload as TaskResultPayload;
        const task = this.get(p.taskId);
        if (task && task.claimerBotId && peer) {
          if (this.verifyResult(p.taskId, peer.publicKey)) {
            this.markVerified(p.taskId);
          }
        }
        break;
      }
    }
  }

  get(taskId: string): NetworkTask | null {
    const row = this.db.prepare('SELECT * FROM network_tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  list(status?: NetworkTask['status']): NetworkTask[] {
    if (status) {
      return (this.db.prepare('SELECT * FROM network_tasks WHERE status = ? ORDER BY created_at DESC').all(status) as TaskRow[]).map(rowToTask);
    }
    return (this.db.prepare('SELECT * FROM network_tasks ORDER BY created_at DESC').all() as TaskRow[]).map(rowToTask);
  }

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
      total: row.total || 0, pending: row.pending || 0,
      claimed: row.claimed || 0, completed: row.completed || 0,
      verified: row.verified || 0, failed: row.failed || 0,
    };
  }
}

interface TaskRow {
  id: string; description: string; requester_bot_id: string;
  claimer_bot_id: string | null; status: string; result: string | null;
  result_signature: string | null; created_at: string; completed_at: string | null;
}

function rowToTask(row: TaskRow): NetworkTask {
  return {
    id: row.id, description: row.description,
    requesterBotId: row.requester_bot_id,
    claimerBotId: row.claimer_bot_id,
    status: row.status as NetworkTask['status'],
    result: row.result, resultSignature: row.result_signature,
    createdAt: row.created_at, completedAt: row.completed_at,
  };
}
