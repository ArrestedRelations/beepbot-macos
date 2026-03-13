import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDataDir } from './db.js';

export interface BotIdentity {
  botId: string;       // beep_<sha256-hex>
  shortId: string;     // beep_<first-16-chars>
  publicKey: string;    // base64-encoded public key (DER)
  createdAt: string;
}

let cachedIdentity: BotIdentity | null = null;
let privateKeyPem: string | null = null;

function getIdentityDir(): string {
  return join(getDataDir(), 'identity');
}

/** Generate or load the bot's Ed25519 keypair */
export function initIdentity(): BotIdentity {
  const dir = getIdentityDir();
  const privPath = join(dir, 'private.pem');
  const pubPath = join(dir, 'public.pem');
  const metaPath = join(dir, 'meta.json');

  if (existsSync(privPath) && existsSync(pubPath) && existsSync(metaPath)) {
    // Load existing keys
    privateKeyPem = readFileSync(privPath, 'utf-8');
    const publicKeyPem = readFileSync(pubPath, 'utf-8');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as { createdAt: string };

    const pubDer = publicKeyPemToDer(publicKeyPem);
    const hash = createHash('sha256').update(pubDer).digest('hex');

    cachedIdentity = {
      botId: `beep_${hash}`,
      shortId: `beep_${hash.slice(0, 16)}`,
      publicKey: pubDer.toString('base64'),
      createdAt: meta.createdAt,
    };

    return cachedIdentity;
  }

  // Generate new keypair
  mkdirSync(dir, { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const createdAt = new Date().toISOString();

  writeFileSync(privPath, privateKey, { mode: 0o600 });
  writeFileSync(pubPath, publicKey);
  writeFileSync(metaPath, JSON.stringify({ createdAt }, null, 2));

  privateKeyPem = privateKey;

  const pubDer = publicKeyPemToDer(publicKey);
  const hash = createHash('sha256').update(pubDer).digest('hex');

  cachedIdentity = {
    botId: `beep_${hash}`,
    shortId: `beep_${hash.slice(0, 16)}`,
    publicKey: pubDer.toString('base64'),
    createdAt,
  };

  console.log(`[identity] Generated new bot identity: ${cachedIdentity.shortId}`);
  return cachedIdentity;
}

/** Get the current bot identity (must call initIdentity first) */
export function getIdentity(): BotIdentity {
  if (!cachedIdentity) throw new Error('Identity not initialized. Call initIdentity() first.');
  return cachedIdentity;
}

/** Sign data with the bot's private key */
export function sign(data: string | Buffer): string {
  if (!privateKeyPem) throw new Error('Identity not initialized.');
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return cryptoSign(null, buf, privateKeyPem).toString('base64');
}

/** Verify a signature against a public key (base64 DER) */
export function verify(data: string | Buffer, signature: string, publicKeyBase64: string): boolean {
  try {
    const pubPem = derToPublicKeyPem(Buffer.from(publicKeyBase64, 'base64'));
    const buf = typeof data === 'string' ? Buffer.from(data) : data;
    return cryptoVerify(null, buf, pubPem, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

/** Extract raw DER bytes from PEM public key */
function publicKeyPemToDer(pem: string): Buffer {
  const lines = pem.split('\n').filter(l => !l.startsWith('-----') && l.trim().length > 0);
  return Buffer.from(lines.join(''), 'base64');
}

/** Convert raw DER bytes back to PEM public key */
function derToPublicKeyPem(der: Buffer): string {
  const b64 = der.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}
