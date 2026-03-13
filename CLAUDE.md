# BeepBot

BeepBot is a standalone desktop AI agent app that replicates openclaw's automated software engineering capabilities with a modern stack.

## Rules

- Only Claude SDK — no other LLM providers are accepted
- Direct chat only — no communication channels (WhatsApp, Telegram, Discord, etc.)
- Backend runs as a Node.js sidecar (Fastify 5) on port 3004
- Frontend is React 19 + Tailwind CSS 4 + Vite 7, served by Tauri 2

## Architecture

- Frontend: `beepbot/src/` — React 19 + Tailwind CSS 4 + Zustand 5
- Sidecar: `beepbot/sidecar/src/` — Fastify 5 + Claude Agent SDK + SQLite
- Shell: `beepbot/src-tauri/` — Tauri 2 (Rust)
- Data: `~/.beepbot-v2/beepbot.db` (SQLite)
- Communication: WebSocket on ws://127.0.0.1:3004/ws + REST

## Development

- Install: `cd beepbot && pnpm install`
- Frontend dev: `pnpm tauri dev`
- Sidecar only: `cd sidecar && npx tsx watch src/index.ts`
- Frontend only: `pnpm dev` (Vite on :1420)
- Type check sidecar: `cd sidecar && npx tsc --noEmit`
- Build: `pnpm tauri build`

## Dashboard

- Dashboard frontend: `dashboard/src/` — separate React app
- Views: `dashboard/src/views/dashboard/` — each page is a separate component
- Shell: `dashboard/src/views/dashboard-shell.tsx` — navigation and layout
- Store: `dashboard/src/stores/dashboard-store.ts` — Zustand state management
- CSS vars: `var(--bb-bg)`, `var(--bb-bg-accent)`, `var(--bb-border)`, `var(--bb-text-strong)`, `var(--bb-text-muted)`, `var(--bb-accent)`, `var(--bb-accent-subtle)`
- Use inline styles with CSS variables, Tailwind for layout

## P2P Network

- Identity: `sidecar/src/identity.ts` — Ed25519 keypair, bot ID, signing
- Network: `sidecar/src/network/` — P2P transport, discovery, hash chain, reputation, tasks
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
