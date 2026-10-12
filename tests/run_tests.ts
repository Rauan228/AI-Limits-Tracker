import { parseCurlForProvider, parseManualInput } from '../src/services/curlParser';
import { formatTimeRemaining, plural } from '../src/utils/formatters';
import { ClaudeProvider, parseClaudeUsage } from '../src/services/providers/ClaudeProvider';
import { ChatGPTProvider, parseChatGPTUsage } from '../src/services/providers/ChatGPTProvider';
import { GeminiProvider } from '../src/services/providers/GeminiProvider';
import { mergeWithPrevious } from '../src/services/providers/common';
import { applyRecipe, autoDetectWindows, mapWindow, RecipeProvider, resolvePath } from '../src/services/providers/recipe';
import { getProvider } from '../src/services/providers';
import { parseAuthCode } from '../src/services/oauth/authCode';
import { identityFromTokens, isChatGPTCallbackUrl } from '../src/services/oauth/chatgptOAuth';
import { claudePlanFromProfile, isClaudeCallbackUrl } from '../src/services/oauth/claudeOAuth';
import { AccountCredentials, UsageSnapshot } from '../src/models/types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, extraInfo?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  ✗ [FAIL] ${testName} ${extraInfo ? `-> ${extraInfo}` : ''}`);
  }
}

declare const Buffer: any;

function fakeJwt(payload: Record<string, any>): string {
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  credentials?: string;
  body?: string;
}

/** Replaces global fetch with a router; returns the recorded calls. */
function mockFetch(handler: (url: string, init: any) => { status: number; body: any }): RecordedCall[] {
  const calls: RecordedCall[] = [];
  (globalThis as any).fetch = async (url: string, init: any = {}) => {
    calls.push({ url, headers: init.headers || {}, credentials: init.credentials, body: init.body });
    const { status, body } = handler(url, init);
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      redirected: false,
      text: async () => text,
      json: async () => JSON.parse(text),
    } as any;
  };
  return calls;
}

