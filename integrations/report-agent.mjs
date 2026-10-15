#!/usr/bin/env node
/**
 * AI Limits Tracker — agent reporter.
 *
 * One small script that both Claude Code (via hooks) and Codex (via notify)
 * call to report "is the agent working / waiting / done" plus its last message
 * to your AI Limits Tracker server, so you can watch it from your phone.
 *
 * It figures out the source automatically:
 *   - Claude Code passes a JSON event on STDIN (and sets $CLAUDE_* env).
 *   - Codex passes a JSON argument as argv[2].
 *
 * Configure with two env vars (see integrations/README.md):
 *   ALT_URL    = https://your-panel-host            (required)
 *   ALT_TOKEN  = the API_TOKEN from the server .env  (required)
 */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

// Config comes from env vars, or a config.json next to this script, or ~/.ai-limits/config.json
// Shape: {"url":"https://your-panel","token":"..."}
let fileCfg = {};
for (const dir of [dirname(fileURLToPath(import.meta.url)), join(homedir(), '.ai-limits')]) {
  try {
    fileCfg = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    break;
  } catch {}
}

const URL_BASE = (process.env.ALT_URL || fileCfg.url || '').replace(/\/$/, '');
const TOKEN = process.env.ALT_TOKEN || fileCfg.token || '';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function lastAssistantFromTranscript(path) {
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let e;
      try {
        e = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      const msg = e.message || e;
      const role = msg?.role || e.role || e.type;
      if (role !== 'assistant') continue;
      const content = msg?.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        const text = content
          .filter((c) => c && (c.type === 'text' || typeof c.text === 'string'))
          .map((c) => c.text)
          .join('\n')
          .trim();
        if (text) return text;
      }
    }
  } catch {}
  return undefined;
}

function build() {
  const stdin = readStdin();

  // --- Claude Code hook (JSON on stdin) ---
  if (stdin && stdin.trim().startsWith('{')) {
    let e = {};
    try {
      e = JSON.parse(stdin);
    } catch {}
    const event = e.hook_event_name || e.hookEventName || '';
    const cwd = e.cwd || process.cwd();
    const status =
      event === 'Stop' || event === 'SubagentStop'
        ? 'done'
        : event === 'Notification'
        ? 'waiting'
        : event === 'SessionEnd'
        ? 'idle'
        : 'working'; // UserPromptSubmit / PreToolUse / PostToolUse / SessionStart
    const lastMessage =
      status === 'done' && e.transcript_path ? lastAssistantFromTranscript(e.transcript_path) : e.message || undefined;
    return {
      id: `claude:${e.session_id || cwd}`,
      source: 'claude',
      project: basename(cwd),
      cwd,
      status,
      lastMessage,
    };
  }

  // --- Codex notify (JSON as argv[2]) ---
  const arg = process.argv[2];
  if (arg) {
    let e = {};
    try {
      e = JSON.parse(arg);
    } catch {}
    const cwd = e.cwd || e['cwd'] || process.env.PWD || process.cwd();
    const type = e.type || '';
    const status = type === 'agent-turn-complete' ? 'done' : type.includes('approval') || type.includes('input') ? 'waiting' : 'working';
    const lastMessage = e['last-assistant-message'] || e.last_assistant_message || e.message || undefined;
    return {
      id: `codex:${e['turn-id'] || e.session_id || cwd}`,
      source: 'codex',
      project: basename(cwd),
      cwd,
      status,
      lastMessage,
      model: e.model,
    };
  }

  return null;
}

async function main() {
  if (!URL_BASE || !TOKEN) process.exit(0); // not configured — stay silent
  const payload = build();
  if (!payload) process.exit(0);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch(`${URL_BASE}/api/agents/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch {
    // Never block or fail the agent because of reporting
  }
  process.exit(0);
}

main();
