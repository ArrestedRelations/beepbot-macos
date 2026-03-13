import { createHash, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getIdentity, sign, verify } from '../identity.js';
import type { GossipRouter } from './gossip.js';
import type { PeerStore } from './peer-store.js';
import type { DistributedLedger, LedgerAction } from './ledger.js';
import {
  createGossipEnvelope,
  verifyGossipEnvelope,
  TOPIC_ECONOMY,
  type GossipEnvelope,
  type RewardClaimPayload,
  type RewardAckPayload,
  type TokenTransferPayload,
  type EpochBoundaryPayload,
} from './protocols.js';

// === Constants ===
const EPOCH_SIZE = 10_000;                // proofs per epoch
const INITIAL_INFLATION_RATE = 0.05;      // 5%
const INFLATION_DECAY = 0.005;            // -0.5% per epoch
const INFLATION_FLOOR = 0.01;             // 1% minimum
const QUORUM_MIN = 3;                     // minimum votes for quorum
const QUORUM_TIMEOUT_MS = 5 * 60 * 1000;  // 5 minutes
const REP_MIN_VOTE = 10;                  // minimum reputation to vote

// Reward amounts
const REWARD_HILL_SERVICE = 1.0;
const REWARD_IMPROVEMENT_REVIEW = 0.5;

// Proof type weights for inflation distribution
const PROOF_WEIGHT_HILL_SERVICE = 1.0;
const PROOF_WEIGHT_REVIEW = 1.5;

export interface TokenBalance {
  botId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  lastUpdated: string;
}

interface PendingClaim {
  claimId: string;
  botId: string;
  proofEventId: string;
  proofType: 'PROOF_HILL_SERVICE' | 'PROOF_IMPROVEMENT_REVIEW';
  amount: number;
  votes: Map<string, { approved: boolean; weight: number }>;
  createdAt: number;
  timeout: ReturnType<typeof setTimeout>;
}

export class Economy {
  private pendingClaims = new Map<string, PendingClaim>();
  private broadcast: ((data: Record<string, unknown>) => void) | null = null;

  constructor(
    private db: Database.Database,
    private gossip: GossipRouter | null,
    private ledger: DistributedLedger,
    private peerStore: PeerStore,
  ) {}

