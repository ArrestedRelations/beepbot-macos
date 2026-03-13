/**
 * Vault — Password-protected secure storage for credentials, payment methods, and secrets.
 *
 * Encryption: AES-256-GCM with per-entry random IVs.
 * Master key: derived from user password via scrypt, stored as a verification hash.
 */

import { scryptSync, randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';
import { getDataDir } from './db.js';

// ===== Vault Service =====

export class Vault {
  private db: Database.Database;
  private masterKey: Buffer | null = null;
  private unlockedAt: number | null = null;
  private autoLockMinutes = 15;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // --- Password Management ---

  hasPassword(): boolean {
    return existsSync(this.getKeyFilePath());
  }

  setPassword(password: string): void {
    const salt = randomBytes(32);
    const key = scryptSync(password, salt, 32);
    // Store salt + verification hash (HMAC of a known string with the derived key)
    const verifier = createHmac('sha256', key).update('beepbot-vault-verify').digest();
    const payload = {
      salt: salt.toString('base64'),
      verifier: verifier.toString('base64'),
      version: 1,
    };
    writeFileSync(this.getKeyFilePath(), JSON.stringify(payload), { mode: 0o600 });
    this.masterKey = key;
    this.unlockedAt = Date.now();
    console.log('[vault] Master password set');
  }

  unlock(password: string): boolean {
    const keyFile = this.readKeyFile();
    if (!keyFile) return false;

    const salt = Buffer.from(keyFile.salt, 'base64');
    const key = scryptSync(password, salt, 32);
    const verifier = createHmac('sha256', key).update('beepbot-vault-verify').digest();
    const expected = Buffer.from(keyFile.verifier, 'base64');

    if (!timingSafeEqual(verifier, expected)) {
      return false;
    }

    this.masterKey = key;
    this.unlockedAt = Date.now();
    console.log('[vault] Unlocked');
    return true;
  }

  lock(): void {
    this.masterKey = null;
    this.unlockedAt = null;
    console.log('[vault] Locked');
  }

  isUnlocked(): boolean {
    if (!this.masterKey) return false;
    // Auto-lock after timeout
    if (this.unlockedAt && Date.now() - this.unlockedAt > this.autoLockMinutes * 60_000) {
      this.lock();
      return false;
    }
    return true;
  }

  // --- Encryption ---

  encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
    if (!this.masterKey) throw new Error('Vault is locked');
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    let enc = cipher.update(plaintext, 'utf8', 'base64');
    enc += cipher.final('base64');
    return {
      ciphertext: enc,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(ciphertext: string, iv: string, authTag?: string): string {
    if (!this.masterKey) throw new Error('Vault is locked');
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, Buffer.from(iv, 'base64'));
    if (authTag) {
      decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    }
    let dec = decipher.update(ciphertext, 'base64', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  }

  // --- Entry Helpers ---

  encryptEntry(data: Record<string, unknown>): { encrypted_data: string; iv: string; auth_tag: string } {
    const { ciphertext, iv, authTag } = this.encrypt(JSON.stringify(data));
    return { encrypted_data: ciphertext, iv, auth_tag: authTag };
  }

  decryptEntry(encrypted_data: string, iv: string, auth_tag: string): Record<string, unknown> {
    const plaintext = this.decrypt(encrypted_data, iv, auth_tag);
    return JSON.parse(plaintext);
  }

  // --- Private ---

  private getKeyFilePath(): string {
    return join(getDataDir(), 'vault-key.enc');
  }

  private readKeyFile(): { salt: string; verifier: string; version: number } | null {
    try {
      const raw = readFileSync(this.getKeyFilePath(), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

// ===== TOTP Generation =====

export function generateTOTP(
  secret: string,
  options?: { period?: number; digits?: number; algorithm?: string }
): { code: string; expiresIn: number } {
  const period = options?.period ?? 30;
  const digits = options?.digits ?? 6;
  const algorithm = options?.algorithm ?? 'sha1';

  const time = Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / period);
  const expiresIn = period - (time % period);

  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac(algorithm, key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % Math.pow(10, digits);

  return {
    code: code.toString().padStart(digits, '0'),
    expiresIn,
  };
}

function base32Decode(encoded: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = encoded.replace(/[\s=-]/g, '').toUpperCase();
  let bits = '';
  for (const char of cleaned) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// ===== Spending Limits =====

export function checkSpendingLimits(
  db: Database.Database,
  entryId: string,
  amountCents: number,
  merchant: string,
  entryData: Record<string, unknown>,
  config: Record<string, unknown>,
): { allowed: boolean; reason?: string; requiresConfirmation?: boolean } {
  const spendLimits = entryData.spendLimits as Record<string, unknown> | undefined;

  // Per-transaction limit
  const perTxn = (spendLimits?.perTransactionCents as number) ?? (config.defaultSpendLimitCentsPerTransaction as number) ?? 5000;
  if (amountCents > perTxn) {
    return { allowed: false, reason: `Exceeds per-transaction limit of $${(perTxn / 100).toFixed(2)}` };
  }

  // Confirmation threshold
  const confirmThreshold = (spendLimits?.requireConfirmAboveCents as number) ?? (config.requireConfirmAboveCents as number) ?? 2500;
  if (amountCents > confirmThreshold) {
    return { allowed: true, requiresConfirmation: true };
  }

  // Daily limit
  const dailyLimit = (spendLimits?.dailyCents as number) ?? (config.defaultSpendLimitCentsPerDay as number) ?? 20000;
  const todaySpend = db.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) as total FROM vault_spending_log
     WHERE entry_id = ? AND created_at >= datetime('now', '-1 day')`
  ).get(entryId) as { total: number } | undefined;

  if ((todaySpend?.total ?? 0) + amountCents > dailyLimit) {
    return { allowed: false, reason: `Would exceed daily limit of $${(dailyLimit / 100).toFixed(2)}` };
  }

  // Blocked merchants
  const blocked = spendLimits?.blockedMerchants as string[] | undefined;
  if (blocked?.some(m => merchant.toLowerCase().includes(m.toLowerCase()))) {
    return { allowed: false, reason: `Merchant "${merchant}" is blocked for this card` };
  }

  // Allowed merchants
  const allowed = spendLimits?.allowedMerchants as string[] | undefined;
  if (allowed && !allowed.some(m => merchant.toLowerCase().includes(m.toLowerCase()))) {
    return { allowed: false, reason: `Merchant "${merchant}" is not in the allowed list for this card` };
  }

  return { allowed: true };
}

// ===== Masking =====

export function maskCardNumber(num: string): string {
  if (num.length < 8) return '****';
  return `\u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 ${num.slice(-4)}`;
}

export function maskPassword(): string {
  return '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
}

// ===== Vault Categories =====

export const VAULT_CATEGORIES = [
  'payment_method',
  'login',
  'identity',
  'address',
  'personal_info',
  'secure_note',
  'api_key',
] as const;

export type VaultCategory = typeof VAULT_CATEGORIES[number];
