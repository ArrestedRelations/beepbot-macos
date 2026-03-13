#!/usr/bin/env node
/**
 * BeepBot Chat Session & Multi-turn Test
 *
 * Diagnoses two known issues:
 *   1. Chat sessions not being saved to SQLite after a conversation
 *   2. Second message gets no response (agent goes silent after first reply)
 *
 * Usage:
 *   node test-script/test-chat.mjs
 *
 * Requires: sidecar running on :3004 and authenticated
 */

const SIDECAR = 'http://127.0.0.1:3004';
const WS_URL  = 'ws://127.0.0.1:3004/ws';

// Colours
const PASS  = '\x1b[32m✓\x1b[0m';
const FAIL  = '\x1b[31m✗\x1b[0m';
const WARN  = '\x1b[33m⚠\x1b[0m';
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

/** Open a WebSocket and resolve with a control object */
function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => reject(new Error('WS connect timeout')), 6000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(ws); });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Send one chat message and wait for `done` or `error`.
 * Collects all text chunks so we can verify a real response was built.
 * Rejects after `timeout` ms if no `done`/`error` arrives.
 */
function sendChat(ws, content, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to: "${content.slice(0, 40)}..."`));
    }, timeout);

    const chunks = [];
    let thinkingChunks = [];

    function onMessage(event) {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'text')     chunks.push(msg.data);
      if (msg.type === 'thinking') thinkingChunks.push(msg.data);

      if (msg.type === 'done') {
        clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        resolve({
          text: chunks.join(''),
          thinking: thinkingChunks.join(''),
          meta: msg.data,   // { text, provider, model, tokensIn, tokensOut }
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

// ────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}BeepBot Chat Session & Multi-turn Test${RESET}`);
  console.log('─'.repeat(52));

  // ── Pre-flight ────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Pre-flight${RESET}`);

  let health;
  try {
    health = await fetchJson('/api/health');
    if (!health.ok) throw new Error('health.ok is false');
    pass('Sidecar reachable', `mode: ${health.agentMode}`);
  } catch (e) {
    fail('Sidecar reachable', e.message);
    console.log(`\n${FAIL} ${BOLD}Sidecar is down — start it first:${RESET}`);
    console.log('    cd sidecar && npx tsx watch src/index.ts\n');
    process.exit(1);
  }

  try {
    const auth = await fetchJson('/api/auth/status');
    if (!auth.authenticated) throw new Error(`not authenticated (method: ${auth.method})`);
    pass('Authenticated', `method: ${auth.method}`);
  } catch (e) {
    fail('Authenticated', e.message);
    console.log(`\n${WARN} Configure auth before running chat tests.\n`);
    process.exit(1);
  }

  // ── Open WebSocket ────────────────────────────────────────────────────────
  console.log(`\n${BOLD}WebSocket${RESET}`);
  let ws;
  try {
    ws = await openWs();
    pass('WebSocket connected');
  } catch (e) {
    fail('WebSocket connected', e.message);
    process.exit(1);
  }

  // ── Create a fresh conversation ───────────────────────────────────────────
  console.log(`\n${BOLD}Session setup${RESET}`);
  let convId;
  try {
    const conv = await fetchJson('/api/conversations', { method: 'POST', body: '{}' });
    convId = conv.id;
    pass('New conversation created', `id: ${convId}`);
  } catch (e) {
    fail('New conversation created', e.message);
    ws.close();
    process.exit(1);
  }

  // Give the sidecar a moment to register the new conversation
  await new Promise(r => setTimeout(r, 300));

  // ── Turn 1 ────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Turn 1 — first message${RESET}`);
  const MSG1 = 'Reply with exactly three words: alpha beta gamma';
  let turn1;
  try {
    info(`Sending: "${MSG1}"`);
    turn1 = await sendChat(ws, MSG1, 90_000);
    pass('Agent responded', `${turn1.text.length} chars | tokensOut: ${turn1.meta?.tokensOut ?? '?'}`);
    if (!turn1.text.trim()) {
      fail('Response is non-empty');
    } else {
      pass('Response is non-empty');
    }
  } catch (e) {
    fail('Agent responded to turn 1', e.message);
    ws.close();
    process.exit(1);
  }

  // ── Session persistence check ─────────────────────────────────────────────
  console.log(`\n${BOLD}Session persistence (Bug #1)${RESET}`);

  // Small delay so the DB write can flush
  await new Promise(r => setTimeout(r, 500));

  try {
    const convs = await fetchJson('/api/conversations');
    const found = convs.find(c => c.id === convId);
    if (!found) throw new Error(`conversation ${convId} not in list`);
    pass('Conversation persisted', `title: "${found.title}"`);

    if (found.title && found.title !== 'New Conversation') {
      pass('Title auto-generated from first message');
    } else {
      fail('Title auto-generated', `still "New Conversation" — title update may have failed`);
    }
  } catch (e) {
    fail('Conversation persisted', e.message);
  }

  try {
    const msgs = await fetchJson(`/api/conversations/${convId}/messages`);
    const userMsgs = msgs.filter(m => m.role === 'user');
    const assistantMsgs = msgs.filter(m => m.role === 'assistant');

    if (userMsgs.length >= 1) {
      pass('User message saved to DB', `${userMsgs.length} user msg(s)`);
    } else {
      fail('User message saved to DB', 'no user messages found');
    }

    if (assistantMsgs.length >= 1) {
      pass('Assistant reply saved to DB', `content: "${assistantMsgs[0].content.slice(0, 60)}"`);
    } else {
      fail('Assistant reply saved to DB', 'no assistant messages found — response not persisted');
    }
  } catch (e) {
    fail('Messages readable from DB', e.message);
  }

  // ── Turn 2 ────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Turn 2 — second message (Bug #2)${RESET}`);
  const MSG2 = 'Reply with exactly three different words: delta epsilon zeta';
  let turn2;
  try {
    info(`Sending: "${MSG2}"`);
    turn2 = await sendChat(ws, MSG2, 90_000);
    pass('Agent responded to second message', `${turn2.text.length} chars | tokensOut: ${turn2.meta?.tokensOut ?? '?'}`);
    if (!turn2.text.trim()) {
      fail('Second response is non-empty');
    } else {
      pass('Second response is non-empty');
    }
  } catch (e) {
    fail('Agent responded to second message', e.message);
    console.log(`\n  ${WARN} ${DIM}This is the known multi-turn bug.`);
    console.log(`     The session stream likely ended after the first turn.${RESET}`);
  }

  // ── Full session state after both turns ───────────────────────────────────
  console.log(`\n${BOLD}Full session state after two turns${RESET}`);

  await new Promise(r => setTimeout(r, 500));

  try {
    const msgs = await fetchJson(`/api/conversations/${convId}/messages`);
    const userMsgs      = msgs.filter(m => m.role === 'user');
    const assistantMsgs = msgs.filter(m => m.role === 'assistant');

    info(`Total DB messages: ${msgs.length} (${userMsgs.length} user, ${assistantMsgs.length} assistant)`);

    if (userMsgs.length >= 2) {
      pass('Both user messages saved', `${userMsgs.length} found`);
    } else {
      fail('Both user messages saved', `only ${userMsgs.length} found, expected 2`);
    }

    if (assistantMsgs.length >= 2) {
      pass('Both assistant replies saved', `${assistantMsgs.length} found`);
    } else {
      fail('Both assistant replies saved', `only ${assistantMsgs.length} found, expected 2`);
    }
  } catch (e) {
    fail('Messages readable from DB', e.message);
  }

  try {
    const state = await fetchJson('/api/agent/state');
    info(`Agent state: chatRunning=${state.chatRunning}, hasAgent=${state.hasActiveAgent}, convId=${state.conversationId?.slice(0, 8)}…`);
    if (!state.chatRunning) {
      pass('Agent is idle after both turns');
    } else {
      fail('Agent is idle', 'chatRunning is still true — may be stuck');
    }
  } catch (e) {
    fail('Agent state readable', e.message);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  ws.close();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(52)}`);
  const total = passed + failed;
  if (failed === 0) {
    console.log(`  ${PASS} ${BOLD}All ${passed} checks passed — no issues detected${RESET}`);
  } else {
    console.log(`  ${FAIL} ${BOLD}${failed}/${total} checks failed${RESET}`);
    console.log();

    if (failed > 0) {
      console.log(`  ${DIM}Debugging tips:`);
      console.log(`    • Watch sidecar logs: cd sidecar && npx tsx watch src/index.ts`);
      console.log(`    • Inspect DB directly:`);
      console.log(`        sqlite3 ~/.beepbot-v2/beepbot.db`);
      console.log(`        SELECT role, substr(content,1,60) FROM messages WHERE conversation_id='${convId}';`);
      console.log(`    • Check agent state: curl http://127.0.0.1:3004/api/agent/state | jq${RESET}`);
    }
  }
  console.log();

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(`\n${FAIL} Unexpected error: ${e.message}`);
  process.exit(1);
});
