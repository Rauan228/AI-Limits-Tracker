import type { AccountCredentials, ProviderType, UsageSnapshot } from '../../src/models/types';
import { parseManualInput } from '../../src/services/curlParser';
import { bindingBucket, mergeWithPrevious } from '../../src/services/providers/common';
import { getProvider } from '../../src/services/providers';
import { PROVIDER_NAMES } from '../../src/constants/theme';
import { notify } from './notify';
import { ServerAccount, Store } from './store';

export type ConnectResult = { ok: true; account: ServerAccount } | { ok: false; error: string };

export class Tracker {
  private inFlight = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  lastSyncAllAt: string | null = null;

  constructor(private store: Store) {}

  /* ---------------- Polling ---------------- */

  intervalMin(): number {
    return Number(this.store.getSetting('interval_min')) || Number(process.env.POLL_INTERVAL_MIN) || 5;
  }

  setIntervalMin(min: number): void {
    this.store.setSetting('interval_min', String(Math.max(1, Math.min(120, Math.round(min)))));
    this.start();
  }

  start(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.syncAll().catch(() => {}), this.intervalMin() * 60 * 1000);
    this.syncAll().catch(() => {});
    // Keep roughly 13 months of history
    this.store.pruneHistory(Date.now() - 400 * 86400 * 1000);
  }

  async syncAll(): Promise<void> {
    const accounts = this.store.listAccounts().filter((a) => a.isActive);
    await Promise.allSettled(accounts.map((a) => this.sync(a.id)));
    this.lastSyncAllAt = new Date().toISOString();
  }

  /** One sync per account at a time — refresh tokens rotate and must not race. */
  sync(accountId: string): Promise<void> {
    const running = this.inFlight.get(accountId);
    if (running) return running;
    const p = this.doSync(accountId).finally(() => this.inFlight.delete(accountId));
    this.inFlight.set(accountId, p);
    return p;
  }

  private async doSync(accountId: string): Promise<void> {
    const account = this.store.getAccount(accountId);
    if (!account) return;
    const creds = this.store.getCredentials(accountId) || {};
    const result = await getProvider(account.providerType).fetchUsage(accountId, creds);
    if (result.updatedCredentials) this.store.setCredentials(accountId, result.updatedCredentials);

    const snapshot = mergeWithPrevious(result.snapshot, account.latestSnapshot);
    const previousStatus = account.lastStatus;
    const updated: ServerAccount = {
      ...account,
      plan: (result.snapshot.status === 'ok' && result.snapshot.planName) || account.plan,
      email: result.snapshot.email || account.email,
      lastSyncAt: new Date().toISOString(),
      lastStatus: result.snapshot.status,
      lastError: result.snapshot.errorMessage,
      latestSnapshot: snapshot,
    };
    // Re-read so a rename made during the request is not overwritten
    const fresh = this.store.getAccount(accountId);
    if (!fresh) return;
    this.store.upsertAccount({ ...updated, name: fresh.name, orderIndex: fresh.orderIndex, isActive: fresh.isActive });

    if (snapshot.status === 'ok' && !snapshot.isStale) this.recordHistory(accountId, snapshot);
    await this.checkAlerts(updated, snapshot, previousStatus);
  }

  private recordHistory(accountId: string, s: UsageSnapshot): void {
    const session = s.buckets.find((b) => b.windowType === 'session_5h') || s.buckets[0];
    const weekly = s.buckets.find((b) => b.windowType === 'weekly_7d' && b !== session);
    this.store.addHistory(accountId, Date.now(), session?.utilizationPercent ?? null, weekly?.utilizationPercent ?? null);
  }

  /* ---------------- Alerts ---------------- */

  private async alert(account: ServerAccount, kind: Parameters<Store['logAlert']>[1], title: string, body: string) {
    this.store.logAlert(account.id, kind, title, body);
    await notify(title, body);
  }

  private async checkAlerts(account: ServerAccount, snapshot: UsageSnapshot, previousStatus: string) {
    if (snapshot.status === 'reauth_required') {
      if (previousStatus !== 'reauth_required') {
        await this.alert(account, 'reauth', 'Требуется авторизация', `${account.name}: сессия истекла, войдите заново.`);
      }
      return;
    }
    if (snapshot.status !== 'ok' || snapshot.isStale) return;
    const b = bindingBucket(snapshot);
    if (!b || b.utilizationPercent === null) return;
    const used = b.utilizationPercent;
    const left = Math.max(0, Math.round(100 - used));
    const st = this.store.alertState(account.id);
    const next = { ...st };

    if (used >= 100) {
      if (st.armed0) await this.alert(account, 'exhausted', `Лимит исчерпан: ${account.name}`, `${b.label}: 0% осталось.`);
      next.armed0 = false;
    } else if (!st.armed0) {
      next.armed0 = true;
      await this.alert(account, 'restored', `Лимит восстановлен: ${account.name}`, `${b.label}: доступно ${left}%.`);
    }
    if (used >= 90) {
      if (used < 100 && st.armed10) await this.alert(account, 'low10', `Низкий лимит: ${account.name}`, `${b.label}: осталось ${left}%.`);
      next.armed10 = false;
    } else next.armed10 = true;
    if (used >= 80) {
      if (used < 90 && st.armed20) await this.alert(account, 'low20', `Низкий лимит: ${account.name}`, `${b.label}: осталось ${left}%.`);
      next.armed20 = false;
    } else next.armed20 = true;

    this.store.setAlertState(account.id, next);
  }

  /* ---------------- Connecting accounts ---------------- */

  async connectManual(provider: ProviderType, input: string, accountId?: string): Promise<ConnectResult> {
    const parsed = parseManualInput(input, provider);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return this.connect(provider, parsed.credentials, accountId);
  }

  private async connect(provider: ProviderType, credentials: AccountCredentials, existingId?: string): Promise<ConnectResult> {
    const accounts = this.store.listAccounts();
    const id = existingId || `${provider}-${Date.now().toString(36)}`;
    const result = await getProvider(provider).fetchUsage(id, credentials);
    const snapshot = result.snapshot;
    const creds = result.updatedCredentials || credentials;

    if (snapshot.status === 'reauth_required' || snapshot.status === 'not_configured') {
      return { ok: false, error: snapshot.errorMessage || 'Не удалось авторизоваться' };
    }
    const email = (snapshot.email || creds.email || '').trim().toLowerCase() || undefined;
    if (email) {
      const dup = accounts.find((a) => a.providerType === provider && a.id !== existingId && a.email?.toLowerCase() === email);
      if (dup) return { ok: false, error: `Аккаунт ${email} уже подключён как «${dup.name}».` };
    }

    const existing = accounts.find((a) => a.id === existingId);
    const plan = snapshot.planName || existing?.plan || '';
    const base = plan ? `${PROVIDER_NAMES[provider]} (${plan})` : PROVIDER_NAMES[provider];
    let name = existing?.name || base;
    if (!existing) {
      const taken = new Set(accounts.map((a) => a.name));
      for (let i = 2; taken.has(name); i++) name = `${base} #${i}`;
    }

    const account: ServerAccount = {
      id,
      name,
      providerType: provider,
      plan,
      email: email || existing?.email,
      orderIndex: existing?.orderIndex ?? accounts.length,
      isActive: true,
      lastSyncAt: new Date().toISOString(),
      lastStatus: snapshot.status,
      lastError: snapshot.errorMessage,
      createdAt: existing?.createdAt || new Date().toISOString(),
      latestSnapshot: snapshot,
    };
    this.store.upsertAccount(account);
    this.store.setCredentials(id, creds);
    if (snapshot.status === 'ok') this.recordHistory(id, snapshot);
    return { ok: true, account };
  }

  reorder(ids: string[]): void {
    ids.forEach((id, index) => {
      const a = this.store.getAccount(id);
      if (a) this.store.upsertAccount({ ...a, orderIndex: index });
    });
  }
}
