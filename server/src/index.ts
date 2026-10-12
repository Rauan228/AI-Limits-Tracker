import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { NATIVE_PROVIDERS, type ProviderType, RECIPE_PROVIDERS } from '../../src/models/types';
import { computeStats, forecastWindow } from '../../src/services/stats';
import { Store } from './store';
import { Tracker } from './tracker';

const PORT = Number(process.env.PORT) || 8795;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const APP_SECRET = process.env.APP_SECRET || '';
const API_TOKEN = process.env.API_TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || resolve('data');
const WEB_DIR = resolve(process.env.WEB_DIR || 'public');
const SESSION_DAYS = 180;

if (!ADMIN_PASSWORD || APP_SECRET.length < 16) {
  console.error('ADMIN_PASSWORD and APP_SECRET (16+ chars) must be set. See .env.example');
  process.exit(1);
}

const store = new Store(join(DATA_DIR, 'tracker.db'), APP_SECRET);
const tracker = new Tracker(store);

/* ---------------- Auth ---------------- */

function sign(value: string): string {
  return createHmac('sha256', APP_SECRET).update(value).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function sessionCookie(): string {
  const issued = String(Date.now());
  return `${issued}.${sign(issued)}`;
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAuthed(req: IncomingMessage): boolean {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (API_TOKEN && bearer && safeEqual(bearer, API_TOKEN)) return true;
  const raw = parseCookies(req).alt_session;
  if (!raw) return false;
  const [issued, sig] = raw.split('.');
  if (!issued || !sig || !safeEqual(sig, sign(issued))) return false;
  return Date.now() - Number(issued) < SESSION_DAYS * 86400 * 1000;
}

const loginAttempts = new Map<string, { count: number; first: number }>();
function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now - rec.first > 15 * 60 * 1000) {
    loginAttempts.set(ip, { count: 1, first: now });
    return false;
  }
  rec.count++;
  return rec.count > 10;
}

/* ---------------- HTTP helpers ---------------- */

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 256 * 1024) throw new Error('Body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(WEB_DIR, 'index.html'); // SPA fallback
  }
  if (!existsSync(file)) {
    res.writeHead(404).end('Not found');
    return;
  }
  const ext = extname(file);
  const immutable = /\.[0-9a-f]{8,}\./.test(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(readFileSync(file));
}

const ALL_PROVIDERS: ProviderType[] = [...NATIVE_PROVIDERS, ...RECIPE_PROVIDERS, 'custom'];

