import { AccountCredentials, QuotaBucket, UsageSnapshot } from '../../models/types';
import { isolatedFetch, readJsonSafe } from '../http';
import {
  CLAUDE_OAUTH,
  fetchClaudeProfile,
  refreshClaudeToken,
} from '../oauth/claudeOAuth';
import { failureSnapshot, makeBucket, needsRefresh } from './common';
import { ProviderFetchResult, UsageProvider } from './UsageProvider';

const WEB_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://claude.ai',
  Referer: 'https://claude.ai/',
};

/** Parses the usage payload shared by the OAuth and the web endpoint. */
export function parseClaudeUsage(data: any): QuotaBucket[] {
  const buckets: QuotaBucket[] = [];
  if (!data || typeof data !== 'object') return buckets;

  const windows: Array<[string, string, 'session_5h' | 'weekly_7d']> = [
    ['five_hour', 'Сессия (5ч)', 'session_5h'],
    ['seven_day', 'Неделя', 'weekly_7d'],
    ['seven_day_opus', 'Неделя · Opus', 'weekly_7d'],
    ['seven_day_sonnet', 'Неделя · Sonnet', 'weekly_7d'],
  ];

  for (const [key, label, type] of windows) {
    const w = data[key];
    if (w && typeof w.utilization === 'number') {
      buckets.push(makeBucket(key, label, type, w.utilization, w.resets_at || null));
    }
  }

  const extra = data.extra_usage;
  if (extra && extra.is_enabled && typeof extra.monthly_limit === 'number' && extra.monthly_limit > 0) {
    const used = Number(extra.used_credits) || 0;
    const pct =
      typeof extra.utilization === 'number' ? extra.utilization : (used / extra.monthly_limit) * 100;
    buckets.push(
      makeBucket('extra_usage', 'Доп. расход', 'monthly_30d', pct, null, {
        used: (used / 100).toFixed(2),
        limit: (extra.monthly_limit / 100).toFixed(2),
        currency: 'USD',
      })
    );
  }

  // Legacy web shape
  const spend = data.spend;
  if (!extra && spend?.enabled && spend.used && spend.limit) {
    const usedMinor = spend.used.amount_minor || 0;
    const limitMinor = spend.limit.amount_minor || 1;
    buckets.push(
      makeBucket('extra_usage', 'Доп. расход', 'monthly_30d', (usedMinor / limitMinor) * 100, null, {
        used: (usedMinor / 100).toFixed(2),
        limit: (limitMinor / 100).toFixed(2),
        currency: spend.used.currency || 'USD',
      })
    );
  }

  return buckets;
}

export class ClaudeProvider implements UsageProvider {
  readonly id = 'claude';
  readonly type = 'claude' as const;
  readonly name = 'Claude';

  validateCredentials(credentials: AccountCredentials): boolean {
    if (credentials.authType === 'oauth') return Boolean(credentials.accessToken);
    return Boolean(credentials.sessionKey || credentials.cookies?.includes('sessionKey='));
  }

  async fetchUsage(accountId: string, credentials: AccountCredentials): Promise<ProviderFetchResult> {
    if (!this.validateCredentials(credentials)) {
      const legacy = credentials.webSessionActive || credentials.cookies;
      return {
        snapshot: failureSnapshot(
          accountId,
          'claude',
          legacy ? 'reauth_required' : 'not_configured',
          legacy
            ? 'Старое подключение не поддерживает фоновое обновление — переподключите аккаунт'
            : 'Аккаунт не подключён'
        ),
      };
    }

    try {
      if (credentials.authType === 'oauth') {
        return await this.fetchViaOAuth(accountId, credentials);
      }
      return await this.fetchViaCookies(accountId, credentials);
    } catch (err: any) {
      const aborted = err?.name === 'AbortError';
      return {
        snapshot: failureSnapshot(
          accountId,
          'claude',
          'error',
          aborted ? 'Claude не ответил вовремя' : err?.message || 'Сбой сети при запросе к Claude'
        ),
      };
    }
  }

