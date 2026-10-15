// Outbound-only relay client. OpenAI credentials remain in the local Codex runtime.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { validateRemoteCommand, type RemoteApproval, type RemoteCommand, type RemoteConversation, type RemoteMessage, type RemoteProject, type RemoteSnapshot, type RemoteThread } from '../src/models/remote';

export interface BridgeConfig {
  url: string; hostId?: string; token?: string; codexHome?: string; executable?: string;
  projects: RemoteProject[]; name?: string;
}

export async function canonicalProjects(projects: RemoteProject[]): Promise<RemoteProject[]> {
  const result: RemoteProject[] = [];
  for (const p of projects) {
    const canonical = await fs.realpath(p.path);
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error('Папка проекта не найдена');
    result.push({ path: canonical, name: p.name || path.basename(canonical) });
  }
  if (!result.length) throw new Error('Укажите хотя бы одну папку проекта в локальном конфиге');
  return result;
}

export async function allowedProject(cwd: string, projects: RemoteProject[]): Promise<string> {
  const actual = await fs.realpath(cwd);
  const normalize = (s: string) => process.platform === 'win32' ? s.toLowerCase() : s;
  if (!projects.some(p => {
    const relative = path.relative(normalize(p.path), normalize(actual));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  })) throw new Error('Эта папка не разрешена в локальном конфиге ноутбука');
  return actual;
}

export async function findCodexExecutable(config: BridgeConfig): Promise<string> {
  if (config.executable) { await fs.access(config.executable); return config.executable; }
  for (const folder of ['.vscode', '.vscode-insiders', '.cursor']) {
    try {
      const root = path.join(os.homedir(), folder, 'extensions');
      const entries = await fs.readdir(root, { withFileTypes: true });
      const matches = await Promise.all(entries.filter(e => e.isDirectory() && e.name.startsWith('openai.chatgpt-')).map(async e => ({ dir: path.join(root, e.name), time: (await fs.stat(path.join(root, e.name))).mtimeMs })));
      for (const m of matches.sort((a, b) => b.time - a.time)) {
        const executable = path.join(m.dir, 'bin', process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'macos-aarch64' : 'linux-x86_64', process.platform === 'win32' ? 'codex.exe' : 'codex');
        try { await fs.access(executable); return executable; } catch {}
      }
    } catch {}
  }
  if (process.platform !== 'win32') return 'codex';
  throw new Error('Не найден Codex. Укажите executable в codex-remote.config.json');
}

