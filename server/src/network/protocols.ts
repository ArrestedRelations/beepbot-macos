import { sign, verify, getIdentity } from '../identity.js';

// === Stream Protocol IDs ===
export const PROTOCOL_CHAIN_SYNC = '/beepbot/chain-sync/1.0.0';
export const PROTOCOL_FILE_TRANSFER = '/beepbot/file-transfer/1.0.0';
export const PROTOCOL_VERIFY = '/beepbot/verify/1.0.0';
export const PROTOCOL_DIRECT_MSG = '/beepbot/dm/1.0.0';

// === GossipSub Topics ===
export const TOPIC_HILL = 'beepbot:hill';
export const TOPIC_TASKS = 'beepbot:tasks';
export const TOPIC_LEDGER = 'beepbot:ledger';
export const TOPIC_UPDATES = 'beepbot:updates';
export const TOPIC_ANCHORS = 'beepbot:anchors';
export const TOPIC_REVIEWS = 'beepbot:reviews';
export const TOPIC_ECONOMY = 'beepbot:economy';

// === GossipSub Envelope ===
export interface GossipEnvelope<T = unknown> {
  type: string;
  payload: T;
  senderId: string;
  senderShortId: string;
  timestamp: number;
  signature: string;
}

// === Payload Types ===

export interface HelloPayload {
  botId: string;
  shortId: string;
  publicKey: string;
  version: string;
  hashChainHead: string | null;
  multiaddrs: string[];
}

export interface HillChatPayload {
  id: string;
  senderBotId: string;
  senderShortId: string;
  displayName?: string;
  content: string;
  timestamp: number;
}

export interface TaskSubmitPayload {
  id: string;
  description: string;
  requesterBotId: string;
}

export interface TaskClaimPayload {
  taskId: string;
  claimerBotId: string;
}

export interface TaskResultPayload {
  taskId: string;
  result: string;
  resultSignature: string;
}

export interface LedgerEventPayload {
  eventId: string;
  botId: string;
  sequence: number;
  action: string;
  proofHash: string;
  previousHash: string;
  hash: string;
  timestamp: string;
  signature: string;
  metadata?: Record<string, unknown>;
}

// === PoUW Economy Payloads ===

export interface RewardClaimPayload {
  claimId: string;
  botId: string;
  proofEventId: string;
  proofType: 'PROOF_HILL_SERVICE' | 'PROOF_IMPROVEMENT_REVIEW';
  amount: number;
  timestamp: number;
}

export interface RewardAckPayload {
  claimId: string;
  voterBotId: string;
  approved: boolean;
  weight: number;
  timestamp: number;
}

export interface TokenTransferPayload {
  transferId: string;
  fromBotId: string;
  toBotId: string;
  amount: number;
  reason: 'improvement_adopt' | 'stake' | 'burn' | 'reputation_recovery';
  referenceId?: string;
  timestamp: number;
}

export interface EpochBoundaryPayload {
  epoch: number;
  totalProofs: number;
  inflationRate: number;
  distributions: Array<{ botId: string; amount: number }>;
  timestamp: number;
}

export interface ImprovementReviewPayload {
  reviewId: string;
  updateId: string;
  reviewerBotId: string;
  vote: 'APPROVE' | 'REJECT';
  reviewNotesHash: string;
  timestamp: number;
}

export interface UpdateAnnouncePayload {
  updateId: string;
  fromBotId: string;
  fromShortId: string;
  description: string;
  codebaseHash: string;
  previousHash: string;
  changedFiles: Array<{
    path: string;
    hash: string;
    size: number;
    action: 'add' | 'modify' | 'delete';
  }>;
  timestamp: number;
}

export interface UpdateRequestPayload {
  updateId: string;
  requestedFiles: string[];
}

export interface UpdateResponsePayload {
  updateId: string;
  files: Array<{
    path: string;
    content: string;
    hash: string;
  }>;
}

export interface UpdateAppliedPayload {
  updateId: string;
  appliedByBotId: string;
  newCodebaseHash: string;
}

export interface MerkleAnchorPayload {
  anchorId: string;
  botId: string;
  merkleRoot: string;
  fromSequence: number;
  toSequence: number;
  timestamp: string;
  signature: string;
}

export interface VerifyRequestPayload {
  botId: string;
  chainIndex: number;
}

export interface VerifyResponsePayload {
  chainIndex: number;
  valid: boolean;
  hash: string;
}

export interface ChainSyncRequest {
  botId: string;
  fromSequence: number;
  toSequence?: number;
}

export interface ChainSyncResponse {
  entries: LedgerEventPayload[];
}

export interface FileTransferRequest {
  updateId: string;
  requestedFiles: string[];
}

export interface FileTransferResponse {
  updateId: string;
  files: Array<{ path: string; content: string; hash: string }>;
}

// === Helpers ===

export function createGossipEnvelope<T>(type: string, payload: T): GossipEnvelope<T> {
  const identity = getIdentity();
  const timestamp = Date.now();
  const dataToSign = `${type}:${JSON.stringify(payload)}:${identity.botId}:${timestamp}`;
  const signature = sign(dataToSign);

  return {
    type,
    payload,
    senderId: identity.botId,
    senderShortId: identity.shortId,
    timestamp,
    signature,
  };
}

export function verifyGossipEnvelope(envelope: GossipEnvelope, senderPublicKey: string): boolean {
  const dataToSign = `${envelope.type}:${JSON.stringify(envelope.payload)}:${envelope.senderId}:${envelope.timestamp}`;
  return verify(dataToSign, envelope.signature, senderPublicKey);
}

export function encodeStreamMessage(msg: unknown): Uint8Array {
  const json = JSON.stringify(msg);
  const body = new TextEncoder().encode(json);
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, body.length, false);
  const result = new Uint8Array(4 + body.length);
  result.set(header);
  result.set(body, 4);
  return result;
}

export function decodeStreamMessage<T>(data: Uint8Array): T {
  const json = new TextDecoder().decode(data);
  return JSON.parse(json) as T;
}
