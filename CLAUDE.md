# BeepBot

BeepBot is an autonomous AI agent with a web dashboard, modeled after OpenClaw's architecture.

## Rules

- Only Claude SDK — no other LLM providers are accepted
- Direct chat only — no communication channels (WhatsApp, Telegram, Discord, etc.)
- Server runs as a standalone Node.js process (Fastify 5) on port 3004
- Dashboard is React 19 + Tailwind CSS 4 + Vite 7, served by the server

## Architecture

- Server: `server/src/` — Fastify 5 + Claude Agent SDK + SQLite + static file serving
- Dashboard: `dashboard/src/` — React 19 + Tailwind CSS 4 + Zustand 5
- Data: `~/.beepbot-v2/beepbot.db` (SQLite) — overridable via `BEEPBOT_DATA_DIR` env
- Auth: Encrypted vault at `<data-dir>/vault.enc` (AES-256-GCM)
- Communication: WebSocket on /ws + REST API on /api/*
- IPC: Unix socket (`<data-dir>/agent-runtime.sock`) or Windows named pipe
- Deployment: Docker or standalone Node.js
- Cross-platform: macOS, Linux, Windows — data dir, IPC, shell spawns are all platform-aware

## Development

- Install: `cd server && pnpm install && cd ../dashboard && pnpm install`
- Full dev: `npm run dev` (starts server + dashboard dev server)
- Server only: `cd server && npx tsx watch src/index.ts`
- Dashboard only: `cd dashboard && pnpm dev` (Vite on :7432, proxies to :3004)
- Type check: `npm run typecheck`
- Build: `npm run build`
- Start (production): `npm start` or `node beepbot.mjs`
- Docker: `docker compose up`

## Dashboard

- Chat + voice: `dashboard/src/views/chat-page.tsx` — main chat interface with voice overlay
- Views: `dashboard/src/views/dashboard/` — each page is a separate component
- Shell: `dashboard/src/views/dashboard-shell.tsx` — navigation and layout
- Store: `dashboard/src/stores/app-store.ts` — Zustand state management
- Hooks: `dashboard/src/hooks/` — use-agent (WS), use-speech (STT), use-tts (TTS)
- CSS vars: `var(--bb-bg)`, `var(--bb-bg-accent)`, `var(--bb-border)`, `var(--bb-text-strong)`, `var(--bb-text-muted)`, `var(--bb-accent)`, `var(--bb-accent-subtle)`
- Use inline styles with CSS variables, Tailwind for layout

## P2P Network

- Identity: `server/src/identity.ts` — Ed25519 keypair, bot ID, signing
- Network: `server/src/network/` — P2P transport, discovery, hash chain, reputation, tasks
- P2P port: 3005 (configurable via BEEPBOT_P2P_PORT)
- API: `/api/identity`, `/api/network/*` endpoints
- Protocol: Length-prefixed JSON over TCP, all messages signed

## Sub-Agent Execution

When building features, the agent uses sub-agents:
- "coder" agent — for writing/modifying code, building features
- "executor" agent — for shell commands, web searches, quick tasks
- Sub-agents have full tool access (Bash, Read, Write, Edit, etc.)
- All sub-agents run with bypassPermissions mode
- Timeout: 15 minutes per chat turn (resets on activity)
