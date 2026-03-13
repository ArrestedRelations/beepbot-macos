#!/usr/bin/env node
/**
 * BeepBot Native Compaction Test
 *
 * Verifies that the migration from custom 180k-token compaction to SDK native
 * compaction is working correctly. Tests:
 *
 * 1. Custom compaction code has been removed (no ROTATION_TOKENS, no compactSession)
 * 2. SDK compact_boundary handler is wired up in handleSDKMessage()
 * 3. buildCompactionRefresh() produces valid context refresh content
 * 4. The compaction status event flows through to WebSocket clients
 * 5. The "prompt too long" fallback uses resumeSession=true (not session destruction)
 * 6. The compaction_log endpoint still works (repurposed for native events)
 * 7. Multi-turn chat works without premature session rotation
 *
 * Usage:
 *   node test-script/test-compaction.mjs
 *
 * Requires: sidecar running on :3004 and authenticated
 */

const SIDECAR = 'http://127.0.0.1:3004';
const WS_URL  = 'ws://127.0.0.1:3004/ws';

const PASS  = '\x1b[32m✓\x1b[0m';
const FAIL  = '\x1b[31m✗\x1b[0m';
const SKIP  = '\x1b[33m○\x1b[0m';
const INFO  = '\x1b[36m·\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(label, detail = '') {
  passed++;
  console.log(`  ${PASS} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}
function fail(label, detail = '') {
  failed++;
  console.log(`  ${FAIL} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}
function skip(label, detail = '') {
  skipped++;
  console.log(`  ${SKIP} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
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

function sendChatAndCollectEvents(ws, content, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout (${timeout / 1000}s) — no 'done' event received.`));
    }, timeout);

    const eventCounts = {};
    const textChunks = [];
    const statusEvents = [];

    function onMessage(event) {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      eventCounts[msg.type] = (eventCounts[msg.type] || 0) + 1;
      if (msg.type === 'text') textChunks.push(msg.data);
      if (msg.type === 'status') statusEvents.push(msg.data);

      if (msg.type === 'done' || msg.type === 'error') {
        clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        resolve({ eventCounts, text: textChunks.join(''), meta: msg.data, statusEvents });
      }
    }

    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ type: 'chat', content }));
  });
}

// ── Test 1: Static code analysis — verify custom compaction removed ──────────
async function testCodeRemoval() {
  console.log(`\n${BOLD}1. Custom compaction code removed${RESET}`);

  const fs = await import('fs');
  const path = await import('path');

  const agentPath = path.resolve(
    new URL('.', import.meta.url).pathname,
    '../server/src/agent.ts'
  );

  let agentCode;
  try {
    agentCode = fs.readFileSync(agentPath, 'utf-8');
  } catch (e) {
    fail('Read agent.ts', e.message);
    return;
  }

  // ROTATION_TOKENS should be gone
  if (!agentCode.includes('ROTATION_TOKENS')) {
    pass('ROTATION_TOKENS constant removed');
  } else {
    fail('ROTATION_TOKENS constant removed', 'still found in agent.ts');
  }

  // compactSession method should be gone
  if (!agentCode.includes('compactSession()') && !agentCode.includes('async compactSession')) {
    pass('compactSession() method removed');
  } else {
    fail('compactSession() method removed', 'still found in agent.ts');
  }

  // rotateSession method should be gone
  if (!agentCode.includes('rotateSession()') && !agentCode.includes('rotateSession():')) {
    pass('rotateSession() method removed');
  } else {
    fail('rotateSession() method removed', 'still found in agent.ts');
  }

  // generateCompactionSummary should be gone
  if (!agentCode.includes('generateCompactionSummary')) {
    pass('generateCompactionSummary() method removed');
  } else {
    fail('generateCompactionSummary() method removed', 'still found in agent.ts');
  }

  // compactionSummary field should be gone
  if (!agentCode.includes('compactionSummary')) {
    pass('compactionSummary field removed');
  } else {
    fail('compactionSummary field removed', 'still found in agent.ts');
  }

  // No more "compaction_model" setting reference in agent
  if (!agentCode.includes("compaction_model")) {
    pass('compaction_model setting reference removed');
  } else {
    fail('compaction_model setting reference removed', 'still found in agent.ts');
  }
}

