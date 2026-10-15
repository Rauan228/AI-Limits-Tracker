// Optional local end-to-end check: real Codex inference, isolated state, headless Chrome.
// Run after building server/web/remote. Requires an existing local Codex login.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const root = process.cwd(), scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-limits-remote-check-'));
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const password = randomBytes(24).toString('base64url');
let cdp, bridge, base;
function start(exe, args, env = {}) {
  const child = spawn(exe, args, { cwd: root, windowsHide: true, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child); child.stderr.resume(); child.stdout.resume(); return child;
}
async function until(fn, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch {} await delay(200); }
  throw new Error('Timed out: ' + label);
}
async function freePort() {
  const server = net.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port; await new Promise(r => server.close(r)); return port;
}
async function connectCdp(url) {
  const ws = new WebSocket(url), pending = new Map(); let sequence = 0;
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = e => {
    const message = JSON.parse(e.data), p = pending.get(message.id);
    if (p) { pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(Error(message.error.message)) : p.resolve(message.result); }
  };
  return {
    call(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout')); }, 15000);
        pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { ws.close(); },
  };
}
async function evaluate(expression) {
  const r = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error('Browser evaluation failed: ' + r.exceptionDetails.text);
  return r.result?.value;
}
async function click(text) {
  const clicked = await evaluate(`(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(b&&!b.disabled){b.click();return true}return false})()`);
  assert.ok(clicked, 'Button available: ' + text);
}
async function browserApi(route, body) {
  return evaluate(`fetch(${JSON.stringify('/api/remote/' + route)},${JSON.stringify({ method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })}).then(async r=>({status:r.status,data:await r.json()}))`);
}

try {
  const port = await freePort(); base = 'http://127.0.0.1:' + port;
  start(process.execPath, ['server/dist/server.mjs'], { HOST: '127.0.0.1', PORT: String(port), ADMIN_PASSWORD: password, APP_SECRET: randomBytes(32).toString('hex'), API_TOKEN: '', DATA_DIR: path.join(scratch, 'data'), WEB_DIR: path.join(root, 'web/dist') });
  await until(async () => (await fetch(base + '/api/health')).ok, 'local server');
  const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const profile = path.join(scratch, 'chrome');
  start(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank']);
  const debugPort = await until(async () => Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]), 'headless Chrome');
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(base)}`, { method: 'PUT' })).json();
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.call('Page.enable'); await cdp.call('Runtime.enable');
  await until(() => evaluate("!!document.querySelector('.login')"), 'login screen');
  const login = await evaluate(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:${JSON.stringify(password)}})}).then(r=>r.status)`);
  assert.equal(login, 200);
  await cdp.call('Page.navigate', { url: base + '/#/remote' });
  await cdp.call('Page.reload');
  await until(() => evaluate("document.body.textContent.includes('Разблокировать управление')"), 'remote unlock screen');
  await evaluate("document.querySelector('input[type=password]').focus()");
  await cdp.call('Input.insertText', { text: password });
  await click('Разблокировать управление');
  await until(() => evaluate("document.body.textContent.includes('Привязать ноутбук')"), 'unlocked UI');
  await click('Привязать ноутбук');
  const code = await until(() => evaluate("document.querySelector('.remote-pair > code')?.textContent"), 'pair code');
  const codexHome = path.join(scratch, 'codex'); await fs.mkdir(codexHome);
  // Temporary private test home prevents the production watcher seeing test chats.
  await fs.copyFile(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json'), path.join(codexHome, 'auth.json'));
  await fs.chmod(path.join(codexHome, 'auth.json'), 0o600);
  const workspace = path.join(scratch, 'project'); await fs.mkdir(workspace);
  const configPath = path.join(scratch, 'bridge.config.json');
  await fs.writeFile(configPath, JSON.stringify({ url: base, codexHome, projects: [{ name: 'Remote check', path: workspace }], name: 'Local verification' }), { mode: 0o600 });
  const pairing = start(process.execPath, ['integrations/dist/codex-remote.mjs', '--config', configPath, '--pair']);
  pairing.stdin.end(code + '\n');
  assert.equal(await new Promise(r => pairing.on('exit', r)), 0, 'Pairing succeeds');
  bridge = start(process.execPath, ['integrations/dist/codex-remote.mjs', '--config', configPath]);
  await until(() => evaluate("document.body.textContent.includes('Ноутбук подключён')"), 'bridge ready', 45000);
  await until(() => evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Новый чат'&&!b.disabled)"), 'new chat available');
  await click('Новый чат');
  await until(() => evaluate("!!document.querySelector('#remote-draft')"), 'chat composer');
  await evaluate("document.querySelector('#remote-draft').focus()");
  await cdp.call('Input.insertText', { text: 'Reply exactly REMOTE_CODEX_OK. Do not use tools. Do not read or change any files.' });
  await click('Отправить');
  await until(() => evaluate("!![...document.querySelectorAll('.remote-message.assistant pre')].find(e=>e.textContent.trim()==='REMOTE_CODEX_OK')"), 'real Codex answer', 90000);
  await until(() => evaluate("document.querySelector('.remote-chat-head span')?.textContent==='Готов к сообщению'"), 'completion state');
  console.log('PASS: browser unlock, pairing, new chat, real Codex response, completion.');
  const remoteStatus = await browserApi('status'), hostId = remoteStatus.data.hosts[0].id;
  const originalState = await browserApi('hosts/' + hostId);
  const originalId = originalState.data.snapshot.conversations[0].thread.id;
  const forkId = randomBytes(16).toString('hex');
  assert.equal((await browserApi('hosts/' + hostId + '/command', { id: forkId, command: { op: 'fork', threadId: originalId } })).status, 202);
  await until(async () => {
    const state = await browserApi('hosts/' + hostId), receipt = state.data.receipts.find(r => r.id === forkId);
    if (receipt?.state === 'error') throw Error('Fork: ' + receipt.error);
    return receipt?.state === 'done' && state.data.snapshot.conversations.some(c => c.thread.id !== originalId && c.messages.some(m => m.text === 'REMOTE_CODEX_OK'));
  }, 'fork preserves conversation history', 70000);
  console.log('PASS: forking a real chat preserves Codex conversation history.');
  const artifacts = path.join(root, '.local-remote'); await fs.mkdir(artifacts, { recursive: true });
  for (const viewport of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 1000 }]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.name === 'mobile' });
    await delay(300);
    const overflow = await evaluate('document.documentElement.scrollWidth > innerWidth'); assert.equal(overflow, false, viewport.name + ' has no horizontal overflow');
    const image = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await fs.writeFile(path.join(artifacts, 'remote-' + viewport.name + '.png'), Buffer.from(image.data, 'base64'));
  }
  console.log('PASS: mobile / desktop layout, screenshots saved in .local-remote.');
  const status = await browserApi('status'); const id = status.data.hosts[0].id;
  const revoke = await evaluate(`fetch(${JSON.stringify('/api/remote/hosts/' + id)},{method:'DELETE',headers:{'Content-Type':'application/json'}}).then(r=>r.status)`);
  assert.equal(revoke, 200);
  await until(() => bridge.exitCode !== null, 'revoked bridge exits');
  console.log('PASS: revoking pairing stops the local bridge.');
} catch (e) {
  if (cdp) console.log('Browser diagnostic:', await evaluate("JSON.stringify({route:location.hash,buttons:[...document.querySelectorAll('button')].map(b=>b.textContent.trim()),error:document.querySelector('.remote-error')?.textContent})").catch(() => 'unavailable'));
  throw e;
} finally {
  cdp?.close();
  for (const child of children.reverse()) if (child.exitCode === null) child.kill();
  await delay(1500);
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('ai-limits-remote-check-')) throw Error('Unexpected cleanup path');
  // Chrome can need a moment to release its private profile files on Windows.
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
