# Watch your coding agents from your phone

Report the status of **Claude Code** and **Codex** sessions (working / waiting / done)
plus the agent's last message to your AI Limits Tracker server, and see them in the
panel's **Agents** tab on your phone. Get a push when an agent finishes.

One script, [`report-agent.mjs`](report-agent.mjs), handles both tools.

## 1. Server: set an API token

On the server, add a token to `/opt/ai-limits-tracker/server/.env` and restart:

```bash
echo "API_TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")" >> /opt/ai-limits-tracker/server/.env
systemctl restart aitracker
grep API_TOKEN /opt/ai-limits-tracker/server/.env   # copy this value
```

## 2. Laptop: install the reporter

Copy `report-agent.mjs` somewhere stable, e.g. `~/.ai-limits/report-agent.mjs`
(on Windows an ASCII path like `C:/Users/Public/ai-limits/` avoids issues with
non-Latin usernames). Put a `config.json` **next to it**:

```json
{ "url": "https://aitracker.178.88.115.213.sslip.io", "token": "<API_TOKEN from step 1>" }
```

(Alternatively set `ALT_URL` and `ALT_TOKEN` as environment variables — the env
vars win over the file.)

## 3. Claude Code — add hooks

In `~/.claude/settings.json` (applies to every project), add:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/Public/ai-limits/report-agent.mjs\"" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/Public/ai-limits/report-agent.mjs\"" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/Public/ai-limits/report-agent.mjs\"" }] }],
    "SubagentStop":     [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/Public/ai-limits/report-agent.mjs\"" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/Public/ai-limits/report-agent.mjs\"" }] }]
  }
}
```

If your `settings.json` already has hooks (e.g. managed by another tool), **append**
this reporter as an extra entry to each event's array rather than replacing — Claude
Code runs every hook registered for an event. Already-open sessions load hooks at
start, so restart them (or open a new window) for the hooks to take effect.

- `UserPromptSubmit` → status **working** (you just gave it a task)
- `Notification` → status **waiting** (needs your input / a permission)
- `Stop` → status **done** (turn finished; sends the last message + a push)

On Windows use the full path, e.g. `"command": "node C:\\Users\\You\\.ai-limits\\report-agent.mjs"`.

## 4. Codex — add notify

In `~/.codex/config.toml`:

```toml
notify = ["node", "/Users/you/.ai-limits/report-agent.mjs"]
```

Codex calls it on `agent-turn-complete` → status **done** with the last message.

## 5. Done

Open the panel on your phone → **Агенты**. Each VS Code window shows up as a card:
project, tool, status (идёт работа / ждёт ввода / готово), last message and time.
Nothing here can block or slow your agents — the script fails silently if the
server is unreachable, and only your own server ever sees the data.