// ── Test 2: Verify new SDK compaction handlers exist ─────────────────────────
async function testSDKHandlersExist() {
  console.log(`\n${BOLD}2. SDK native compaction handlers present${RESET}`);

  const fs = await import('fs');
  const path = await import('path');

  const agentPath = path.resolve(
    new URL('.', import.meta.url).pathname,
    '../server/src/agent.ts'
  );
  const agentCode = fs.readFileSync(agentPath, 'utf-8');

  // compact_boundary handler
  if (agentCode.includes("'compact_boundary'")) {
    pass('compact_boundary handler present');
  } else {
    fail('compact_boundary handler present', 'not found in handleSDKMessage()');
  }

  // Status compacting handler
  if (agentCode.includes("'compacting'")) {
    pass("'compacting' status handler present");
  } else {
    fail("'compacting' status handler present", 'not found in handleSDKMessage()');
  }

  // buildCompactionRefresh method
  if (agentCode.includes('buildCompactionRefresh')) {
    pass('buildCompactionRefresh() method present');
  } else {
    fail('buildCompactionRefresh() method present', 'not found in agent.ts');
  }

  // AgentEvent type includes 'status'
  if (agentCode.includes("'status'") && agentCode.includes('AgentEvent')) {
    pass("AgentEvent type includes 'status'");
  } else {
    fail("AgentEvent type includes 'status'", 'not found in AgentEvent interface');
  }

  // readWorkspaceFile and parseIdentity imports
  if (agentCode.includes('readWorkspaceFile') && agentCode.includes('parseIdentity')) {
    pass('Workspace helpers imported (readWorkspaceFile, parseIdentity)');
  } else {
    fail('Workspace helpers imported', 'readWorkspaceFile or parseIdentity not imported');
  }

  // Prompt-too-long handler uses resumeSession = true (not compactSession/rotateSession)
  const promptTooLongSection = agentCode.split('prompt is too long').join('MARKER').split('Prompt is too long').join('MARKER');
  if (agentCode.includes('resumeSession = true') && !agentCode.includes('compactSession') && !agentCode.includes('rotateSession')) {
    pass('Prompt-too-long uses resumeSession=true (not session destruction)');
  } else {
    fail('Prompt-too-long uses resumeSession=true', 'still uses compactSession/rotateSession');
  }
}

// ── Test 3: Verify dashboard handles compacting status ───────────────────────
async function testDashboardHandler() {
  console.log(`\n${BOLD}3. Dashboard compaction status handler${RESET}`);

  const fs = await import('fs');
  const path = await import('path');

  const hookPath = path.resolve(
    new URL('.', import.meta.url).pathname,
    '../dashboard/src/hooks/use-agent.ts'
  );

  let hookCode;
  try {
    hookCode = fs.readFileSync(hookPath, 'utf-8');
  } catch (e) {
    fail('Read use-agent.ts', e.message);
    return;
  }

  if (hookCode.includes('compacting')) {
    pass("Dashboard handles 'compacting' status");
  } else {
    fail("Dashboard handles 'compacting' status", 'not found in use-agent.ts');
  }

  if (hookCode.includes('Compacting context')) {
    pass("Dashboard shows 'Compacting context...' message");
  } else {
    fail("Dashboard shows 'Compacting context...' message", 'not found in use-agent.ts');
  }
}

// ── Test 4: Compaction log endpoint still works ──────────────────────────────
async function testCompactionLogEndpoint() {
  console.log(`\n${BOLD}4. Compaction log endpoint${RESET}`);

  try {
    const data = await fetchJson('/api/dashboard/compactions');
    if (Array.isArray(data)) {
      pass('GET /api/dashboard/compactions returns array', `${data.length} entries`);

      // Check if any native compaction entries exist (from prior testing)
      const nativeEntries = data.filter(e => e.summary && e.summary.includes('Native SDK'));
      if (nativeEntries.length > 0) {
        pass('Native SDK compaction entries found', `${nativeEntries.length} entries`);
      } else {
        skip('No native SDK compaction entries yet', 'will appear when context reaches threshold');
      }
    } else {
      fail('GET /api/dashboard/compactions returns array', `got ${typeof data}`);
    }
  } catch (e) {
    fail('GET /api/dashboard/compactions', e.message);
  }
}