export class CodexRpc extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  connected = false;
  async start(executable: string, config: BridgeConfig) {
    const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd: config.projects[0].path, windowsHide: true,
      env: { ...process.env, ...(config.codexHome ? { CODEX_HOME: config.codexHome } : {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    child.stdout.on('data', data => {
      buffer += decoder.write(data);
      if (buffer.length > 32 * 1024 * 1024) { child.kill(); return; }
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        try {
          const message = JSON.parse(line);
          if (message.method) this.emit('event', message);
          else if (this.pending.has(message.id)) {
            const p = this.pending.get(message.id)!; this.pending.delete(message.id); clearTimeout(p.timer);
            if (message.error) p.reject(new Error(String(message.error.message || 'Codex RPC error')));
            else p.resolve(message.result);
          }
        } catch {}
      }
    });
    child.stderr.resume(); // Do not log prompts, credentials, or private config warnings.
    const closed = () => {
      this.connected = false;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex отключён')); }
      this.pending.clear(); this.emit('disconnect');
    };
    child.once('error', closed); child.once('exit', closed);
    child.stdin.on('error', () => {});
    await this.call('initialize', { clientInfo: { name: 'ai_limits_tracker', title: 'AI Limits Tracker', version: '1.0.0' } });
    this.write({ method: 'initialized' });
    this.connected = true;
  }
  private write(message: unknown) {
    if (!this.child || this.child.killed || this.child.stdin.destroyed) throw new Error('Codex не подключён');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  call(method: string, params: unknown): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex не ответил. Проверьте состояние чата перед повтором.')); }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  reply(id: string | number, result: unknown) { this.write({ id, result }); }
  reject(id: string | number) { this.write({ id, error: { code: -32601, message: 'This request is not supported by AI Limits Tracker' } }); }
  stop() { this.child?.kill(); this.connected = false; }
}

function summarizeThread(t: any, managed: boolean): RemoteThread {
  const status = t.status?.type;
  return {
    id: String(t.id), title: String(t.name || t.preview || 'Новый чат').slice(0, 120), cwd: String(t.cwd || ''),
    updatedAt: Number(t.updatedAt || t.createdAt || Date.now() / 1000), managed,
    status: status === 'active' ? 'working' : status === 'systemError' ? 'error' : 'idle',
  };
}

export function summarizeItem(item: any): RemoteMessage | null {
  const id = String(item.id || randomUUID());
  if (item.type === 'agentMessage') return { id, role: 'assistant', text: String(item.text || '').slice(-12000) };
  if (item.type === 'userMessage') return { id, role: 'user', text: (item.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('\n').slice(-16000) };
  if (item.type === 'commandExecution') return { id, role: 'tool', text: `${item.command || ''}\n${item.aggregatedOutput || ''}`.slice(0, 4000) };
  if (item.type === 'fileChange') return { id, role: 'tool', text: (item.changes || []).map((c: any) => `${c.path}\n${c.diff || ''}`).join('\n').slice(0, 8000) };
  return null;
}

interface ApprovalRequest { rpcId: string | number; method: string; threadId: string; approval: RemoteApproval }
const POLICY = { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' };

export class CodexController {
  private threads = new Map<string, RemoteThread>();
  private conversations = new Map<string, RemoteConversation>();
  private managed = new Set<string>();
  private turns = new Map<string, string>();
  private requests = new Map<string, ApprovalRequest>();
  private error?: string;
  constructor(private rpc: CodexRpc, public projects: RemoteProject[]) {
    rpc.on('event', e => this.onEvent(e));
    rpc.on('disconnect', () => {
      this.error = 'Локальный Codex отключён. Перезапустите мост на ноутбуке.';
      this.requests.clear();
      for (const view of this.conversations.values()) { view.approvals = []; if (view.thread.managed) { view.thread.status = 'error'; view.error = this.error; } }
    });
  }
  snapshot(): RemoteSnapshot {
    return { connected: this.rpc.connected, error: this.error, threads: [...this.threads.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50), conversations: [...this.conversations.values()].slice(-3).map(v => ({ ...v, messages: v.messages.slice(-40).map(m => ({ ...m, text: m.text.slice(-8000) })) })) };
  }
  private async getThread(id: string): Promise<RemoteThread> {
    const result = await this.rpc.call('thread/read', { threadId: id, includeTurns: false });
    await allowedProject(result.thread.cwd, this.projects);
    const known = this.threads.get(id);
    if (known?.managed) return known;
    const thread = summarizeThread(result.thread, this.managed.has(id));
    this.threads.set(id, thread);
    return thread;
  }
  async list() {
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await this.rpc.call('thread/list', { limit: 50, sortKey: 'updated_at', ...(cursor ? { cursor } : {}) });
      for (const t of result.data || []) {
        if (t.parentThreadId || (t.source && typeof t.source === 'object')) continue;
        try {
          await allowedProject(t.cwd, this.projects);
          if (!this.managed.has(t.id)) this.threads.set(t.id, summarizeThread(t, false));
        } catch {}
      }
      cursor = result.nextCursor;
      if (!cursor || this.threads.size >= 50) break;
    }
  }
  private putView(view: RemoteConversation) {
    this.conversations.delete(view.thread.id); this.conversations.set(view.thread.id, view);
    // Keep active conversations even when another chat is opened.
    for (const [id, v] of this.conversations) {
      if (this.conversations.size <= 3) break;
      if (v.thread.status === 'idle' && id !== view.thread.id) this.conversations.delete(id);
    }
  }
  private async read(id: string) {
    const thread = await this.getThread(id);
    if (this.managed.has(id) && this.conversations.has(id)) { this.putView(this.conversations.get(id)!); return; }
    let messages: RemoteMessage[] = [], hasOlder = false;
    try {
      const result = await this.rpc.call('thread/items/list', { threadId: id, limit: 60, sortDirection: 'desc' });
      messages = (result.data || []).map((e: any) => summarizeItem(e.item)).filter(Boolean).reverse();
      hasOlder = !!result.nextCursor;
    } catch {
      // Older Codex versions / legacy rollout history.
      const result = await this.rpc.call('thread/read', { threadId: id, includeTurns: true });
      const turns = result.thread.turns || [];
      messages = turns.flatMap((t: any) => (t.items || []).map(summarizeItem)).filter(Boolean).slice(-60);
      hasOlder = messages.length === 60;
    }
    this.putView({ thread, messages, approvals: [], hasOlder });
  }
  private async takeThread(id: string, fork: boolean) {
    const original = await this.getThread(id);
    if (!fork && this.managed.has(id)) return id;
    if (this.managed.size >= 12) throw new Error('Открыто слишком много чатов. Перезапустите мост, чтобы освободить их.');
    const result = await this.rpc.call(fork ? 'thread/fork' : 'thread/resume', { threadId: id, excludeTurns: true, ...POLICY, cwd: original.cwd });
    await allowedProject(result.thread.cwd, this.projects);
    const thread = summarizeThread(result.thread, true);
    this.managed.add(thread.id); this.threads.set(thread.id, thread);
    // Load history before marking the view as managed in the UI.
    this.conversations.delete(thread.id);
    await this.read(thread.id);
    return thread.id;
  }
  async execute(raw: unknown): Promise<{ threadId?: string }> {
    const c = validateRemoteCommand(raw);
    switch (c.op) {
      case 'list': await this.list(); return {};
      case 'read': await this.read(c.threadId); return { threadId: c.threadId };
      case 'create': {
        const cwd = await allowedProject(c.project, this.projects);
        if (this.managed.size >= 12) throw new Error('Открыто слишком много чатов. Перезапустите мост, чтобы освободить их.');
        const result = await this.rpc.call('thread/start', { cwd, ...POLICY, serviceName: 'ai_limits_tracker' });
        const thread = summarizeThread(result.thread, true);
        this.managed.add(thread.id); this.threads.set(thread.id, thread);
        this.putView({ thread, messages: [], approvals: [] });
        return { threadId: thread.id };
      }
      case 'resume': case 'fork': return { threadId: await this.takeThread(c.threadId, c.op === 'fork') };
      case 'send': {
        if (!this.managed.has(c.threadId)) throw new Error('Сначала нажмите «Продолжить здесь» или создайте копию чата');
        const thread = this.threads.get(c.threadId)!;
        await allowedProject(thread.cwd, this.projects);
        if (thread.status === 'working' || thread.status === 'waiting') throw new Error('Дождитесь ответа или остановите текущую задачу');
        const view = this.conversations.get(c.threadId);
        if (view) view.error = undefined;
        thread.status = 'working';
        let result;
        try { result = await this.rpc.call('turn/start', {
          threadId: c.threadId, cwd: thread.cwd, input: [{ type: 'text', text: c.text }],
          approvalPolicy: 'on-request', approvalsReviewer: 'user',
          sandboxPolicy: { type: 'workspaceWrite', writableRoots: [thread.cwd], networkAccess: false },
        }); } catch (e) { thread.status = 'error'; throw e; }
        this.turns.set(c.threadId, result.turn.id);
        if (thread.title === 'Новый чат') thread.title = c.text.slice(0, 100);
        return { threadId: c.threadId };
      }
      case 'interrupt': {
        if (!this.managed.has(c.threadId)) throw new Error('Этой задачей управляет другой клиент Codex');
        const turnId = this.turns.get(c.threadId);
        if (!turnId) throw new Error('Нет активной задачи');
        await this.rpc.call('turn/interrupt', { threadId: c.threadId, turnId });
        return { threadId: c.threadId };
      }
      case 'respond': {
        const pending = this.requests.get(c.requestId);
        if (!pending) throw new Error('Запрос уже закрыт');
        if (pending.approval.kind === 'input') {
          if (!c.answers) throw new Error('Заполните ответы');
          const answers: Record<string, { answers: string[] }> = {};
          for (const q of pending.approval.questions || []) {
            if (!c.answers[q.id]?.trim()) throw new Error('Ответьте на каждый вопрос');
            answers[q.id] = { answers: [c.answers[q.id]] };
          }
          this.rpc.reply(pending.rpcId, { answers });
        } else {
          if (!c.decision) throw new Error('Выберите решение');
          this.rpc.reply(pending.rpcId, { decision: c.decision });
        }
        this.requests.delete(c.requestId);
        const view = this.conversations.get(pending.threadId);
        if (view) { view.approvals = view.approvals.filter(a => a.id !== c.requestId); view.thread.status = view.approvals.length ? 'waiting' : 'working'; }
        return { threadId: pending.threadId };
      }
    }
  }
  private addMessage(view: RemoteConversation, message: RemoteMessage, delta = false) {
    const old = view.messages.find(m => m.id === message.id);
    if (old) old.text = (delta ? old.text + message.text : message.text).slice(-16000);
    else view.messages.push(message);
    if (view.messages.length > 80) view.messages.splice(0, view.messages.length - 80);
  }
  private onEvent(e: any) {
    const p = e.params || {}, id = p.threadId;
    const view = this.conversations.get(id);
    if (e.id !== undefined) {
      if (!view || !this.managed.has(id)) { this.rpc.reject(e.id); return; }
      const requestId = randomUUID();
      let approval: RemoteApproval;
      if (e.method === 'item/commandExecution/requestApproval') approval = { id: requestId, kind: 'command', title: 'Разрешить команду один раз?', detail: [p.command, p.cwd, p.reason].filter(Boolean).join('\n').slice(0, 12000) };
      else if (e.method === 'item/fileChange/requestApproval') approval = { id: requestId, kind: 'files', title: 'Разрешить изменение файлов?', detail: [p.reason, view.messages.find(m => m.id === p.itemId)?.text, p.grantRoot].filter(Boolean).join('\n').slice(0, 12000) };
      else if (e.method === 'item/tool/requestUserInput') approval = {
        id: requestId, kind: 'input', title: 'Codex задаёт вопрос', detail: '',
        questions: (p.questions || []).map((q: any) => ({ id: q.id, question: q.question, options: (q.options || []).map((o: any) => o.label) })),
      };
      else { this.rpc.reject(e.id); return; }
      this.requests.set(requestId, { rpcId: e.id, method: e.method, threadId: id, approval });
      view.approvals.push(approval);
      if (p.isBlocking !== false) view.thread.status = 'waiting';
      return;
    }
    if (e.method === 'serverRequest/resolved') {
      for (const [key, request] of this.requests) if (request.rpcId === p.requestId) {
        this.requests.delete(key);
        const requestView = this.conversations.get(request.threadId);
        if (requestView) {
          requestView.approvals = requestView.approvals.filter(a => a.id !== key);
          if (!requestView.approvals.length && requestView.thread.status === 'waiting') requestView.thread.status = this.turns.has(request.threadId) ? 'working' : 'idle';
        }
      }
    }
    if (!view) return;
    view.thread.updatedAt = Date.now() / 1000;
    if (e.method === 'turn/started') { this.turns.set(id, p.turn.id); view.thread.status = 'working'; view.error = undefined; }
    if (e.method === 'turn/completed') {
      this.turns.delete(id); view.thread.status = p.turn.status === 'failed' ? 'error' : 'idle';
      view.error = p.turn.error?.message;
      for (const [key, request] of this.requests) if (request.threadId === id) this.requests.delete(key);
      view.approvals = [];
    }
    if (e.method === 'error') { view.error = p.error?.message || 'Ошибка Codex'; if (!p.willRetry) view.thread.status = 'error'; }
    if (e.method === 'item/agentMessage/delta') this.addMessage(view, { id: p.itemId, role: 'assistant', text: p.delta || '' }, true);
    if (e.method === 'item/started' || e.method === 'item/completed') {
      const message = summarizeItem(p.item);
      if (message) this.addMessage(view, message);
    }
  }
}

export function validateRelayUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Укажите адрес панели без пути и пароля');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Для удалённого сервера требуется HTTPS');
  return url.origin;
}

export async function relayRequest(config: BridgeConfig, route: string, body: unknown): Promise<any> {
  const response = await fetch(`${validateRelayUrl(config.url)}/api/remote/bridge/${route}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || `HTTP ${response.status}`), { status: response.status });
  return value;
}

export async function localLock(hostId: string): Promise<(() => Promise<void>) | null> {
  const file = path.join(os.tmpdir(), `ai-limits-remote-${hostId.replace(/[^\w-]/g, '')}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(file, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      await handle.close();
      return () => fs.unlink(file).catch(() => {});
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const old = JSON.parse(await fs.readFile(file, 'utf8'));
        if (!Number.isInteger(old.pid) || old.pid <= 0) return null;
        try { process.kill(old.pid, 0); return null; }
        catch (error: any) { if (error.code !== 'ESRCH') return null; }
        await fs.unlink(file);
      } catch { return null; }
    }
  }
  return null;
}

