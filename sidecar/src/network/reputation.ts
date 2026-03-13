import type { PeerStore } from './peer.js';

export interface ReputationChange {
  peerId: string;
  oldRep: number;
  newRep: number;
  delta: number;
  reason: string;
  timestamp: string;
}

// Reputation constants
export const REP_INITIAL = 100;
export const REP_MIN_PARTICIPATE = 10;
export const REP_MAX = 1000;

// Reputation deltas
export const REP_TASK_COMPLETE = +5;
export const REP_VERIFY_SUCCESS = +2;
export const REP_VERIFY_FAIL = -20;
export const REP_UNGRACEFUL_DISCONNECT = -10;
export const REP_GRACEFUL_DISCONNECT = 0;
export const REP_PING_RESPONSE = +1;

export class ReputationManager {
  private broadcast: ((data: Record<string, unknown>) => void) | null = null;

  constructor(private peerStore: PeerStore) {}

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcast = fn;
  }

  /** Award reputation for completing a verified task */
  taskCompleted(peerId: string): ReputationChange | null {
    return this.adjust(peerId, REP_TASK_COMPLETE, 'Completed a verified task');
  }

  /** Award reputation for successful peer verification */
  verifySuccess(peerId: string): ReputationChange | null {
    return this.adjust(peerId, REP_VERIFY_SUCCESS, 'Passed chain verification');
  }

  /** Slash reputation for failed verification (potential tampering) */
  verifyFailed(peerId: string): ReputationChange | null {
    return this.adjust(peerId, REP_VERIFY_FAIL, 'Failed chain verification — potential tampering');
  }

  /** Slash reputation for ungraceful disconnect */
  ungracefulDisconnect(peerId: string): ReputationChange | null {
    return this.adjust(peerId, REP_UNGRACEFUL_DISCONNECT, 'Ungraceful disconnect (missed pings)');
  }

  /** Small reward for being responsive */
  pingResponse(peerId: string): ReputationChange | null {
    // Only award occasionally to prevent farming
    const peer = this.peerStore.get(peerId);
    if (!peer) return null;
    // Only award if reputation is below 200 (to prevent inflation)
    if (peer.reputation >= 200) return null;
    return this.adjust(peerId, REP_PING_RESPONSE, 'Responsive peer');
  }

  /** Check if a peer can participate (has enough reputation) */
  canParticipate(peerId: string): boolean {
    const peer = this.peerStore.get(peerId);
    if (!peer) return false;
    return peer.reputation >= REP_MIN_PARTICIPATE;
  }

  /** Get reputation for a peer */
  getReputation(peerId: string): number | null {
    const peer = this.peerStore.get(peerId);
    return peer?.reputation ?? null;
  }

  /** Get all peer reputations sorted by score */
  getLeaderboard(): Array<{ botId: string; shortId: string; reputation: number }> {
    return this.peerStore.list().map(p => ({
      botId: p.botId,
      shortId: p.shortId,
      reputation: p.reputation,
    })).sort((a, b) => b.reputation - a.reputation);
  }

  /** Generic reputation adjustment */
  private adjust(peerId: string, delta: number, reason: string): ReputationChange | null {
    const result = this.peerStore.updateReputation(peerId, delta, reason);
    if (!result) return null;

    const change: ReputationChange = {
      peerId,
      oldRep: result.oldRep,
      newRep: result.newRep,
      delta,
      reason,
      timestamp: new Date().toISOString(),
    };

    if (this.broadcast) {
      this.broadcast({ type: 'reputation_change', data: change });
    }

    return change;
  }
}
