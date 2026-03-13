import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import type Database from 'better-sqlite3';
import { getDataDir } from './db.js';

function getEncryptionKey(): Buffer {
  return scryptSync(getDataDir(), 'beepbot-byok-v1', 32);
}

export function encryptKey(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(plaintext, 'utf8', 'base64');
  enc += cipher.final('base64');
  return { ciphertext: enc, iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

export function decryptKey(ciphertext: string, iv: string, authTag: string): string {
  const key = getEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  let dec = decipher.update(ciphertext, 'base64', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

export function maskKey(apiKey: string): string {
  if (apiKey.length <= 8) return '••••••••';
  return apiKey.slice(0, 4) + '••••••••' + apiKey.slice(-4);
}

export function getProviderKey(db: Database.Database, slug: string): string | null {
  const row = db.prepare(
    'SELECT ciphertext, iv, auth_tag FROM provider_keys WHERE slug = ?'
  ).get(slug) as { ciphertext: string; iv: string; auth_tag: string } | undefined;
  if (!row) return null;
  try {
    return decryptKey(row.ciphertext, row.iv, row.auth_tag);
  } catch {
    return null;
  }
}

export function setProviderKey(db: Database.Database, slug: string, plaintext: string): void {
  const { ciphertext, iv, authTag } = encryptKey(plaintext);
  db.prepare(`
    INSERT OR REPLACE INTO provider_keys (slug, ciphertext, iv, auth_tag, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(slug, ciphertext, iv, authTag);
}

export function deleteProviderKey(db: Database.Database, slug: string): void {
  db.prepare('DELETE FROM provider_keys WHERE slug = ?').run(slug);
}
