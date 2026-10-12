import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import {
  AccountEntity,
  AlertKind,
  AlertLogEntry,
  NotificationSettings,
  UsageHistoryPoint,
  UsageSnapshot,
} from '../models/types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// In-memory fallback for Web platform where SQLite native driver is not loaded
const WEB_ACCOUNTS = new Map<string, AccountEntity>();
const WEB_SNAPSHOTS: Array<UsageHistoryPoint & { snapshot: UsageSnapshot }> = [];
const WEB_NOTIFICATIONS = new Map<string, NotificationSettings>();
const WEB_ALERTS: AlertLogEntry[] = [];
const WEB_SETTINGS = new Map<string, string>();

export async function getDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (Platform.OS === 'web') return null;
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('ai_limits_tracker.db');
  }
  return dbPromise;
}

export async function initDatabase(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      plan TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      last_sync_at TEXT,
      last_status TEXT DEFAULT 'idle',
      last_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      snapshot_data TEXT NOT NULL,
      primary_utilization REAL,
      secondary_utilization REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notification_settings (
      account_id TEXT PRIMARY KEY,
      notify_at_20 INTEGER DEFAULT 1,
      notify_at_10 INTEGER DEFAULT 1,
      notify_at_0 INTEGER DEFAULT 1,
      notify_on_restore INTEGER DEFAULT 1,
      notify_on_reauth INTEGER DEFAULT 1,
      is_armed_20 INTEGER DEFAULT 1,
      is_armed_10 INTEGER DEFAULT 1,
      is_armed_0 INTEGER DEFAULT 1,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS alert_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_account ON usage_snapshots(account_id, created_at);
  `);

  // v2 migration: identity of the real provider account behind each slot
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(accounts)');
  if (!columns.some((c) => c.name === 'email')) {
    await db.execAsync('ALTER TABLE accounts ADD COLUMN email TEXT');
  }
}

function rowToAccount(r: any): AccountEntity {
  return {
    id: r.id,
    name: r.name,
    providerType: r.provider_type,
    plan: r.plan,
    email: r.email || undefined,
    orderIndex: r.order_index,
    isActive: Boolean(r.is_active),
    lastSyncAt: r.last_sync_at || undefined,
    lastStatus: r.last_status || 'idle',
    lastError: r.last_error || undefined,
    createdAt: r.created_at,
  };
}

export async function getAllAccounts(): Promise<AccountEntity[]> {
  const db = await getDb();
  if (!db) {
    return Array.from(WEB_ACCOUNTS.values()).sort((a, b) => a.orderIndex - b.orderIndex);
  }
  const rows = await db.getAllAsync<any>('SELECT * FROM accounts ORDER BY order_index ASC, created_at ASC');
  return rows.map(rowToAccount);
}

export async function upsertAccount(account: AccountEntity): Promise<void> {
  const db = await getDb();
  if (!db) {
    const { latestSnapshot, ...rest } = account;
    WEB_ACCOUNTS.set(account.id, rest);
    return;
  }

  await db.runAsync(
    `INSERT INTO accounts (id, name, provider_type, plan, email, order_index, is_active, last_sync_at, last_status, last_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       provider_type = excluded.provider_type,
       plan = excluded.plan,
       email = excluded.email,
       order_index = excluded.order_index,
       is_active = excluded.is_active,
       last_sync_at = excluded.last_sync_at,
       last_status = excluded.last_status,
       last_error = excluded.last_error;`,
    [
      account.id,
      account.name,
      account.providerType,
      account.plan,
      account.email || null,
      account.orderIndex,
      account.isActive ? 1 : 0,
      account.lastSyncAt || null,
      account.lastStatus,
      account.lastError || null,
      account.createdAt,
    ]
  );
}

/** Updates only the fields owned by a sync (never name/order chosen by the user). */
export async function updateAccountSyncState(account: AccountEntity): Promise<void> {
  const db = await getDb();
  if (!db) {
    const current = WEB_ACCOUNTS.get(account.id);
    if (current) {
      WEB_ACCOUNTS.set(account.id, {
        ...current,
        plan: account.plan,
        email: account.email,
        lastSyncAt: account.lastSyncAt,
        lastStatus: account.lastStatus,
        lastError: account.lastError,
      });
    }
    return;
  }
  await db.runAsync(
    'UPDATE accounts SET plan = ?, email = ?, last_sync_at = ?, last_status = ?, last_error = ? WHERE id = ?',
    [
      account.plan,
      account.email || null,
      account.lastSyncAt || null,
      account.lastStatus,
      account.lastError || null,
      account.id,
    ]
  );
}

export async function deleteAccountFromDb(accountId: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    WEB_ACCOUNTS.delete(accountId);
    WEB_NOTIFICATIONS.delete(accountId);
    return;
  }
  await db.runAsync('DELETE FROM usage_snapshots WHERE account_id = ?', [accountId]);
  await db.runAsync('DELETE FROM notification_settings WHERE account_id = ?', [accountId]);
  await db.runAsync('DELETE FROM alert_log WHERE account_id = ?', [accountId]);
  await db.runAsync('DELETE FROM accounts WHERE id = ?', [accountId]);
}

/** Only successful snapshots with numbers are worth charting. */
function primaryValues(snapshot: UsageSnapshot): [number | null, number | null] {
  const session = snapshot.buckets.find((b) => b.windowType === 'session_5h') || snapshot.buckets[0];
  const weekly = snapshot.buckets.find((b) => b.windowType === 'weekly_7d' && b !== session);
  return [session?.utilizationPercent ?? null, weekly?.utilizationPercent ?? null];
}

export async function saveSnapshotToDb(accountId: string, snapshot: UsageSnapshot): Promise<void> {
  if (snapshot.status !== 'ok' || snapshot.isStale) return;
  const [primaryVal, secondaryVal] = primaryValues(snapshot);
  const now = snapshot.fetchedAt;

  const db = await getDb();
  if (!db) {
    WEB_SNAPSHOTS.push({
      id: WEB_SNAPSHOTS.length + 1,
      accountId,
      primaryUtilization: primaryVal,
      secondaryUtilization: secondaryVal,
      fetchedAt: now,
      snapshot,
    });
    return;
  }

  await db.runAsync(
    `INSERT INTO usage_snapshots (account_id, snapshot_data, primary_utilization, secondary_utilization, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [accountId, JSON.stringify(snapshot), primaryVal, secondaryVal, now]
  );
}

export async function getLatestSnapshots(): Promise<Record<string, UsageSnapshot>> {
  const result: Record<string, UsageSnapshot> = {};
  const db = await getDb();
  if (!db) {
    for (const s of WEB_SNAPSHOTS) result[s.accountId] = s.snapshot;
    return result;
  }
  const rows = await db.getAllAsync<{ account_id: string; snapshot_data: string }>(
    `SELECT s.account_id, s.snapshot_data FROM usage_snapshots s
     JOIN (SELECT account_id, MAX(id) AS max_id FROM usage_snapshots GROUP BY account_id) m
       ON s.id = m.max_id`
  );
  for (const r of rows) {
    try {
      result[r.account_id] = JSON.parse(r.snapshot_data);
    } catch {}
  }
  return result;
}

export async function getHistoryFromDb(accountId: string, limit: number = 30): Promise<UsageHistoryPoint[]> {
  const db = await getDb();
  if (!db) {
    return WEB_SNAPSHOTS.filter((s) => s.accountId === accountId).slice(-limit);
  }
  const rows = await db.getAllAsync<any>(
    'SELECT id, account_id, primary_utilization, secondary_utilization, created_at FROM usage_snapshots WHERE account_id = ? ORDER BY id DESC LIMIT ?',
    [accountId, limit]
  );
  return rows.reverse().map((r) => ({
    id: r.id,
    accountId: r.account_id,
    primaryUtilization: r.primary_utilization,
    secondaryUtilization: r.secondary_utilization,
    fetchedAt: r.created_at,
  }));
}

/** All history points since `sinceIso`, for every account (or one). */
export async function getHistorySince(sinceIso: string, accountId?: string): Promise<UsageHistoryPoint[]> {
  const db = await getDb();
  if (!db) {
    return WEB_SNAPSHOTS.filter(
      (s) => s.fetchedAt >= sinceIso && (!accountId || s.accountId === accountId)
    );
  }
  const rows = accountId
    ? await db.getAllAsync<any>(
        'SELECT id, account_id, primary_utilization, secondary_utilization, created_at FROM usage_snapshots WHERE created_at >= ? AND account_id = ? ORDER BY created_at ASC',
        [sinceIso, accountId]
      )
    : await db.getAllAsync<any>(
        'SELECT id, account_id, primary_utilization, secondary_utilization, created_at FROM usage_snapshots WHERE created_at >= ? ORDER BY created_at ASC',
        [sinceIso]
      );
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    primaryUtilization: r.primary_utilization,
    secondaryUtilization: r.secondary_utilization,
    fetchedAt: r.created_at,
  }));
}

