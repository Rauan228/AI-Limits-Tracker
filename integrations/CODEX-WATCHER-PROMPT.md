# Prompt for Codex — build the Codex session watcher

Paste everything below the line into Codex (CLI or extension) on the laptop.
It is self-contained: Codex needs no other context.

---

Build me a small Node.js background "watcher" for Windows that reports the status of my
local **Codex CLI** sessions to my self-hosted "AI Limits Tracker" server, so I can watch
them from my phone. Work only on this machine; do not touch any repo.

## What the server expects

Send HTTP POST to `${URL}/api/agents/report` with header `Authorization: Bearer ${TOKEN}`
and a JSON body:

```json
{
  "id": "codex:<sessionId>",
  "source": "codex",
  "project": "<folder name>",
  "cwd": "<full cwd>",
  "status": "working | waiting | done | idle",
  "lastMessage": "<last assistant message text, optional>",
  "silent": true
}
```

- `silent: true` tells the server NOT to send a phone push for this report (use it for
  catch-up reports on startup). Omit it (or false) when you want a push.
- The server pushes a notification when a session transitions to `done` or `waiting`
  (and `silent` is not set).

## Config (already on this machine)

Read `{ "url": "...", "token": "..." }` from the FIRST of these that exists:
1. `process.env.ALT_URL` / `process.env.ALT_TOKEN`
2. a `config.json` next to the watcher script
3. `%USERPROFILE%\.ai-limits\config.json`

(The file already exists at `C:\Users\Public\ai-limits\config.json` and at
`%USERPROFILE%\.ai-limits\config.json`.)

## Where Codex writes sessions

`%USERPROFILE%\.codex\sessions\YYYY\MM\DD\rollout-*.jsonl` — one JSON object per line:

- First line: `{"type":"session_meta","payload":{"id":"<uuid>","cwd":"<path>", ...}}`
- Message lines: `{"type":"response_item","payload":{"type":"message","role":"user|assistant","content":[{"type":"output_text"|"text"|"input_text","text":"..."}]}}`

The **last assistant message** = the last `response_item` whose `payload.role === "assistant"`;
join the `text` fields of its `content` array, trimmed.

## Status logic

Scan every rollout file **modified in the last 15 minutes**. For each session:
- `working` if the file was modified within the last ~25 seconds (Codex is actively streaming),
- otherwise `done` (the turn finished / it is waiting for me).

## Avoid push spam on startup

Keep an in-memory `Map<sessionId, lastStatus>`:
- If a session is first seen already idle (`done`), report it once with `silent: true`
  (just to populate the panel — no push).
- If you previously reported it as `working` and it is now idle, report `done` WITHOUT
  `silent` (so I get a push). Only report when status or last message actually changed,
  plus a light heartbeat every ~60s.

## Runtime

- A loop every ~8 seconds. Single instance only (use a lockfile with a heartbeat timestamp
  under the temp dir; if another instance updated it within the last 20s, exit).
- It must be bulletproof: wrap all fs/network in try/catch, 5s fetch timeout, never throw,
  never block, never print noise.

## Install & auto-start (do these)

1. Save the script as `C:\Users\Public\ai-limits\codex-watch.mjs`.
2. Create a launcher `C:\Users\Public\ai-limits\codex-watch.cmd` that runs it detached:
   `start "" /b "C:\Program Files\nodejs\node.exe" "C:\Users\Public\ai-limits\codex-watch.mjs"`
3. Register it to auto-start at logon:
   `schtasks /Create /SC ONLOGON /TN "AILimitsCodexWatch" /TR "C:\Users\Public\ai-limits\codex-watch.cmd" /F`
4. Start it now in the background so it runs immediately (without blocking this session).
5. Verify: run `codex` in a terminal, send it a tiny task; then confirm a GET to
   `${URL}/api/agents` (with the bearer token) lists a `codex:` entry with the right project
   and status. Tell me the result.

Note: this only works for the **Codex CLI** (`codex` in a terminal), because the ChatGPT
VS Code extension does not write these session files. If I'm not logged in, remind me to run
`codex login` first.
