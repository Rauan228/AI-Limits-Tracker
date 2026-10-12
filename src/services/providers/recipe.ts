import {
  AccountCredentials,
  ProviderRecipe,
  ProviderType,
  QuotaBucket,
  ResetFormat,
  UsageSnapshot,
  WindowMapping,
} from '../../models/types';
import { isolatedFetch, readJsonSafe } from '../http';
import { failureSnapshot, makeBucket } from './common';
import { getRecipe } from './recipes';
import { ProviderFetchResult, UsageProvider } from './UsageProvider';

/** Resolves a path like `a.b[0].c` or `a/b/0/c` against a parsed JSON value. */
export function resolvePath(root: any, path: string | undefined): any {
  if (!path) return undefined;
  const parts = path
    .replace(/\[(\w+)\]/g, '.$1')
    .split(/[./]/)
    .filter(Boolean);
  let cur = root;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function toNumber(v: any): number | null {
  if (typeof v === 'number' && !isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[, ]/g, ''));
    return isNaN(n) ? null : n;
  }
  return null;
}

function resetToIso(value: any, format: ResetFormat | undefined): string | null {
  if (value == null) return null;
  const n = toNumber(value);
  switch (format) {
    case 'unix_s':
      return n == null ? null : new Date(n * 1000).toISOString();
    case 'unix_ms':
      return n == null ? null : new Date(n).toISOString();
    case 'seconds_from_now':
      return n == null ? null : new Date(Date.now() + n * 1000).toISOString();
    case 'ms_from_now':
      return n == null ? null : new Date(Date.now() + n).toISOString();
    case 'iso':
    default: {
      const d = new Date(typeof value === 'string' ? value : n ?? NaN);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
  }
}

/** Turns one mapping + the response body into a bucket, or null if no data. */
export function mapWindow(body: any, m: WindowMapping): QuotaBucket | null {
  let usedPercent: number | null = null;

  if (m.usedPercentPath) {
    const raw = toNumber(resolvePath(body, m.usedPercentPath));
    if (raw != null) {
      const scaled = m.percentScale === 1 ? raw * 100 : raw;
      usedPercent = m.valueIsRemaining ? 100 - scaled : scaled;
    }
  } else if (m.usedPath && m.limitPath) {
    const used = toNumber(resolvePath(body, m.usedPath));
    const limit = toNumber(resolvePath(body, m.limitPath));
    if (used != null && limit && limit > 0) {
      usedPercent = (used / limit) * 100;
      const resetIso = resetToIso(resolvePath(body, m.resetPath), m.resetFormat);
      return makeBucket(m.id, m.label, m.windowType, usedPercent, resetIso, {
        used: String(used),
        limit: String(limit),
        currency: m.unit,
      });
    }
  } else if (m.remainingPath && m.limitPath) {
    const remaining = toNumber(resolvePath(body, m.remainingPath));
    const limit = toNumber(resolvePath(body, m.limitPath));
    if (remaining != null && limit && limit > 0) {
      usedPercent = ((limit - remaining) / limit) * 100;
    }
  }

  if (usedPercent == null) return null;
  const resetIso = resetToIso(resolvePath(body, m.resetPath), m.resetFormat);
  return makeBucket(m.id, m.label, m.windowType, usedPercent, resetIso);
}

const USED_KEYS = /^(used|numrequests|used_count|usedrequests|requests_used|consumed|usage_used)$/i;
const LIMIT_KEYS = /^(limit|max|total|maxrequestusage|allotment|quota|max_requests|total_requests|monthly_limit|totalmessagepointallotment)$/i;
const REMAINING_KEYS = /^(remaining|remainingqueries|messagepointbalance|left|balance|remaining_count)$/i;
const PERCENT_KEYS = /(percent|utilization|pct)/i;
const RESET_KEYS = /(reset|expires|renew|refill|window)/i;

/**
 * Best-effort discovery of usage windows in an arbitrary JSON response, for
 * 'custom' accounts where the user hasn't mapped fields. Finds used/limit or
 * remaining/limit pairs and standalone percentages.
 */
export function autoDetectWindows(body: any, max = 4): QuotaBucket[] {
  const buckets: QuotaBucket[] = [];
  const seen = new Set<string>();

  const visit = (node: any, path: string, label: string) => {
    if (buckets.length >= max || node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.slice(0, 4).forEach((v, i) => visit(v, `${path}[${i}]`, label));
      return;
    }
    const keys = Object.keys(node);
    let used: string | undefined, limit: string | undefined, remaining: string | undefined, pct: string | undefined, reset: string | undefined;
    for (const k of keys) {
      const v = node[k];
      if (typeof v === 'number') {
        if (USED_KEYS.test(k)) used = k;
        else if (LIMIT_KEYS.test(k)) limit = k;
        else if (REMAINING_KEYS.test(k)) remaining = k;
        else if (PERCENT_KEYS.test(k)) pct = k;
      }
      if ((typeof v === 'number' || typeof v === 'string') && RESET_KEYS.test(k)) reset = k;
    }
    const mkLabel = label || 'Лимит';
    const resetIso = reset ? resolvePath(node, reset) : null;
    const fmt = reset && /window/i.test(reset) ? 'seconds_from_now' : undefined;
    if ((used && limit) || (remaining && limit)) {
      const sig = `${path}:${used || remaining}/${limit}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        const u = Number(node[used || '']);
        const l = Number(node[limit!]);
        const r = Number(node[remaining || '']);
        const usedPct = used ? (u / l) * 100 : ((l - r) / l) * 100;
        const b = makeBucket(path || 'window', mkLabel, 'sliding_window', usedPct, resetToIso(resetIso, fmt as any),
          used ? { used: String(u), limit: String(l) } : { used: String(l - r), limit: String(l) });
        buckets.push(b);
      }
    } else if (pct) {
      const sig = `${path}:${pct}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        let p = Number(node[pct]);
        if (p <= 1) p *= 100;
        buckets.push(makeBucket(path || 'window', mkLabel, 'sliding_window', p, resetToIso(resetIso, fmt as any)));
      }
    }
    // Recurse into nested objects (their key becomes the label)
    for (const k of keys) {
      if (node[k] && typeof node[k] === 'object') visit(node[k], path ? `${path}.${k}` : k, k);
    }
  };

  visit(body, '', '');
  return buckets;
}

