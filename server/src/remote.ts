import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateRemoteCommand, type RemoteCommand, type RemoteHost, type RemoteProject, type RemoteReceipt, type RemoteSnapshot } from '../../src/models/remote';
import type { Store } from './store';

const ONLINE_MS = 12000, COMMAND_MS = 90000, CONTROL_MS = 15 * 60000;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const equal = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function cookie(req: IncomingMessage, name: string): string {
  try {
    const entry = (req.headers.cookie || '').split(';').find(c => c.trim().startsWith(`${name}=`));
    return entry ? decodeURIComponent(entry.trim().slice(name.length + 1)) : '';
  } catch { return ''; }
}

export function sameOrigin(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

interface HostRecord { id: string; name: string; tokenHash: string }
interface Pending extends RemoteReceipt { command: RemoteCommand; createdAt: number; instanceId: string }
interface LiveHost { lastSeen: number; projects: RemoteProject[]; snapshot: RemoteSnapshot | null; pending: Map<string, Pending>; instanceId: string }

/** Durable host identities only; chat text and in-flight commands stay in memory. */
export class RemoteHub {
  private hosts = new Map<string, HostRecord>();
  private live = new Map<string, LiveHost>();
  private pairs = new Map<string, number>();
  constructor(private store: Pick<Store, 'getSetting' | 'setSetting'>, private now = Date.now) {
    try {
      for (const host of JSON.parse(store.getSetting('remote.hosts') || '[]')) {
        if (typeof host.id === 'string' && typeof host.tokenHash === 'string') this.hosts.set(host.id, host);
      }
    } catch {}
  }
  private save() { this.store.setSetting('remote.hosts', JSON.stringify([...this.hosts.values()])); }
  pairCode() {
    for (const [code, expires] of this.pairs) if (expires < this.now()) this.pairs.delete(code);
    if (this.pairs.size >= 5) this.pairs.clear();
    const code = randomBytes(9).toString('base64url');
    const expiresAt = this.now() + 5 * 60000;
    this.pairs.set(hash(code), expiresAt);
    return { code, expiresAt };
  }
  pair(code: string, name: string) {
    const key = hash(code), expires = this.pairs.get(key);
    if (!expires || expires < this.now()) throw new Error('Код привязки истёк или неверен');
    if (this.hosts.size >= 10) throw new Error('Сначала отключите один из ноутбуков');
    this.pairs.delete(key);
    const hostId = randomUUID(), token = randomBytes(32).toString('base64url');
    this.hosts.set(hostId, { id: hostId, name: name.trim().slice(0, 80) || 'Ноутбук', tokenHash: hash(token) });
    this.save();
    return { hostId, token };
  }
  authenticate(id: string, token: string): boolean {
    const host = this.hosts.get(id);
    return !!host && !!token && equal(hash(token), host.tokenHash);
  }
  revoke(id: string) { this.hosts.delete(id); this.live.delete(id); this.save(); }
  list(): RemoteHost[] {
    return [...this.hosts.values()].map(h => {
      const live = this.live.get(h.id);
      return { id: h.id, name: h.name, online: !!live && this.now() - live.lastSeen < ONLINE_MS, lastSeen: live?.lastSeen || 0, projects: live?.projects || [] };
    });
  }
  state(id: string) {
    const host = this.list().find(h => h.id === id);
    if (!host) return null;
    const live = this.live.get(id);
    this.expire(live);
    return { ...host, snapshot: live?.snapshot || null, receipts: [...(live?.pending.values() || [])].map(({ id, state, error, value }) => ({ id, state, error, value })) };
  }
  private expire(live?: LiveHost) {
    if (!live) return;
    for (const p of live.pending.values()) {
      if (['queued', 'dispatched'].includes(p.state) && this.now() - p.createdAt > COMMAND_MS) {
        p.state = 'error'; p.error = 'Время ожидания истекло. Проверьте чат перед повторной отправкой.';
      }
    }
  }
  enqueue(hostId: string, id: string, raw: unknown) {
    const command = validateRemoteCommand(raw);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(id)) throw new Error('Некорректный id команды');
    const live = this.live.get(hostId);
    if (!live || this.now() - live.lastSeen >= ONLINE_MS) throw new Error('Ноутбук не в сети');
    const existing = live.pending.get(id);
    if (existing) return { id: existing.id, state: existing.state };
    this.expire(live);
    if ([...live.pending.values()].filter(p => ['queued', 'dispatched'].includes(p.state)).length >= 8) throw new Error('Дождитесь выполнения предыдущих команд');
    while (live.pending.size >= 60) {
      const entry = [...live.pending.entries()].find(([, p]) => ['done', 'error'].includes(p.state));
      if (!entry) break;
      live.pending.delete(entry[0]);
    }
    live.pending.set(id, { id, command, state: 'queued', createdAt: this.now(), instanceId: live.instanceId });
    return { id, state: 'queued' };
  }
  poll(id: string, body: any) {
    let live = this.live.get(id);
    if (!live) {
      live = { lastSeen: 0, projects: [], snapshot: null, pending: new Map(), instanceId: '' };
      this.live.set(id, live);
    }
    if (typeof body.instanceId !== 'string' || !/^[\w-]{16,80}$/.test(body.instanceId)) throw new Error('instanceId required');
    // Never replay actions to a restarted or replaced local process.
    if (live.instanceId && live.instanceId !== body.instanceId) {
      if (this.now() - live.lastSeen < ONLINE_MS) throw new Error('Другой экземпляр уже подключён');
      for (const p of live.pending.values()) if (['queued', 'dispatched'].includes(p.state)) { p.state = 'error'; p.error = 'Соединение сменилось; команда не повторяется'; }
    }
    live.instanceId = body.instanceId;
    live.lastSeen = this.now();
    live.projects = (Array.isArray(body.projects) ? body.projects : []).slice(0, 30).filter((p: any) => typeof p?.name === 'string' && typeof p?.path === 'string').map((p: RemoteProject) => ({ name: p.name.slice(0, 80), path: p.path.slice(0, 1000) }));
    if (body.snapshot && typeof body.snapshot === 'object' && Array.isArray(body.snapshot.threads) && Array.isArray(body.snapshot.conversations)) live.snapshot = body.snapshot;
    const acknowledged: string[] = [];
    for (const result of (Array.isArray(body.results) ? body.results : []).slice(0, 20)) {
      if (typeof result?.id !== 'string') continue;
      acknowledged.push(result.id);
      const p = live.pending.get(result?.id);
      if (!p || p.instanceId !== live.instanceId || p.state !== 'dispatched') continue;
      p.state = result.ok === true ? 'done' : 'error';
      p.error = typeof result.error === 'string' ? result.error.slice(0, 500) : undefined;
      p.value = typeof result.value?.threadId === 'string' ? { threadId: result.value.threadId.slice(0, 200) } : undefined;
    }
    this.expire(live);
    const commands = [...live.pending.values()].filter(p => p.state === 'queued').slice(0, 4);
    for (const p of commands) p.state = 'dispatched'; // at most once, including lost HTTP responses
    return { acknowledged, commands: commands.map(({ id, command }) => ({ id, command })) };
  }
}

