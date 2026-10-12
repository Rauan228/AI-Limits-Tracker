import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccountCredentials, AccountEntity, AlertKind, AlertLogEntry, UsageSnapshot } from '../../src/models/types';
import type { StatPoint } from '../../src/services/stats';

export interface ServerAccount extends AccountEntity {
  latestSnapshot?: UsageSnapshot;
}

/** Credentials are encrypted at rest with AES-256-GCM; the key comes from APP_SECRET. */
class Vault {
  private key: Buffer;
  constructor(secret: string) {
    this.key = createHash('sha256').update(`ai-limits-vault:${secret}`).digest();
  }
  encrypt(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
  }
  decrypt<T>(payload: string | null): T | null {
    if (!payload) return null;
    try {
      const [iv, tag, data] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
    } catch {
      return null;
    }
  }
}

export class Store {
  private db: DatabaseSync;
  private vault: Vault;

  constructor(path: string, secret: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.vault = new Vault(secret);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT '',
        email TEXT,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        last_sync_at TEXT,
        last_status TEXT NOT NULL DEFAULT 'idle',
        last_error TEXT,
        created_at TEXT NOT NULL,
        credentials TEXT,
        latest_snapshot TEXT
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        t INTEGER NOT NULL,
        session REAL,
        weekly REAL
      );
      CREATE INDEX IF NOT EXISTS idx_history ON history(account_id, t);
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alert_state (
        account_id TEXT PRIMARY KEY,
        armed20 INTEGER NOT NULL DEFAULT 1,
        armed10 INTEGER NOT NULL DEFAULT 1,
        armed0 INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  private rowToAccount(r: any): ServerAccount {
    return {
      id: r.id,
      name: r.name,
      providerType: r.provider_type,
      plan: r.plan,
      email: r.email || undefined,
      orderIndex: r.order_index,
      isActive: Boolean(r.is_active),
      lastSyncAt: r.last_sync_at || undefined,
      lastStatus: r.last_status,
      lastError: r.last_error || undefined,
      createdAt: r.created_at,
      latestSnapshot: r.latest_snapshot ? JSON.parse(r.latest_snapshot) : undefined,
    };
  }

  listAccounts(): ServerAccount[] {
    return this.db
      .prepare('SELECT * FROM accounts ORDER BY order_index ASC, created_at ASC')
      .all()
      .map((r) => this.rowToAccount(r));
  }

  getAccount(id: string): ServerAccount | null {
    const r = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    return r ? this.rowToAccount(r) : null;
  }

  upsertAccount(a: ServerAccount): void {
    this.db
      .prepare(
        `INSERT INTO accounts (id, name, provider_type, plan, email, order_index, is_active, last_sync_at, last_status, last_error, created_at, latest_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, provider_type=excluded.provider_type, plan=excluded.plan,
           email=excluded.email, order_index=excluded.order_index, is_active=excluded.is_active,
           last_sync_at=excluded.last_sync_at, last_status=excluded.last_status, last_error=excluded.last_error,
           latest_snapshot=excluded.latest_snapshot`
      )
      .run(
        a.id,
        a.name,
        a.providerType,
        a.plan || '',
        a.email ?? null,
        a.orderIndex,
        a.isActive ? 1 : 0,
        a.lastSyncAt ?? null,
        a.lastStatus,
        a.lastError ?? null,
        a.createdAt,
        a.latestSnapshot ? JSON.stringify(a.latestSnapshot) : null
      );
  }

  deleteAccount(id: string): void {
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM history WHERE account_id = ?').run(id);
    this.db.prepare('DELETE FROM alerts WHERE account_id = ?').run(id);
    this.db.prepare('DELETE FROM alert_state WHERE account_id = ?').run(id);
  }

  getCredentials(id: string): AccountCredentials | null {
    const r = this.db.prepare('SELECT credentials FROM accounts WHERE id = ?').get(id) as any;
    return this.vault.decrypt<AccountCredentials>(r?.credentials ?? null);
  }

  setCredentials(id: string, creds: AccountCredentials): void {
    this.db.prepare('UPDATE accounts SET credentials = ? WHERE id = ?').run(this.vault.encrypt(creds), id);
  }

  /** Stores a point only when the numbers changed or 30 min passed — keeps a year of history small. */
  addHistory(accountId: string, t: number, session: number | null, weekly: number | null): void {
    const last = this.db
      .prepare('SELECT t, session, weekly FROM history WHERE account_id = ? ORDER BY t DESC LIMIT 1')
      .get(accountId) as any;
    if (last && last.session === session && last.weekly === weekly && t - last.t < 30 * 60 * 1000) return;
    this.db.prepare('INSERT INTO history (account_id, t, session, weekly) VALUES (?, ?, ?, ?)').run(accountId, t, session, weekly);
  }

  history(sinceMs: number, accountId?: string): StatPoint[] {
    const rows = accountId
      ? this.db.prepare('SELECT account_id, t, session, weekly FROM history WHERE t >= ? AND account_id = ? ORDER BY t').all(sinceMs, accountId)
      : this.db.prepare('SELECT account_id, t, session, weekly FROM history WHERE t >= ? ORDER BY t').all(sinceMs);
    return (rows as any[]).map((r) => ({ accountId: r.account_id, t: r.t, session: r.session, weekly: r.weekly }));
  }

  pruneHistory(beforeMs: number): void {
    this.db.prepare('DELETE FROM history WHERE t < ?').run(beforeMs);
  }

  logAlert(accountId: string, kind: AlertKind, title: string, body: string): void {
    this.db
      .prepare('INSERT INTO alerts (account_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(accountId, kind, title, body, new Date().toISOString());
  }

  alerts(limit = 100): AlertLogEntry[] {
    return (this.db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT ?').all(limit) as any[]).map((r) => ({
      id: r.id,
      accountId: r.account_id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      createdAt: r.created_at,
    }));
  }

  clearAlerts(): void {
    this.db.prepare('DELETE FROM alerts').run();
  }

  alertState(accountId: string): { armed20: boolean; armed10: boolean; armed0: boolean } {
    const r = this.db.prepare('SELECT * FROM alert_state WHERE account_id = ?').get(accountId) as any;
    return r
      ? { armed20: !!r.armed20, armed10: !!r.armed10, armed0: !!r.armed0 }
      : { armed20: true, armed10: true, armed0: true };
  }

  setAlertState(accountId: string, s: { armed20: boolean; armed10: boolean; armed0: boolean }): void {
    this.db
      .prepare(
        `INSERT INTO alert_state (account_id, armed20, armed10, armed0) VALUES (?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET armed20=excluded.armed20, armed10=excluded.armed10, armed0=excluded.armed0`
      )
      .run(accountId, s.armed20 ? 1 : 0, s.armed10 ? 1 : 0, s.armed0 ? 1 : 0);
  }

  getSetting(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    return r?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }
}
