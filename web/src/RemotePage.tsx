import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteApproval, RemoteCommand, RemoteConversation, RemoteHost, RemoteHostState } from '../../src/models/remote';
import { api, ApiError } from './api';
import { Icon } from './ui';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const STATUS = { idle: 'Готов к сообщению', working: 'Codex работает', waiting: 'Нужен ваш ответ', error: 'Ошибка' };

export default function RemotePage({ initialThreadId }: { initialThreadId?: string }) {
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [hostId, setHostId] = useState('');
  const [host, setHost] = useState<RemoteHostState | null>(null);
  const [selected, setSelected] = useState('');
  const [project, setProject] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [password, setPassword] = useState('');
  const [pair, setPair] = useState<{ code: string; expiresAt: number; knownHosts: string[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [lastContact, setLastContact] = useState(0);
  const [now, setNow] = useState(Date.now);
  const transcript = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const openedInitial = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (pair && (now >= pair.expiresAt || hosts.some(h => !pair.knownHosts.includes(h.id)))) setPair(null);
  }, [pair, hosts, now]);

  const showError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 423) setUnlocked(false);
    setError(e instanceof Error ? e.message : 'Не удалось связаться с ноутбуком');
  }, []);
  const loadStatus = useCallback(async () => {
    try {
      const state = await api.remoteStatus();
      if (!mounted.current) return;
      setReady(true); setUnlocked(state.unlocked); setHosts(state.hosts);
      setHostId(id => state.hosts.some(h => h.id === id) ? id : state.hosts[0]?.id || '');
    } catch (e) {
      if (mounted.current) { setReady(true); if (e instanceof ApiError && e.status === 404) setUnavailable(true); else showError(e); }
    }
  }, [showError]);
  useEffect(() => {
    loadStatus();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') loadStatus(); }, 4000);
    return () => clearInterval(timer);
  }, [loadStatus]);

  useEffect(() => {
    if (!unlocked || !hostId) return;
    let cancelled = false, loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const value = await api.remoteHost(hostId);
        if (!cancelled) { setHost(value); setLastContact(Date.now()); setProject(p => value.projects.some(v => v.path === p) ? p : value.projects[0]?.path || ''); }
      } catch (e) { if (!cancelled) showError(e); }
      finally { loading = false; }
    };
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [unlocked, hostId, showError]);

  const run = useCallback(async (command: RemoteCommand) => {
    setBusy(true); setError('');
    try {
      const id = crypto.randomUUID();
      await api.remoteCommand(hostId, id, command);
      const deadline = Date.now() + 95000;
      while (Date.now() < deadline && mounted.current) {
        const current = await api.remoteHost(hostId);
        setHost(current); setLastContact(Date.now());
        const result = current.receipts.find(r => r.id === id);
        if (result?.state === 'error') throw new Error(result.error || 'Не удалось выполнить команду');
        if (result?.state === 'done') return result.value;
        await pause(500);
      }
      throw new Error('Ответ не получен. Проверьте чат перед повторной отправкой.');
    } catch (e) { showError(e); throw e; }
    finally { if (mounted.current) setBusy(false); }
  }, [hostId, showError]);

  const open = useCallback(async (id: string) => {
    setSelected(id); atBottom.current = true;
    try { await run({ op: 'read', threadId: id }); } catch {}
  }, [run]);

  useEffect(() => {
    if (unlocked && initialThreadId && host?.online && !openedInitial.current) {
      openedInitial.current = true; open(initialThreadId);
    }
  }, [unlocked, initialThreadId, host?.online, open]);

  const conversation = host?.snapshot?.conversations.find(c => c.thread.id === selected);
  const online = !!host?.online && host.snapshot?.connected && now - lastContact < 12000;
  const draft = drafts[selected] || '';
  const changeDraft = (text: string) => setDrafts(d => ({ ...d, [selected]: text }));
  const messages = conversation?.messages;
  useEffect(() => {
    if (atBottom.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages, selected]);

  const chooseHost = (id: string) => { setHostId(id); setHost(null); setSelected(''); setProject(''); setError(''); };
  const start = async () => {
    try { const result = await run({ op: 'create', project }); if (result?.threadId) { setSelected(result.threadId); atBottom.current = true; } } catch {}
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    try { await run({ op: 'send', threadId: selected, text: draft.trim() }); changeDraft(''); } catch {}
  };
  const takeOver = async (fork: boolean) => {
    try { const result = await run({ op: fork ? 'fork' : 'resume', threadId: selected }); if (result?.threadId) setSelected(result.threadId); } catch {}
  };

  return (
    <section className="remote-page">
      <header className="page-head">
        <div className="page-head-row">
          <a className="btn remote-back" href="#/agents"><Icon name="back" size={18} /> Агенты</a>
          {unlocked && <button className="btn" onClick={async () => { try { await api.remoteLock(); setUnlocked(false); setHost(null); } catch (e) { showError(e); } }}>Заблокировать</button>}
        </div>
        <h1>Чат с Codex</h1>
        <p className="muted">Задачи выполняются на вашем ноутбуке</p>
      </header>
      {error && <p className="remote-error" role="alert">{error}</p>}
      {unavailable ? <div className="card remote-panel"><h2>Обновите сервер трекера</h2><p>Для удалённого чата нужна новая серверная часть. Наблюдение за агентами продолжает работать.</p></div>
        : !ready ? <p role="status">Подключаемся к панели…</p>
        : !unlocked ? (
          <form className="card remote-panel stack" onSubmit={async e => {
            e.preventDefault(); setBusy(true); setError('');
            try { await api.remoteUnlock(password); setPassword(''); await loadStatus(); } catch (e) { showError(e); } finally { setBusy(false); }
          }}>
            <h2>Разрешить управление на 15 минут</h2>
            <p className="muted">Подтвердите пароль панели, чтобы отправлять задачи и разрешать действия на ноутбуке.</p>
            <label className="stack">Пароль панели<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
            <button className="btn dark" disabled={busy || !password}>{busy ? 'Проверяем…' : 'Разблокировать управление'}</button>
          </form>
        ) : (
          <>
            <div className="card remote-panel stack">
              <div className="remote-row"><h2>Ваш ноутбук</h2><button className="btn" disabled={busy} onClick={async () => { try { setPair({ ...await api.remotePair(), knownHosts: hosts.map(h => h.id) }); } catch (e) { showError(e); } }}>Привязать ноутбук</button></div>
              {hosts.length > 0 ? <div className="remote-row">
                <label className="grow">Устройство<select value={hostId} onChange={e => chooseHost(e.target.value)} disabled={busy}>{hosts.map(h => <option value={h.id} key={h.id}>{h.name} · {h.online ? 'в сети' : 'не в сети'}</option>)}</select></label>
                <button className="btn" disabled={busy || !hostId} onClick={async () => {
                  if (!confirm('Отозвать доступ этого ноутбука? Для подключения потребуется новый код.')) return;
                  try { await api.remoteRevoke(hostId); setHost(null); await loadStatus(); } catch (e) { showError(e); }
                }}>Отключить</button>
              </div> : <p className="muted">Создайте код и запустите настройку моста на ноутбуке один раз. После этого он будет подключаться сам.</p>}
              {pair && <div className="remote-pair" role="status">
                <p>Код привязки до {new Date(pair.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                <code>{pair.code}</code>
                <p className="small">На ноутбуке запустите <code>setup-codex-remote.ps1</code> из папки integrations и введите этот код. Код даёт доступ к управлению — не передавайте его другим.</p>
              </div>}
            </div>
            {host && <>
              <p className="remote-connection" role="status"><span className={`status-dot ${online ? 'online' : ''}`} />{online ? 'Ноутбук подключён' : !host.online ? 'Ноутбук не в сети. Отправка отключена.' : host.snapshot?.error || 'Codex подключается…'}</p>
              <div className="card remote-panel remote-new">
                <label className="grow">Проект<select value={project} disabled={busy || !online} onChange={e => setProject(e.target.value)}>{host.projects.map(p => <option value={p.path} key={p.path}>{p.name}</option>)}</select></label>
                <button className="btn dark" disabled={busy || !online || !project} onClick={start}><Icon name="plus" size={18} /> Новый чат</button>
              </div>
              <div className="remote-workspace">
                <aside className="card remote-thread-list" aria-label="Чаты Codex">
                  <div className="remote-row"><h2>Чаты</h2><button className="icon-btn" aria-label="Обновить список чатов" disabled={busy || !online} onClick={() => { run({ op: 'list' }).catch(() => {}); }}><Icon name="refresh" size={18} /></button></div>
                  {(host.snapshot?.threads || []).map(t => <button className={`remote-thread ${t.id === selected ? 'selected' : ''}`} key={t.id} disabled={busy || !online} onClick={() => open(t.id)} aria-pressed={t.id === selected}>
                    <b>{t.title}</b><span>{t.cwd.split(/[\\/]/).pop()} · {t.managed ? STATUS[t.status] : 'История Codex'}</span>
                  </button>)}
                  {!host.snapshot?.threads.length && <p className="muted small">Создайте новый чат в разрешённом проекте.</p>}
                </aside>
                <div className="card remote-chat">
                  {!selected ? <div className="remote-placeholder"><Icon name="terminal" size={30} /><h2>Продолжайте работу с телефона</h2><p>Выберите чат или начните новую задачу.</p></div>
                    : !conversation ? <div className="remote-placeholder"><p>{busy ? 'Загружаем историю…' : 'Нажмите на чат, чтобы загрузить историю'}</p></div>
                    : <>
                      <div className="remote-chat-head"><b>{conversation.thread.title}</b><span role="status">{conversation.thread.managed ? STATUS[conversation.thread.status] : 'История из VS Code / Codex'}</span></div>
                      <div className="remote-transcript" ref={transcript} role="log" aria-label="Сообщения чата" aria-live="off" onScroll={() => {
                        const el = transcript.current; if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
                      }}>
                        {conversation.hasOlder && <p className="muted small center">Показана последняя часть истории. Полная история остаётся на ноутбуке.</p>}
                        {conversation.messages.map(m => <article className={`remote-message ${m.role}`} key={m.id}>
                          <b>{m.role === 'user' ? 'Вы' : m.role === 'assistant' ? 'Codex' : 'Действие'}</b>
                          {m.role === 'tool' ? <details><summary>Показать действие</summary><pre>{m.text}</pre></details> : <pre>{m.text || '…'}</pre>}
                        </article>)}
                        {!conversation.messages.length && <p className="muted">Чат готов. Напишите первую задачу.</p>}
                      </div>
                      {conversation.error && <p className="remote-error" role="alert">{conversation.error}</p>}
                      {conversation.approvals.map(a => <Approval key={a.id} approval={a} disabled={busy || !online} onRespond={command => run(command)} />)}
                      {!conversation.thread.managed ? <div className="remote-takeover stack">
                        <p className="small muted">Для отправки сообщений продолжите чат здесь. Если он открыт в другом клиенте, завершите там задачу или создайте отдельную копию с историей.</p>
                        <div className="remote-row"><button className="btn dark" disabled={busy || !online} onClick={() => takeOver(false)}>Продолжить здесь</button><button className="btn" disabled={busy || !online} onClick={() => takeOver(true)}>Создать копию</button></div>
                      </div> : <form className="remote-composer" onSubmit={send}>
                        <label htmlFor="remote-draft" className="small">Сообщение Codex</label>
                        <textarea id="remote-draft" rows={3} value={draft} onChange={e => changeDraft(e.target.value)} maxLength={16000} placeholder="Что нужно сделать в проекте?" />
                        <div className="remote-row">
                          <span className="small muted grow">{busy ? 'Передаём запрос…' : 'Доступ ограничен папками, выбранными на ноутбуке'}</span>
                          {['working', 'waiting'].includes(conversation.thread.status) ? <button className="btn remote-stop" type="button" disabled={busy || !online} onClick={() => { run({ op: 'interrupt', threadId: selected }).catch(() => {}); }}>Остановить</button>
                            : <button className="btn dark" disabled={busy || !online || !draft.trim()}>Отправить</button>}
                        </div>
                      </form>}
                    </>}
                </div>
              </div>
            </>}
          </>
        )}
    </section>
  );
}

function Approval({ approval: a, disabled, onRespond }: { approval: RemoteApproval; disabled: boolean; onRespond: (c: RemoteCommand) => Promise<unknown> }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return <section className="remote-approval" aria-label={a.title}>
    <h2>{a.title}</h2>
    {a.detail && <pre>{a.detail}</pre>}
    {a.kind === 'input' ? <form className="stack" onSubmit={e => { e.preventDefault(); onRespond({ op: 'respond', requestId: a.id, answers }).catch(() => {}); }}>
      {(a.questions || []).map(q => <label className="stack" key={q.id}>{q.question}
        {q.options.length > 0 && <div className="remote-options">{q.options.map(o => <button type="button" className={`btn ${answers[q.id] === o ? 'dark' : ''}`} disabled={disabled} key={o} onClick={() => setAnswers(v => ({ ...v, [q.id]: o }))}>{o}</button>)}</div>}
        <input value={answers[q.id] || ''} onChange={e => setAnswers(v => ({ ...v, [q.id]: e.target.value }))} required disabled={disabled} placeholder="Ваш ответ" />
      </label>)}
      <button className="btn dark" disabled={disabled}>Ответить</button>
    </form> : <div className="remote-row"><button className="btn dark" disabled={disabled} onClick={() => { onRespond({ op: 'respond', requestId: a.id, decision: 'accept' }).catch(() => {}); }}>Разрешить один раз</button><button className="btn" disabled={disabled} onClick={() => { onRespond({ op: 'respond', requestId: a.id, decision: 'decline' }).catch(() => {}); }}>Отклонить</button></div>}
  </section>;
}
