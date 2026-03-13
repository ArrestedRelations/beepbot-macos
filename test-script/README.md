# Test Scripts — BeepBot v2

> Standard procedure for testing BeepBot — an autonomous desktop AI agent built with Tauri 2, React 19, and a Node.js sidecar running a Claude agent.

---

## 1. Architecture

```
┌─────────────────────────────────┐
│     Tauri 2 (Rust shell)        │
│  ┌──────────┐  ┌─────────────┐  │
│  │ WebView  │  │  Plugins    │  │
│  │ React 19 │  │ shell/fs/   │  │
│  │ (:1420)  │  │ opener/notif│  │
│  └────┬─────┘  └──────┬──────┘  │
└───────┼────────────────┼────────┘
        │ WebSocket      │ spawn/kill
┌───────┴────────────────┴────────┐
│   Node.js Sidecar (:3004)       │
│  ┌───────────┐  ┌────────────┐  │
│  │  Claude   │  │  Tools     │  │
│  │  Agent    │  │ Bash/Read/ │  │
│  │  SDK      │  │ Write/Edit │  │
│  └───────────┘  │ Glob/Grep  │  │
│  ┌──────────────┤ WebFetch   │  │
│  │ SQLite       │ TodoWrite  │  │
│  │ ~/.beepbot-  │ Notebook   │  │
│  │ v2/beepbot.db└────────────┘  │
│  └──────────────────────────────│
└─────────────────────────────────┘

┌─────────────────────────────────┐
│   Dashboard (:7432)             │
│   Vite + React 19 + Tailwind 4 │
│   http://beepbotai:7432         │
│   Connects to sidecar REST + WS│
└─────────────────────────────────┘
```

### Services

| Service | Port | URL | Stack |
|---------|------|-----|-------|
| Tauri app (chat) | 1420 | `http://localhost:1420` | React 19 + Tailwind 4 + Vite 7 |
| Sidecar (backend) | 3004 | `http://127.0.0.1:3004` | Fastify 5 + Claude Agent SDK + SQLite |
| Dashboard (browser) | 7432 | `http://beepbotai:7432` | React 19 + Tailwind 4 + Vite 7 |

---

## 2. Starting & Stopping

```bash
# Full stack (Tauri + sidecar)
cd /Users/emma/Documents/apps/beepbot
pnpm tauri dev

# Dashboard (separate terminal)
cd dashboard && pnpm dev

# Sidecar only
cd sidecar && npx tsx watch src/index.ts

# Stop everything
pnpm kill-tauri
```

---

## 3. CPI Script (Continuous Process Improvement)

The CPI script runs a full health check across all services.

```bash
# One-shot health check
node test-script/test-cpi.mjs

# Continuous monitoring (every 30s)
node test-script/test-cpi.mjs --watch
```

### What it checks

| Check | Endpoint | What it validates |
|-------|----------|-------------------|
| Sidecar health | `GET /api/health` | Server reachable, `ok: true` |
| Auth status | `GET /api/auth/status` | Authenticated via OAuth or API key |
| System health | `GET /api/system/health` | DB size, WS clients, uptime |
| Dashboard stats | `GET /api/dashboard/stats` | Conversations, messages, usage |
| Activity feed | `GET /api/dashboard/activity` | Event log populated |
| Scheduler | `GET /api/scheduler/tasks` | Cron tasks list |
| Conversations | `GET /api/conversations` | Conversation list |
| WebSocket | `ws://127.0.0.1:3004/ws` | Handshake succeeds |
| Dashboard | `http://beepbotai:7432` | Vite dev server responds HTTP 200 |
| Frontend | `http://localhost:1420` | Vite dev server responds |
| CORS | `Access-Control-Allow-Origin` | Header present on sidecar |

---

## 4. PDSA Methodology

Every test follows **Plan-Do-Study-Act** cycles.

| Phase | What Happens |
|-------|-------------|
| **Plan** | Define hypothesis: "If we change X, then Y should happen." |
| **Do** | Make the smallest change. One variable per cycle. |
| **Study** | Run the test. Compare actual vs expected. Classify failures. |
| **Act** | If verified, adopt. If not, return to Plan. |

---

## 5. API Reference