/** Keeps the history table from growing forever (~1 year). */
export async function pruneHistory(olderThanIso: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('DELETE FROM usage_snapshots WHERE created_at < ?', [olderThanIso]);
}

const DEFAULT_NOTIFICATION_SETTINGS = (accountId: string): NotificationSettings => ({
  accountId,
  notifyAt20: true,
  notifyAt10: true,
  notifyAt0: true,
  notifyOnRestore: true,
  notifyOnReauth: true,
  isArmed20: true,
  isArmed10: true,
  isArmed0: true,
});

export async function getNotificationSettings(accountId: string): Promise<NotificationSettings> {
  const db = await getDb();
  if (!db) return WEB_NOTIFICATIONS.get(accountId) || DEFAULT_NOTIFICATION_SETTINGS(accountId);

  const row = await db.getFirstAsync<any>('SELECT * FROM notification_settings WHERE account_id = ?', [accountId]);
  if (!row) return DEFAULT_NOTIFICATION_SETTINGS(accountId);

  return {
    accountId: row.account_id,
    notifyAt20: Boolean(row.notify_at_20),
    notifyAt10: Boolean(row.notify_at_10),
    notifyAt0: Boolean(row.notify_at_0),
    notifyOnRestore: Boolean(row.notify_on_restore),
    notifyOnReauth: Boolean(row.notify_on_reauth),
    isArmed20: Boolean(row.is_armed_20),
    isArmed10: Boolean(row.is_armed_10),
    isArmed0: Boolean(row.is_armed_0),
  };
}

