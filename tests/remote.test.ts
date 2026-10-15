import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { RemoteHub, RemoteRoutes } from '../server/src/remote';
import { validateRemoteCommand } from '../src/models/remote';
import { allowedProject, canonicalProjects, CodexController, type CodexRpc, validateRelayUrl } from '../integrations/codex-remote';

function memoryStore() {
  const settings = new Map<string, string>();
  return { getSetting: (key: string) => settings.get(key) || null, setSetting: (key: string, value: string) => { settings.set(key, value); } };
}

test('pair codes expire, are single use; bridge identities persist as hashes and revoke', () => {
  let now = 1000000;
  const store = memoryStore(), hub = new RemoteHub(store, () => now);
  const code = hub.pairCode().code, paired = hub.pair(code, 'Laptop');
  assert.throws(() => hub.pair(code, 'Other'));
  assert.equal(hub.authenticate(paired.hostId, paired.token), true);
  assert.equal(new RemoteHub(store).authenticate(paired.hostId, paired.token), true);
  assert.ok(!store.getSetting('remote.hosts')!.includes(paired.token));
  const expired = hub.pairCode().code; now += 300001;
  assert.throws(() => hub.pair(expired, 'Laptop'));
  hub.revoke(paired.hostId); assert.equal(hub.authenticate(paired.hostId, paired.token), false);
});

test('commands dispatch once, deduplicate client retries and acknowledge repeated results', () => {
  const hub = new RemoteHub(memoryStore());
  const { hostId } = hub.pair(hub.pairCode().code, 'Laptop');
  const instanceId = randomUUID(), id = randomUUID();
  const poll = (extra = {}) => hub.poll(hostId, { instanceId, projects: [], ...extra });
  poll();
  hub.enqueue(hostId, id, { op: 'create', project: 'C:/work' });
  hub.enqueue(hostId, id, { op: 'create', project: 'C:/work' });
  assert.equal(poll().commands.length, 1);
  assert.equal(poll().commands.length, 0); // lost HTTP response must not execute the task twice
  const result = { results: [{ id, ok: true, value: { threadId: 'thread' } }] };
  assert.deepEqual(poll(result).acknowledged, [id]);
  assert.deepEqual(poll(result).acknowledged, [id]);
  assert.equal(hub.state(hostId)!.receipts[0].state, 'done');
  assert.equal(hub.state(hostId)!.receipts[0].value?.threadId, 'thread');
});

test('offline hosts reject commands; a new process cannot replay a previous pending action', () => {
  let now = 1000000;
  const hub = new RemoteHub(memoryStore(), () => now), { hostId } = hub.pair(hub.pairCode().code, 'Laptop');
  const one = randomUUID(), two = randomUUID(), id = randomUUID();
  hub.poll(hostId, { instanceId: one });
  hub.enqueue(hostId, id, { op: 'list' });
  assert.throws(() => hub.poll(hostId, { instanceId: two }));
  now += 13000;
  assert.throws(() => hub.enqueue(hostId, randomUUID(), { op: 'list' }));
  assert.equal(hub.poll(hostId, { instanceId: two }).commands.length, 0);
  assert.equal(hub.state(hostId)!.receipts[0].state, 'error');
});

test('relay supports only typed commands and one-time approvals', () => {
  assert.throws(() => validateRemoteCommand({ op: 'rpc', method: 'command/exec' }));
  assert.throws(() => validateRemoteCommand({ op: 'respond', requestId: 'x', decision: 'acceptForSession' }));
  assert.throws(() => validateRemoteCommand({ op: 'send', threadId: 'x', text: 'x'.repeat(16001) }));
  assert.deepEqual(validateRemoteCommand({ op: 'create', project: 'C:/allowed', sandbox: 'danger-full-access' }), { op: 'create', project: 'C:/allowed' });
  assert.throws(() => validateRelayUrl('http://public.example.com'));
  assert.throws(() => validateRelayUrl('https://user:password@example.com'));
  assert.equal(validateRelayUrl('http://127.0.0.1:8795/'), 'http://127.0.0.1:8795');
});

test('canonical project boundary rejects siblings, traversal and symlink escapes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alt-boundary-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'project'), sibling = path.join(dir, 'project-other');
  await fs.mkdir(path.join(root, 'child'), { recursive: true }); await fs.mkdir(sibling);
  const projects = await canonicalProjects([{ path: root, name: 'Project' }]);
  assert.equal(await allowedProject(path.join(root, 'child'), projects), await fs.realpath(path.join(root, 'child')));
  await assert.rejects(allowedProject(sibling, projects));
  await assert.rejects(allowedProject(path.join(root, '..', 'project-other'), projects));
  await fs.symlink(sibling, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(allowedProject(path.join(root, 'escape'), projects));
});

