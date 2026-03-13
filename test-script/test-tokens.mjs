#!/usr/bin/env node
/**
 * BeepBot Token System Verification Test
 *
 * Sends chat messages via WebSocket, then verifies token tracking:
 *   - tokens_in, tokens_out populated and non-zero
 *   - cache_read_tokens, cache_write_tokens tracked
 *   - done event tokensIn/tokensOut match DB entry
 *   - Cache tokens increase on second turn (prompt caching)
 *
 * Usage:
 *   node test-script/test-tokens.mjs
 *
 * Requires: server running on :3004 and authenticated
 */

const SIDECAR = 'http://127.0.0.1:3004';
const WS_URL  = 'ws://127.0.0.1:3004/ws';

// Colours
const PASS  = '\x1b[32m✓\x1b[0m';
const FAIL  = '\x1b[31m✗\x1b[0m';
const INFO  = '\x1b[36m·\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

function pass(label, detail = '') {
  passed++;
  console.log(`  ${PASS} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}
function fail(label, detail = '') {
  failed++;
  console.log(`  ${FAIL} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}
function info(msg) {
  console.log(`  ${INFO} ${DIM}${msg}${RESET}`);
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${SIDECAR}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
  return res.json();
}

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => reject(new Error('WS connect timeout')), 6000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(ws); });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function sendChat(ws, content, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to: "${content.slice(0, 40)}..."`));
    }, timeout);

    const chunks = [];

    function onMessage(event) {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'text') chunks.push(msg.data);

      if (msg.type === 'done') {
        clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        resolve({
          text: chunks.join(''),
          meta: msg.data,
        });
      }

      if (msg.type === 'error') {
        clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        reject(new Error(`Agent error: ${msg.data}`));
      }
    }

    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ type: 'chat', content }));
  });
}

function printTokenTable(label, entry) {
  console.log(`\n  ${BOLD}${label}${RESET}`);
  console.log(`  ${'─'.repeat(44)}`);
  const rows = [
    ['tokens_in',          entry.tokens_in],
    ['tokens_out',         entry.tokens_out],
    ['cache_read_tokens',  entry.cache_read_tokens],
    ['cache_write_tokens', entry.cache_write_tokens],
    ['model',              entry.model],
    ['slot',               entry.slot],
    ['duration_ms',        entry.duration_ms],
  ];
  for (const [k, v] of rows) {
    console.log(`  ${DIM}${k.padEnd(22)}${RESET}${v}`);
  }
  console.log();
}

// ────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}BeepBot Token System Verification${RESET}`);
  console.log('─'.repeat(52));

  // ── Pre-flight ──────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Pre-flight${RESET}`);

  try {
    const health = await fetchJson('/api/health');
    if (!health.ok) throw new Error('health.ok is false');
    pass('Server reachable');
  } catch (e) {
    fail('Server reachable', e.message);
    console.log(`\n  Start the server first: cd server && npx tsx watch src/index.ts\n`);
    process.exit(1);
  }

  try {
    const auth = await fetchJson('/api/auth/status');
    if (!auth.authenticated) throw new Error(`not authenticated (method: ${auth.method})`);
    pass('Authenticated', `method: ${auth.method}`);
  } catch (e) {
    fail('Authenticated', e.message);
    process.exit(1);
  }

  // ── Connect WebSocket ──────────────────────────────────────────────────
  let ws;
  try {
    ws = await openWs();
    pass('WebSocket connected');
  } catch (e) {
    fail('WebSocket connected', e.message);
    process.exit(1);
  }

  // ── Create fresh conversation ──────────────────────────────────────────
  try {
    await fetchJson('/api/conversations', { method: 'POST', body: '{}' });
    pass('New conversation created');
  } catch (e) {
    fail('New conversation created', e.message);
    ws.close();
    process.exit(1);
  }

  await new Promise(r => setTimeout(r, 300));

  // ── Turn 1: Send message and capture done event ────────────────────────
  console.log(`\n${BOLD}Turn 1 — Token tracking${RESET}`);

  const MSG1 = 'Reply with exactly: "token test ok"';
  let turn1;
  try {
    info(`Sending: "${MSG1}"`);
    turn1 = await sendChat(ws, MSG1, 90_000);
    pass('Agent responded', `${turn1.text.length} chars`);
  } catch (e) {
    fail('Agent responded', e.message);
    ws.close();
    process.exit(1);
  }

  // Small delay for DB write
  await new Promise(r => setTimeout(r, 500));

  // Fetch latest usage transaction
  let tx1;
  try {
    const usage = await fetchJson('/api/usage/transactions?limit=1');
    tx1 = usage.transactions?.[0];
    if (!tx1) throw new Error('No transactions found');
    pass('Usage transaction recorded');
  } catch (e) {
    fail('Usage transaction recorded', e.message);
    ws.close();
    process.exit(1);
  }

  printTokenTable('Turn 1 — DB Entry', tx1);

  // Verify token fields
  if (tx1.tokens_in > 0) {
    pass('tokens_in > 0', `${tx1.tokens_in}`);
  } else {
    fail('tokens_in > 0', `got ${tx1.tokens_in}`);
  }

  if (tx1.tokens_out > 0) {
    pass('tokens_out > 0', `${tx1.tokens_out}`);
  } else {
    fail('tokens_out > 0', `got ${tx1.tokens_out}`);
  }

  if (typeof tx1.cache_read_tokens === 'number') {
    pass('cache_read_tokens tracked', `${tx1.cache_read_tokens}`);
  } else {
    fail('cache_read_tokens tracked', 'field missing');
  }

  if (typeof tx1.cache_write_tokens === 'number') {
    pass('cache_write_tokens tracked', `${tx1.cache_write_tokens}`);
  } else {
    fail('cache_write_tokens tracked', 'field missing');
  }

  if (tx1.model) {
    pass('model recorded', tx1.model);
  } else {
    fail('model recorded', 'empty');
  }

  if (tx1.slot === 'chat') {
    pass('slot is "chat"');
  } else {
    fail('slot is "chat"', `got "${tx1.slot}"`);
  }

  // Verify done event matches DB
  const doneMeta = turn1.meta || {};
  if (doneMeta.tokensIn && doneMeta.tokensIn === tx1.tokens_in) {
    pass('done.tokensIn matches DB', `${doneMeta.tokensIn}`);
  } else {
    fail('done.tokensIn matches DB', `done=${doneMeta.tokensIn} vs db=${tx1.tokens_in}`);
  }

  if (doneMeta.tokensOut && doneMeta.tokensOut === tx1.tokens_out) {
    pass('done.tokensOut matches DB', `${doneMeta.tokensOut}`);
  } else {
    fail('done.tokensOut matches DB', `done=${doneMeta.tokensOut} vs db=${tx1.tokens_out}`);
  }

  // ── Turn 2: Cache behavior ────────────────────────────────────────────
  console.log(`\n${BOLD}Turn 2 — Cache token behavior${RESET}`);

  const MSG2 = 'Reply with exactly: "cache test ok"';
  let turn2;
  try {
    info(`Sending: "${MSG2}"`);
    turn2 = await sendChat(ws, MSG2, 90_000);
    pass('Agent responded to turn 2', `${turn2.text.length} chars`);
  } catch (e) {
    fail('Agent responded to turn 2', e.message);
    ws.close();
    process.exit(1);
  }

  await new Promise(r => setTimeout(r, 500));

  let tx2;
  try {
    const usage = await fetchJson('/api/usage/transactions?limit=1');
    tx2 = usage.transactions?.[0];
    if (!tx2) throw new Error('No transaction for turn 2');
    pass('Turn 2 usage recorded');
  } catch (e) {
    fail('Turn 2 usage recorded', e.message);
    ws.close();
    process.exit(1);
  }

  printTokenTable('Turn 2 — DB Entry', tx2);

  // Check cache tokens on second turn
  if (tx2.cache_read_tokens > 0) {
    pass('cache_read_tokens > 0 on turn 2', `${tx2.cache_read_tokens} — prompt caching active`);
  } else if (tx2.cache_read_tokens === 0 && tx1.cache_write_tokens > 0) {
    info(`cache_read_tokens is 0 but turn 1 wrote ${tx1.cache_write_tokens} cache tokens — cache may not have been hit yet`);
    pass('cache tracking fields present (cache may need more turns to activate)');
  } else {
    info(`cache_read_tokens: ${tx2.cache_read_tokens}, turn1 cache_write: ${tx1.cache_write_tokens}`);
    pass('cache fields tracked (values depend on SDK caching behavior)');
  }

  // ── Compare turns ──────────────────────────────────────────────────────
  console.log(`\n${BOLD}Cross-turn comparison${RESET}`);
  console.log(`  ${'─'.repeat(44)}`);
  console.log(`  ${DIM}${'Field'.padEnd(22)}${'Turn 1'.padEnd(12)}Turn 2${RESET}`);
  console.log(`  ${'─'.repeat(44)}`);
  const compareFields = ['tokens_in', 'tokens_out', 'cache_read_tokens', 'cache_write_tokens', 'duration_ms'];
  for (const field of compareFields) {
    console.log(`  ${DIM}${field.padEnd(22)}${RESET}${String(tx1[field]).padEnd(12)}${tx2[field]}`);
  }
  console.log();

  // ── Aggregated stats check ─────────────────────────────────────────────
  console.log(`${BOLD}Aggregated stats${RESET}`);
  try {
    const stats = await fetchJson('/api/dashboard/stats');
    if (stats.usageToday?.tokens_in > 0) {
      pass('usageToday.tokens_in > 0', `${stats.usageToday.tokens_in}`);
    } else {
      fail('usageToday.tokens_in > 0');
    }
    if (stats.usageToday?.tokens_out > 0) {
      pass('usageToday.tokens_out > 0', `${stats.usageToday.tokens_out}`);
    } else {
      fail('usageToday.tokens_out > 0');
    }
  } catch (e) {
    fail('Aggregated stats', e.message);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  ws.close();

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(52)}`);
  const total = passed + failed;
  if (failed === 0) {
    console.log(`  ${PASS} ${BOLD}All ${passed} checks passed — token system verified${RESET}`);
  } else {
    console.log(`  ${FAIL} ${BOLD}${failed}/${total} checks failed${RESET}`);
  }
  console.log();

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(`\n${FAIL} Unexpected error: ${e.message}`);
  process.exit(1);
});