export async function updateNotificationSettings(settings: NotificationSettings): Promise<void> {
  const db = await getDb();
  if (!db) {
    WEB_NOTIFICATIONS.set(settings.accountId, settings);
    return;
  }

  await db.runAsync(
    `INSERT INTO notification_settings
     (account_id, notify_at_20, notify_at_10, notify_at_0, notify_on_restore, notify_on_reauth, is_armed_20, is_armed_10, is_armed_0)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       notify_at_20 = excluded.notify_at_20,
       notify_at_10 = excluded.notify_at_10,
       notify_at_0 = excluded.notify_at_0,
       notify_on_restore = excluded.notify_on_restore,
       notify_on_reauth = excluded.notify_on_reauth,
       is_armed_20 = excluded.is_armed_20,
       is_armed_10 = excluded.is_armed_10,
       is_armed_0 = excluded.is_armed_0;`,
    [
      settings.accountId,
      settings.notifyAt20 ? 1 : 0,
      settings.notifyAt10 ? 1 : 0,
      settings.notifyAt0 ? 1 : 0,
      settings.notifyOnRestore ? 1 : 0,
      settings.notifyOnReauth ? 1 : 0,
      settings.isArmed20 ? 1 : 0,
      settings.isArmed10 ? 1 : 0,
      settings.isArmed0 ? 1 : 0,
    ]
  );
}

export async function logAlert(accountId: string, kind: AlertKind, title: string, body: string): Promise<void> {
  const createdAt = new Date().toISOString();
  const db = await getDb();
  if (!db) {
    WEB_ALERTS.push({ id: WEB_ALERTS.length + 1, accountId, kind, title, body, createdAt });
    return;
  }
  await db.runAsync('INSERT INTO alert_log (account_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?)', [
    accountId,
    kind,
    title,
    body,
    createdAt,
  ]);
}

export async function getAlertLog(limit = 50): Promise<AlertLogEntry[]> {
  const db = await getDb();
  if (!db) return WEB_ALERTS.slice(-limit).reverse();
  const rows = await db.getAllAsync<any>('SELECT * FROM alert_log ORDER BY id DESC LIMIT ?', [limit]);
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    createdAt: r.created_at,
  }));
}

export async function clearAlertLog(): Promise<void> {
  const db = await getDb();
  if (!db) {
    WEB_ALERTS.length = 0;
    return;
  }
  await db.runAsync('DELETE FROM alert_log');
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return WEB_SETTINGS.get(key) ?? null;
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    WEB_SETTINGS.set(key, value);
    return;
  }
  await db.runAsync(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}