test('controller enforces project and sandbox, streams messages, handles approvals and interrupts', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alt-controller-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  class FakeRpc extends EventEmitter {
    connected = true;
    calls: { method: string; params: any }[] = [];
    replies: { id: unknown; result: any }[] = [];
    rejected: unknown[] = [];
    async call(method: string, params: any) {
      this.calls.push({ method, params });
      if (method === 'thread/start') return { thread: { id: 'thread', cwd: root, name: 'Test', status: { type: 'idle' } } };
      if (method === 'turn/start') return { turn: { id: 'turn' } };
      return {};
    }
    reply(id: unknown, result: any) { this.replies.push({ id, result }); }
    reject(id: unknown) { this.rejected.push(id); }
  }
  const rpc = new FakeRpc(), controller = new CodexController(rpc as unknown as CodexRpc, await canonicalProjects([{ name: 'Project', path: root }]));
  await assert.rejects(controller.execute({ op: 'send', threadId: 'foreign', text: 'task' }));
  await controller.execute({ op: 'create', project: root });
  assert.equal(rpc.calls[0].params.sandbox, 'workspace-write');
  await controller.execute({ op: 'send', threadId: 'thread', text: 'task' });
  assert.equal(rpc.calls.at(-1)!.params.approvalPolicy, 'on-request');
  assert.equal(rpc.calls.at(-1)!.params.approvalsReviewer, 'user');
  assert.equal(rpc.calls.at(-1)!.params.sandboxPolicy.networkAccess, false);
  await assert.rejects(controller.execute({ op: 'send', threadId: 'thread', text: 'duplicate' }));
  rpc.emit('event', { method: 'item/agentMessage/delta', params: { threadId: 'thread', itemId: 'msg', delta: 'Hello ' } });
  rpc.emit('event', { method: 'item/agentMessage/delta', params: { threadId: 'thread', itemId: 'msg', delta: 'world' } });
  assert.equal(controller.snapshot().conversations[0].messages[0].text, 'Hello world');
  rpc.emit('event', { id: 42, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'turn', command: 'test command' } });
  const view = controller.snapshot().conversations[0];
  assert.equal(view.thread.status, 'waiting'); assert.equal(rpc.replies.length, 0);
  await controller.execute({ op: 'respond', requestId: view.approvals[0].id, decision: 'decline' });
  assert.deepEqual(rpc.replies[0], { id: 42, result: { decision: 'decline' } });
  assert.equal(controller.snapshot().conversations[0].approvals.length, 0);
  rpc.emit('event', { id: 43, method: 'unknown/request', params: { threadId: 'thread' } });
  assert.deepEqual(rpc.rejected, [43]);
  rpc.emit('event', { id: 44, method: 'item/tool/requestUserInput', params: { threadId: 'thread', questions: [{ id: 'q', question: 'Which?', options: [{ label: 'One' }] }] } });
  const question = controller.snapshot().conversations[0].approvals[0];
  await controller.execute({ op: 'respond', requestId: question.id, answers: { q: 'One' } });
  assert.deepEqual(rpc.replies.at(-1)!.result, { answers: { q: { answers: ['One'] } } });
  await controller.execute({ op: 'interrupt', threadId: 'thread' });
  assert.equal(rpc.calls.at(-1)!.method, 'turn/interrupt');
  rpc.emit('event', { method: 'turn/completed', params: { threadId: 'thread', turn: { status: 'interrupted' } } });
  assert.equal(controller.snapshot().conversations[0].thread.status, 'idle');
});

test('HTTP requires browser reauthentication and same-origin JSON; watcher token cannot control', async t => {
  const routes = new RemoteRoutes(new RemoteHub(memoryStore()), {
    secret: 'test-secret-for-remote',
    hasSession: req => req.headers.cookie?.includes('alt_session=browser') || false,
    verifyPassword: password => password === 'password', rateLimit: () => false,
    readBody: async (req, max = 262144) => {
      const buffers = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error('too large'); buffers.push(chunk); }
      return JSON.parse(Buffer.concat(buffers).toString() || '{}');
    },
  });
  const server = createServer((req, res) => { routes.handle(req, res, new URL(req.url!, 'http://localhost')).catch(() => res.end()); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (route: string, body?: unknown, extra = {}) => fetch(origin + '/api/remote/' + route, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: 'alt_session=browser', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal((await call('status', undefined, { Cookie: '', Authorization: 'Bearer tracker-token' })).status, 401);
  assert.equal((await call('pair', {})).status, 423);
  assert.equal((await call('unlock', { password: 'password' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('unlock', { password: 'password' }, { 'Content-Type': 'text/plain' })).status, 403);
  const unlocked = await call('unlock', { password: 'password' }); assert.equal(unlocked.status, 200);
  assert.match(unlocked.headers.get('set-cookie')!, /HttpOnly; Secure; SameSite=Strict/);
  const control = unlocked.headers.get('set-cookie')!.split(';')[0];
  const headers = { Cookie: `alt_session=browser; ${control}` };
  const code = await (await call('pair', {}, headers)).json();
  const pairing = await fetch(origin + '/api/remote/bridge/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.code, name: 'Laptop' }) });
  assert.equal(pairing.status, 200);
  const identity = await pairing.json();
  assert.equal((await call('hosts/' + identity.hostId, undefined, headers)).status, 200);
  const bridge = await fetch(origin + '/api/remote/bridge/poll', { method: 'POST', headers: { Authorization: 'Bearer ' + identity.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ hostId: identity.hostId, instanceId: randomUUID() }) });
  assert.equal(bridge.status, 200);
  assert.equal((await call('hosts/' + identity.hostId + '/command', { id: randomUUID(), command: { op: 'list' } }, { Cookie: '', Authorization: 'Bearer ' + identity.token })).status, 401);
  assert.equal((await call('pair', {}, { Cookie: `alt_session=other; ${control}` })).status, 401);
});