### REST Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Sidecar status |
| `/api/auth/status` | GET | Auth status and method |
| `/api/auth/api-key` | POST | Set API key |
| `/api/auth/refresh` | POST | Re-check auth |
| `/api/auth/logout` | POST | Clear credentials |
| `/api/agent/mode` | GET/POST | Agent mode (autonomous/ask/stop) |
| `/api/agent/permission-mode` | GET/POST | Permission mode |
| `/api/agent/sandbox` | GET/POST | Sandbox toggle |
| `/api/agent/state` | GET | Full agent state |
| `/api/conversations` | GET | List conversations |
| `/api/conversations/:id/messages` | GET | Messages for conversation |
| `/api/dashboard/stats` | GET | Usage stats, counts |
| `/api/dashboard/activity` | GET | Activity event feed |
| `/api/dashboard/compactions` | GET | Compaction log |
| `/api/system/health` | GET | System health (DB, WS, uptime) |
| `/api/scheduler/tasks` | GET/POST | Scheduled cron tasks |
| `/api/scheduler/tasks/:id` | GET/PATCH/DELETE | Individual task CRUD |
| `/api/tasks` | GET | Background tasks |
| `/api/tasks/stats` | GET | Background task stats |
| `/api/memory` | GET/POST | Memory files |
| `/api/conversations/stats` | GET | Conversation statistics |

### WebSocket (`ws://127.0.0.1:3004/ws`)

**Client to Server:**

| Type | Payload | Purpose |
|------|---------|---------|
| `chat` | `{ content: string }` | Send user message |
| `stop` | `{}` | Cancel running agent |
| `steer` | `{ content: string }` | Inject steering message |
| `ask_user_response` | `{ response: string }` | Answer agent question |
| `login` | `{}` | Start OAuth login flow |
| `bg_spawn` | `{ prompt, description }` | Launch background task |
| `bg_kill` | `{ id }` | Kill background task |

**Server to Client:**

| Type | Data | Purpose |
|------|------|---------|
| `status` | `'thinking' / 'idle' / ...` | Agent status change |
| `text` | `string` | Text response chunk |
| `thinking` | `string` | Extended thinking content |
| `tool_call` | `{ name, input }` | Tool invocation |
| `tool_result` | `{ name, result }` | Tool result |
| `done` | `string` | Turn complete |
| `error` | `string` | Error occurred |
| `agent_mode` | `{ mode }` | Mode changed |
| `permission_mode` | `{ mode }` | Permission mode changed |
| `sub_agent` | `{ event, id, ... }` | Sub-agent lifecycle |
| `log` | `{ level, message }` | Console log broadcast |
| `ask_user` | `{ question }` | Agent needs input |

---

## 6. Directory Structure

```
test-script/
├── README.md              <- This file
├── test-cpi.mjs           <- CPI health check (one-shot or --watch)
├── test-chat.mjs          <- Chat session & multi-turn test
├── test-tokens.mjs        <- Token system verification
└── test-ws-events.mjs     <- WebSocket event broadcast test
```

---

## 8. Token System Verification

Verifies that the token tracking pipeline works correctly end-to-end.

```bash
node test-script/test-tokens.mjs
```

### What it checks

| Check | What it validates |
|-------|------------------|
| tokens_in > 0 | Input tokens recorded from SDK |
| tokens_out > 0 | Output tokens recorded from SDK |
| cache_read_tokens tracked | Cache read field present in DB |
| cache_write_tokens tracked | Cache write field present in DB |
| model recorded | Model name stored with usage entry |
| slot is "chat" | Usage categorized correctly |
| done.tokensIn matches DB | WebSocket event matches stored value |
| done.tokensOut matches DB | WebSocket event matches stored value |
| Turn 2 cache behavior | Cache tokens increase on second turn |
| Aggregated stats | `/api/dashboard/stats` reflects usage |

---

## 9. Chat Session & Multi-turn Test

Diagnoses two specific bugs:
1. **Session not saved** — verifies conversations + messages are persisted in SQLite after a chat turn
2. **Second message ignored** — verifies the agent responds to a second message in the same session

```bash
node test-script/test-chat.mjs
```

### What it checks

| Check | What it validates |
|-------|------------------|
| Sidecar reachable | Pre-flight: server up |
| Authenticated | Pre-flight: Claude auth configured |
| WebSocket connected | WS handshake succeeds |
| New conversation created | `POST /api/conversations` returns an id |
| Agent responded (turn 1) | `done` event received, response is non-empty |
| Conversation persisted | Conversation appears in `GET /api/conversations` |
| Title auto-generated | Title changed from "New Conversation" after first reply |
| User message saved | `GET /api/conversations/:id/messages` has ≥1 user row |
| Assistant reply saved | `GET /api/conversations/:id/messages` has ≥1 assistant row |
| Agent responded (turn 2) | Second `done` event received (key multi-turn check) |
| Both user messages saved | 2 user rows in DB after two turns |
| Both assistant replies saved | 2 assistant rows in DB after two turns |
| Agent is idle | `chatRunning: false` in `/api/agent/state` after completion |

---

## 7. Custom Hostname Setup

The dashboard runs at `http://beepbotai:7432`. This requires an `/etc/hosts` entry:

```bash
echo '127.0.0.1 beepbotai' | sudo tee -a /etc/hosts
```

Verify: `ping beepbotai` should resolve to `127.0.0.1`.
