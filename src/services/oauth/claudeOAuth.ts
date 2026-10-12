import { AccountCredentials } from '../../models/types';
import { isolatedFetch, readJsonSafe } from '../http';

/**
 * Claude subscription login — the same public OAuth client that Claude Code uses.
 * Each login yields an independent access/refresh token pair, so any number of
 * Claude accounts can be tracked side by side without sharing browser cookies.
 */
export const CLAUDE_OAUTH = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  redirectUri: 'https://console.anthropic.com/oauth/code/callback',
  tokenUrls: [
    'https://console.anthropic.com/v1/oauth/token',
    'https://platform.claude.com/v1/oauth/token',
  ],
  scope: 'org:create_api_key user:profile user:inference',
  usageUrl: 'https://api.anthropic.com/api/oauth/usage',
  profileUrl: 'https://api.anthropic.com/api/oauth/profile',
  betaHeader: 'oauth-2025-04-20',
};

export function buildClaudeAuthorizeUrl(challenge: string, state: string): string {
  const params = [
    ['code', 'true'],
    ['client_id', CLAUDE_OAUTH.clientId],
    ['response_type', 'code'],
    ['redirect_uri', CLAUDE_OAUTH.redirectUri],
    ['scope', CLAUDE_OAUTH.scope],
    ['code_challenge', challenge],
    ['code_challenge_method', 'S256'],
    ['state', state],
  ];
  return (
    CLAUDE_OAUTH.authorizeUrl +
    '?' +
    params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  );
}

export function isClaudeCallbackUrl(url: string): boolean {
  return /\/oauth\/code\/callback/i.test(url) && /[?&]code=/.test(url);
}

async function postToken(body: Record<string, string>): Promise<any> {
  let lastError = 'Сервер авторизации Claude недоступен';
  for (const url of CLAUDE_OAUTH.tokenUrls) {
    try {
      const resp = await isolatedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readJsonSafe(resp);
      if (resp.ok && data?.access_token) return data;
      if (resp.status === 400 || resp.status === 401) {
        throw new Error(
          data?.error_description || data?.error?.message || data?.error || 'Код авторизации отклонён'
        );
      }
      lastError = `HTTP ${resp.status}`;
    } catch (e: any) {
      if (e?.message && !/network|abort/i.test(e.message)) throw e;
      lastError = e?.message || lastError;
    }
  }
  throw new Error(lastError);
}

function tokensToCredentials(data: any, previous?: AccountCredentials): AccountCredentials {
  return {
    ...previous,
    authType: 'oauth',
    accessToken: data.access_token,
    refreshToken: data.refresh_token || previous?.refreshToken,
    expiresAt: Date.now() + (Number(data.expires_in) || 8 * 3600) * 1000,
    email: data.account?.email_address || previous?.email,
    orgId: data.organization?.uuid || previous?.orgId,
    webSessionActive: undefined,
    cookies: undefined,
    sessionKey: undefined,
  };
}

export async function exchangeClaudeCode(
  code: string,
  state: string | undefined,
  verifier: string,
  expectedState: string
): Promise<AccountCredentials> {
  const data = await postToken({
    grant_type: 'authorization_code',
    code,
    state: state || expectedState,
    client_id: CLAUDE_OAUTH.clientId,
    redirect_uri: CLAUDE_OAUTH.redirectUri,
    code_verifier: verifier,
  });
  return tokensToCredentials(data);
}

export async function refreshClaudeToken(creds: AccountCredentials): Promise<AccountCredentials> {
  if (!creds.refreshToken) throw new Error('Нет refresh-токена');
  const data = await postToken({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: CLAUDE_OAUTH.clientId,
  });
  return tokensToCredentials(data, creds);
}

export interface ClaudeProfile {
  email?: string;
  plan: string;
  orgId?: string;
}

export function claudePlanFromProfile(profile: any): string {
  const org = profile?.organization || {};
  const acct = profile?.account || {};
  const tier: string = String(org.rate_limit_tier || '');
  const type: string = String(org.organization_type || '');
  if (/max.*20x/i.test(tier)) return 'Max 20x';
  if (/max.*5x/i.test(tier)) return 'Max 5x';
  if (/max/i.test(type) || acct.has_claude_max) return 'Max';
  if (/enterprise/i.test(type)) return 'Enterprise';
  if (/team/i.test(type)) return 'Team';
  if (/pro/i.test(type) || acct.has_claude_pro) return 'Pro';
  return 'Free';
}

export async function fetchClaudeProfile(accessToken: string): Promise<ClaudeProfile | null> {
  try {
    const resp = await isolatedFetch(CLAUDE_OAUTH.profileUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': CLAUDE_OAUTH.betaHeader,
        Accept: 'application/json',
      },
    });
    if (!resp.ok) return null;
    const data = await readJsonSafe(resp);
    if (!data) return null;
    return {
      email: data.account?.email || data.account?.email_address,
      plan: claudePlanFromProfile(data),
      orgId: data.organization?.uuid,
    };
  } catch {
    return null;
  }
}
