import { create } from 'zustand';
import { AccountCredentials, AccountEntity, ProviderType, UsageSnapshot } from '../models/types';
import {
  deleteAccountFromDb,
  getAllAccounts,
  getLatestSnapshots,
  getSetting,
  initDatabase,
  pruneHistory,
  saveSnapshotToDb,
  setSetting,
  upsertAccount,
} from '../services/db';
import { getProvider } from '../services/providers';
import { deleteAccountCredentials, saveAccountCredentials } from '../services/secureStore';
import { syncAccount, syncAccounts } from '../services/syncManager';
import { PROVIDER_NAMES } from '../constants/theme';

export type ConnectResult =
  | { ok: true; accountId: string; snapshot: UsageSnapshot }
  | { ok: false; error: string };

interface AppState {
  isReady: boolean;
  accounts: AccountEntity[];
  snapshots: Record<string, UsageSnapshot>;
  isSyncing: boolean;
  lastSyncAllAt: string | null;
  refreshIntervalMin: number;
  userName: string;

  initializeStore: () => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshSingle: (accountId: string) => Promise<void>;
  /** Binds freshly obtained credentials to a new account, or to an existing one (reconnect). */
  connectAccount: (
    providerType: ProviderType,
    credentials: AccountCredentials,
    existingAccountId?: string
  ) => Promise<ConnectResult>;
  renameAccount: (accountId: string, name: string) => Promise<void>;
  setAccountActive: (accountId: string, isActive: boolean) => Promise<void>;
  deleteAccount: (accountId: string) => Promise<void>;
  deleteAllAccounts: () => Promise<void>;
  moveAccount: (accountId: string, direction: -1 | 1) => Promise<void>;
  setRefreshInterval: (minutes: number) => Promise<void>;
  setUserName: (name: string) => Promise<void>;
}

/** Applies only the fields a sync owns, so a rename made mid-sync isn't lost. */
function applySync(current: AccountEntity, synced: AccountEntity | undefined): AccountEntity {
  if (!synced) return current;
  return {
    ...current,
    plan: synced.plan,
    email: synced.email,
    lastSyncAt: synced.lastSyncAt,
    lastStatus: synced.lastStatus,
    lastError: synced.lastError,
  };
}

function normalizeEmail(email?: string): string | undefined {
  return email ? email.trim().toLowerCase() : undefined;
}

