/** Only this small command vocabulary crosses the relay; never arbitrary RPC or shell. */
export type RemoteCommand =
  | { op: 'list' }
  | { op: 'read' | 'resume' | 'fork' | 'interrupt'; threadId: string }
  | { op: 'create'; project: string }
  | { op: 'send'; threadId: string; text: string }
  | { op: 'respond'; requestId: string; decision?: 'accept' | 'decline' | 'cancel'; answers?: Record<string, string> };

export interface RemoteProject { name: string; path: string }
export interface RemoteMessage { id: string; role: 'user' | 'assistant' | 'tool'; text: string }
export interface RemoteQuestion { id: string; question: string; options: string[] }
export interface RemoteApproval {
  id: string;
  kind: 'command' | 'files' | 'input';
  title: string;
  detail: string;
  questions?: RemoteQuestion[];
}
export interface RemoteThread {
  id: string; title: string; cwd: string; updatedAt: number;
  status: 'idle' | 'working' | 'waiting' | 'error';
  managed: boolean;
}
export interface RemoteConversation {
  thread: RemoteThread;
  messages: RemoteMessage[];
  approvals: RemoteApproval[];
  error?: string;
  hasOlder?: boolean;
}
export interface RemoteSnapshot {
  connected: boolean;
  error?: string;
  threads: RemoteThread[];
  conversations: RemoteConversation[];
}
export interface RemoteHost {
  id: string; name: string; online: boolean; lastSeen: number;
  projects: RemoteProject[];
}
export interface RemoteReceipt {
  id: string; state: 'queued' | 'dispatched' | 'done' | 'error';
  error?: string; value?: { threadId?: string };
}
export interface RemoteHostState extends RemoteHost {
  snapshot: RemoteSnapshot | null;
  receipts: RemoteReceipt[];
}

export function validateRemoteCommand(value: unknown): RemoteCommand {
  const b = value as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('Некорректная команда');
  const field = (name: string, max = 200) => {
    const v = b[name];
    if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0')) throw new Error(`Некорректное поле ${name}`);
    return v;
  };
  switch (b.op) {
    case 'list': return { op: 'list' };
    case 'read': case 'resume': case 'fork': case 'interrupt':
      return { op: b.op, threadId: field('threadId') };
    case 'create': return { op: 'create', project: field('project', 1000) };
    case 'send': return { op: 'send', threadId: field('threadId'), text: field('text', 16000) };
    case 'respond': {
      const requestId = field('requestId');
      if (['accept', 'decline', 'cancel'].includes(String(b.decision))) return { op: 'respond', requestId, decision: b.decision as 'accept' | 'decline' | 'cancel' };
      if (b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers)) {
        const entries = Object.entries(b.answers);
        if (entries.length > 12 || entries.some(([k, v]) => k.length > 200 || typeof v !== 'string' || v.length > 4000)) throw new Error('Некорректные ответы');
        return { op: 'respond', requestId, answers: Object.fromEntries(entries) as Record<string, string> };
      }
      throw new Error('Нужно решение или ответ');
    }
    default: throw new Error('Неизвестная команда');
  }
}
