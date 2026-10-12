/**
 * Extension tracker. Everything lives in chrome.storage.local of THIS browser
 * profile. Limits are read through the browser's own logged-in session on
 * claude.ai / chatgpt.com / gemini.google.com — the extension never signs in
 * for you and never impersonates another app. One profile holds one account
 * per service; use a second Chrome profile for a second account.
 */
import type { ProviderType, QuotaBucket, UsageSnapshot } from '../../src/models/types';
import { parseClaudeUsage } from '../../src/services/providers/ClaudeProvider';
import { parseChatGPTUsage } from '../../src/services/providers/ChatGPTProvider';
import { bindingBucket } from '../../src/services/providers/common';
import { PROVIDER_NAMES } from '../../src/constants/theme';

export interface TrackedAccount {
  provider: ProviderType;
  enabled: boolean;
  email?: string;
  plan?: string;
  snapshot?: UsageSnapshot;
  lastSyncAt?: string;
  lastError?: string;
  status: 'ok' | 'reauth' | 'error' | 'idle';
}

interface Store {
  accounts: Partial<Record<ProviderType, TrackedAccount>>;
  armed: Partial<Record<ProviderType, { a20: boolean; a10: boolean; a0: boolean }>>;
}

const DEFAULT: Store = { accounts: {}, armed: {} };
export const PROVIDERS: ProviderType[] = ['claude', 'chatgpt', 'gemini'];

export async function loadStore(): Promise<Store> {
  const d = (await chrome.storage.local.get(['accounts', 'armed'])) as Partial<Store>;
  return { accounts: d.accounts || {}, armed: d.armed || {} };
}

async function saveStore(s: Store): Promise<void> {
  await chrome.storage.local.set(s);
}

export async function setEnabled(provider: ProviderType, enabled: boolean): Promise<void> {
  const s = await loadStore();
  const acc = s.accounts[provider] || { provider, enabled, status: 'idle' as const };
  s.accounts[provider] = { ...acc, enabled };
  await saveStore(s);
}

/* ---------------- Reading limits via the browser session ---------------- */

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; data: any; text: string }> {
  // credentials:'include' uses the browser's existing cookies for that origin
  const resp = await fetch(url, { ...init, credentials: 'include' });
  const text = await resp.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: resp.status, data, text };
}

async function readClaude(): Promise<Partial<TrackedAccount>> {
  const orgs = await fetchJson('https://claude.ai/api/organizations');
  if (orgs.status === 401 || orgs.status === 403) return { status: 'reauth', lastError: 'Войдите в claude.ai в этом браузере' };
  if (!orgs.data) return { status: 'error', lastError: `Claude HTTP ${orgs.status}` };
  const list: any[] = Array.isArray(orgs.data) ? orgs.data : orgs.data.organizations || [];
  const org =
    list.find((o) => (o.capabilities || []).some((c: string) => /claude_(max|pro|team)/.test(c))) || list[0];
  if (!org) return { status: 'reauth', lastError: 'Нет организации Claude' };
  const caps: string[] = org.capabilities || [];
  let plan = caps.includes('claude_max') ? 'Max' : caps.includes('claude_team') ? 'Team' : caps.includes('claude_pro') ? 'Pro' : 'Free';
  const tier = String(org.rate_limit_tier || '');
  if (/20x/.test(tier)) plan = 'Max 20x';
  else if (/5x/.test(tier)) plan = 'Max 5x';

  const usage = await fetchJson(`https://claude.ai/api/organizations/${org.uuid || org.id}/usage`);
  if (usage.status === 401 || usage.status === 403) return { status: 'reauth', lastError: 'Сессия Claude истекла' };
  if (!usage.data) return { status: 'error', lastError: `Claude usage HTTP ${usage.status}` };
  const buckets = parseClaudeUsage(usage.data);
  return { status: 'ok', plan, email: org.billing_email || org.name, snapshot: snap('claude', plan, buckets, org.billing_email) };
}

async function readChatGPT(): Promise<Partial<TrackedAccount>> {
  const session = await fetchJson('https://chatgpt.com/api/auth/session');
  if (session.status === 401 || !session.data?.accessToken) return { status: 'reauth', lastError: 'Войдите в chatgpt.com в этом браузере' };
  const token: string = session.data.accessToken;
  const email: string | undefined = session.data.user?.email;
  const usage = await fetchJson('https://chatgpt.com/backend-api/wham/usage', {
    headers: { Authorization: `Bearer ${token}`, originator: 'codex_cli_rs', 'OpenAI-Beta': 'responses=experimental' },
  });
  if (usage.status === 401 || usage.status === 403) return { status: 'reauth', lastError: 'Нет доступа к лимитам ChatGPT' };
  const parsed = parseChatGPTUsage(usage.data || {});
  const plan = parsed.plan || 'Plus';
  return { status: 'ok', plan, email, snapshot: snap('chatgpt', plan, parsed.buckets, email) };
}

