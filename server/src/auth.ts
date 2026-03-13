import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { getDataDir } from './db.js';

type AuthConfig =
  | { authToken: string; apiKey?: undefined }
  | { apiKey: string; authToken?: undefined };

type AuthMethod = 'oauth' | 'api_key' | 'none';

const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

let cachedConfig: AuthConfig | null = null;
let cachedMethod: AuthMethod = 'none';

// ===== Encrypted Vault =====

interface VaultData {
  oauthAccessToken?: string;
  oauthRefreshToken?: string;
  expiresAt?: number;
}

function getVaultPath(): string {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'vault.enc');
}

function getVaultKey(): Buffer {
  return scryptSync(getDataDir(), 'beepbot-vault-v1', 32);
}

function readVault(): VaultData | null {
  const path = getVaultPath();
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, 'utf-8');
    const { ciphertext, iv, authTag } = JSON.parse(raw) as { ciphertext: string; iv: string; authTag: string };
    const key = getVaultKey();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    let dec = decipher.update(ciphertext, 'base64', 'utf8');
    dec += decipher.final('utf8');
    return JSON.parse(dec) as VaultData;
  } catch {
    return null;
  }
}

function writeVault(data: VaultData): void {
  const key = getVaultKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(data);
  let enc = cipher.update(json, 'utf8', 'base64');
  enc += cipher.final('base64');
  const payload = {
    ciphertext: enc,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
  // mode 0o600: owner-only read/write on Unix; ignored on Windows (use NTFS ACLs if needed)
  writeFileSync(getVaultPath(), JSON.stringify(payload), { mode: 0o600 });
}

// ===== Token Access =====

export function extractOAuthToken(): string | null {
  const vault = readVault();
  return vault?.oauthAccessToken || null;
}

export async function refreshOAuthToken(): Promise<string | null> {
  const vault = readVault();
  const refreshToken = vault?.oauthRefreshToken;
  if (!refreshToken) return null;

  try {
    const resp = await fetch('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${OAUTH_CLIENT_ID}`,
    });

    if (!resp.ok) return null;

    const data = await resp.json() as Record<string, unknown>;
    const newAccess = data.access_token as string;
    if (!newAccess) return null;

    writeVault({
      ...vault,
      oauthAccessToken: newAccess,
      expiresAt: data.expires_in ? Date.now() + (data.expires_in as number) * 1000 : undefined,
    });

    cachedConfig = null;
    return newAccess;
  } catch {
    return null;
  }
}

export function saveOAuthTokens(accessToken: string, refreshToken: string, expiresIn?: number): void {
  writeVault({
    oauthAccessToken: accessToken,
    oauthRefreshToken: refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  });
  cachedConfig = null;
  cachedMethod = 'none';
}

export function clearVault(): void {
  const path = getVaultPath();
  if (existsSync(path)) {
    writeFileSync(path, '', { mode: 0o600 }); // owner-only on Unix; no-op on Windows
  }
  cachedConfig = null;
  cachedMethod = 'none';
}

// ===== Auth Config =====

export function getAuthConfig(): AuthConfig {
  if (cachedConfig) return cachedConfig;

  const oauthToken = extractOAuthToken();
  if (oauthToken) {
    cachedMethod = 'oauth';
    cachedConfig = { authToken: oauthToken };
    return cachedConfig;
  }

  if (process.env.ANTHROPIC_API_KEY) {
    cachedMethod = 'api_key';
    cachedConfig = { apiKey: process.env.ANTHROPIC_API_KEY };
    return cachedConfig;
  }

  cachedMethod = 'none';
  cachedConfig = { apiKey: '' };
  return cachedConfig;
}

export function getAuthMethod(): AuthMethod {
  if (!cachedConfig) getAuthConfig();
  return cachedMethod;
}

export function isAuthenticated(): boolean {
  if (!cachedConfig) getAuthConfig();
  return cachedMethod !== 'none';
}

export function clearCachedAuth(): void {
  cachedConfig = null;
  cachedMethod = 'none';
}

export { OAUTH_CLIENT_ID };
