import { createHash, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getIdentity, sign } from '../identity.js';
import type { GossipRouter } from './gossip.js';
import type { PeerStore } from './peer-store.js';
import type { DistributedLedger } from './ledger.js';
import type { Economy } from './economy.js';
import {
  createGossipEnvelope,
  verifyGossipEnvelope,
  TOPIC_REVIEWS,
  type GossipEnvelope,
  type ImprovementReviewPayload,
} from './protocols.js';

// === Constants ===
const DEFAULT_PRICE = 5;           // default improvement price in BotTokens
const STAKE_AMOUNT = 2;            // tokens staked to publish
const MIN_APPROVALS = 3;           // minimum approvals for approval
const ELEVATED_APPROVALS = 5;      // required if <3 distinct reviewers
const PUBLISH_COOLDOWN_MS = 3600_000; // 1 hour between publishes
const REVIEW_REWARD = 0.5;         // tokens earned per review

export interface Improvement {
  updateId: string;
  publisherBotId: string;
  description: string;
  price: number;
  staked: number;
  status: 'pending' | 'approved' | 'rejected' | 'adopted';
  approvals: number;
  rejections: number;
  distinctReviewers: number;
  publishedAt: string;
}

export class Marketplace {
  private lastPublishTime = 0;
  private broadcast: ((data: Record<string, unknown>) => void) | null = null;

  constructor(
    private db: Database.Database,
    private gossip: GossipRouter | null,
    private ledger: DistributedLedger,
    private peerStore: PeerStore,
    private economy: Economy,
  ) {
    // Add marketplace columns to updates table if missing
    this.migrateUpdatesTable();
  }