async function run() {
  const argv = process.argv.slice(2);
  const configIndex = argv.indexOf('--config');
  const file = path.resolve(configIndex >= 0 ? argv[configIndex + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), 'codex-remote.config.json'));
  const config: BridgeConfig = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  config.url = validateRelayUrl(config.url);
  config.projects = await canonicalProjects(config.projects || []);
  if (argv.includes('--pair')) {
    // Pairing code arrives on stdin, never as a command-line argument.
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    const pair = await relayRequest(config, 'pair', { code: input.trim(), name: config.name || os.hostname() });
    config.hostId = pair.hostId; config.token = pair.token;
    await fs.writeFile(file, JSON.stringify(config, null, 2), { mode: 0o600 });
    console.log('Ноутбук привязан. Можно запустить codex-remote без --pair.');
    return;
  }
  if (!config.hostId || !config.token) throw new Error('Сначала привяжите ноутбук: codex-remote --pair');
  const release = await localLock(config.hostId);
  if (!release) return;
  try {
  // Validate the pairing before starting a local Codex process.
  const instanceId = randomUUID();
  await relayRequest(config, 'poll', { hostId: config.hostId, instanceId, projects: config.projects });
  const rpc = new CodexRpc(), controller = new CodexController(rpc, config.projects);
  let stopping = false, lastList = 0, inFlight = 0;
  const results = new Map<string, { id: string; ok: boolean; value?: unknown; error?: string }>();
  const seen = new Set<string>();
  const stop = () => { stopping = true; rpc.stop(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  rpc.on('disconnect', () => { if (!stopping) { stopping = true; process.exitCode = 1; } });
  try {
    await rpc.start(await findCodexExecutable(config), config);
    while (!stopping) {
      try {
        const answer = await relayRequest(config, 'poll', { hostId: config.hostId, instanceId, projects: config.projects, snapshot: controller.snapshot(), results: [...results.values()].slice(0, 20) });
        for (const id of answer.acknowledged || []) results.delete(id);
        for (const entry of answer.commands || []) {
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          if (inFlight >= 8) { results.set(entry.id, { id: entry.id, ok: false, error: 'Мост занят, попробуйте позже' }); continue; }
          inFlight++;
          controller.execute(entry.command).then(value => results.set(entry.id, { id: entry.id, ok: true, value }),
            error => results.set(entry.id, { id: entry.id, ok: false, error: String(error.message || 'Ошибка Codex').slice(0, 500) }))
            .finally(() => { inFlight--; });
        }
        if (!inFlight && Date.now() - lastList > 30000 && rpc.connected) {
          lastList = Date.now();
          controller.list().catch(() => {});
        }
      } catch (e: any) {
        if (e.status === 401) { stop(); break; } // revoked pairing stops local runtime too
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally { stopping = true; rpc.stop(); }
  } finally { await release(); }
}

// Bundling preserves this guard; tests import the controller without starting a process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(e => { console.error(String(e.message || 'Не удалось запустить мост')); process.exitCode = 1; });
}