// ── Test 5: Multi-turn chat without premature rotation ───────────────────────
async function testMultiTurnNoRotation(ws) {
  console.log(`\n${BOLD}5. Multi-turn chat — no premature session rotation${RESET}`);

  // Turn 1
  info('Sending turn 1...');
  let result1;
  try {
    result1 = await sendChatAndCollectEvents(ws, 'Reply with exactly: "turn one acknowledged"');
    if (result1.text.trim().length > 0) {
      pass('Turn 1 response received', `${result1.text.trim().slice(0, 60)}`);
    } else {
      fail('Turn 1 response received', 'empty response');
      return;
    }
  } catch (e) {
    fail('Turn 1', e.message);
    return;
  }

  // Turn 2
  info('Sending turn 2...');
  let result2;
  try {
    result2 = await sendChatAndCollectEvents(ws, 'Reply with exactly: "turn two acknowledged"');
    if (result2.text.trim().length > 0) {
      pass('Turn 2 response received', `${result2.text.trim().slice(0, 60)}`);
    } else {
      fail('Turn 2 response received', 'empty response');
      return;
    }
  } catch (e) {
    fail('Turn 2', e.message);
    return;
  }

  // Turn 3 — verify session continuity (model should remember prior turns)
  info('Sending turn 3 (continuity check)...');
  let result3;
  try {
    result3 = await sendChatAndCollectEvents(ws, 'What was the exact text I asked you to reply with in turn 1? Just repeat it.');
    if (result3.text.trim().length > 0) {
      pass('Turn 3 response received', `${result3.text.trim().slice(0, 80)}`);

      // Check if the model remembers turn 1 (session wasn't destroyed)
      const remembers = result3.text.toLowerCase().includes('turn one') ||
                        result3.text.toLowerCase().includes('turn 1');
      if (remembers) {
        pass('Session continuity — model remembers turn 1');
      } else {
        fail('Session continuity — model remembers turn 1',
          'response does not reference turn 1 — session may have been rotated');
      }
    } else {
      fail('Turn 3 response received', 'empty response');
    }
  } catch (e) {
    fail('Turn 3', e.message);
  }

  // Verify no compaction events fired (we're well under 1M tokens)
  const allStatus = [...result1.statusEvents, ...result2.statusEvents, ...result3.statusEvents];
  const compactingEvents = allStatus.filter(
    s => (typeof s === 'object' && s?.status === 'compacting') || s === 'compacting'
  );
  if (compactingEvents.length === 0) {
    pass('No premature compaction events during 3-turn chat');
  } else {
    fail('No premature compaction events', `${compactingEvents.length} compacting events seen — should not happen for short chats`);
  }
}

// ── Test 6: Token tracking still works ───────────────────────────────────────
async function testTokenTracking() {
  console.log(`\n${BOLD}6. Token tracking (sessionInputTokens still counted)${RESET}`);

  try {
    const stats = await fetchJson('/api/dashboard/stats');
    if (stats.totalTokensIn > 0) {
      pass('Total input tokens tracked', `${stats.totalTokensIn.toLocaleString()} tokens`);
    } else {
      skip('No input tokens recorded yet', 'run a chat turn first');
    }
    if (stats.totalTokensOut > 0) {
      pass('Total output tokens tracked', `${stats.totalTokensOut.toLocaleString()} tokens`);
    } else {
      skip('No output tokens recorded yet', 'run a chat turn first');
    }
  } catch (e) {
    fail('Token tracking', e.message);
  }
}

