import { AccountCredentials } from '../../models/types';
import { decodeJwtPayload, isolatedFetch, readJsonSafe } from '../http';

/**
 * ChatGPT login — the same public OAuth client the Codex CLI uses
 * ("Sign in with ChatGPT"). Tokens are per-account and refreshable, which is
 * what lets two ChatGPT subscriptions be tracked independently.
 */
export const CHATGPT_OAUTH = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  redirectUri: 'http://localhost:1455/auth/callback',
  scope: 'openid profile email offline_access',
  usageUrl: 'https://chatgpt.com/backend-api/wham/usage',
};

export function buildChatGPTAuthorizeUrl(challenge: string, state: string): string {
  const params = [
    ['response_type', 'code'],
    ['client_id', CHATGPT_OAUTH.clientId],
    ['redirect_uri', CHATGPT_OAUTH.redirectUri],
    ['scope', CHATGPT_OAUTH.scope],
    ['code_challenge', challenge],
    ['code_challenge_method', 'S256'],
    ['id_token_add_organizations', 'true'],
    ['codex_cli_simplified_flow', 'true'],
    ['state', state],
    ['originator', 'codex_cli_rs'],
  ];
  return (
    CHATGPT_OAUTH.authorizeUrl +
    '?' +
    params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  );
}

export function isChatGPTCallbackUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1):1455\/auth\/callback/i.test(url);
}

export interface ChatGPTIdentity {
  email?: string;
  accountId?: string;
  plan?: string;
}

const PLAN_TITLES: Record<string, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
};

export function chatgptPlanTitle(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const key = String(raw).toLowerCase().replace(/^chatgpt/, '').replace(/plan$/, '');
  return PLAN_TITLES[key] || raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function identityFromTokens(idToken?: string, accessToken?: string): ChatGPTIdentity {
  const id = decodeJwtPayload(idToken) || {};
  const access = decodeJwtPayload(accessToken) || {};
  const auth = id['https://api.openai.com/auth'] || access['https://api.openai.com/auth'] || {};
  const profile = access['https://api.openai.com/profile'] || {};
  return {
    email: id.email || profile.email,
    accountId: auth.chatgpt_account_id,
    plan: chatgptPlanTitle(auth.chatgpt_plan_type),
  };
}

function tokensToCredentials(data: any, previous?: AccountCredentials): AccountCredentials {
  const accessToken: string = data.access_token;
  const idToken: string | undefined = data.id_token || previous?.idToken;
  const identity = identityFromTokens(idToken, accessToken);
  const jwtExp = decodeJwtPayload(accessToken)?.exp;
  const expiresAt = data.expires_in
    ? Date.now() + Number(data.expires_in) * 1000
    : jwtExp
    ? jwtExp * 1000
    : Date.now() + 3600 * 1000;

  return {
    ...previous,
    authType: 'oauth',
    accessToken,
    refreshToken: data.refresh_token || previous?.refreshToken,
    idToken,
    expiresAt,
    email: identity.email || previous?.email,
    orgId: identity.accountId || previous?.orgId,
    webSessionActive: undefined,
    cookies: undefined,
  };
}

export async function exchangeChatGPTCode(code: string, verifier: string): Promise<AccountCredentials> {
  const body = [
    ['grant_type', 'authorization_code'],
    ['code', code],
    ['redirect_uri', CHATGPT_OAUTH.redirectUri],
    ['client_id', CHATGPT_OAUTH.clientId],
    ['code_verifier', verifier],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const resp = await isolatedFetch(CHATGPT_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const data = await readJsonSafe(resp);
  if (!resp.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error?.message || `HTTP ${resp.status}`);
  }
  return tokensToCredentials(data);
}

export async function refreshChatGPTToken(creds: AccountCredentials): Promise<AccountCredentials> {
  if (!creds.refreshToken) throw new Error('Нет refresh-токена');
  const resp = await isolatedFetch(CHATGPT_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: CHATGPT_OAUTH.clientId,
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      scope: 'openid profile email',
    }),
  });
  const data = await readJsonSafe(resp);
  if (!resp.ok || !data?.access_token) {
    const err: any = new Error(data?.error_description || data?.error?.message || `HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return tokensToCredentials(data, creds);
}