/* ---------------- Routes ---------------- */

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname;
  const method = req.method || 'GET';

  if (path === '/api/health') return send(res, 200, { ok: true });

  if (path === '/api/login' && method === 'POST') {
    const ip = (req.headers['x-real-ip'] as string) || req.socket.remoteAddress || '';
    if (tooManyAttempts(ip)) return send(res, 429, { error: 'Слишком много попыток, подождите 15 минут' });
    const { password } = await readBody(req);
    if (typeof password !== 'string' || !safeEqual(password, ADMIN_PASSWORD)) {
      return send(res, 401, { error: 'Неверный пароль' });
    }
    loginAttempts.delete(ip);
    return send(res, 200, { ok: true }, {
      'Set-Cookie': `alt_session=${sessionCookie()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
    });
  }

  if (path === '/api/logout' && method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'alt_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
  }

  if (!isAuthed(req)) return send(res, 401, { error: 'unauthorized' });

  if (path === '/api/state' && method === 'GET') {
    return send(res, 200, {
      accounts: store.listAccounts(), // credentials are never part of the account object
      lastSyncAllAt: tracker.lastSyncAllAt,
      intervalMin: tracker.intervalMin(),
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    });
  }

  if (path === '/api/refresh' && method === 'POST') {
    await tracker.syncAll();
    return send(res, 200, { ok: true });
  }

  if (path === '/api/settings' && method === 'PUT') {
    const body = await readBody(req);
    if (typeof body.intervalMin === 'number') tracker.setIntervalMin(body.intervalMin);
    return send(res, 200, { ok: true, intervalMin: tracker.intervalMin() });
  }

  if (path === '/api/oauth/start' && method === 'POST') {
    const { provider, accountId } = await readBody(req);
    try {
      return send(res, 200, tracker.startOAuth(provider, accountId));
    } catch (e: any) {
      return send(res, 400, { error: e.message });
    }
  }

  if (path === '/api/oauth/finish' && method === 'POST') {
    const { state, input } = await readBody(req);
    const result = await tracker.finishOAuth(String(state || ''), String(input || ''));
    return send(res, result.ok ? 200 : 400, result);
  }

  if (path === '/api/accounts/manual' && method === 'POST') {
    const { provider, input, accountId } = await readBody(req);
    if (!ALL_PROVIDERS.includes(provider)) return send(res, 400, { error: 'Неизвестный сервис' });
    const result = await tracker.connectManual(provider, String(input || ''), accountId);
    return send(res, result.ok ? 200 : 400, result);
  }

  if (path === '/api/accounts/reorder' && method === 'POST') {
    const { ids } = await readBody(req);
    if (Array.isArray(ids)) tracker.reorder(ids.map(String));
    return send(res, 200, { ok: true });
  }

  const m = /^\/api\/accounts\/([\w-]+)(\/refresh)?$/.exec(path);
  if (m) {
    const id = m[1];
    const account = store.getAccount(id);
    if (!account) return send(res, 404, { error: 'not found' });
    if (m[2] && method === 'POST') {
      await tracker.sync(id);
      return send(res, 200, { account: store.getAccount(id) });
    }
    if (method === 'PATCH') {
      const body = await readBody(req);
      const next = { ...account };
      if (typeof body.name === 'string' && body.name.trim()) next.name = body.name.trim().slice(0, 80);
      if (typeof body.isActive === 'boolean') next.isActive = body.isActive;
      store.upsertAccount(next);
      return send(res, 200, { account: next });
    }
    if (method === 'DELETE') {
      store.deleteAccount(id);
      return send(res, 200, { ok: true });
    }
  }

  if (path === '/api/history' && method === 'GET') {
    const days = Math.min(400, Number(url.searchParams.get('days')) || 7);
    const accountId = url.searchParams.get('accountId') || undefined;
    return send(res, 200, { points: store.history(Date.now() - days * 86400000, accountId) });
  }

  if (path === '/api/stats' && method === 'GET') {
    const days = Math.min(400, Number(url.searchParams.get('days')) || 30);
    let tz = url.searchParams.get('tz') || undefined;
    try {
      if (tz) new Intl.DateTimeFormat('en', { timeZone: tz });
    } catch {
      tz = undefined;
    }
    const accounts = store.listAccounts();
    const points = store.history(Date.now() - days * 86400000);
    const stats = computeStats(points, accounts.map((a) => a.id), { timeZone: tz, days });
    const recent = Date.now() - 3 * 3600000;
    const forecasts: Record<string, ReturnType<typeof forecastWindow>> = {};
    for (const a of accounts) {
      const session = a.latestSnapshot?.buckets.find((b) => b.windowType === 'session_5h');
      forecasts[a.id] = forecastWindow(
        points.filter((p) => p.accountId === a.id && p.t >= recent).map((p) => ({ t: p.t, value: p.session })),
        session?.utilizationPercent ?? null,
        session?.resetsAt ?? null
      );
    }
    return send(res, 200, { stats, forecasts });
  }

  if (path === '/api/alerts' && method === 'GET') return send(res, 200, { alerts: store.alerts(100) });
  if (path === '/api/alerts' && method === 'DELETE') {
    store.clearAlerts();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'not found' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url.pathname);
  } catch (e: any) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, () => {
  console.log(`AI Limits Tracker server on :${PORT} (data: ${DATA_DIR}, web: ${WEB_DIR})`);
  tracker.start();
});