  setGossip(gossip: GossipRouter): void {
    this.gossip = gossip;
  }

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcast = fn;
  }

  private migrateUpdatesTable(): void {
    const cols = this.db.prepare("PRAGMA table_info(updates)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('price')) {
      this.db.exec(`ALTER TABLE updates ADD COLUMN price REAL DEFAULT ${DEFAULT_PRICE}`);
    }
    if (!colNames.has('staked')) {
      this.db.exec('ALTER TABLE updates ADD COLUMN staked REAL DEFAULT 0');
    }
  }

  // === Publishing ===

  /** Set price for an improvement before announcing */
  setPrice(updateId: string, price: number): boolean {
    this.db.prepare('UPDATE updates SET price = ? WHERE id = ?').run(price, updateId);
    return true;
  }

  /** Stake tokens when publishing an improvement */
  stakeForPublish(updateId: string): boolean {
    const identity = getIdentity();

    // Enforce cooldown
    const now = Date.now();
    if (now - this.lastPublishTime < PUBLISH_COOLDOWN_MS) {
      console.warn('[marketplace] Publish cooldown active');
      return false;
    }

    // Stake tokens
    if (!this.economy.stake(STAKE_AMOUNT, `publish:${updateId}`)) {
      console.warn('[marketplace] Insufficient balance to stake');
      return false;
    }

    this.db.prepare('UPDATE updates SET staked = ? WHERE id = ?').run(STAKE_AMOUNT, updateId);
    this.lastPublishTime = now;

    // Record proof in ledger
    this.ledger.append('PROOF_IMPROVEMENT_PUBLISH', JSON.stringify({
      updateId,
      publisherBotId: identity.botId,
    }), { updateId });

    return true;
  }

  // === Reviewing ===

  /** Submit a review for an improvement */
  submitReview(updateId: string, vote: 'APPROVE' | 'REJECT', reviewNotes: string): string | null {
    const identity = getIdentity();

    // Check self-review
    const update = this.db.prepare('SELECT from_bot_id FROM updates WHERE id = ?').get(updateId) as { from_bot_id: string } | undefined;
    if (!update) return null;
    if (update.from_bot_id === identity.botId) {
      console.warn('[marketplace] Cannot review own improvement');
      return null;
    }

    // Check duplicate review
    const existing = this.db.prepare(
      'SELECT id FROM improvement_reviews WHERE update_id = ? AND reviewer_bot_id = ?'
    ).get(updateId, identity.botId);
    if (existing) return null;

    const reviewId = randomUUID();
    const reviewNotesHash = createHash('sha256').update(reviewNotes).digest('hex');
    const timestamp = new Date().toISOString();
    const sigData = `${reviewId}:${updateId}:${identity.botId}:${vote}:${reviewNotesHash}:${timestamp}`;
    const reviewSig = sign(sigData);

    // Store review
    this.db.prepare(`
      INSERT INTO improvement_reviews (id, update_id, reviewer_bot_id, vote, review_notes_hash, timestamp, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(reviewId, updateId, identity.botId, vote, reviewNotesHash, timestamp, reviewSig);

    // Record proof in ledger
    this.ledger.append('PROOF_IMPROVEMENT_REVIEW', JSON.stringify({
      reviewId, updateId, vote,
    }), { reviewId, updateId, vote });

    // Claim review reward
    const eventId = `${identity.botId}:${this.ledger.getLocalSequence()}`;
    this.economy.claimReward(eventId, 'PROOF_IMPROVEMENT_REVIEW');

    // Broadcast
    if (this.gossip) {
      const payload: ImprovementReviewPayload = {
        reviewId,
        updateId,
        reviewerBotId: identity.botId,
        vote,
        reviewNotesHash,
        timestamp: Date.now(),
      };
      const envelope = createGossipEnvelope('IMPROVEMENT_REVIEW', payload);
      this.gossip.publish(TOPIC_REVIEWS, envelope).catch(() => {});
    }

    // Check if this triggers approval/rejection
    this.checkApprovalStatus(updateId);

    return reviewId;
  }

  /** Handle incoming review from gossip */
  handleReviewGossip(envelope: GossipEnvelope<ImprovementReviewPayload>): void {
    const payload = envelope.payload;
    const identity = getIdentity();
    if (payload.reviewerBotId === identity.botId) return;

    // Verify envelope
    const peer = this.peerStore.get(envelope.senderId);
    if (peer && !verifyGossipEnvelope(envelope, peer.publicKey)) return;

    // Self-review check
    const update = this.db.prepare('SELECT from_bot_id FROM updates WHERE id = ?').get(payload.updateId) as { from_bot_id: string } | undefined;
    if (update && update.from_bot_id === payload.reviewerBotId) return;

    // Store (deduplicate)
    this.db.prepare(`
      INSERT OR IGNORE INTO improvement_reviews (id, update_id, reviewer_bot_id, vote, review_notes_hash, timestamp, signature)
      VALUES (?, ?, ?, ?, ?, datetime('now'), '')
    `).run(payload.reviewId, payload.updateId, payload.reviewerBotId, payload.vote, payload.reviewNotesHash);

    this.checkApprovalStatus(payload.updateId);

    if (this.broadcast) {
      this.broadcast({ type: 'improvement_review', data: payload });
    }
  }

  /** Check if an improvement has enough votes to be approved or rejected */
  private checkApprovalStatus(updateId: string): void {
    const reviews = this.db.prepare(
      'SELECT reviewer_bot_id, vote FROM improvement_reviews WHERE update_id = ?'
    ).all(updateId) as Array<{ reviewer_bot_id: string; vote: string }>;

    const approvals = reviews.filter(r => r.vote === 'APPROVE').length;
    const rejections = reviews.filter(r => r.vote === 'REJECT').length;
    const distinctReviewers = new Set(reviews.map(r => r.reviewer_bot_id)).size;

    // Determine required approvals
    const requiredApprovals = distinctReviewers < 3 ? ELEVATED_APPROVALS : MIN_APPROVALS;

    if (approvals >= requiredApprovals && approvals > rejections) {
      this.approveImprovement(updateId);
    } else if (rejections >= requiredApprovals && rejections > approvals) {
      this.rejectImprovement(updateId);
    }
  }

  private approveImprovement(updateId: string): void {
    this.db.prepare("UPDATE updates SET status = 'approved' WHERE id = ?").run(updateId);

    // Return stake to publisher
    const update = this.db.prepare('SELECT from_bot_id, staked FROM updates WHERE id = ?').get(updateId) as { from_bot_id: string; staked: number } | undefined;
    if (update && update.staked > 0) {
      this.economy.transfer(update.from_bot_id, 0, 'stake'); // stake is already deducted, just mark as approved
    }

    if (this.broadcast) {
      this.broadcast({ type: 'improvement_approved', data: { updateId } });
    }
    console.log(`[marketplace] Improvement ${updateId} approved`);
  }

  private rejectImprovement(updateId: string): void {
    this.db.prepare("UPDATE updates SET status = 'rejected' WHERE id = ?").run(updateId);

    // Burn publisher's stake
    const update = this.db.prepare('SELECT from_bot_id, staked FROM updates WHERE id = ?').get(updateId) as { from_bot_id: string; staked: number } | undefined;
    if (update && update.staked > 0) {
      this.economy.burn(update.from_bot_id, update.staked, `rejected:${updateId}`);
    }

    if (this.broadcast) {
      this.broadcast({ type: 'improvement_rejected', data: { updateId } });
    }
    console.log(`[marketplace] Improvement ${updateId} rejected — stake burned`);
  }

  // === Adoption ===

  /** Adopt an approved improvement by paying the publisher */
  adoptImprovement(updateId: string): boolean {
    const identity = getIdentity();

    const update = this.db.prepare(
      'SELECT from_bot_id, status, price FROM updates WHERE id = ?'
    ).get(updateId) as { from_bot_id: string; status: string; price: number } | undefined;

    if (!update) return false;
    if (update.status !== 'approved') return false;
    if (update.from_bot_id === identity.botId) return false;

    const price = update.price ?? DEFAULT_PRICE;

    // Pay the publisher (price of 0 is allowed — free/open-source)
    if (price > 0) {
      if (!this.economy.transfer(update.from_bot_id, price, 'improvement_adopt', updateId)) {
        console.warn('[marketplace] Insufficient balance to adopt');
        return false;
      }
    }

    // Record adoption in ledger
    this.ledger.append('IMPROVEMENT_ADOPT', JSON.stringify({
      updateId,
      publisherBotId: update.from_bot_id,
      price,
    }), { updateId, publisherBotId: update.from_bot_id, price });

    if (this.broadcast) {
      this.broadcast({ type: 'improvement_adopted', data: { updateId, price } });
    }

    console.log(`[marketplace] Adopted improvement ${updateId} for ${price} BotTokens`);
    return true;
  }

  // === Queries ===

  /** Get improvement details with review status */
  getImprovement(updateId: string): Improvement | null {
    const update = this.db.prepare(
      'SELECT id, from_bot_id, description, status, price, staked, created_at FROM updates WHERE id = ?'
    ).get(updateId) as { id: string; from_bot_id: string; description: string; status: string; price: number; staked: number; created_at: string } | undefined;

    if (!update) return null;

    const reviews = this.db.prepare(
      'SELECT reviewer_bot_id, vote FROM improvement_reviews WHERE update_id = ?'
    ).all(updateId) as Array<{ reviewer_bot_id: string; vote: string }>;

    return {
      updateId: update.id,
      publisherBotId: update.from_bot_id,
      description: update.description,
      price: update.price ?? DEFAULT_PRICE,
      staked: update.staked ?? 0,
      status: update.status as Improvement['status'],
      approvals: reviews.filter(r => r.vote === 'APPROVE').length,
      rejections: reviews.filter(r => r.vote === 'REJECT').length,
      distinctReviewers: new Set(reviews.map(r => r.reviewer_bot_id)).size,
      publishedAt: update.created_at,
    };
  }

  /** List improvements by status */
  listImprovements(status?: string, limit = 50): Improvement[] {
    const rows = status
      ? this.db.prepare('SELECT id FROM updates WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit) as Array<{ id: string }>
      : this.db.prepare('SELECT id FROM updates ORDER BY created_at DESC LIMIT ?').all(limit) as Array<{ id: string }>;

    return rows.map(r => this.getImprovement(r.id)).filter((i): i is Improvement => i !== null);
  }

  /** Get reviews for an improvement */
  getReviews(updateId: string): Array<{ reviewId: string; reviewerBotId: string; vote: string; timestamp: string }> {
    const rows = this.db.prepare(
      'SELECT id, reviewer_bot_id, vote, timestamp FROM improvement_reviews WHERE update_id = ? ORDER BY timestamp ASC'
    ).all(updateId) as Array<{ id: string; reviewer_bot_id: string; vote: string; timestamp: string }>;
    return rows.map(r => ({ reviewId: r.id, reviewerBotId: r.reviewer_bot_id, vote: r.vote, timestamp: r.timestamp }));
  }
}