async function runAllTests() {
  const realFetch = globalThis.fetch;
  console.log('\n========================================');
  console.log('  AI LIMITS TRACKER - UNIT & E2E TESTS  ');
  console.log('========================================\n');

  console.log('Suite 1: cURL и ручной ввод');
  {
    const claudeCurl = `curl 'https://claude.ai/api/organizations/org-uuid-12345/usage' -H 'cookie: sessionKey=sk-ant-sid01-testkey123; other=val' -H 'origin: https://claude.ai'`;
    const claudeParsed = parseCurlForProvider(claudeCurl, 'claude');
    assert(claudeParsed.orgId === 'org-uuid-12345', 'Claude cURL: orgId');
    assert(claudeParsed.sessionKey === 'sk-ant-sid01-testkey123', 'Claude cURL: sessionKey');

    const cmdCurl = `curl ^"https://claude.ai/api/organizations/org-9/usage^" ^\n  -H ^"cookie: sessionKey=sk-ant-sid01-cmd; a=b^"`;
    assert(parseCurlForProvider(cmdCurl, 'claude').sessionKey === 'sk-ant-sid01-cmd', 'Claude cURL (cmd/Windows формат)');

    const chatgptCurl = `curl 'https://chatgpt.com/backend-api/wham/usage' -H 'cookie: __Secure-next-auth.session-token=jwt; cf_clearance=abc' -H 'chatgpt-account-id: acct-openai-99'`;
    assert(parseCurlForProvider(chatgptCurl, 'chatgpt').orgId === 'acct-openai-99', 'ChatGPT cURL: account id');

    const geminiCurl = `curl 'https://gemini.google.com/_/BardChatUi/data/batchexecute?bl=boq_assistant-bard_2026&f.sid=-123456789&at=SNlM0e_token_val' -H 'cookie: __Secure-1PSID=sid_val; __Secure-1PSIDTS=ts_val'`;
    const g = parseCurlForProvider(geminiCurl, 'gemini');
    assert(g.bl === 'boq_assistant-bard_2026' && g.sid === '-123456789' && g.atToken === 'SNlM0e_token_val', 'Gemini cURL: bl/sid/at');

    const m1 = parseManualInput('sk-ant-sid01-abc_DEF-123', 'claude');
    assert(m1.ok && m1.credentials.sessionKey === 'sk-ant-sid01-abc_DEF-123' && m1.credentials.authType === 'cookie', 'Ручной ввод: голый sessionKey');
    const m2 = parseManualInput('Bearer ' + fakeJwt({ a: 1 }), 'chatgpt');
    assert(m2.ok && m2.credentials.authType === 'token', 'Ручной ввод: access token ChatGPT');
    assert(!parseManualInput('hello', 'claude').ok, 'Ручной ввод: мусор отклоняется');
    assert(!parseManualInput('foo=bar', 'gemini').ok, 'Ручной ввод: Gemini без PSID отклоняется');
  }

  console.log('\nSuite 2: OAuth callback и коды');
  {
    assert(isClaudeCallbackUrl('https://console.anthropic.com/oauth/code/callback?code=abc&state=xyz'), 'Claude callback распознан');
    assert(!isClaudeCallbackUrl('https://claude.ai/oauth/authorize?code=true'), 'Claude authorize ≠ callback');
    assert(isChatGPTCallbackUrl('http://localhost:1455/auth/callback?code=c1&state=s1'), 'ChatGPT callback распознан');
    const c1 = parseAuthCode('http://localhost:1455/auth/callback?code=c%2B1&state=s1');
    assert(c1?.code === 'c+1' && c1?.state === 's1', 'parseAuthCode: из URL');
    const c2 = parseAuthCode('abc123#st456');
    assert(c2?.code === 'abc123' && c2?.state === 'st456', 'parseAuthCode: формат code#state');
    assert(parseAuthCode('   ') === null, 'parseAuthCode: пустая строка');

    const id = identityFromTokens(
      fakeJwt({ email: 'two@example.com', 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-2', chatgpt_plan_type: 'plus' } })
    );
    assert(id.email === 'two@example.com' && id.accountId === 'acc-2' && id.plan === 'Plus', 'ChatGPT: email/account/plan из id_token');

    assert(claudePlanFromProfile({ organization: { rate_limit_tier: 'default_claude_max_20x' } }) === 'Max 20x', 'Claude план: Max 20x');
    assert(claudePlanFromProfile({ organization: { organization_type: 'claude_pro' } }) === 'Pro', 'Claude план: Pro');
  }

  console.log('\nSuite 3: Парсинг ответов API');
  {
    const buckets = parseClaudeUsage({
      five_hour: { utilization: 32, resets_at: new Date(Date.now() + 3600e3).toISOString() },
      seven_day: { utilization: 48.4, resets_at: null },
      seven_day_opus: null,
      extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1250, utilization: 25 },
    });
    assert(buckets.length === 3, 'Claude: 5ч + неделя + доп. расход');
    assert(buckets[0].remainingPercent === 68, 'Claude: остаток 5ч = 68%');
    assert(buckets[2].details?.used === '12.50', 'Claude: доп. расход в $');

    const gpt = parseChatGPTUsage({
      plan_type: 'pro',
      rate_limit: {
        primary_window: { used_percent: 48, limit_window_seconds: 18000, reset_after_seconds: 600 },
        secondary_window: { used_percent: 10, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 9999 },
      },
      credits: { balance: '12.5', unlimited: false },
    });
    assert(gpt.buckets.length === 2 && gpt.buckets[0].label === 'Codex · 5ч', 'ChatGPT: окна 5ч и неделя');
    assert(gpt.buckets[1].windowType === 'weekly_7d', 'ChatGPT: недельное окно');
    assert(gpt.plan === 'Pro' && gpt.credits === 12.5, 'ChatGPT: план и кредиты');
  }

  console.log('\nSuite 4: Изоляция нескольких аккаунтов одного провайдера');
  {
    const usageByToken: Record<string, number> = { 'tok-A': 20, 'tok-B': 90 };
    const calls = mockFetch((url, init) => {
      const token = (init.headers.Authorization || '').replace('Bearer ', '');
      if (url.includes('/api/oauth/usage')) return { status: 200, body: { five_hour: { utilization: usageByToken[token], resets_at: null } } };
      if (url.includes('/api/oauth/profile'))
        return { status: 200, body: { account: { email: token === 'tok-A' ? 'a@x.com' : 'b@x.com' }, organization: { organization_type: 'claude_pro' } } };
      return { status: 404, body: {} };
    });

    const provider = new ClaudeProvider();
    const far = Date.now() + 3600e3;
    const [ra, rb] = await Promise.all([
      provider.fetchUsage('claude-a', { authType: 'oauth', accessToken: 'tok-A', refreshToken: 'r-A', expiresAt: far }),
      provider.fetchUsage('claude-b', { authType: 'oauth', accessToken: 'tok-B', refreshToken: 'r-B', expiresAt: far }),
    ]);
    assert(ra.snapshot.buckets[0].utilizationPercent === 20 && rb.snapshot.buckets[0].utilizationPercent === 90, 'Два Claude-аккаунта получают СВОИ лимиты');
    assert(ra.snapshot.email === 'a@x.com' && rb.snapshot.email === 'b@x.com', 'Каждый аккаунт определён по своему email');
    assert(calls.every((c) => c.credentials === 'omit'), 'Все запросы без общего cookie-jar (credentials: omit)');
    assert(!calls.some((c) => 'Cookie' in c.headers), 'OAuth-запросы не несут cookie');

    // ChatGPT: two accounts, each with its own ChatGPT-Account-Id
    const gptCalls = mockFetch((url, init) => {
      if (url.includes('wham/usage'))
        return { status: 200, body: { plan_type: 'plus', rate_limit: { primary_window: { used_percent: init.headers['ChatGPT-Account-Id'] === 'acc-1' ? 5 : 70 } } } };
      return { status: 404, body: {} };
    });
    const gp = new ChatGPTProvider();
    const tokenFor = (acc: string) =>
      fakeJwt({ exp: Math.floor(far / 1000), 'https://api.openai.com/auth': { chatgpt_account_id: acc } });
    const g1 = await gp.fetchUsage('gpt-1', { authType: 'oauth', accessToken: tokenFor('acc-1'), expiresAt: far });
    const g2 = await gp.fetchUsage('gpt-2', { authType: 'oauth', accessToken: tokenFor('acc-2'), expiresAt: far });
    assert(g1.snapshot.buckets[0].utilizationPercent === 5 && g2.snapshot.buckets[0].utilizationPercent === 70, 'Два ChatGPT-аккаунта получают СВОИ лимиты');
    assert(gptCalls.map((c) => c.headers['ChatGPT-Account-Id']).join(',') === 'acc-1,acc-2', 'ChatGPT-Account-Id берётся из токена аккаунта');
  }

  console.log('\nSuite 5: Обновление токенов');
  {
    const calls = mockFetch((url, init) => {
      if (url.includes('/v1/oauth/token')) {
        const body = JSON.parse(init.body);
        return { status: 200, body: { access_token: 'new-' + body.refresh_token, refresh_token: 'rotated', expires_in: 28800 } };
      }
      if (url.includes('/api/oauth/usage')) {
        const ok = init.headers.Authorization === 'Bearer new-r-old';
        return ok ? { status: 200, body: { five_hour: { utilization: 1, resets_at: null } } } : { status: 401, body: {} };
      }
      if (url.includes('/api/oauth/profile')) return { status: 200, body: { account: { email: 'a@x.com' }, organization: {} } };
      return { status: 404, body: {} };
    });
    const expired: AccountCredentials = { authType: 'oauth', accessToken: 'old', refreshToken: 'r-old', expiresAt: Date.now() - 1000 };
    const res = await new ClaudeProvider().fetchUsage('claude-a', expired);
    assert(res.snapshot.status === 'ok', 'Истёкший access token обновляется автоматически');
    assert(res.updatedCredentials?.refreshToken === 'rotated', 'Новый refresh token сохраняется (ротация)');
    assert(calls[0].url.includes('/v1/oauth/token'), 'Refresh выполняется до запроса лимитов');

    mockFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    const dead = await new ClaudeProvider().fetchUsage('claude-a', expired);
    assert(dead.snapshot.status === 'reauth_required', 'Отозванный refresh token → «Нужен вход»');
  }

  console.log('\nSuite 6: Честные статусы и устаревшие данные');
  {
    (globalThis as any).fetch = realFetch;
    const legacy = await new ClaudeProvider().fetchUsage('c', { webSessionActive: true });
    assert(legacy.snapshot.status === 'reauth_required' && legacy.snapshot.buckets.length === 0, 'Старая web-сессия без ключа: без фейковых 0%');

    const empty = await new ChatGPTProvider().fetchUsage('g', {});
    assert(empty.snapshot.status === 'not_configured', 'ChatGPT без данных → not_configured');
    const gem = await new GeminiProvider().fetchUsage('g', {});
    assert(gem.snapshot.status === 'not_configured' && gem.snapshot.buckets.length === 0, 'Gemini без данных → not_configured');

    const prev: UsageSnapshot = {
      accountId: 'x', providerType: 'claude', planName: 'Pro', status: 'ok', fetchedAt: '2026-01-01T00:00:00Z',
      buckets: parseClaudeUsage({ five_hour: { utilization: 40, resets_at: null } }),
    };
    const failed: UsageSnapshot = { ...prev, status: 'rate_limited', errorMessage: '429', buckets: [], fetchedAt: new Date().toISOString() };
    const merged = mergeWithPrevious(failed, prev);
    assert(merged.isStale === true && merged.buckets[0].utilizationPercent === 40 && merged.status === 'rate_limited', 'Временный сбой: последние реальные данные помечены устаревшими');
  }

  console.log('\nSuite 7: Форматирование');
  {
    assert(formatTimeRemaining(null) === '—', 'null → —');
    assert(formatTimeRemaining(new Date(Date.now() - 5000).toISOString()) === 'Сброшен', 'прошлое → Сброшен');
    assert(formatTimeRemaining(new Date(Date.now() + 25 * 60e3 + 500).toISOString()) === '25м', '25м');
    assert(formatTimeRemaining(new Date(Date.now() + (2 * 3600 + 15 * 60) * 1000 + 500).toISOString()) === '2ч 15м', '2ч 15м');
    assert(formatTimeRemaining(new Date(Date.now() + (3 * 86400 + 4 * 3600) * 1000 + 500).toISOString()) === '3д 4ч', '3д 4ч');
    assert(plural(4, ['аккаунт', 'аккаунта', 'аккаунтов']) === 'аккаунта' && plural(11, ['a', 'b', 'c']) === 'c', 'Склонение');
  }

  console.log('\nSuite 8: Движок рецептов (Cursor/Copilot/Perplexity/… + Custom)');
  {
    assert(resolvePath({ a: { b: [{ c: 7 }] } }, 'a.b[0].c') === 7, 'resolvePath: вложенный путь с индексом');
    assert(resolvePath({ a: 1 }, 'x.y') === undefined, 'resolvePath: отсутствующий путь → undefined');

    // used/limit mapping (Cursor shape)
    const cursorBody = { 'gpt-4': { numRequests: 125, maxRequestUsage: 500 } };
    const b = mapWindow(cursorBody, { id: 'p', label: 'Premium', windowType: 'monthly_30d', usedPath: 'gpt-4.numRequests', limitPath: 'gpt-4.maxRequestUsage' })!;
    assert(b.utilizationPercent === 25 && b.remainingPercent === 75, 'mapWindow: used/limit → 25% использовано');
    assert(b.details?.used === '125' && b.details?.limit === '500', 'mapWindow: детали used/limit');

    // remaining/limit (Grok/Poe shape)
    const grok = mapWindow({ remainingQueries: 8, totalQueries: 20 }, { id: 'w', label: 'W', windowType: 'sliding_window', remainingPath: 'remainingQueries', limitPath: 'totalQueries' })!;
    assert(grok.utilizationPercent === 60, 'mapWindow: remaining/limit → 60% использовано');

    // percent 0-1 with scale
    const frac = mapWindow({ u: 0.42 }, { id: 'x', label: 'X', windowType: 'sliding_window', usedPercentPath: 'u', percentScale: 1 })!;
    assert(frac.utilizationPercent === 42, 'mapWindow: доля 0-1 масштабируется в проценты');

    // reset formats
    const r = mapWindow({ u: 10, reset: 120 }, { id: 'r', label: 'R', windowType: 'sliding_window', usedPercentPath: 'u', resetPath: 'reset', resetFormat: 'seconds_from_now' })!;
    assert(r.resetsAt !== null && (r.resetSecondsRemaining ?? 0) > 100, 'mapWindow: reset seconds_from_now');

    // auto-detect for custom (arbitrary response)
    const auto = autoDetectWindows({ limits: { used: 30, limit: 100, resetAt: new Date(Date.now() + 3600e3).toISOString() } });
    assert(auto.length === 1 && auto[0].utilizationPercent === 30, 'autoDetect: находит used/limit в произвольном JSON');
    const autoPct = autoDetectWindows({ quota: { utilization: 0.5 } });
    assert(autoPct.length === 1 && autoPct[0].utilizationPercent === 50, 'autoDetect: находит долю utilization');

    // applyRecipe end-to-end
    const snap = applyRecipe('acc', 'cursor', { usageUrl: 'x', auth: 'cookie', planPath: 'plan', windows: [{ id: 'p', label: 'P', windowType: 'monthly_30d', usedPath: 'u', limitPath: 'l' }] } as any, { plan: 'Pro', u: 1, l: 4 });
    assert(snap.status === 'ok' && snap.planName === 'Pro' && snap.buckets[0].utilizationPercent === 25, 'applyRecipe: собирает снапшот + план');

    // registry returns a RecipeProvider for new types
    assert(getProvider('grok') instanceof RecipeProvider && getProvider('custom') instanceof RecipeProvider, 'Реестр: новые сервисы → RecipeProvider');

    // custom cURL → recipe
    const customCurl = `curl 'https://api.svc.com/v1/usage' -H 'cookie: session=abc' `;
    const cm = parseManualInput(customCurl, 'custom');
    assert(cm.ok && cm.credentials.recipe?.usageUrl === 'https://api.svc.com/v1/usage' && cm.credentials.recipe?.auth === 'cookie', 'Custom: cURL → рецепт с URL и cookie-auth');
    const cmPost = parseManualInput(`curl 'https://poe.com/api/gql_POST' -H 'authorization: Bearer eyJx.y.z' --data-raw '{"q":1}'`, 'custom');
    assert(cmPost.ok && cmPost.credentials.recipe?.method === 'POST' && cmPost.credentials.recipe?.body === '{"q":1}' && cmPost.credentials.recipe?.auth === 'bearer', 'Custom: POST + body + bearer');

    // recipe provider cURL extracts cookie
    const cur = parseManualInput(`curl 'https://cursor.com/api/usage' -H 'cookie: WorkosCursorSessionToken=xyz'`, 'cursor');
    assert(Boolean(cur.ok && cur.credentials.cookies?.includes('WorkosCursorSessionToken')), 'Cursor: cURL → cookie');

    // needsVerification recipe with no matching fields → honest error, not crash
    const unverified = await getProvider('mistral').fetchUsage('m', { authType: 'cookie', cookies: 'x=y' });
    // fetch will fail on network in test env; status is error/reauth, never ok with fake data
    assert(unverified.snapshot.status !== 'ok', 'Непроверенный рецепт без сети не выдаёт фейковые данные');
  }

  console.log('\n========================================');
  console.log(`ИТОГИ: Всего: ${totalTests} | Пройдено: ${passedTests} | Ошибок: ${failedTests}`);
  console.log('========================================\n');

  if (failedTests > 0) process.exit(1);
}

runAllTests().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