  private async fetchViaOAuth(
    accountId: string,
    original: AccountCredentials
  ): Promise<ProviderFetchResult> {
    let creds = original;
    let changed = false;

    if (needsRefresh(creds.expiresAt)) {
      try {
        creds = await refreshClaudeToken(creds);
        changed = true;
      } catch {
        return {
          snapshot: failureSnapshot(
            accountId,
            'claude',
            'reauth_required',
            'Сессия Claude истекла — войдите в аккаунт заново'
          ),
        };
      }
    }

    const call = (token: string) =>
      isolatedFetch(CLAUDE_OAUTH.usageUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': CLAUDE_OAUTH.betaHeader,
          Accept: 'application/json',
        },
      });

    let resp = await call(creds.accessToken!);

    // Token revoked/expired early: try one refresh
    if (resp.status === 401 && creds.refreshToken) {
      try {
        creds = await refreshClaudeToken(creds);
        changed = true;
        resp = await call(creds.accessToken!);
      } catch {
        // fall through to the 401 handling below
      }
    }

    if (resp.status === 401 || resp.status === 403) {
      return {
        snapshot: failureSnapshot(accountId, 'claude', 'reauth_required', 'Сессия Claude истекла — войдите заново'),
        updatedCredentials: changed ? creds : undefined,
      };
    }
    if (resp.status === 429) {
      return {
        snapshot: failureSnapshot(accountId, 'claude', 'rate_limited', 'Слишком частые запросы — повторим позже'),
        updatedCredentials: changed ? creds : undefined,
      };
    }
    if (!resp.ok) {
      return {
        snapshot: failureSnapshot(accountId, 'claude', 'error', `Claude вернул HTTP ${resp.status}`),
        updatedCredentials: changed ? creds : undefined,
      };
    }

    const usage = await readJsonSafe(resp);
    const buckets = parseClaudeUsage(usage);

    // Plan + email: refresh the cached profile at most every 12h
    let plan = creds.plan;
    const profileAge = Date.now() - (creds.profileFetchedAt || 0);
    if (!plan || !creds.email || profileAge > 12 * 3600 * 1000) {
      const profile = await fetchClaudeProfile(creds.accessToken!);
      if (profile) {
        plan = profile.plan;
        creds = {
          ...creds,
          email: profile.email || creds.email,
          orgId: profile.orgId || creds.orgId,
          plan,
          profileFetchedAt: Date.now(),
        };
        changed = true;
      }
    }

    const snapshot: UsageSnapshot = {
      accountId,
      providerType: 'claude',
      planName: plan || '',
      status: 'ok',
      fetchedAt: new Date().toISOString(),
      buckets,
      email: creds.email,
    };

    return { snapshot, updatedCredentials: changed ? creds : undefined };
  }

  private async fetchViaCookies(
    accountId: string,
    credentials: AccountCredentials
  ): Promise<ProviderFetchResult> {
    const cookieHeader =
      credentials.cookies && credentials.cookies.includes('sessionKey=')
        ? credentials.cookies
        : `sessionKey=${credentials.sessionKey}`;
    const headers = { ...WEB_HEADERS, Cookie: cookieHeader };

    let orgId = credentials.orgId;
    if (!orgId && credentials.orgUrl) {
      const m = /organizations\/([^/?]+)/.exec(credentials.orgUrl);
      if (m) orgId = m[1];
    }

    let plan = '';
    let email: string | undefined = credentials.email;

    const orgResp = await isolatedFetch('https://claude.ai/api/organizations', { headers });
    if (orgResp.status === 401 || orgResp.status === 403) {
      const text = await orgResp.text();
      const cf = /cloudflare|challenge/i.test(text);
      return {
        snapshot: failureSnapshot(
          accountId,
          'claude',
          cf ? 'error' : 'reauth_required',
          cf ? 'Cloudflare заблокировал запрос — переподключите через вход в аккаунт' : 'sessionKey истёк — переподключите аккаунт'
        ),
      };
    }
    if (orgResp.ok) {
      const data = await readJsonSafe(orgResp);
      const list: any[] = Array.isArray(data) ? data : data?.organizations || [];
      const chosen =
        list.find((o) => o.uuid === orgId) ||
        list.find((o) => (o.capabilities || []).some((c: string) => /claude_(max|pro|team)/.test(c))) ||
        list[0];
      if (chosen) {
        orgId = chosen.uuid || chosen.id;
        const caps: string[] = chosen.capabilities || [];
        if (caps.includes('claude_max')) plan = 'Max';
        else if (caps.includes('claude_enterprise')) plan = 'Enterprise';
        else if (caps.includes('claude_team')) plan = 'Team';
        else if (caps.includes('claude_pro')) plan = 'Pro';
        else plan = 'Free';
        const tier = String(chosen.rate_limit_tier || '');
        if (/20x/.test(tier)) plan = 'Max 20x';
        else if (/5x/.test(tier)) plan = 'Max 5x';
      }
    }

    if (!orgId) {
      return {
        snapshot: failureSnapshot(accountId, 'claude', 'error', 'Не удалось определить организацию Claude'),
      };
    }

    const usageResp = await isolatedFetch(`https://claude.ai/api/organizations/${orgId}/usage`, { headers });
    if (usageResp.status === 401 || usageResp.status === 403) {
      return {
        snapshot: failureSnapshot(accountId, 'claude', 'reauth_required', 'sessionKey истёк — переподключите аккаунт'),
      };
    }
    if (!usageResp.ok) {
      return {
        snapshot: failureSnapshot(accountId, 'claude', 'error', `Claude вернул HTTP ${usageResp.status}`),
      };
    }

    const usage = await readJsonSafe(usageResp);
    return {
      snapshot: {
        accountId,
        providerType: 'claude',
        planName: plan,
        status: 'ok',
        fetchedAt: new Date().toISOString(),
        buckets: parseClaudeUsage(usage),
        email,
      },
      updatedCredentials: orgId !== credentials.orgId ? { ...credentials, orgId } : undefined,
    };
  }
}