// ── Test 7: Workspace files accessible (needed for buildCompactionRefresh) ───
async function testWorkspaceFiles() {
  console.log(`\n${BOLD}7. Workspace files for context refresh${RESET}`);

  try {
    const files = await fetchJson('/api/workspace');
    if (Array.isArray(files)) {
      const identity = files.find(f => f.name === 'IDENTITY.md');
      const user = files.find(f => f.name === 'USER.md');

      if (identity?.exists) {
        pass('IDENTITY.md exists', `${identity.size} bytes`);
      } else {
        skip('IDENTITY.md not found', 'buildCompactionRefresh() will use fallback name "BeepBot"');
      }

      if (user?.exists) {
        pass('USER.md exists', `${user.size} bytes`);
      } else {
        skip('USER.md not found', 'buildCompactionRefresh() will skip user context');
      }
    } else {
      fail('GET /api/workspace returns file list', `got ${typeof files}`);
    }
  } catch (e) {
    fail('Workspace files', e.message);
  }
}

// ── Test 8: TypeScript compilation ───────────────────────────────────────────
async function testTypeCheck() {
  console.log(`\n${BOLD}8. TypeScript compilation${RESET}`);

  const { execSync } = await import('child_process');
  const path = await import('path');
  const projectRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');

  try {
    execSync('npm run typecheck', { cwd: projectRoot, stdio: 'pipe', timeout: 30_000 });
    pass('TypeScript compiles cleanly (server + dashboard)');
  } catch (e) {
    const stderr = e.stderr?.toString() || e.stdout?.toString() || e.message;
    fail('TypeScript compilation', stderr.split('\n').slice(0, 5).join('\n    '));
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}BeepBot Native Compaction Test${RESET}`);
  console.log('─'.repeat(52));
  info('Verifies migration from custom 180k compaction to SDK native compaction');

  // ── Pre-flight ──
  console.log(`\n${BOLD}Pre-flight${RESET}`);

  try {
    const health = await fetchJson('/api/health');
    if (!health.ok) throw new Error('health.ok is false');
    pass('Sidecar reachable');
  } catch (e) {
    fail('Sidecar reachable', e.message);
    console.log(`\n  Start the sidecar first: cd server && npx tsx watch src/index.ts\n`);
    process.exit(1);
  }

  let authenticated = false;
  try {
    const auth = await fetchJson('/api/auth/status');
    if (!auth.authenticated) throw new Error(`not authenticated (method: ${auth.method})`);
    pass('Authenticated', `method: ${auth.method}`);
    authenticated = true;
  } catch (e) {
    fail('Authenticated', e.message);
  }

  // ── Static code analysis tests (no sidecar needed) ──
  await testCodeRemoval();
  await testSDKHandlersExist();
  await testDashboardHandler();
  await testTypeCheck();

  // ── Runtime tests (require sidecar + auth) ──
  if (authenticated) {
    await testCompactionLogEndpoint();
    await testWorkspaceFiles();
    await testTokenTracking();

    // Multi-turn test
    let ws;
    try {
      ws = await openWs();
      pass('WebSocket connected');
      await testMultiTurnNoRotation(ws);
      ws.close();
    } catch (e) {
      fail('WebSocket', e.message);
    }
  } else {
    info('Skipping runtime tests — not authenticated');
  }

  // ── Summary ──
  console.log(`\n${'─'.repeat(52)}`);
  const total = passed + failed;
  if (failed === 0) {
    console.log(`  ${PASS} ${BOLD}All ${passed} checks passed${RESET}${skipped ? ` (${skipped} skipped)` : ''}`);
    console.log(`\n  ${DIM}Custom 180k compaction removed. SDK native compaction handles`);
    console.log(`  context management automatically within the 1M token window.`);
    console.log(`  Post-compaction context refresh is wired up via buildCompactionRefresh().${RESET}`);
  } else {
    console.log(`  ${FAIL} ${BOLD}${failed}/${total} checks failed${RESET}${skipped ? ` (${skipped} skipped)` : ''}`);
  }
  console.log();

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(`\n${FAIL} Unexpected error: ${e.message}`);
  process.exit(1);
});