  setGossip(gossip: GossipRouter): void {
    this.gossip = gossip;
  }

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcast = fn;
  }

  // === Balance Operations ===

  /** Get a bot's token balance (from materialized cache) */
  getBalance(botId: string): TokenBalance {
    const row = this.db.prepare(
      'SELECT * FROM token_balances WHERE bot_id = ?'
    ).get(botId) as { bot_id: string; balance: number; total_earned: number; total_spent: number; last_updated: string } | undefined;

    if (row) {
      return {
        botId: row.bot_id,
        balance: row.balance,
        totalEarned: row.total_earned,
        totalSpent: row.total_spent,
        lastUpdated: row.last_updated,
      };
    }

    return { botId, balance: 0, totalEarned: 0, totalSpent: 0, lastUpdated: new Date().toISOString() };
  }

  /** Credit tokens to a bot */
  private credit(botId: string, amount: number): void {
    this.db.prepare(`
      INSERT INTO token_balances (bot_id, balance, total_earned, total_spent, last_updated)
      VALUES (?, ?, ?, 0, datetime('now'))
      ON CONFLICT(bot_id) DO UPDATE SET
        balance = balance + ?,
        total_earned = total_earned + ?,
        last_updated = datetime('now')
    `).run(botId, amount, amount, amount, amount);
  }

  /** Debit tokens from a bot (returns false if insufficient balance) */
  private debit(botId: string, amount: number): boolean {
    const balance = this.getBalance(botId);
    if (balance.balance < amount) return false;

    this.db.prepare(`
      UPDATE token_balances SET
        balance = balance - ?,
        total_spent = total_spent + ?,
        last_updated = datetime('now')
      WHERE bot_id = ?
    `).run(amount, amount, botId);
    return true;
  }

  // === Reward Claims ===

  /** Claim a reward for validated work */
  claimReward(proofEventId: string, proofType: 'PROOF_HILL_SERVICE' | 'PROOF_IMPROVEMENT_REVIEW'): string | null {
    const identity = getIdentity();
    const amount = proofType === 'PROOF_HILL_SERVICE' ? REWARD_HILL_SERVICE : REWARD_IMPROVEMENT_REVIEW;

    const claimId = randomUUID();
    const payload: RewardClaimPayload = {
      claimId,
      botId: identity.botId,
      proofEventId,
      proofType,
      amount,
      timestamp: Date.now(),
    };

    // If we have no connected peers, self-mint (solo mode)
    const connectedPeers = this.peerStore.list().filter(p => p.reputation >= REP_MIN_VOTE);
    if (connectedPeers.length === 0) {
      this.mintReward(identity.botId, amount, proofEventId);
      return claimId;
    }

    // Create pending claim with timeout
    const timeout = setTimeout(() => {
      this.resolveClaim(claimId);
    }, QUORUM_TIMEOUT_MS);

    this.pendingClaims.set(claimId, {
      claimId,
      botId: identity.botId,
      proofEventId,
      proofType,
      amount,
      votes: new Map(),
      createdAt: Date.now(),
      timeout,
    });

    // Broadcast claim
    if (this.gossip) {
      const envelope = createGossipEnvelope('REWARD_CLAIM', payload);
      this.gossip.publish(TOPIC_ECONOMY, envelope).catch(() => {});
    }

    return claimId;
  }

  /** Handle incoming reward claim from another bot */
  handleRewardClaim(envelope: GossipEnvelope<RewardClaimPayload>): void {
    const payload = envelope.payload;
    const identity = getIdentity();
    if (payload.botId === identity.botId) return;

    // Verify envelope
    const peer = this.peerStore.get(envelope.senderId);
    if (peer && !verifyGossipEnvelope(envelope, peer.publicKey)) return;

    // Check our reputation is high enough to vote
    const myRep = 200; // Local bot always has full weight
    if (myRep < REP_MIN_VOTE) return;

    // Verify the proof exists in our ledger copy
    const proofExists = this.db.prepare(
      'SELECT id FROM ledger_events WHERE event_id = ?'
    ).get(payload.proofEventId);

    const approved = !!proofExists;
    const weight = Math.min(1.0, myRep / 200);

    const ackPayload: RewardAckPayload = {
      claimId: payload.claimId,
      voterBotId: identity.botId,
      approved,
      weight,
      timestamp: Date.now(),
    };

    if (this.gossip) {
      const ackEnvelope = createGossipEnvelope('REWARD_ACK', ackPayload);
      this.gossip.publish(TOPIC_ECONOMY, ackEnvelope).catch(() => {});
    }
  }

  /** Handle incoming reward acknowledgment */
  handleRewardAck(envelope: GossipEnvelope<RewardAckPayload>): void {
    const payload = envelope.payload;
    const claim = this.pendingClaims.get(payload.claimId);
    if (!claim) return;

    // Verify envelope
    const peer = this.peerStore.get(envelope.senderId);
    if (peer && !verifyGossipEnvelope(envelope, peer.publicKey)) return;

    // Check voter reputation
    const voterPeer = this.peerStore.get(payload.voterBotId);
    if (voterPeer && voterPeer.reputation < REP_MIN_VOTE) return;

    claim.votes.set(payload.voterBotId, { approved: payload.approved, weight: payload.weight });

    // Check if quorum reached
    const requiredVotes = Math.max(QUORUM_MIN, Math.ceil(this.peerStore.list().length * 0.51));
    if (claim.votes.size >= requiredVotes) {
      this.resolveClaim(payload.claimId);
    }
  }

  /** Resolve a pending claim (called on quorum or timeout) */
  private resolveClaim(claimId: string): void {
    const claim = this.pendingClaims.get(claimId);
    if (!claim) return;

    clearTimeout(claim.timeout);
    this.pendingClaims.delete(claimId);

    // Tally weighted votes
    let approveWeight = 0;
    let rejectWeight = 0;
    for (const vote of claim.votes.values()) {
      if (vote.approved) approveWeight += vote.weight;
      else rejectWeight += vote.weight;
    }

    if (approveWeight > rejectWeight && claim.votes.size >= QUORUM_MIN) {
      this.mintReward(claim.botId, claim.amount, claim.proofEventId);
    }
  }

  /** Mint tokens as reward */
  private mintReward(botId: string, amount: number, proofEventId: string): void {
    this.credit(botId, amount);

    // Record in ledger
    const identity = getIdentity();
    if (botId === identity.botId) {
      this.ledger.append('REWARD_MINT', JSON.stringify({ amount, proofEventId }), {
        amount,
        proofEventId,
      });
    }

    if (this.broadcast) {
      this.broadcast({ type: 'reward_minted', data: { botId, amount, proofEventId } });
    }

    // Check epoch boundary
    this.checkEpochBoundary();
  }

  // === Token Transfers ===

  /** Transfer tokens from local bot to another bot */
  transfer(toBotId: string, amount: number, reason: TokenTransferPayload['reason'], referenceId?: string): boolean {
    const identity = getIdentity();

    if (!this.debit(identity.botId, amount)) return false;
    this.credit(toBotId, amount);

    const transferId = randomUUID();

    // Record in ledger
    this.ledger.append('TOKEN_TRANSFER', JSON.stringify({
      transferId, toBotId, amount, reason, referenceId,
    }), { transferId, toBotId, amount, reason, referenceId });

    // Broadcast
    if (this.gossip) {
      const payload: TokenTransferPayload = {
        transferId,
        fromBotId: identity.botId,
        toBotId,
        amount,
        reason,
        referenceId,
        timestamp: Date.now(),
      };
      const envelope = createGossipEnvelope('TOKEN_TRANSFER', payload);
      this.gossip.publish(TOPIC_ECONOMY, envelope).catch(() => {});
    }

    if (this.broadcast) {
      this.broadcast({ type: 'token_transfer', data: { transferId, toBotId, amount, reason } });
    }

    return true;
  }

  /** Handle incoming token transfer from gossip */
  handleTokenTransfer(envelope: GossipEnvelope<TokenTransferPayload>): void {
    const payload = envelope.payload;
    const identity = getIdentity();

    // Verify envelope
    const peer = this.peerStore.get(envelope.senderId);
    if (peer && !verifyGossipEnvelope(envelope, peer.publicKey)) return;

    // If we're the recipient, credit our local balance cache
    if (payload.toBotId === identity.botId) {
      this.credit(identity.botId, payload.amount);
      if (this.broadcast) {
        this.broadcast({ type: 'token_received', data: { from: payload.fromBotId, amount: payload.amount, reason: payload.reason } });
      }
    }
  }

  // === Inflation / Epochs ===

  /** Check if we've reached an epoch boundary */
  private checkEpochBoundary(): void {
    const proofCount = this.ledger.countProofs();
    const state = this.db.prepare('SELECT * FROM epoch_state WHERE id = 1').get() as {
      current_epoch: number; proof_count: number; last_boundary: string | null;
    };

    const expectedEpoch = Math.floor(proofCount / EPOCH_SIZE);
    if (expectedEpoch > state.current_epoch) {
      this.triggerEpochInflation(expectedEpoch, proofCount);
    }
  }

  /** Distribute inflation tokens at epoch boundary */
  private triggerEpochInflation(epoch: number, totalProofs: number): void {
    const inflationRate = Math.max(INFLATION_FLOOR, INITIAL_INFLATION_RATE - (epoch * INFLATION_DECAY));

    // Calculate total circulating supply
    const totalSupply = (this.db.prepare(
      'SELECT COALESCE(SUM(balance), 0) as total FROM token_balances'
    ).get() as { total: number }).total;

    const inflationAmount = totalSupply * inflationRate;
    if (inflationAmount <= 0) {
      // Update epoch state even if no inflation (supply is 0)
      this.db.prepare('UPDATE epoch_state SET current_epoch = ?, proof_count = ?, last_boundary = datetime("now") WHERE id = 1').run(epoch, totalProofs);
      return;
    }

    // Get all bots with proofs in this epoch window
    const bots = this.ledger.getKnownBots();
    const distributions: Array<{ botId: string; amount: number }> = [];
    let totalWeight = 0;

    for (const botId of bots) {
      const hillCount = (this.db.prepare(
        "SELECT COUNT(*) as cnt FROM ledger_events WHERE bot_id = ? AND action = 'PROOF_HILL_SERVICE'"
      ).get(botId) as { cnt: number }).cnt;
      const reviewCount = (this.db.prepare(
        "SELECT COUNT(*) as cnt FROM ledger_events WHERE bot_id = ? AND action = 'PROOF_IMPROVEMENT_REVIEW'"
      ).get(botId) as { cnt: number }).cnt;

      const weight = (hillCount * PROOF_WEIGHT_HILL_SERVICE) + (reviewCount * PROOF_WEIGHT_REVIEW);
      if (weight > 0) {
        distributions.push({ botId, amount: weight });
        totalWeight += weight;
      }
    }

    // Distribute proportionally
    for (const dist of distributions) {
      dist.amount = (dist.amount / totalWeight) * inflationAmount;
      this.credit(dist.botId, dist.amount);

      // Record inflation mint in ledger for local bot
      const identity = getIdentity();
      if (dist.botId === identity.botId) {
        this.ledger.append('INFLATION_MINT', JSON.stringify({
          epoch, amount: dist.amount,
        }), { epoch, amount: dist.amount });
      }
    }

    // Update epoch state
    this.db.prepare('UPDATE epoch_state SET current_epoch = ?, proof_count = ?, last_boundary = datetime("now") WHERE id = 1').run(epoch, totalProofs);

    // Broadcast epoch boundary
    if (this.gossip) {
      const payload: EpochBoundaryPayload = {
        epoch,
        totalProofs,
        inflationRate,
        distributions,
        timestamp: Date.now(),
      };
      const envelope = createGossipEnvelope('EPOCH_BOUNDARY', payload);
      this.gossip.publish(TOPIC_ECONOMY, envelope).catch(() => {});
    }

    if (this.broadcast) {
      this.broadcast({ type: 'epoch_boundary', data: { epoch, inflationRate, distributions } });
    }

    console.log(`[economy] Epoch ${epoch}: inflated ${inflationAmount.toFixed(2)} tokens at ${(inflationRate * 100).toFixed(1)}% across ${distributions.length} bots`);
  }

  // === Staking ===

  /** Stake tokens (for publishing improvements, priority, etc.) */
  stake(amount: number, reason: string): boolean {
    const identity = getIdentity();
    return this.debit(identity.botId, amount);
  }

  /** Burn staked tokens (when improvement rejected, etc.) */
  burn(botId: string, amount: number, reason: string): void {
    this.debit(botId, amount);
    // Burns reduce total supply — no credit counterpart
  }

  /** Recover reputation by burning tokens */
  recoverReputation(tokenAmount: number): number {
    const identity = getIdentity();
    if (!this.debit(identity.botId, tokenAmount)) return 0;
    // 10 tokens = +5 reputation
    const repGain = Math.floor(tokenAmount / 2);
    return repGain;
  }

  // === Stats ===

  getEpochState(): { epoch: number; proofCount: number; nextEpochAt: number; inflationRate: number } {
    const state = this.db.prepare('SELECT * FROM epoch_state WHERE id = 1').get() as {
      current_epoch: number; proof_count: number;
    };
    const proofCount = this.ledger.countProofs();
    const inflationRate = Math.max(INFLATION_FLOOR, INITIAL_INFLATION_RATE - (state.current_epoch * INFLATION_DECAY));
    return {
      epoch: state.current_epoch,
      proofCount,
      nextEpochAt: (state.current_epoch + 1) * EPOCH_SIZE,
      inflationRate,
    };
  }

  getTopBalances(limit = 20): TokenBalance[] {
    const rows = this.db.prepare(
      'SELECT * FROM token_balances ORDER BY balance DESC LIMIT ?'
    ).all(limit) as Array<{ bot_id: string; balance: number; total_earned: number; total_spent: number; last_updated: string }>;

    return rows.map(r => ({
      botId: r.bot_id,
      balance: r.balance,
      totalEarned: r.total_earned,
      totalSpent: r.total_spent,
      lastUpdated: r.last_updated,
    }));
  }

  /** Clean up pending claims on shutdown */
  stop(): void {
    for (const claim of this.pendingClaims.values()) {
      clearTimeout(claim.timeout);
    }
    this.pendingClaims.clear();
  }
}