interface Options {
  secret: string;
  hasSession(req: IncomingMessage): boolean;
  verifyPassword(password: string): boolean;
  rateLimit(key: string): boolean;
  readBody(req: IncomingMessage, max?: number): Promise<any>;
}

export class RemoteRoutes {
  constructor(public hub: RemoteHub, private options: Options) {}
  private signature(value: string) { return createHmac('sha256', this.options.secret).update(`remote-control:${value}`).digest('hex'); }
  private cookieValue(req: IncomingMessage, issued: string) { return `${issued}.${this.signature(`${issued}:${hash(cookie(req, 'alt_session'))}`)}`; }
  unlocked(req: IncomingMessage) {
    if (!this.options.hasSession(req)) return false;
    const raw = cookie(req, 'alt_control'), issued = raw.split('.')[0], age = Date.now() - Number(issued);
    return age >= 0 && age < CONTROL_MS && equal(raw, this.cookieValue(req, issued));
  }
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/api/remote/')) return false;
    const respond = (status: number, body: unknown, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
      res.end(JSON.stringify(body)); return true;
    };
    const route = url.pathname.slice('/api/remote/'.length), method = req.method || 'GET';
    try {
      if (route.startsWith('bridge/')) {
        if (method !== 'POST') return respond(405, { error: 'method not allowed' });
        // Machine endpoints never accept browser cookies, and never use the tracker API_TOKEN.
        if (req.headers.origin) return respond(403, { error: 'machine endpoint' });
        const b = await this.options.readBody(req, 1024 * 1024);
        if (route === 'bridge/pair') {
          const ip = req.socket.remoteAddress || '';
          if (this.options.rateLimit(`pair:${ip}`)) return respond(429, { error: 'Слишком много попыток' });
          return respond(200, this.hub.pair(String(b.code || ''), String(b.name || '')));
        }
        const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!this.hub.authenticate(String(b.hostId || ''), token)) return respond(401, { error: 'Привязка отозвана или неверна' });
        if (route === 'bridge/poll') return respond(200, this.hub.poll(b.hostId, b));
        return respond(404, { error: 'not found' });
      }
      if (!this.options.hasSession(req)) return respond(401, { error: 'Войдите в веб-панель' });
      if (method !== 'GET' && (!sameOrigin(req) || !String(req.headers['content-type']).toLowerCase().startsWith('application/json'))) return respond(403, { error: 'Запрос должен прийти из этой веб-панели' });
      if (route === 'status' && method === 'GET') return respond(200, { unlocked: this.unlocked(req), hosts: this.hub.list() });
      if (route === 'unlock' && method === 'POST') {
        const ip = req.socket.remoteAddress || '';
        if (this.options.rateLimit(`unlock:${ip}`)) return respond(429, { error: 'Слишком много попыток, подождите 15 минут' });
        const b = await this.options.readBody(req);
        if (typeof b.password !== 'string' || !this.options.verifyPassword(b.password)) return respond(403, { error: 'Неверный пароль' });
        return respond(200, { ok: true }, { 'Set-Cookie': `alt_control=${this.cookieValue(req, String(Date.now()))}; Path=/api/remote; HttpOnly; Secure; SameSite=Strict; Max-Age=${CONTROL_MS / 1000}` });
      }
      if (route === 'lock' && method === 'POST') return respond(200, { ok: true }, { 'Set-Cookie': 'alt_control=; Path=/api/remote; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
      if (!this.unlocked(req)) return respond(423, { error: 'Подтвердите пароль для управления ноутбуком' });
      if (route === 'pair' && method === 'POST') return respond(200, this.hub.pairCode());
      const match = /^hosts\/([\w-]+)(\/command)?$/.exec(route);
      if (match) {
        if (!match[2] && method === 'GET') {
          const state = this.hub.state(match[1]);
          return respond(state ? 200 : 404, state || { error: 'Ноутбук не найден' });
        }
        if (!match[2] && method === 'DELETE') { this.hub.revoke(match[1]); return respond(200, { ok: true }); }
        if (match[2] && method === 'POST') {
          const b = await this.options.readBody(req);
          return respond(202, this.hub.enqueue(match[1], String(b.id || ''), b.command));
        }
      }
      return respond(404, { error: 'not found' });
    } catch (e: any) { return respond(400, { error: e.message || 'Некорректный запрос' }); }
  }
}