async function readGemini(): Promise<Partial<TrackedAccount>> {
  // Gemini has no stable session-usage endpoint callable from an extension.
  return { status: 'error', lastError: 'Gemini доступен только в приложении/на сервере (через cURL)' };
}

function snap(provider: ProviderType, plan: string, buckets: QuotaBucket[], email?: string): UsageSnapshot {
  return { accountId: provider, providerType: provider, planName: plan, status: 'ok', fetchedAt: new Date().toISOString(), buckets, email };
}

export async function syncProvider(provider: ProviderType): Promise<TrackedAccount> {
  const s = await loadStore();
  const prev = s.accounts[provider] || { provider, enabled: true, status: 'idle' as const };
  let patch: Partial<TrackedAccount>;
  try {
    patch =
      provider === 'claude' ? await readClaude() : provider === 'chatgpt' ? await readChatGPT() : await readGemini();
  } catch (e: any) {
    patch = { status: 'error', lastError: e?.message || 'Сбой запроса' };
  }
  const acc: TrackedAccount = {
    ...prev,
    ...patch,
    provider,
    enabled: prev.enabled,
    lastSyncAt: new Date().toISOString(),
    snapshot: patch.snapshot || (patch.status === 'ok' ? prev.snapshot : prev.snapshot),
  };
  s.accounts[provider] = acc;
  await saveStore(s);
  if (acc.status === 'ok' && acc.snapshot) await checkAlerts(provider, acc, s);
  return acc;
}

export async function syncAll(): Promise<void> {
  const s = await loadStore();
  const enabled = PROVIDERS.filter((p) => s.accounts[p]?.enabled);
  await Promise.allSettled((enabled.length ? enabled : PROVIDERS).map((p) => syncProvider(p)));
  await updateBadge();
}

/* ---------------- Badge & notifications ---------------- */

export async function updateBadge(): Promise<void> {
  const s = await loadStore();
  let worst: number | null = null;
  let reauth = false;
  for (const p of PROVIDERS) {
    const acc = s.accounts[p];
    if (!acc?.enabled) continue;
    if (acc.status === 'reauth') reauth = true;
    const b = bindingBucket(acc.snapshot);
    if (b?.remainingPercent != null) worst = worst === null ? b.remainingPercent : Math.min(worst, b.remainingPercent);
  }
  const text = reauth && worst === null ? '!' : worst === null ? '' : `${Math.round(worst)}`;
  const color = reauth ? '#ef4444' : worst === null ? '#71717a' : worst <= 15 ? '#ef4444' : worst <= 35 ? '#f97316' : '#1f9d74';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function checkAlerts(provider: ProviderType, acc: TrackedAccount, s: Store): Promise<void> {
  const b = bindingBucket(acc.snapshot);
  if (!b || b.utilizationPercent === null) return;
  const used = b.utilizationPercent;
  const left = Math.max(0, Math.round(100 - used));
  const armed = s.armed[provider] || { a20: true, a10: true, a0: true };
  const name = PROVIDER_NAMES[provider];
  const notify = (title: string, message: string) =>
    chrome.notifications.create(`${provider}-${Date.now()}`, { type: 'basic', iconUrl: 'icons/128.png', title, message });

  if (used >= 100) {
    if (armed.a0) notify(`Лимит исчерпан: ${name}`, `${b.label}: 0% осталось.`);
    armed.a0 = false;
  } else {
    if (!armed.a0) notify(`Лимит восстановлен: ${name}`, `${b.label}: доступно ${left}%.`);
    armed.a0 = true;
  }
  if (used >= 90) {
    if (used < 100 && armed.a10) notify(`Низкий лимит: ${name}`, `${b.label}: осталось ${left}%.`);
    armed.a10 = false;
  } else armed.a10 = true;
  if (used >= 80) {
    if (used < 90 && armed.a20) notify(`Низкий лимит: ${name}`, `${b.label}: осталось ${left}%.`);
    armed.a20 = false;
  } else armed.a20 = true;
  s.armed[provider] = armed;
  await saveStore(s);
}