export function applyRecipe(
  accountId: string,
  providerType: ProviderType,
  recipe: ProviderRecipe,
  body: any
): UsageSnapshot {
  const buckets: QuotaBucket[] = [];
  for (const w of recipe.windows) {
    const b = mapWindow(body, w);
    if (b) buckets.push(b);
  }
  // Custom accounts with no explicit mapping: try to discover windows
  if (!buckets.length && (!recipe.windows || recipe.windows.length === 0)) {
    buckets.push(...autoDetectWindows(body));
  }
  const plan = recipe.planPath ? String(resolvePath(body, recipe.planPath) ?? '') : '';
  const email = recipe.emailPath ? resolvePath(body, recipe.emailPath) : undefined;
  return {
    accountId,
    providerType,
    planName: plan,
    status: 'ok',
    fetchedAt: new Date().toISOString(),
    buckets,
    email: typeof email === 'string' ? email : undefined,
  };
}

/**
 * Drives any provider described by a ProviderRecipe. Built-in services
 * (Cursor, Copilot, Perplexity, Grok, Mistral, DeepSeek, Poe) get their recipe
 * from recipes.ts; 'custom' accounts carry theirs in credentials.recipe.
 */
export class RecipeProvider implements UsageProvider {
  readonly id: string;
  readonly type: ProviderType;
  readonly name: string;

  constructor(type: ProviderType, name: string) {
    this.id = type;
    this.type = type;
    this.name = name;
  }

  private recipeFor(credentials: AccountCredentials): ProviderRecipe | null {
    if (this.type === 'custom') return credentials.recipe || null;
    return getRecipe(this.type);
  }

  validateCredentials(credentials: AccountCredentials): boolean {
    const recipe = this.recipeFor(credentials);
    if (!recipe) return false;
    return recipe.auth === 'bearer'
      ? Boolean(credentials.accessToken || credentials.apiKey)
      : Boolean(credentials.cookies);
  }

  async fetchUsage(accountId: string, credentials: AccountCredentials): Promise<ProviderFetchResult> {
    const recipe = this.recipeFor(credentials);
    if (!recipe) {
      return { snapshot: failureSnapshot(accountId, this.type, 'not_configured', 'Нет рецепта для этого сервиса') };
    }
    if (!this.validateCredentials(credentials)) {
      return { snapshot: failureSnapshot(accountId, this.type, 'not_configured', 'Аккаунт не подключён') };
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ...(recipe.extraHeaders || {}),
    };
    if (recipe.auth === 'bearer') {
      headers.Authorization = `Bearer ${credentials.accessToken || credentials.apiKey}`;
    } else if (credentials.cookies) {
      headers.Cookie = credentials.cookies;
    }
    if (recipe.method === 'POST') headers['Content-Type'] = headers['Content-Type'] || 'application/json';

    try {
      const resp = await isolatedFetch(recipe.usageUrl, {
        method: recipe.method || 'GET',
        headers,
        body: recipe.method === 'POST' ? recipe.body : undefined,
      });

      if (resp.status === 401 || resp.status === 403) {
        return { snapshot: failureSnapshot(accountId, this.type, 'reauth_required', 'Сессия истекла — переподключите аккаунт') };
      }
      if (resp.status === 429) {
        return { snapshot: failureSnapshot(accountId, this.type, 'rate_limited', 'Слишком частые запросы — повторим позже') };
      }
      if (!resp.ok) {
        return { snapshot: failureSnapshot(accountId, this.type, 'error', `Сервис вернул HTTP ${resp.status}`) };
      }

      const body = await readJsonSafe(resp);
      if (!body) {
        return { snapshot: failureSnapshot(accountId, this.type, 'error', 'Ответ не является JSON — проверьте URL в рецепте') };
      }

      const snapshot = applyRecipe(accountId, this.type, recipe, body);
      if (!snapshot.buckets.length) {
        return {
          snapshot: failureSnapshot(
            accountId,
            this.type,
            'error',
            recipe.needsVerification
              ? 'Рецепт ещё не выверен под реальный ответ — пришлите cURL этого сервиса'
              : 'Не удалось прочитать лимиты из ответа'
          ),
        };
      }
      return { snapshot };
    } catch (err: any) {
      return {
        snapshot: failureSnapshot(
          accountId,
          this.type,
          'error',
          err?.name === 'AbortError' ? 'Сервис не ответил вовремя' : err?.message || 'Сбой сети'
        ),
      };
    }
  }
}
