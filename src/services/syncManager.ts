import { AccountEntity, UsageSnapshot } from '../models/types';
import { saveSnapshotToDb, updateAccountSyncState } from './db';
import { checkThresholdsAndNotify } from './notificationService';
import { getProvider } from './providers';
import { mergeWithPrevious } from './providers/common';
import { getAccountCredentials, saveAccountCredentials } from './secureStore';

// One in-flight sync per account: refresh tokens rotate, so two parallel
// refreshes for the same account would invalidate each other.
const inFlightRequests = new Map<string, Promise<UsageSnapshot>>();

export async function syncAccount(
  account: AccountEntity,
  previous?: UsageSnapshot
): Promise<{ account: AccountEntity; snapshot: UsageSnapshot }> {
  const existing = inFlightRequests.get(account.id);
  if (existing) {
    const snapshot = await existing;
    return { account, snapshot };
  }

  let resolvedAccount = account;
  const syncPromise = (async () => {
    try {
      const creds = (await getAccountCredentials(account.id)) || {};
      const provider = getProvider(account.providerType);
      const result = await provider.fetchUsage(account.id, creds);

      if (result.updatedCredentials) {
        await saveAccountCredentials(account.id, result.updatedCredentials);
      }

      const snapshot = mergeWithPrevious(result.snapshot, previous);
      await saveSnapshotToDb(account.id, snapshot);

      resolvedAccount = {
        ...account,
        plan: (result.snapshot.status === 'ok' && result.snapshot.planName) || account.plan,
        email: result.snapshot.email || account.email,
        lastSyncAt: new Date().toISOString(),
        lastStatus: result.snapshot.status,
        lastError: result.snapshot.errorMessage,
      };
      await updateAccountSyncState(resolvedAccount);

      try {
        await checkThresholdsAndNotify(resolvedAccount, snapshot, account.lastStatus);
      } catch {
        // Notifications must never break a sync
      }

      return snapshot;
    } finally {
      inFlightRequests.delete(account.id);
    }
  })();

  inFlightRequests.set(account.id, syncPromise);
  const snapshot = await syncPromise;
  return { account: resolvedAccount, snapshot };
}

export async function syncAccounts(
  accounts: AccountEntity[],
  previous: Record<string, UsageSnapshot>
): Promise<{ accounts: Record<string, AccountEntity>; snapshots: Record<string, UsageSnapshot> }> {
  const out = { accounts: {} as Record<string, AccountEntity>, snapshots: {} as Record<string, UsageSnapshot> };
  const settled = await Promise.allSettled(
    accounts.filter((a) => a.isActive).map((a) => syncAccount(a, previous[a.id]))
  );
  for (const item of settled) {
    if (item.status === 'fulfilled') {
      out.accounts[item.value.account.id] = item.value.account;
      out.snapshots[item.value.account.id] = item.value.snapshot;
    }
  }
  return out;
}