function autoName(providerType: ProviderType, plan: string, accounts: AccountEntity[], skipId?: string): string {
  const base = plan ? `${PROVIDER_NAMES[providerType]} (${plan})` : PROVIDER_NAMES[providerType];
  const taken = new Set(accounts.filter((a) => a.id !== skipId).map((a) => a.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} #${i}`)) i++;
  return `${base} #${i}`;
}

export const useAppStore = create<AppState>((set, get) => ({
  isReady: false,
  accounts: [],
  snapshots: {},
  isSyncing: false,
  lastSyncAllAt: null,
  refreshIntervalMin: 5,
  userName: 'Рауан',

  initializeStore: async () => {
    await initDatabase();
    const [accounts, snapshots, interval, userName] = await Promise.all([
      getAllAccounts(),
      getLatestSnapshots(),
      getSetting('refresh_interval_min'),
      getSetting('user_name'),
    ]);

    // Restore last known status on top of the last numbers, so the UI is right before the first sync
    for (const acc of accounts) {
      const snap = snapshots[acc.id];
      if (snap && acc.lastStatus !== 'ok' && acc.lastStatus !== 'idle') {
        snapshots[acc.id] = {
          ...snap,
          status: acc.lastStatus,
          errorMessage: acc.lastError,
          isStale: true,
        };
      }
    }

    set({
      isReady: true,
      accounts,
      snapshots,
      refreshIntervalMin: interval ? Number(interval) || 5 : 5,
      userName: userName ?? 'Рауан',
    });

    pruneHistory(new Date(Date.now() - 400 * 86400 * 1000).toISOString()).catch(() => {});
    await get().refreshAll();
  },

  refreshAll: async () => {
    if (get().isSyncing) return;
    set({ isSyncing: true });
    try {
      const { accounts, snapshots } = get();
      const result = await syncAccounts(accounts, snapshots);
      set((state) => ({
        accounts: state.accounts.map((a) => applySync(a, result.accounts[a.id])),
        snapshots: { ...state.snapshots, ...result.snapshots },
        lastSyncAllAt: new Date().toISOString(),
      }));
    } finally {
      set({ isSyncing: false });
    }
  },

  refreshSingle: async (accountId) => {
    const target = get().accounts.find((a) => a.id === accountId);
    if (!target) return;
    const { account, snapshot } = await syncAccount(target, get().snapshots[accountId]);
    set((state) => ({
      accounts: state.accounts.map((a) => (a.id === accountId ? applySync(a, account) : a)),
      snapshots: { ...state.snapshots, [accountId]: snapshot },
    }));
  },

  connectAccount: async (providerType, credentials, existingAccountId) => {
    const { accounts } = get();
    const accountId = existingAccountId || `${providerType}-${Date.now().toString(36)}`;

    // One real request validates the credentials and tells us who this account is
    const result = await getProvider(providerType).fetchUsage(accountId, credentials);
    const finalCreds = result.updatedCredentials || credentials;
    const snapshot = result.snapshot;

    if (snapshot.status === 'reauth_required' || snapshot.status === 'not_configured') {
      return { ok: false, error: snapshot.errorMessage || 'Не удалось авторизоваться' };
    }

    const email = normalizeEmail(snapshot.email || finalCreds.email);
    if (email) {
      const duplicate = accounts.find(
        (a) => a.providerType === providerType && a.id !== existingAccountId && normalizeEmail(a.email) === email
      );
      if (duplicate) {
        return {
          ok: false,
          error: `Этот аккаунт (${email}) уже подключён как «${duplicate.name}». Войдите в другой аккаунт.`,
        };
      }
    }

    await saveAccountCredentials(accountId, finalCreds);

    const existing = accounts.find((a) => a.id === existingAccountId);
    const plan = snapshot.planName || existing?.plan || '';
    const account: AccountEntity = {
      id: accountId,
      providerType,
      name: existing?.name || autoName(providerType, plan, accounts),
      plan,
      email: email || existing?.email,
      orderIndex: existing?.orderIndex ?? accounts.length,
      isActive: true,
      lastSyncAt: new Date().toISOString(),
      lastStatus: snapshot.status,
      lastError: snapshot.errorMessage,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    await upsertAccount(account);
    await saveSnapshotToDb(accountId, snapshot);

    set((state) => ({
      accounts: existing
        ? state.accounts.map((a) => (a.id === accountId ? account : a))
        : [...state.accounts, account],
      snapshots: { ...state.snapshots, [accountId]: snapshot },
    }));

    return { ok: true, accountId, snapshot };
  },

  renameAccount: async (accountId, name) => {
    const target = get().accounts.find((a) => a.id === accountId);
    const trimmed = name.trim();
    if (!target || !trimmed) return;
    const updated = { ...target, name: trimmed };
    await upsertAccount(updated);
    set((state) => ({ accounts: state.accounts.map((a) => (a.id === accountId ? updated : a)) }));
  },

  setAccountActive: async (accountId, isActive) => {
    const target = get().accounts.find((a) => a.id === accountId);
    if (!target) return;
    const updated = { ...target, isActive };
    await upsertAccount(updated);
    set((state) => ({ accounts: state.accounts.map((a) => (a.id === accountId ? updated : a)) }));
  },

  deleteAccount: async (accountId) => {
    await deleteAccountCredentials(accountId);
    await deleteAccountFromDb(accountId);
    set((state) => {
      const nextSnaps = { ...state.snapshots };
      delete nextSnaps[accountId];
      return { accounts: state.accounts.filter((a) => a.id !== accountId), snapshots: nextSnaps };
    });
  },

  deleteAllAccounts: async () => {
    for (const acc of get().accounts) {
      await deleteAccountCredentials(acc.id);
      await deleteAccountFromDb(acc.id);
    }
    set({ accounts: [], snapshots: {} });
  },

  moveAccount: async (accountId, direction) => {
    const list = [...get().accounts];
    const idx = list.findIndex((a) => a.id === accountId);
    const swap = idx + direction;
    if (idx < 0 || swap < 0 || swap >= list.length) return;
    [list[idx], list[swap]] = [list[swap], list[idx]];
    const reindexed = list.map((a, i) => ({ ...a, orderIndex: i }));
    set({ accounts: reindexed });
    for (const a of reindexed) await upsertAccount(a);
  },

  setRefreshInterval: async (minutes) => {
    set({ refreshIntervalMin: minutes });
    await setSetting('refresh_interval_min', String(minutes));
  },

  setUserName: async (name) => {
    set({ userName: name.trim() });
    await setSetting('user_name', name.trim());
  },
}));
