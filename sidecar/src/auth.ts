import { execSync } from 'child_process';

type AuthConfig =
  | { authToken: string; apiKey?: undefined }
  | { apiKey: string; authToken?: undefined };

type AuthMethod = 'oauth' | 'api_key' | 'none';

const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

let cachedConfig: AuthConfig | null = null;
let cachedMethod: AuthMethod = 'none';
let refreshedToken: string | null = null;

function readKeychainCredentials(): Record<string, unknown> | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function extractOAuthToken(): string | null {
  if (refreshedToken) return refreshedToken;
  const creds = readKeychainCredentials();
  return (creds?.claudeAiOauth as Record<string, unknown>)?.accessToken as string || null;
}

export async function refreshOAuthToken(): Promise<string | null> {
  const creds = readKeychainCredentials();
  const oauth = creds?.claudeAiOauth as Record<string, unknown> | undefined;
  const refreshToken = oauth?.refreshToken as string | undefined;
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

    refreshedToken = newAccess;
    cachedConfig = null;
    return newAccess;
  } catch {
    return null;
  }
}

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
  refreshedToken = null;
}
