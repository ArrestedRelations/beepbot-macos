import { sign, verify, getIdentity } from '../identity.js';

// === Message Types ===
export type MessageType =
  | 'HELLO'
  | 'HELLO_ACK'
  | 'PEER_LIST'
  | 'PEER_REQUEST'
  | 'PING'
  | 'PONG'
  | 'TASK_SUBMIT'
  | 'TASK_CLAIM'
  | 'TASK_RESULT'
  | 'VERIFY_REQUEST'
  | 'VERIFY_RESPONSE'
  | 'STAKE_ANNOUNCE'
  | 'CHAIN_SYNC'
  | 'CHAIN_ENTRIES'
  | 'HILL_CHAT'
  | 'UPDATE_ANNOUNCE'
  | 'UPDATE_REQUEST'
  | 'UPDATE_RESPONSE'
  | 'UPDATE_APPLIED'
  | 'DISCONNECT';

// === Message Envelope ===
export interface NetworkMessage {
  type: MessageType;
  payload: unknown;
  senderId: string;      // botId of sender
  senderShortId: string;
  timestamp: number;      // Unix ms
  signature: string;      // base64 Ed25519 signature of (type + JSON(payload) + senderId + timestamp)
}

// === Payload Types ===
export interface HelloPayload {
  botId: string;
  shortId: string;
  publicKey: string;     // base64 DER
  port: number;          // P2P listen port
  version: string;
  hashChainHead: string | null;
}

export interface PeerListPayload {
  peers: Array<{
    botId: string;
    shortId: string;
    publicKey: string;
    host: string;
    port: number;
    reputation: number;
  }>;
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
  resultSignature: string;  // signature of the result by the claimer
}

export interface VerifyRequestPayload {
  chainIndex: number;     // ask peer to verify this chain entry
}

export interface VerifyResponsePayload {
  chainIndex: number;
  valid: boolean;
  hash: string;
}

export interface StakeAnnouncePayload {
  botId: string;
  reputation: number;
  capabilities: string[];
}

export interface ChainSyncPayload {
  fromIndex: number;
  toIndex?: number;
}

export interface ChainEntriesPayload {
  entries: Array<{
    idx: number;
    timestamp: string;
    action: string;
    dataHash: string;
    previousHash: string;
    hash: string;
  }>;
}

export interface HillChatPayload {
  id: string;            // unique message ID
  senderBotId: string;
  senderShortId: string;
  displayName?: string;  // optional human-readable bot name
  content: string;
  timestamp: number;     // Unix ms
}

export interface UpdateAnnouncePayload {
  updateId: string;
  fromBotId: string;
  fromShortId: string;
  description: string;
  codebaseHash: string;         // SHA-256 hash of the full source tree after update
  previousHash: string;         // hash before update (for ordering)
  changedFiles: Array<{
    path: string;               // relative path from project root
    hash: string;               // SHA-256 of file contents
    size: number;               // bytes
    action: 'add' | 'modify' | 'delete';
  }>;
  timestamp: number;
}

export interface UpdateRequestPayload {
  updateId: string;
  requestedFiles: string[];     // paths to request
}

export interface UpdateResponsePayload {
  updateId: string;
  files: Array<{
    path: string;
    content: string;            // base64-encoded file contents
    hash: string;
  }>;
}

export interface UpdateAppliedPayload {
  updateId: string;
  appliedByBotId: string;
  newCodebaseHash: string;
}

// === Create & Verify Messages ===

/** Create a signed network message */
export function createMessage(type: MessageType, payload: unknown): NetworkMessage {
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

/** Verify a network message signature */
export function verifyMessage(msg: NetworkMessage, senderPublicKey: string): boolean {
  const dataToSign = `${msg.type}:${JSON.stringify(msg.payload)}:${msg.senderId}:${msg.timestamp}`;
  return verify(dataToSign, msg.signature, senderPublicKey);
}

/** Serialize a message for transport (length-prefixed JSON) */
export function serializeMessage(msg: NetworkMessage): Buffer {
  const json = JSON.stringify(msg);
  const body = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Parse incoming buffer data, returns parsed messages and remaining buffer */
export function parseMessages(buffer: Buffer): { messages: NetworkMessage[]; remaining: Buffer } {
  const messages: NetworkMessage[] = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const len = buffer.readUInt32BE(offset);
    if (len > 10 * 1024 * 1024) {
      // Message too large (>10MB), skip
      throw new Error('Message too large');
    }
    if (offset + 4 + len > buffer.length) {
      break; // incomplete message
    }
    const json = buffer.subarray(offset + 4, offset + 4 + len).toString('utf-8');
    try {
      messages.push(JSON.parse(json) as NetworkMessage);
    } catch {
      // malformed message, skip
    }
    offset += 4 + len;
  }

  return { messages, remaining: buffer.subarray(offset) };
}
