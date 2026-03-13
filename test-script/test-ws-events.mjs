#!/usr/bin/env node
/**
 * BeepBot WebSocket Event Broadcast Test
 *
 * Verifies that the broadcast() function in index.ts correctly sends all
 * agent event types to connected WebSocket clients. This catches the bug
 * where broadcast() filtered out everything except 'hill_chat', silently
 * dropping text, tool_call, done, sub_agent, and error events.
 *
 * Usage:
 *   node test-script/test-ws-events.mjs
 *
 * Requires: sidecar running on :3004 and authenticated
 */

const SIDECAR = 'http://127.0.0.1:3004';
const WS_URL  = 'ws://127.0.0.1:3004/ws';

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

/**
 * Send a chat message and collect ALL event types received until done/error.
 * Returns a map of event type -> count of times seen.
 */
function sendChatAndCollectEvents(ws, content, timeout = 90_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout (${timeout / 1000}s) — no 'done' event received.\n` +
        `    This usually means broadcast() is filtering out agent events.\n` +
        `    Check broadcast() in sidecar/src/index.ts — it must not have an early return.`));
    }, timeout);

    const eventCounts = {};
    const textChunks = [];

    function onMessage(event) {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      eventCounts[msg.type] = (eventCounts[msg.type] || 0) + 1;
      if (msg.type === 'text') textChunks.push(msg.data);

      if (msg.type === 'done' || msg.type === 'error') {
        clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        resolve({ eventCounts, text: textChunks.join(''), meta: msg.data });
      }
    }

    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ type: 'chat', content }));
  });
}

async function main() {
  console.log(`\n${BOLD}BeepBot WebSocket Event Broadcast Test${RESET}`);
  console.log('─'.repeat(52));

  // ── Pre-flight ────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Pre-flight${RESET}`);

  try {
    const health = await fetchJson('/api/health');
    if (!health.ok) throw new Error('health.ok is false');
    pass('Sidecar reachable', `mode: ${health.agentMode}`);
  } catch (e) {
    fail('Sidecar reachable', e.message);
    console.log(`\n  Start the sidecar first: cd sidecar && npx tsx watch src/index.ts\n`);
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

  // ── WebSocket connection ──────────────────────────────────────────────────
  console.log(`\n${BOLD}WebSocket${RESET}`);
  let ws;
  try {
    ws = await openWs();
    pass('WebSocket connected');
  } catch (e) {
    fail('WebSocket connected', e.message);
    process.exit(1);
  }

  // ── Broadcast test ────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Broadcast — core event delivery${RESET}`);

  const MSG = 'Reply with exactly two words: hello world';
  info(`Sending: "${MSG}"`);
  info('Watching for: status, text, done (minimum required set)');

  let result;
  try {
    result = await sendChatAndCollectEvents(ws, MSG);
  } catch (e) {
    fail('Agent events received via WebSocket', e.message);
    ws.close();
    console.log(`\n${'─'.repeat(52)}`);
    console.log(`  ${FAIL} ${BOLD}1/1 checks failed${RESET}`);
    console.log(`\n  ${DIM}Root cause: broadcast() in sidecar/src/index.ts is filtering events.`);
    console.log(`  Fix: remove any early-return guard from broadcast() so all event`);
    console.log(`  types are forwarded to WebSocket clients.${RESET}\n`);
    process.exit(1);
  }

  const counts = result.eventCounts;
  info(`Events received: ${Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(', ')}`);

  // Check 1: 'status' events arrive (thinking → idle lifecycle)
  if ((counts['status'] || 0) >= 1) {
    pass("'status' events received", `×${counts['status']}`);
  } else {
    fail("'status' events received", "none seen — broadcast() may still be filtering");
  }

  // Check 2: 'text' chunks arrive (the actual reply content)
  if ((counts['text'] || 0) >= 1) {
    pass("'text' chunks received", `×${counts['text']} chunks, ${result.text.length} chars total`);
  } else {
    fail("'text' chunks received", "no text chunks — reply content never reached the client");
  }

  // Check 3: 'done' event arrives (turn completion signal)
  if ((counts['done'] || 0) >= 1) {
    pass("'done' event received", `tokensOut: ${result.meta?.tokensOut ?? '?'}`);
  } else {
    fail("'done' event received", "turn never completed from client's perspective");
  }

  // Check 4: Response text is non-empty
  if (result.text.trim().length > 0) {
    pass('Response text is non-empty', `"${result.text.trim().slice(0, 60)}"`);
  } else {
    fail('Response text is non-empty', 'text is blank');
  }

  // ── Tool call visibility test ─────────────────────────────────────────────
  console.log(`\n${BOLD}Broadcast — tool_call visibility${RESET}`);

  const TOOL_MSG = 'Use the Bash tool to run: echo "beepbot-ws-test"';
  info(`Sending: "${TOOL_MSG}"`);
  info('Watching for tool_call event (proves tool events reach the UI)');

  let toolResult;
  try {
    toolResult = await sendChatAndCollectEvents(ws, TOOL_MSG);
    const toolCounts = toolResult.eventCounts;
    info(`Events: ${Object.entries(toolCounts).map(([k, v]) => `${k}×${v}`).join(', ')}`);

    if ((toolCounts['tool_call'] || 0) >= 1) {
      pass("'tool_call' events received", `×${toolCounts['tool_call']}`);
    } else {
      fail("'tool_call' events received", "no tool_call events — tool usage not visible in UI");
    }

    // Note: the Claude Agent SDK does not emit tool_result events — tool execution
    // happens internally and results are not surfaced as separate events.
  } catch (e) {
    fail('Tool call test', e.message);
  }

  ws.close();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(52)}`);
  const total = passed + failed;
  if (failed === 0) {
    console.log(`  ${PASS} ${BOLD}All ${passed} checks passed — broadcast() is working correctly${RESET}`);
    console.log(`\n  ${DIM}All agent event types (status, text, done, tool_call)`);
    console.log(`  are being forwarded to WebSocket clients as expected.${RESET}`);
  } else {
    console.log(`  ${FAIL} ${BOLD}${failed}/${total} checks failed${RESET}`);
    console.log(`\n  ${DIM}Debugging:`);
    console.log(`    • Check broadcast() in sidecar/src/index.ts`);
    console.log(`    • It must not contain an early-return guard that filters by event type`);
    console.log(`    • All calls to broadcast() in the agentIPC.on('event') handler must reach clients`);
    console.log(`    • Re-run after saving: the sidecar hot-reloads via tsx watch${RESET}`);
  }
  console.log();

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(`\n${FAIL} Unexpected error: ${e.message}`);
  process.exit(1);
});
