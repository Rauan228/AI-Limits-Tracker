import {
  AccountCredentials,
  LimitSeverity,
  QuotaBucket,
  UsageSnapshot,
} from '../../models/types';
import { isolatedFetch } from '../http';
import { ProviderFetchResult, UsageProvider } from './UsageProvider';

const GEMINI_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://gemini.google.com',
  Referer: 'https://gemini.google.com/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

const BATCHEXECUTE_URL = 'https://gemini.google.com/_/BardChatUi/data/batchexecute';
const ROTATE_COOKIES_URL = 'https://accounts.google.com/RotateCookies';
const DEFAULT_BL = 'boq_assistant-bard-web-server_20260730.01_p1';
const USAGE_RPC_ID = 'jSf9Qc';

const BUCKET_LABELS: Record<number, { label: string; windowType: any }> = {
  1: { label: 'Сессия', windowType: 'session_5h' },
  2: { label: 'Неделя', windowType: 'weekly_7d' },
};

function calculateSeverity(utilization: number | null): LimitSeverity {
  if (utilization === null || isNaN(utilization)) return 'unavailable';
  if (utilization >= 100) return 'exhausted';
  if (utilization >= 90) return 'critical';
  if (utilization >= 70) return 'warning';
  return 'normal';
}

function calculateSecondsRemaining(resetsAtIso: string | null): number | undefined {
  if (!resetsAtIso) return undefined;
  const target = new Date(resetsAtIso).getTime();
  const diff = Math.max(0, Math.floor((target - Date.now()) / 1000));
  return diff;
}

function findTimestamp(node: any): number | null {
  if (Array.isArray(node)) {
    if (
      node.length === 2 &&
      typeof node[0] === 'number' &&
      typeof node[1] === 'number' &&
      node[0] > 1000000000
    ) {
      return node[0];
    }
    for (const child of node) {
      const found = findTimestamp(child);
      if (found) return found;
    }
  }
  return null;
}

function parseBatchexecuteChunks(rawText: string): Array<[string, any, any]> {
  const results: Array<[string, any, any]> = [];
  let text = rawText;
  if (text.startsWith(")]}'")) {
    text = text.substring(4).trim();
  }

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^\d+$/.test(trimmed)) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (Array.isArray(item) && item[0] === 'wrb.fr') {
            const rpcId = item[1];
            const payloadRaw = item[2];
            const statusCode = item[5] ?? null;
            let payload: any = null;
            if (payloadRaw && typeof payloadRaw === 'string') {
              try {
                payload = JSON.parse(payloadRaw);
              } catch {}
            }
            results.push([rpcId, payload, statusCode]);
          }
        }
      }
    } catch {}
  }
  return results;
}

export class GeminiProvider implements UsageProvider {
  readonly id = 'gemini';
  readonly type = 'gemini' as const;
  readonly name = 'Google Gemini';

  validateCredentials(credentials: AccountCredentials): boolean {
    return Boolean(credentials.cookies && credentials.cookies.includes('PSID'));
  }

  async fetchUsage(
    accountId: string,
    credentials: AccountCredentials
  ): Promise<ProviderFetchResult> {
    const nowIso = new Date().toISOString();

    if (!this.validateCredentials(credentials)) {
      return {
        snapshot: {
          accountId,
          providerType: 'gemini',
          planName: '',
          status: credentials.webSessionActive ? 'reauth_required' : 'not_configured',
          errorMessage: credentials.webSessionActive
            ? 'Нужны cookie Google (__Secure-1PSID) — переподключите через cURL'
            : 'Аккаунт не подключён',
          fetchedAt: nowIso,
          buckets: [],
        },
      };
    }

    const cookies = credentials.cookies || '';
    let atToken = credentials.atToken;
    let bl = credentials.bl || DEFAULT_BL;
    let sid = credentials.sid || '0';

    const reqHeaders: Record<string, string> = {
      ...GEMINI_HEADERS,
      Cookie: cookies,
    };

    try {
      // 1. If atToken is missing, fetch gemini app page to extract SNlM0e
      if (!atToken) {
        try {
          const pageResp = await isolatedFetch('https://gemini.google.com/app', {
            headers: reqHeaders,
          });
          if (pageResp.status === 401 || pageResp.status === 403 || pageResp.redirected) {
            return {
              snapshot: {
                accountId,
                providerType: 'gemini',
                planName: 'Gemini',
                status: 'reauth_required',
                errorMessage: 'Сессия Google Gemini истекла — обновите cookie',
                fetchedAt: nowIso,
                buckets: [],
              },
            };
          }

          const html = await pageResp.text();
          const atMatch = /"SNlM0e"\s*:\s*"([^"]+)"/.exec(html) || /"(AFWLbD[^"]+)"/.exec(html);
          if (atMatch) atToken = atMatch[1];

          const blMatch = /"cfb2h"\s*:\s*"([^"]+)"/.exec(html);
          if (blMatch) bl = blMatch[1];

          const sidMatch = /"FdrFJe"\s*:\s*"(-?\d+)"/.exec(html);
          if (sidMatch) sid = sidMatch[1];
        } catch {}
      }

