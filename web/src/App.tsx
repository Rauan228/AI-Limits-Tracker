import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AlertLogEntry, ProviderType, QuotaBucket } from '../../src/models/types';
import type { Forecast, StatPoint, UsageStats } from '../../src/services/stats';
import { bindingBucket } from '../../src/services/providers/common';
import { accountChartColor, Colors, PROVIDER_COMPANY, PROVIDER_NAMES } from '../../src/constants/theme';
import { formatTimeRemaining, greeting, MONTHS_SHORT, plural } from '../../src/utils/formatters';
import { Account, api, ApiError } from './api';
import { BarChart, Donut, Icon, LineChart, Logo, MiniBars, Ring, Segmented, StatusDot } from './ui';

/* ---------------- Router ---------------- */

function useRoute(): [string, (to: string) => void] {
  const [route, setRoute] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => {
      setRoute(location.hash.slice(1) || '/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (to) => (location.hash = to)];
}

function useTick(ms = 30000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

const WEEKDAYS_MON = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function relative(iso?: string | null): string {
  if (!iso) return 'никогда';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return `${Math.floor(s / 86400)} д назад`;
}

function clock(t: number | string): string {
  const d = new Date(t);
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function useColors(accounts: Account[]) {
  return useMemo(() => {
    const seen: Record<string, number> = {};
    const map: Record<string, string> = {};
    for (const a of accounts) {
      const i = seen[a.providerType] || 0;
      seen[a.providerType] = i + 1;
      map[a.id] = accountChartColor(a.providerType, i);
    }
    return map;
  }, [accounts]);
}

/* ---------------- App ---------------- */

interface AppState {
  accounts: Account[];
  lastSyncAllAt: string | null;
  intervalMin: number;
  telegram: boolean;
}

export default function App() {
  const [route, go] = useRoute();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [syncing, setSyncing] = useState(false);
  useTick();

  const load = useCallback(async () => {
    try {
      setState(await api.state());
      setAuthed(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthed(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const onFocus = () => document.visibilityState === 'visible' && load();
    const onUnauth = () => setAuthed(false);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('alt:unauthorized', onUnauth);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('alt:unauthorized', onUnauth);
    };
  }, [load]);

  const refreshAll = async () => {
    setSyncing(true);
    try {
      await api.refreshAll();
      await load();
    } finally {
      setSyncing(false);
    }
  };

  if (authed === null) return <div className="splash"><div className="spinner" /></div>;
  if (!authed) return <Login onDone={load} />;
  if (!state) return null;

  const [path, param] = route.split('/').filter(Boolean);
  const accounts = state.accounts;
  let page: React.ReactNode;
  switch (path) {
    case 'account': {
      const acc = accounts.find((a) => a.id === param);
      page = acc ? <AccountPage account={acc} reload={load} go={go} /> : <Empty title="Аккаунт не найден" />;
      break;
    }
    case 'stats':
      page = <StatsPage accounts={accounts} />;
      break;
    case 'accounts':
      page = <AccountsPage accounts={accounts} go={go} reload={load} syncing={syncing} onRefresh={refreshAll} />;
      break;
    case 'add':
      page = <AddPage accounts={accounts} go={go} reload={load} reconnectId={param} />;
      break;
    case 'alerts':
      page = <AlertsPage accounts={accounts} />;
      break;
    case 'settings':
      page = <SettingsPage state={state} reload={load} />;
      break;
    default:
      page = <HomePage state={state} go={go} syncing={syncing} onRefresh={refreshAll} />;
  }

  const tab = !path ? 'home' : path === 'account' ? 'home' : path;
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark">◔</span> AI Limits
        </div>
        <NavItem icon="home" label="Главная" active={tab === 'home'} onClick={() => go('/')} />
        <NavItem icon="chart" label="Статистика" active={tab === 'stats'} onClick={() => go('/stats')} />
        <NavItem icon="users" label="Аккаунты" active={tab === 'accounts'} onClick={() => go('/accounts')} />
        <NavItem icon="bell" label="Уведомления" active={tab === 'alerts'} onClick={() => go('/alerts')} />
        <NavItem icon="settings" label="Настройки" active={tab === 'settings'} onClick={() => go('/settings')} />
        <button className="btn dark wide" onClick={() => go('/add')}>
          <Icon name="plus" size={18} /> Добавить аккаунт
        </button>
      </nav>
      <main className="main">{page}</main>
      <nav className="tabbar">
        <NavItem icon="home" label="Главная" active={tab === 'home'} onClick={() => go('/')} />
        <NavItem icon="chart" label="Статистика" active={tab === 'stats'} onClick={() => go('/stats')} />
        <div className="fab-slot">
          <button className="fab" aria-label="Добавить аккаунт" onClick={() => go('/add')}>
            <Icon name="plus" size={26} stroke={2.4} />
          </button>
        </div>
        <NavItem icon="users" label="Аккаунты" active={tab === 'accounts'} onClick={() => go('/accounts')} />
        <NavItem icon="settings" label="Настройки" active={tab === 'settings'} onClick={() => go('/settings')} />
      </nav>
    </div>
  );
}

const NavItem: React.FC<{ icon: string; label: string; active: boolean; onClick: () => void }> = ({ icon, label, active, onClick }) => (
  <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
    <Icon name={icon} size={21} stroke={active ? 2.4 : 1.9} />
    <span>{label}</span>
  </button>
);

const Empty: React.FC<{ title: string; text?: string; children?: React.ReactNode }> = ({ title, text, children }) => (
  <div className="empty">
    <h3>{title}</h3>
    {text && <p>{text}</p>}
    {children}
  </div>
);

const Header: React.FC<{ title: string; sub?: string; back?: boolean; right?: React.ReactNode }> = ({ title, sub, back, right }) => (
  <header className="page-head">
    <div className="page-head-row">
      {back ? (
        <button className="icon-btn" onClick={() => history.back()} aria-label="Назад">
          <Icon name="arrowLeft" size={22} />
        </button>
      ) : (
        <span />
      )}
      {right}
    </div>
    <h1>{title}</h1>
    {sub && <p className="muted">{sub}</p>}
  </header>
);

/* ---------------- Login ---------------- */

const Login: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.login(pw);
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-logos">
          <Logo type="claude" size={40} />
          <Logo type="chatgpt" size={40} />
          <Logo type="gemini" size={40} />
        </div>
        <h1>AI Limits Tracker</h1>
        <p className="muted">Все лимиты Claude, ChatGPT и Gemini — на одном экране.</p>
        <input type="password" placeholder="Пароль" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" />
        {err && <p className="error">{err}</p>}
        <button className="btn dark wide" disabled={busy || !pw}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  );
};

/* ---------------- Home ---------------- */

const HomePage: React.FC<{ state: AppState; go: (to: string) => void; syncing: boolean; onRefresh: () => void }> = ({ state, go, syncing, onRefresh }) => {
  const { accounts } = state;
  const [filter, setFilter] = useState<'all' | ProviderType>('all');
  const [bars, setBars] = useState<Record<string, Array<number | null>>>({});
  const [streak, setStreak] = useState<number | null>(null);

  useEffect(() => {
    api.history(2).then(({ points }) => {
      const by: Record<string, Array<number | null>> = {};
      for (const p of points) (by[p.accountId] = by[p.accountId] || []).push(p.session);
      for (const k of Object.keys(by)) by[k] = by[k].slice(-10);
      setBars(by);
    }).catch(() => {});
    api.stats(60).then(({ stats }) => setStreak(stats.currentStreak)).catch(() => {});
  }, [state.lastSyncAllAt, accounts.length]);

  let sum = 0, n = 0, low = 0, healthy = 0;
  let nearest: string | null = null;
  for (const a of accounts) {
    if (a.latestSnapshot?.status === 'ok') healthy++;
    const b = bindingBucket(a.latestSnapshot);
    if (b?.utilizationPercent != null) {
      sum += b.utilizationPercent;
      n++;
      if ((b.remainingPercent ?? 100) <= 20) low++;
      if (b.resetsAt && new Date(b.resetsAt).getTime() > Date.now() && (!nearest || b.resetsAt < nearest)) nearest = b.resetsAt;
    }
  }
  const avg = n ? Math.round(sum / n) : null;
  const counts: Record<string, number> = {};
  accounts.forEach((a) => (counts[a.providerType] = (counts[a.providerType] || 0) + 1));
  const filters = ['all', ...(['claude', 'chatgpt', 'gemini'] as ProviderType[]).filter((p) => counts[p])] as Array<'all' | ProviderType>;
  const visible = accounts.filter((a) => filter === 'all' || a.providerType === filter);
  const attention = accounts.some((a) => ['reauth_required', 'error'].includes(a.latestSnapshot?.status || a.lastStatus));

  return (
    <>
      <header className="home-head">
        <div>
          <p className="hello">{greeting()}</p>
          <h1 className="hero-name">Твои лимиты 👋</h1>
          <p className="muted">Все AI аккаунты в одном месте и под контролем</p>
        </div>
        <div className="home-actions">
          <button className={`icon-btn ${syncing ? 'spin' : ''}`} onClick={onRefresh} aria-label="Обновить">
            <Icon name="refresh" />
          </button>
          <button className="icon-btn bell" onClick={() => go('/alerts')} aria-label="Уведомления">
            <Icon name="bell" />
            {attention && <i className="dot" />}
          </button>
        </div>
      </header>

      <section className="card summary">
        <div className="summary-top">
          <div>
            <p className="label">Общее использование</p>
            <p className="big">{avg === null ? '—' : `${avg}%`}</p>
          </div>
          {streak !== null && streak > 0 && (
            <div className="streak-pill" title="Дней подряд с активностью">
              <Icon name="flame" size={16} /> {streak} {plural(streak, ['день', 'дня', 'дней'])} подряд
            </div>
          )}
        </div>
        <div className="track"><i style={{ width: `${Math.min(100, avg ?? 0)}%` }} /></div>
        <div className="stats4">
          <Stat v={String(accounts.length)} l={plural(accounts.length, ['аккаунт', 'аккаунта', 'аккаунтов'])} />
          <Stat v={String(healthy)} l="активны" />
          <Stat v={String(low)} l="на исходе" />
          <Stat v={nearest ? formatTimeRemaining(nearest) : '—'} l="до сброса" />
        </div>
      </section>

      {accounts.length > 0 && (
        <div className="chips">
          {filters.map((f) => (
            <button key={f} className={`chip ${f === filter ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Все' : PROVIDER_NAMES[f]} <i>{f === 'all' ? accounts.length : counts[f]}</i>
            </button>
          ))}
        </div>
      )}

      <div className="cards-grid">
        {visible.map((a) => {
          const b = bindingBucket(a.latestSnapshot);
          return (
            <button key={a.id} className="card account-card" onClick={() => go(`/account/${a.id}`)}>
              <div className="ac-left">
                <Logo type={a.providerType} size={44} />
                <div className="ac-meta">
                  <b>{a.name}</b>
                  <span className="muted small ellipsis">{[a.latestSnapshot?.planName || a.plan, a.email].filter(Boolean).join(' · ') || '—'}</span>
                  <StatusDot account={a} />
                </div>
              </div>
              <Ring remaining={b?.remainingPercent ?? null} provider={a.providerType} dim={a.latestSnapshot?.isStale} />
              <div className="ac-right">
                <span className="muted small">Сброс через</span>
                <b className="reset"><Icon name="clock" size={13} stroke={2.4} /> {formatTimeRemaining(b?.resetsAt)}</b>
                {a.latestSnapshot?.isStale ? (
                  <span className="stale">данные от {clock(a.latestSnapshot.fetchedAt)}</span>
                ) : (
                  <MiniBars values={bars[a.id] || []} />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {accounts.length === 0 && (
        <Empty title="Пока нет аккаунтов" text="Подключите Claude, ChatGPT или Gemini. Можно несколько аккаунтов одного сервиса — у каждого свои лимиты.">
          <button className="btn dark" onClick={() => go('/add')}><Icon name="plus" size={18} /> Добавить аккаунт</button>
        </Empty>
      )}
      <p className="footnote">Сервер обновляет данные каждые {state.intervalMin} мин · последнее обновление {relative(state.lastSyncAllAt)}</p>
    </>
  );
};

const Stat: React.FC<{ v: string; l: string }> = ({ v, l }) => (
  <div className="stat"><b>{v}</b><span>{l}</span></div>
);

/* ---------------- Account ---------------- */

function dailyPeak(points: StatPoint[], days: number) {
  const labels: string[] = [];
  const values: Array<number | null> = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const from = start.getTime() - i * 86400000;
    const d = new Date(from);
    labels.push(days <= 7 ? ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][d.getDay()] : i % 5 === 0 ? String(d.getDate()) : '');
    let max: number | null = null;
    for (const p of points) if (p.t >= from && p.t < from + 86400000 && p.session !== null) max = Math.max(max ?? 0, p.session);
    values.push(max);
  }
  return { labels, values };
}

const AccountPage: React.FC<{ account: Account; reload: () => Promise<void>; go: (to: string) => void }> = ({ account, reload, go }) => {
  const [tab, setTab] = useState<'overview' | 'limits' | 'history' | 'settings'>('overview');
  const [range, setRange] = useState<'7' | '30'>('7');
  const [points, setPoints] = useState<StatPoint[]>([]);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(account.name);
  const snap = account.latestSnapshot;
  const main = bindingBucket(snap);
  const needsLogin = snap?.status === 'reauth_required' || snap?.status === 'not_configured';

  useEffect(() => {
    api.history(30, account.id).then((r) => setPoints(r.points)).catch(() => {});
  }, [account.id, snap?.fetchedAt]);
  useEffect(() => setName(account.name), [account.name]);

  const chart = useMemo(() => dailyPeak(points, Number(range)), [points, range]);
  const refresh = async () => {
    setBusy(true);
    try {
      await api.refresh(account.id);
      await reload();
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm(`Удалить «${account.name}» и его историю?`)) return;
    await api.remove(account.id);
    await reload();
    go('/');
  };

  return (
    <>
      <Header
        title=""
        back
        right={
          <button className={`icon-btn ${busy ? 'spin' : ''}`} onClick={refresh} aria-label="Обновить">
            <Icon name="refresh" />
          </button>
        }
      />
      <div className="identity">
        <Logo type={account.providerType} size={56} />
        <div className="grow">
          <h1 className="acc-title">{account.name}</h1>
          <p className="muted ellipsis">{[snap?.planName || account.plan, account.email].filter(Boolean).join(' · ') || PROVIDER_NAMES[account.providerType]}</p>
        </div>
        <StatusDot account={account} pill />
      </div>

      {snap && snap.status !== 'ok' && (
        <div className={`alert-box ${needsLogin ? 'bad' : ''}`}>
          <div className="grow">
            <b>{snap.errorMessage || 'Ошибка обновления'}</b>
            {snap.isStale && <span className="muted small">Показаны данные от {clock(snap.fetchedAt)}</span>}
          </div>
          {needsLogin && <button className="btn dark small" onClick={() => go(`/add/${account.id}`)}>Войти</button>}
        </div>
      )}

      <Segmented value={tab} onChange={setTab} options={[['overview', 'Обзор'], ['limits', 'Лимиты'], ['history', 'История'], ['settings', 'Настройки']]} />

      {tab === 'overview' && (
        <div className="overview">
          <div className="big-ring">
            <Ring remaining={main?.remainingPercent ?? null} size={220} stroke={16} provider={account.providerType} dim={snap?.isStale} />
            {main && <p className="muted small">{main.label}</p>}
            <p className="muted">Сброс через</p>
            <p className="reset-big"><Icon name="clock" size={20} stroke={2.4} /> {formatTimeRemaining(main?.resetsAt)}</p>
          </div>
          <div className="tiles">
            {(snap?.buckets || []).slice(0, 3).map((b) => <Tile key={b.id} b={b} />)}
          </div>
          <div className="section-row">
            <h2>Использование за {range} дней</h2>
            <Segmented value={range} onChange={setRange} options={[['7', '7 дней'], ['30', '30 дней']]} />
          </div>
          <div className="card">
            {chart.values.some((v) => v !== null) ? (
              <BarChart labels={chart.labels} series={[{ color: '#5f5d58', values: chart.values }]} max={100} />
            ) : (
              <p className="muted center pad">График заполнится по мере обновлений: каждый день — пиковая загрузка 5-часового окна.</p>
            )}
          </div>
          <p className="footnote">Обновлено {relative(account.lastSyncAt)}</p>
        </div>
      )}

      {tab === 'limits' && (
        <div className="stack">
          {(snap?.buckets || []).map((b) => <LimitRow key={b.id} b={b} />)}
          {snap?.credits && (
            <div className="card limit-row"><div className="limit-head"><b>Баланс кредитов</b><span>{snap.credits.balance} {snap.credits.currency}</span></div></div>
          )}
          {!snap?.buckets?.length && <p className="muted center pad">{needsLogin ? 'Войдите в аккаунт, чтобы увидеть лимиты.' : 'Сервис не вернул лимитов.'}</p>}
        </div>
      )}

      {tab === 'history' && (
        <div className="stack">
          <div className="card">
            <p className="label">Сессионное окно, % использования</p>
            {points.length ? <LineChart values={points.slice(-60).map((p) => p.session)} color={Colors[account.providerType].chart} /> : <p className="muted center pad">История пока пуста.</p>}
          </div>
          <div className="card table">
            <div className="tr th"><span>Время</span><span>Сессия</span><span>Неделя</span></div>
            {[...points].reverse().slice(0, 40).map((p, i) => (
              <div className="tr" key={i}><span>{clock(p.t)}</span><span>{p.session ?? '—'}%</span><span>{p.weekly != null ? `${p.weekly}%` : '—'}</span></div>
            ))}
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="stack">
          <div className="card">
            <p className="label">Название</p>
            <div className="row">
              <input value={name} onChange={(e) => setName(e.target.value)} />
              {name.trim() && name !== account.name && (
                <button className="btn dark small" onClick={async () => { await api.rename(account.id, name); await reload(); }}>Сохранить</button>
              )}
            </div>
            {account.email && <p className="muted small mt">Аккаунт: {account.email}</p>}
            <label className="switch-row mt">
              <span>Отслеживать</span>
              <input type="checkbox" checked={account.isActive} onChange={async (e) => { await api.setActive(account.id, e.target.checked); await reload(); }} />
            </label>
          </div>
          <button className="btn light wide" onClick={() => go(`/add/${account.id}`)}>Переподключить аккаунт</button>
          <button className="btn danger wide" onClick={remove}><Icon name="trash" size={18} /> Удалить аккаунт</button>
        </div>
      )}
    </>
  );
};

const Tile: React.FC<{ b: QuotaBucket }> = ({ b }) => (
  <div className="tile">
    <span className="muted small ellipsis">{b.label}</span>
    <b>
      {b.details?.used ? `$${b.details.used}` : b.remainingPercent === null ? '—' : `${Math.round(b.remainingPercent)}%`}
      <small>{b.details?.limit ? ` / $${b.details.limit}` : ' ост.'}</small>
    </b>
  </div>
);

const LimitRow: React.FC<{ b: QuotaBucket }> = ({ b }) => {
  const used = b.utilizationPercent;
  const color = used === null ? Colors.unavailable : used >= 90 ? Colors.exhausted : used >= 70 ? Colors.critical : Colors.ring;
  return (
    <div className="card limit-row">
      <div className="limit-head"><b>{b.label}</b><span>{used === null ? '—' : `${Math.round(used)}% исп.`}</span></div>
      <div className="track"><i style={{ width: `${Math.min(100, used ?? 0)}%`, background: color }} /></div>
      <p className="muted small">
        {b.details?.used
          ? `Потрачено $${b.details.used} из $${b.details.limit}`
          : b.resetsAt
          ? `Сброс через ${formatTimeRemaining(b.resetsAt)} · ${new Date(b.resetsAt).toLocaleString('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
          : 'Время сброса не сообщается'}
      </p>
    </div>
  );
};

/* ---------------- Stats ---------------- */

const RANGES: Array<[string, string]> = [['7', '7Д'], ['30', '30Д'], ['90', '3М'], ['365', '1Г']];

const StatsPage: React.FC<{ accounts: Account[] }> = ({ accounts }) => {
  const [range, setRange] = useState('30');
  const [data, setData] = useState<{ stats: UsageStats; forecasts: Record<string, Forecast> } | null>(null);
  const colors = useColors(accounts);

  useEffect(() => {
    setData(null);
    api.stats(Number(range)).then(setData).catch(() => {});
  }, [range]);

  const dist = useMemo(() => {
    const items = accounts
      .map((a) => ({ a, used: bindingBucket(a.latestSnapshot)?.utilizationPercent ?? null }))
      .filter((x): x is { a: Account; used: number } => x.used !== null);
    const total = items.reduce((s, x) => s + x.used, 0);
    return { avg: items.length ? Math.round(total / items.length) : 0, items: items.map((x) => ({ ...x, share: total ? Math.round((x.used / total) * 100) : 0 })) };
  }, [accounts]);

  const s = data?.stats;
  const maxHour = s ? Math.max(1, ...s.byHour) : 1;
  const maxDay = s ? Math.max(1, ...s.byWeekday) : 1;

  return (
    <>
      <Header title="Статистика" sub="Активность и лимиты по всем аккаунтам" />
      <Segmented value={range} onChange={setRange} options={RANGES as Array<[string, string]>} />
      {!s ? (
        <div className="splash small"><div className="spinner" /></div>
      ) : (
        <div className="stack">
          <div className="kpis">
            <Kpi icon="flame" value={`${s.currentStreak}`} label={`${plural(s.currentStreak, ['день', 'дня', 'дней'])} подряд`} accent />
            <Kpi value={`${s.longestStreak}`} label="рекорд серии" />
            <Kpi value={`${s.activeDays}`} label={`активных ${plural(s.activeDays, ['день', 'дня', 'дней'])}`} />
            <Kpi value={`${s.limitHits}`} label={`${plural(s.limitHits, ['упор', 'упора', 'упоров'])} в лимит`} />
            <Kpi value={s.redZoneMinutes >= 60 ? `${Math.round(s.redZoneMinutes / 60)}ч` : `${s.redZoneMinutes}м`} label="в красной зоне (<20%)" />
            <Kpi value={s.busiestHour === null ? '—' : `${String(s.busiestHour).padStart(2, '0')}:00`} label="самый активный час" />
          </div>

          <div className="card">
            <h2>Календарь активности</h2>
            <Heatmap calendar={s.calendar} days={Math.min(Number(range), 182)} />
          </div>

          <div className="two-col">
            <div className="card">
              <h2>Распределение нагрузки</h2>
              <div className="dist">
                <Donut segments={dist.items.map((x) => ({ value: x.used, color: colors[x.a.id] }))} value={`${dist.avg}%`} label="в среднем" />
                <div className="legend">
                  {dist.items.map((x) => (
                    <div key={x.a.id}><i style={{ background: colors[x.a.id] }} /><span className="ellipsis">{x.a.name}</span><b>{x.share}%</b></div>
                  ))}
                  {!dist.items.length && <p className="muted small">Нет текущих данных</p>}
                </div>
              </div>
            </div>
            <div className="card">
              <h2>Прогноз (5-часовое окно)</h2>
              <div className="forecasts">
                {accounts.map((a) => {
                  const f = data!.forecasts[a.id];
                  const session = a.latestSnapshot?.buckets.find((b) => b.windowType === 'session_5h');
                  let text = 'темп ровный — хватит до сброса';
                  if (!session) text = 'нет данных';
                  else if (f?.exhaustAt && !f.safeUntilReset) text = `кончится через ${formatTimeRemaining(new Date(f.exhaustAt).toISOString())}`;
                  else if (f?.burnRatePerHour) text = `${f.burnRatePerHour}%/ч — хватит до сброса`;
                  return (
                    <div key={a.id} className="fc-row">
                      <Logo type={a.providerType} size={26} />
                      <span className="ellipsis grow">{a.name}</span>
                      <span className={`small ${f?.exhaustAt && !f.safeUntilReset ? 'bad-text' : 'muted'}`}>{text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="two-col">
            <div className="card">
              <h2>По часам</h2>
              <div className="hours">
                {s.byHour.map((v, h) => (
                  <div key={h} className="hour" title={`${h}:00`}>
                    <i style={{ height: `${Math.max(4, (v / maxHour) * 100)}%`, opacity: v ? 1 : 0.25 }} />
                    {h % 6 === 0 && <span>{h}</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h2>По дням недели</h2>
              <div className="weekdays">
                {s.byWeekday.map((v, d) => (
                  <div key={d}><span>{WEEKDAYS_MON[d]}</span><div className="track"><i style={{ width: `${(v / maxDay) * 100}%` }} /></div></div>
                ))}
              </div>
            </div>
          </div>

          <div className="card table">
            <div className="tr th five"><span>Аккаунт</span><span>Средн.</span><span>Пик</span><span>Упоры</span><span>Доля</span></div>
            {s.perAccount.map((p) => {
              const a = accounts.find((x) => x.id === p.accountId);
              if (!a) return null;
              return (
                <div className="tr five" key={p.accountId}>
                  <span className="ellipsis"><i className="legend-dot" style={{ background: colors[a.id] }} />{a.name}</span>
                  <span>{p.avgSession === null ? '—' : `${Math.round(p.avgSession)}%`}</span>
                  <span>{p.peakSession === null ? '—' : `${Math.round(p.peakSession)}%`}</span>
                  <span>{p.limitHits}</span>
                  <span>{p.activityShare}%</span>
                </div>
              );
            })}
          </div>
          <p className="footnote">
            Сервисы не сообщают число сообщений или токенов по подписке — статистика считается по изменению «% использования» лимитов. Замеров: {s.measurements}.
          </p>
        </div>
      )}
    </>
  );
};

const Kpi: React.FC<{ value: string; label: string; icon?: string; accent?: boolean }> = ({ value, label, icon, accent }) => (
  <div className={`card kpi ${accent ? 'accent' : ''}`}>
    <b>{icon && <Icon name={icon} size={18} />}{value}</b>
    <span>{label}</span>
  </div>
);

const Heatmap: React.FC<{ calendar: Record<string, number>; days: number }> = ({ calendar, days }) => {
  const weeks = Math.ceil(days / 7) + 1;
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOffset = (end.getDay() + 6) % 7; // Monday-based
  const start = new Date(end.getTime() - ((weeks - 1) * 7 + startOffset) * 86400000);
  const max = Math.max(1, ...Object.values(calendar));
  const cols: React.ReactNode[] = [];
  for (let w = 0; w < weeks; w++) {
    const cells: React.ReactNode[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * 86400000);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const v = calendar[key] || 0;
      const future = date > end;
      const level = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
      cells.push(<i key={d} className={`hm l${level} ${future ? 'future' : ''}`} title={`${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}: ${Math.round(v)}`} />);
    }
    cols.push(<div key={w} className="hm-col">{cells}</div>);
  }
  return (
    <div className="heatmap">
      <div className="hm-days">{WEEKDAYS_MON.map((d, i) => <span key={d}>{i % 2 === 0 ? d : ''}</span>)}</div>
      <div className="hm-grid">{cols}</div>
    </div>
  );
};

/* ---------------- Accounts ---------------- */

const AccountsPage: React.FC<{ accounts: Account[]; go: (to: string) => void; reload: () => Promise<void>; syncing: boolean; onRefresh: () => void }> = ({ accounts, go, reload, syncing, onRefresh }) => {
  const move = async (i: number, dir: -1 | 1) => {
    const ids = accounts.map((a) => a.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.reorder(ids);
    await reload();
  };
  return (
    <>
      <Header
        title="Аккаунты"
        sub="Управление всеми AI аккаунтами"
        right={<button className={`icon-btn ${syncing ? 'spin' : ''}`} onClick={onRefresh} aria-label="Обновить все"><Icon name="refresh" /></button>}
      />
      <button className="btn dark wide mb" onClick={() => go('/add')}><Icon name="plus" size={18} /> Добавить аккаунт</button>
      <div className="stack">
        {accounts.map((a, i) => (
          <div key={a.id} className="card list-row">
            <button className="row-main" onClick={() => go(`/account/${a.id}`)}>
              <Logo type={a.providerType} size={46} />
              <div className="grow">
                <b className="ellipsis">{a.name}</b>
                <span className="muted small ellipsis">{a.email || `обновлено ${relative(a.lastSyncAt)}`}</span>
              </div>
              <StatusDot account={a} />
            </button>
            <div className="order">
              <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="Выше">▲</button>
              <button disabled={i === accounts.length - 1} onClick={() => move(i, 1)} aria-label="Ниже">▼</button>
            </div>
          </div>
        ))}
        {!accounts.length && <Empty title="Нет аккаунтов" text="Нажмите «Добавить аккаунт»." />}
      </div>
    </>
  );
};

/* ---------------- Add / reconnect ---------------- */

const DEFAULT_GUIDE = {
  steps: [
    'Откройте сайт сервиса на компьютере и войдите в нужный аккаунт.',
    'DevTools (F12) → Network → найдите запрос, который возвращает ваши лимиты.',
    'Правой кнопкой → Copy → Copy as cURL и вставьте сюда.',
  ],
  placeholder: 'curl …',
};

const GUIDES: Partial<Record<ProviderType, { steps: string[]; placeholder: string }>> = {
  claude: {
    steps: [
      'Откройте claude.ai на компьютере и войдите в нужный аккаунт.',
      'DevTools (F12) → Application → Cookies → https://claude.ai.',
      'Скопируйте значение cookie sessionKey (начинается с sk-ant-sid…). Можно и целиком cURL: Network → любой запрос к /api → Copy as cURL.',
    ],
    placeholder: 'sk-ant-sid01-…  или  curl …',
  },
  chatgpt: {
    steps: [
      'Откройте chatgpt.com на компьютере и войдите в нужный аккаунт.',
      'DevTools (F12) → Network → любой запрос к backend-api → Copy as cURL.',
      'Вставьте cURL сюда — сервер возьмёт cookie сессии и будет сам обновлять доступ.',
    ],
    placeholder: 'curl https://chatgpt.com/backend-api/…',
  },
  gemini: {
    steps: [
      'Откройте gemini.google.com на компьютере и войдите в нужный Google-аккаунт.',
      'DevTools (F12) → Network → отправьте любое сообщение → запрос batchexecute → Copy as cURL.',
      'Для второго Google-аккаунта используйте отдельный профиль браузера.',
    ],
    placeholder: "curl 'https://gemini.google.com/_/BardChatUi/data/batchexecute…",
  },
  cursor: {
    steps: ['Откройте cursor.com/settings и войдите.', 'DevTools → Network → запрос usage → Copy as cURL.', 'Вставьте сюда.'],
    placeholder: 'curl https://cursor.com/api/usage …',
  },
  custom: {
    steps: [
      'Откройте сайт сервиса и найдите страницу с лимитами/квотой.',
      'DevTools → Network → запрос, возвращающий лимиты → Copy as cURL.',
      'Вставьте — сервер сам найдёт в ответе проценты и время сброса.',
    ],
    placeholder: 'curl … (любой сервис)',
  },
};

const ADD_GROUPS: Array<{ title: string; items: ProviderType[] }> = [
  { title: 'Основные', items: ['claude', 'chatgpt', 'gemini'] },
  { title: 'Кодинг', items: ['cursor', 'copilot'] },
  { title: 'Чат-ассистенты', items: ['perplexity', 'grok', 'mistral', 'deepseek', 'poe'] },
  { title: 'Любой другой сервис', items: ['custom'] },
];

const supportsOAuth = (p: ProviderType) => p === 'claude' || p === 'chatgpt';

const AddPage: React.FC<{ accounts: Account[]; go: (to: string) => void; reload: () => Promise<void>; reconnectId?: string }> = ({ accounts, go, reload, reconnectId }) => {
  const reconnect = accounts.find((a) => a.id === reconnectId);
  const [provider, setProvider] = useState<ProviderType | null>(reconnect?.providerType ?? null);
  const [mode, setMode] = useState<'oauth' | 'manual'>('oauth');
  const [oauth, setOauth] = useState<{ authorizeUrl: string; state: string } | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setInput('');
    setErr('');
    setOauth(null);
    setMode(provider && supportsOAuth(provider) ? 'oauth' : 'manual');
  }, [provider]);

  const startOAuth = async () => {
    if (!provider) return;
    setErr('');
    try {
      const r = await api.oauthStart(provider, reconnect?.id);
      setOauth(r);
      window.open(r.authorizeUrl, '_blank', 'noopener');
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const submit = async () => {
    if (!provider) return;
    setBusy(true);
    setErr('');
    try {
      const r =
        mode === 'oauth' && oauth
          ? await api.oauthFinish(oauth.state, input)
          : await api.manual(provider, input, reconnect?.id);
      await reload();
      go(`/account/${r.account.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!provider) {
    return (
      <>
        <Header title="Добавить аккаунт" back />
        <div className="stack">
          {ADD_GROUPS.map((g) => (
            <div key={g.title}>
              <p className="add-group">{g.title}</p>
              {g.items.map((p) => (
                <button key={p} className="card provider-row" onClick={() => setProvider(p)}>
                  <Logo type={p} size={44} />
                  <div className="grow">
                    <b>{PROVIDER_NAMES[p]}</b>
                    <span className="muted small">{PROVIDER_COMPANY[p]}{accounts.some((a) => a.providerType === p) ? ' · ещё один аккаунт' : ''}</span>
                  </div>
                  <Icon name="chevron" />
                </button>
              ))}
            </div>
          ))}
          <p className="info">Можно подключить сколько угодно аккаунтов одного сервиса. Данные каждого аккаунта хранятся отдельно и в зашифрованном виде, а один и тот же аккаунт дважды подключить нельзя.</p>
        </div>
      </>
    );
  }

  const guide = GUIDES[provider] || DEFAULT_GUIDE;
  const codePlaceholder = provider === 'claude' ? 'code#state' : 'http://localhost:1455/auth/callback?code=…';
  return (
    <>
      <Header title={reconnect ? `Обновить доступ: ${reconnect.name}` : `Подключить ${PROVIDER_NAMES[provider]}`} back />

      {supportsOAuth(provider) && (
        <Segmented
          value={mode}
          options={[['oauth', 'Вход в аккаунт'], ['manual', 'Вручную (cURL)']]}
          onChange={(m) => { setMode(m); setErr(''); setInput(''); }}
        />
      )}

      {mode === 'oauth' && supportsOAuth(provider) ? (
        <div className="stack">
          <div className="card steps">
            <div className="step"><i>1</i><div className="grow">
              <b>Откройте вход</b>
              <p className="small muted">Войдите в {reconnect ? 'нужный' : 'любой'} аккаунт {PROVIDER_NAMES[provider]}. Для второго аккаунта — окно инкогнито или другой профиль браузера. Вход держится неделями и продлевается сам.</p>
              <button className="btn dark small" onClick={startOAuth} style={{ marginTop: 8 }}>
                <Icon name="external" size={16} /> {oauth ? 'Открыть ещё раз' : 'Открыть страницу входа'}
              </button>
            </div></div>
            <div className="step"><i>2</i><div className="grow">
              <b>{provider === 'claude' ? 'Нажмите Authorize и скопируйте код' : 'Скопируйте адрес после входа'}</b>
              <p className="small muted">{provider === 'claude' ? 'Claude покажет код вида xxxx#yyyy.' : 'Браузер откроет localhost:1455/auth/callback?code=… и покажет ошибку — это нормально, скопируйте весь адрес из строки.'}</p>
            </div></div>
            <div className="step"><i>3</i><div className="grow">
              <b>Вставьте сюда</b>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={codePlaceholder} disabled={!oauth} style={{ marginTop: 6 }} />
            </div></div>
          </div>
          {err && <p className="error">{err}</p>}
          <button className="btn dark wide" disabled={!oauth || !input.trim() || busy} onClick={submit}>{busy ? 'Подключаем…' : 'Подключить'}</button>
        </div>
      ) : (
        <div className="stack">
          <div className="card steps">
            {guide.steps.map((s, i) => (
              <div className="step" key={i}><i>{i + 1}</i><div><p className="small">{s}</p></div></div>
            ))}
          </div>
          <textarea rows={7} value={input} onChange={(e) => setInput(e.target.value)} placeholder={guide.placeholder} />
          {supportsOAuth(provider) && <p className="muted tiny">⚠ Вход по cURL/sessionKey живёт недолго (у Claude ~30 мин). Для долгой работы используйте «Вход в аккаунт».</p>}
          {err && <p className="error">{err}</p>}
          <button className="btn dark wide" disabled={!input.trim() || busy} onClick={submit}>{busy ? 'Проверяем…' : 'Подключить'}</button>
        </div>
      )}
      <p className="muted tiny center" style={{ marginTop: 10 }}>Данные шифруются на вашем сервере и отправляются только в {PROVIDER_NAMES[provider]}.</p>
    </>
  );
};

/* ---------------- Alerts ---------------- */

const AlertsPage: React.FC<{ accounts: Account[] }> = ({ accounts }) => {
  const [items, setItems] = useState<AlertLogEntry[] | null>(null);
  useEffect(() => {
    api.alerts().then((r) => setItems(r.alerts)).catch(() => setItems([]));
  }, []);
  const icon: Record<string, string> = { low20: '🔔', low10: '⚠️', exhausted: '⛔', restored: '✅', reauth: 'ℹ️' };
  return (
    <>
      <Header
        title="Уведомления"
        back
        right={items?.length ? <button className="link-btn" onClick={async () => { await api.clearAlerts(); setItems([]); }}>Очистить</button> : null}
      />
      <div className="card list">
        {(items || []).map((n) => (
          <div key={n.id} className="alert-row">
            <span className="alert-icon">{icon[n.kind] || '🔔'}</span>
            <div className="grow">
              <b>{n.title}</b>
              <p className="muted small">{n.body}</p>
              {!n.title.includes(accounts.find((a) => a.id === n.accountId)?.name || '\u0000') && (
                <p className="muted tiny">{accounts.find((a) => a.id === n.accountId)?.name}</p>
              )}
            </div>
            <span className="muted tiny">{clock(n.createdAt)}</span>
          </div>
        ))}
        {items && !items.length && <Empty title="Уведомлений нет" text="Здесь появятся предупреждения о низком лимите, исчерпании, восстановлении и необходимости войти заново." />}
      </div>
    </>
  );
};

/* ---------------- Settings ---------------- */

const SettingsPage: React.FC<{ state: AppState; reload: () => Promise<void> }> = ({ state, reload }) => {
  const [installEvt, setInstallEvt] = useState<any>(null);
  useEffect(() => {
    const h = (e: any) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  return (
    <>
      <Header title="Настройки" sub={`Последнее обновление: ${relative(state.lastSyncAllAt)}`} />
      <div className="card menu">
        <label className="menu-row">
          <span>Обновление данных</span>
          <select value={state.intervalMin} onChange={async (e) => { await api.setInterval(Number(e.target.value)); await reload(); }}>
            {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>каждые {m} мин</option>)}
          </select>
        </label>
        <div className="menu-row">
          <span>Telegram-уведомления</span>
          <span className="muted small">{state.telegram ? 'подключены' : 'не настроены (TELEGRAM_BOT_TOKEN)'}</span>
        </div>
        <div className="menu-row column">
          <span>Установить как приложение</span>
          <span className="muted small">
            iPhone: Safari → «Поделиться» → «На экран „Домой“». Android: меню Chrome → «Установить приложение».
          </span>
          {installEvt && <button className="btn dark small mt" onClick={() => installEvt.prompt()}>Установить</button>}
        </div>
        <button className="menu-row danger" onClick={async () => { await api.logout(); location.reload(); }}>
          <span>Выйти</span><Icon name="logout" size={18} />
        </button>
      </div>
      <p className="footnote">
        AI Limits Tracker · open source · <a href="https://github.com/Rauan228/AI-Limits-Tracker" target="_blank" rel="noopener">GitHub</a>
      </p>
    </>
  );
};
