#!/usr/bin/env node
/**
 * BeepBot Continuous Process Improvement (CPI) Script
 *
 * Runs a full health check cycle across all BeepBot services:
 *   1. Sidecar (Fastify on :3004)
 *   2. Dashboard (Vite on :7432)
 *   3. Tauri frontend (Vite on :1420)
 *   4. WebSocket connectivity
 *   5. Dashboard API endpoints
 *   6. Auth status
 *
 * Usage:
 *   node test-script/test-cpi.mjs           # one-shot
 *   node test-script/test-cpi.mjs --watch   # re-run every 30s
 */

const SIDECAR = 'http://127.0.0.1:3004';
const DASHBOARD = 'http://beepbotai:7432';
const DASHBOARD_FALLBACK = 'http://localhost:7432';
const FRONTEND = 'http://localhost:1420';
const WS_URL = 'ws://127.0.0.1:3004/ws';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
let warnings = 0;

function log(icon, msg, detail) {
  console.log(`  ${icon} ${msg}${detail ? ` ${DIM}${detail}${RESET}` : ''}`);
}

async function check(name, fn) {
  try {
    const result = await fn();
    passed++;
    log(PASS, name, result || '');
    return true;
  } catch (e) {
    failed++;
    log(FAIL, name, e.message);
    return false;
  }
}

async function warn(name, fn) {
  try {
    const result = await fn();
    passed++;
    log(PASS, name, result || '');
    return true;
  } catch (e) {
    warnings++;
    log(WARN, name, e.message);
    return false;
  }
}

async function fetchJson(url, timeout = 5000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

async function fetchStatus(url, timeout = 5000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.status;
  } finally {
    clearTimeout(id);
  }
}

async function testWs(url, timeout = 5000) {
  // Use native WebSocket (available in Node 22+)
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, timeout);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function runCycle() {
  passed = 0;
  failed = 0;
  warnings = 0;

  const now = new Date().toLocaleTimeString();
  console.log(`\n${BOLD}BeepBot CPI Health Check${RESET} ${DIM}${now}${RESET}`);
  console.log(`${'─'.repeat(50)}`);

  // ── 1. Sidecar ──
  console.log(`\n${BOLD}Sidecar${RESET} ${DIM}(:3004)${RESET}`);

  let health;
  const sidecarOk = await check('Sidecar reachable', async () => {
    health = await fetchJson(`${SIDECAR}/api/health`);
    if (!health.ok) throw new Error('health.ok is false');
    return `v${health.version} | mode: ${health.agentMode}`;
  });

  if (sidecarOk) {
    await check('Auth configured', async () => {
      const auth = await fetchJson(`${SIDECAR}/api/auth/status`);
      if (!auth.authenticated) throw new Error(`not authenticated (method: ${auth.method})`);
      return `method: ${auth.method}`;
    });

    await check('System health endpoint', async () => {
      const sys = await fetchJson(`${SIDECAR}/api/system/health`);
      return `uptime: ${Math.round(sys.uptime / 1000)}s | db: ${sys.dbSizeMB}MB | ws: ${sys.wsClients} clients`;
    });

    await check('Dashboard stats endpoint', async () => {
      const stats = await fetchJson(`${SIDECAR}/api/dashboard/stats`);
      return `${stats.conversations} convos | ${stats.messages} msgs | today: ${stats.usageToday.api_calls} calls`;
    });

    await check('Activity feed endpoint', async () => {
      const activity = await fetchJson(`${SIDECAR}/api/dashboard/activity`);
      return `${activity.length} events`;
    });

    await check('Scheduler endpoint', async () => {
      const tasks = await fetchJson(`${SIDECAR}/api/scheduler/tasks`);
      return `${tasks.length} scheduled tasks`;
    });

    await check('Conversations endpoint', async () => {
      const convos = await fetchJson(`${SIDECAR}/api/conversations`);
      return `${convos.length} conversations`;
    });
  }

  // ── 2. WebSocket ──
  console.log(`\n${BOLD}WebSocket${RESET} ${DIM}(:3004/ws)${RESET}`);

  await check('WebSocket connects', async () => {
    await testWs(WS_URL);
    return 'handshake ok';
  });

  // ── 3. Dashboard ──
  console.log(`\n${BOLD}Dashboard${RESET} ${DIM}(:7432)${RESET}`);

  await check('Dashboard reachable (beepbotai:7432)', async () => {
    const status = await fetchStatus(DASHBOARD);
    if (status !== 200) throw new Error(`HTTP ${status}`);
    return 'HTTP 200';
  }).catch(async () => {
    // Try fallback
    await warn('Dashboard fallback (localhost:7432)', async () => {
      const status = await fetchStatus(DASHBOARD_FALLBACK);
      if (status !== 200) throw new Error(`HTTP ${status} — run: cd dashboard && pnpm dev`);
      return 'HTTP 200 (beepbotai hostname not resolving, using localhost)';
    });
  });

  // ── 4. Tauri Frontend ──
  console.log(`\n${BOLD}Frontend${RESET} ${DIM}(:1420)${RESET}`);

  await warn('Vite dev server reachable', async () => {
    const status = await fetchStatus(FRONTEND);
    if (status !== 200) throw new Error('not running — expected if using tauri dev');
    return 'HTTP 200';
  });

  // ── 5. CORS ──
  console.log(`\n${BOLD}CORS${RESET}`);

  if (sidecarOk) {
    await check('CORS headers present', async () => {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(`${SIDECAR}/api/health`, {
          signal: ctrl.signal,
          headers: { 'Origin': DASHBOARD },
        });
        const cors = res.headers.get('access-control-allow-origin');
        if (!cors) throw new Error('no Access-Control-Allow-Origin header');
        return `Allow-Origin: ${cors}`;
      } finally {
        clearTimeout(id);
      }
    });
  }

  // ── Summary ──
  console.log(`\n${'─'.repeat(50)}`);
  const total = passed + failed;
  const summary = failed === 0
    ? `${PASS} ${BOLD}All ${passed} checks passed${RESET}`
    : `${FAIL} ${BOLD}${failed}/${total} checks failed${RESET}`;
  console.log(`  ${summary}${warnings ? ` ${WARN} ${warnings} warnings` : ''}`);
  console.log();

  return failed === 0;
}

// ── Main ──
async function main() {
  const watch = process.argv.includes('--watch');
  const interval = 30000;

  const ok = await runCycle();

  if (watch) {
    console.log(`${DIM}Re-checking every ${interval / 1000}s... (Ctrl+C to stop)${RESET}\n`);
    setInterval(runCycle, interval);
  } else {
    process.exit(ok ? 0 : 1);
  }
}

main();