      if (!atToken) {
        return {
          snapshot: {
            accountId,
            providerType: 'gemini',
            planName: 'Gemini',
            status: 'reauth_required',
            errorMessage: 'Не удалось получить токен сессии Gemini (at_token)',
            fetchedAt: nowIso,
            buckets: [],
          },
        };
      }

      // 2. Call Batchexecute RPC
      const rpcParams = new URLSearchParams({
        rpcids: USAGE_RPC_ID,
        'source-path': '/app',
        bl,
        'f.sid': sid,
        hl: 'en',
        _reqid: '1000001',
        rt: 'c',
      });

      const bodyPayload = new URLSearchParams();
      bodyPayload.append(
        'f.req',
        JSON.stringify([[[USAGE_RPC_ID, '[]', null, 'generic']]])
      );
      bodyPayload.append('at', atToken);

      const rpcResp = await isolatedFetch(`${BATCHEXECUTE_URL}?${rpcParams.toString()}`, {
        method: 'POST',
        headers: {
          ...reqHeaders,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Same-Domain': '1',
        },
        body: bodyPayload.toString(),
      });

      if (rpcResp.status === 401 || rpcResp.status === 403) {
        return {
          snapshot: {
            accountId,
            providerType: 'gemini',
            planName: 'Gemini',
            status: 'reauth_required',
            errorMessage: 'Google отклонил авторизацию — обновите cURL/cookie',
            fetchedAt: nowIso,
            buckets: [],
          },
        };
      }

      if (!rpcResp.ok) {
        return {
          snapshot: {
            accountId,
            providerType: 'gemini',
            planName: 'Gemini',
            status: 'error',
            errorMessage: `RPC ошибка Gemini (HTTP ${rpcResp.status})`,
            fetchedAt: nowIso,
            buckets: [],
          },
          // The cached at-token is the usual culprit; drop it so the next sync re-reads it
          updatedCredentials: { ...credentials, atToken: undefined },
        };
      }

      const responseText = await rpcResp.text();
      const chunks = parseBatchexecuteChunks(responseText);
      const match = chunks.find(([id]) => id === USAGE_RPC_ID);

      const buckets: QuotaBucket[] = [];
      const payload = match ? match[1] : null;

      if (payload && Array.isArray(payload) && Array.isArray(payload[1])) {
        for (const bucketItem of payload[1]) {
          const bucketType = bucketItem[2];
          const typeMeta = BUCKET_LABELS[bucketType];
          if (!typeMeta) continue;

          const rawFraction = bucketItem[1] ?? 0;
          const pct = Math.min(100, Math.max(0, Math.round(rawFraction * 1000) / 10));
          const remaining = Math.round((100 - pct) * 10) / 10;

          const ts = findTimestamp(bucketItem);
          const resetsAtIso = ts ? new Date(ts * 1000).toISOString() : null;

          buckets.push({
            id: `bucket_${bucketType}`,
            label: typeMeta.label,
            windowType: typeMeta.windowType,
            utilizationPercent: pct,
            remainingPercent: remaining,
            resetsAt: resetsAtIso,
            resetSecondsRemaining: calculateSecondsRemaining(resetsAtIso),
            isExhausted: pct >= 100,
            severity: calculateSeverity(pct),
          });
        }
      }

      return {
        snapshot: {
          accountId,
          providerType: 'gemini',
          planName: buckets.length ? 'AI Pro' : 'Gemini',
          status: 'ok',
          fetchedAt: nowIso,
          buckets,
        },
        updatedCredentials: {
          ...credentials,
          atToken,
          bl,
          sid,
        },
      };
    } catch (err: any) {
      return {
        snapshot: {
          accountId,
          providerType: 'gemini',
          planName: 'Google AI Pro',
          status: 'error',
          errorMessage: err?.message || 'Сбой связи с Google Gemini',
          fetchedAt: nowIso,
          buckets: [],
        },
      };
    }
  }
}
