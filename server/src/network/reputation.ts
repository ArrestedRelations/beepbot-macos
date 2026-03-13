import type { PeerStore } from './peer-store.js';

export interface ReputationChange {
  peerId: string;
  oldRep: number;
  newRep: number;
  delta: number;
  reason: string;
  timestamp: string;
}

export const REP_INITIAL = 100;
export const REP_MIN_PARTICIPATE = 10;
export const REP_MAX = 1000;

export const REP_TASK_COMPLETE = +5;
export const REP_VERIFY_SUCCESS = +2;
export const REP_VERIFY_FAIL = -20;
export const REP_UNGRACEFUL_DISCONNECT = -10;
export const REP_GRACEFUL_DISCONNECT = 0;
export const REP_PING_RESPONSE = +1;
export const REP_ANCHOR_MATCH = +3;
export const REP_ANCHOR_MISMATCH = -30;

export class ReputationManager {
  private broadcast: ((data: Record<string, unknown>) => void) | null = null;

  constructor(private peerStore: PeerStore) {}

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcast = fn;
  }

  taskCompleted(peerId: string): ReputationChange | null {
    return this.adjust(peerId, REP_TASK_COMPLETE, 'Completed a verified task');
  }

  verifySuccess(peerId: string): ReputationChange | null {
    return this.adjust(peerId, REP_VERIFY_SUCCESS, 'Passed chain verification');
  }

  verifyFailed(peerId: string): ReputationChange | null {
    return this.adjust(peerId, REP_VERIFY_FAIL, 'Failed chain verification — potential tampering');
  }

  ungracefulDisconnect(peerId: string): ReputationChange | null {
    return this.adjust(peerId, REP_UNGRACEFUL_DISCONNECT, 'Ungraceful disconnect (missed pings)');
  }

  anchorMatch(peerId: string): ReputationChange | null {
    return this.adjust(peerId, REP_ANCHOR_MATCH, 'Merkle anchor verified successfully');
  }

  anchorMismatch(peerId: string): ReputationChange | null {
    return this.adjust(peerId, REP_ANCHOR_MISMATCH, 'Merkle anchor mismatch — possible ledger tampering');
  }

  pingResponse(peerId: string): ReputationChange | null {
    const peer = this.peerStore.get(peerId);
    if (!peer) return null;
    if (peer.reputation >= 200) return null;
    return this.adjust(peerId, REP_PING_RESPONSE, 'Responsive peer');
  }

  canParticipate(peerId: string): boolean {
    const peer = this.peerStore.get(peerId);
    if (!peer) return false;
    return peer.reputation >= REP_MIN_PARTICIPATE;
  }

  getReputation(peerId: string): number | null {
    return this.peerStore.get(peerId)?.reputation ?? null;
  }

  getLeaderboard(): Array<{ botId: string; shortId: string; reputation: number }> {
    return this.peerStore.list().map(p => ({
      botId: p.botId,
      shortId: p.shortId,
      reputation: p.reputation,
    })).sort((a, b) => b.reputation - a.reputation);
  }

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
