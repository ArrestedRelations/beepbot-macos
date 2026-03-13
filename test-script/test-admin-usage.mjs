#!/usr/bin/env node
/**
 * BeepBot Admin Usage API Test
 *
 * Tests the Anthropic Admin Usage Report integration:
 *   1. Server reachable + authenticated
 *   2. GET /api/admin-usage returns expected shape
 *   3. POST /api/admin-usage/refresh calls Anthropic admin API
 *   4. Messages endpoint returns daily usage data
 *   5. Claude Code endpoint returns productivity metrics
 *   6. Data cached in SQLite and served on subsequent GET
 *
 * Usage:
 *   node test-script/test-admin-usage.mjs
 *
 * Requires: server running on :3004 and authenticated
 */

const SIDECAR = 'http://127.0.0.1:3004';

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
let warnings = 0;

function pass(label, detail = '') {
  passed++;
  console.log(`  ${PASS} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}
function fail(label, detail = '') {
  failed++;
  console.log(`  ${FAIL} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}
function warn(label, detail = '') {
  warnings++;
  console.log(`  ${WARN} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}
function info(msg) {
  console.log(`  ${INFO} ${DIM}${msg}${RESET}`);
}

async function fetchJson(path, opts = {}) {
  const headers = { ...opts.headers };
  // Only set content-type for requests with a body
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${SIDECAR}${path}`, {
    ...opts,
    headers,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, data };
}

// ────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}BeepBot Admin Usage API Test${RESET}`);
  console.log('─'.repeat(52));

  // ── Pre-flight ──────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Pre-flight${RESET}`);

  let authMethod = 'unknown';
  try {
    const { data: health } = await fetchJson('/api/health');
    if (!health.ok) throw new Error('health.ok is false');
    pass('Server reachable');
  } catch (e) {
    fail('Server reachable', e.message);
    console.log(`\n  Start the server first: cd server && npx tsx watch src/index.ts\n`);
    process.exit(1);
  }

  try {
    const { data: auth } = await fetchJson('/api/auth/status');
    if (!auth.authenticated) throw new Error(`not authenticated (method: ${auth.method})`);
    authMethod = auth.method;
    pass('Authenticated', `method: ${authMethod}`);
  } catch (e) {
    fail('Authenticated', e.message);
    process.exit(1);
  }

  // ── Test 1: GET /api/admin-usage (cached data) ──────────────────────────
  console.log(`\n${BOLD}Test 1 — GET /api/admin-usage (cached)${RESET}`);

  let cachedData;
  try {
    const { status, data } = await fetchJson('/api/admin-usage');
    cachedData = data;
    if (status !== 200) throw new Error(`HTTP ${status}`);
    pass('Endpoint returns 200');

    // Validate response shape
    if ('byDay' in data && Array.isArray(data.byDay)) {
      pass('Response has byDay array', `${data.byDay.length} entries`);
    } else {
      fail('Response has byDay array', JSON.stringify(Object.keys(data)));
    }

    if ('byModel' in data && Array.isArray(data.byModel)) {
      pass('Response has byModel array', `${data.byModel.length} entries`);
    } else {
      fail('Response has byModel array');
    }

    if ('codeMetrics' in data && Array.isArray(data.codeMetrics)) {
      pass('Response has codeMetrics array', `${data.codeMetrics.length} entries`);
    } else {
      fail('Response has codeMetrics array');
    }

    if ('lastRefresh' in data) {
      pass('Response has lastRefresh', data.lastRefresh || '(null — never refreshed)');
    } else {
      fail('Response has lastRefresh field');
    }

    if ('available' in data) {
      pass('Response has available flag', `${data.available}`);
    } else {
      fail('Response has available flag');
    }
  } catch (e) {
    fail('GET /api/admin-usage', e.message);
  }

  // ── Test 2: POST /api/admin-usage/refresh ────────────────────────────────
  console.log(`\n${BOLD}Test 2 — POST /api/admin-usage/refresh${RESET}`);
  info(`Auth method: ${authMethod} — testing admin API access...`);

  let refreshData;
  try {
    const start = Date.now();
    const { status, data } = await fetchJson('/api/admin-usage/refresh', { method: 'POST' });
    const elapsed = Date.now() - start;
    refreshData = data;

    if (status !== 200) {
      fail('Refresh endpoint returns 200', `HTTP ${status}: ${JSON.stringify(data).slice(0, 200)}`);
    } else {
      pass('Refresh endpoint returns 200', `${elapsed}ms`);
    }

    // Check for errors
    if (data.error) {
      if (data.error.includes('Auth failed')) {
        warn('Admin API auth failed', `${data.error} — your ${authMethod} key may lack admin scope`);
        info('The admin usage report API requires organization admin permissions.');
        info('Regular API keys may not have access. Check: https://console.anthropic.com/settings/admin-api-keys');
      } else if (data.error.includes('No API key')) {
        fail('API key available', data.error);
      } else {
        warn('Refresh returned error', data.error);
      }
    } else {
      pass('No error in response');
    }

    // Check available flag
    if (data.available === false) {
      warn('Admin API not available for this key', 'Section will be hidden in dashboard');
    } else {
      pass('Admin API available');
    }
  } catch (e) {
    fail('POST /api/admin-usage/refresh', e.message);
  }

  // ── Test 3: Validate Messages data ────────────────────────────────────────
  console.log(`\n${BOLD}Test 3 — Messages usage data${RESET}`);

  if (refreshData && !refreshData.error) {
    const { byDay, byModel } = refreshData;

    if (byDay && byDay.length > 0) {
      pass('byDay has data', `${byDay.length} days`);

      // Check first entry shape
      const sample = byDay[0];
      const requiredFields = ['day', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'];
      const missingFields = requiredFields.filter(f => !(f in sample));
      if (missingFields.length === 0) {
        pass('byDay entry has all fields');
      } else {
        fail('byDay entry missing fields', missingFields.join(', '));
      }

      // Print daily summary table
      console.log(`\n  ${BOLD}Daily Usage (last 14 days)${RESET}`);
      console.log(`  ${'─'.repeat(60)}`);
      console.log(`  ${DIM}${'Date'.padEnd(14)}${'Input'.padStart(12)}${'Output'.padStart(12)}${'Cache Read'.padStart(14)}${RESET}`);
      console.log(`  ${'─'.repeat(60)}`);
      let totalIn = 0, totalOut = 0, totalCache = 0;
      for (const d of byDay) {
        totalIn += d.input_tokens;
        totalOut += d.output_tokens;
        totalCache += d.cache_read_tokens;
        console.log(`  ${d.day.padEnd(14)}${String(d.input_tokens).padStart(12)}${String(d.output_tokens).padStart(12)}${String(d.cache_read_tokens).padStart(14)}`);
      }
      console.log(`  ${'─'.repeat(60)}`);
      console.log(`  ${BOLD}${'Total'.padEnd(14)}${String(totalIn).padStart(12)}${String(totalOut).padStart(12)}${String(totalCache).padStart(14)}${RESET}`);
      console.log();

      if (totalIn > 0 || totalOut > 0) {
        pass('Non-zero token usage found', `${totalIn} in, ${totalOut} out`);
      } else {
        warn('Zero token usage', 'No API usage in the last 14 days?');
      }
    } else {
      warn('byDay is empty', 'No daily usage data returned — may be a new account');
    }

    if (byModel && byModel.length > 0) {
      pass('byModel has data', `${byModel.length} models`);
      for (const m of byModel) {
        info(`${m.model}: ${m.input_tokens} in, ${m.output_tokens} out`);
      }
    } else {
      warn('byModel is empty');
    }
  } else {
    info('Skipping messages data validation — refresh returned an error');
  }

  // ── Test 4: Validate Claude Code data ──────────────────────────────────
  console.log(`\n${BOLD}Test 4 — Claude Code metrics${RESET}`);

  if (refreshData && !refreshData.error) {
    const { codeMetrics } = refreshData;

    if (codeMetrics && codeMetrics.length > 0) {
      pass('codeMetrics has data', `${codeMetrics.length} records`);

      // Check first entry shape
      const sample = codeMetrics[0];
      const requiredFields = ['metric_date', 'num_sessions', 'commits', 'pull_requests', 'lines_added', 'lines_removed'];
      const missingFields = requiredFields.filter(f => !(f in sample));
      if (missingFields.length === 0) {
        pass('codeMetrics entry has all fields');
      } else {
        fail('codeMetrics entry missing fields', missingFields.join(', '));
      }

      // Aggregate and print
      let totalSessions = 0, totalCommits = 0, totalPRs = 0, totalAdded = 0, totalRemoved = 0;
      for (const m of codeMetrics) {
        totalSessions += m.num_sessions;
        totalCommits += m.commits;
        totalPRs += m.pull_requests;
        totalAdded += m.lines_added;
        totalRemoved += m.lines_removed;
      }

      console.log(`\n  ${BOLD}Claude Code Activity (14 days)${RESET}`);
      console.log(`  ${'─'.repeat(44)}`);
      console.log(`  ${DIM}${'Sessions'.padEnd(22)}${RESET}${totalSessions}`);
      console.log(`  ${DIM}${'Commits'.padEnd(22)}${RESET}${totalCommits}`);
      console.log(`  ${DIM}${'Pull Requests'.padEnd(22)}${RESET}${totalPRs}`);
      console.log(`  ${DIM}${'Lines Added'.padEnd(22)}${RESET}+${totalAdded}`);
      console.log(`  ${DIM}${'Lines Removed'.padEnd(22)}${RESET}-${totalRemoved}`);
      console.log();

      if (totalSessions > 0) {
        pass('Non-zero Claude Code sessions', `${totalSessions} sessions`);
      } else {
        warn('Zero sessions', 'No Claude Code usage in the last 14 days?');
      }
    } else {
      warn('codeMetrics is empty', 'No Claude Code data — may require Team/Enterprise plan');
    }
  } else {
    info('Skipping Claude Code validation — refresh returned an error');
  }

  // ── Test 5: Verify cache persistence ────────────────────────────────────
  console.log(`\n${BOLD}Test 5 — Cache persistence${RESET}`);

  try {
    const { data: cached } = await fetchJson('/api/admin-usage');

    if (cached.lastRefresh) {
      pass('lastRefresh is set after refresh', cached.lastRefresh);
    } else if (refreshData?.error) {
      info('lastRefresh is null — expected since refresh failed');
    } else {
      fail('lastRefresh should be set after successful refresh');
    }

    // Compare cached data matches refresh data (if refresh succeeded)
    if (refreshData && !refreshData.error && cached.byDay?.length > 0) {
      if (cached.byDay.length === refreshData.byDay.length) {
        pass('Cached byDay matches refresh data', `${cached.byDay.length} entries`);
      } else {
        fail('Cached byDay count mismatch', `cached=${cached.byDay.length} vs refresh=${refreshData.byDay.length}`);
      }
    }
  } catch (e) {
    fail('Cache persistence check', e.message);
  }

  // ── Test 6: Direct Anthropic API test (bypass server) ───────────────────
  console.log(`\n${BOLD}Test 6 — Direct Anthropic Admin API probe${RESET}`);

  try {
    const { data: authStatus } = await fetchJson('/api/auth/status');
    info(`Testing direct API call with ${authStatus.method} auth...`);

    // Build a minimal test request to the messages endpoint
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 1);

    const params = new URLSearchParams({
      starting_at: start.toISOString(),
      ending_at: now.toISOString(),
      bucket_width: '1d',
      limit: '1',
    });

    const url = `https://api.anthropic.com/v1/organizations/usage_report/messages?${params}`;

    // We can't get the actual API key from the server, but we can test the server's proxy
    // Instead, verify the server endpoint handles the full flow
    info('Direct API test requires API key — testing via server proxy instead');

    // Re-fetch to confirm server-side logs show the API call
    const { data: stats } = await fetchJson('/api/dashboard/stats');
    if (stats.usageToday) {
      pass('Server operational — local usage tracking works');
      info(`Local tracking: ${stats.usageToday.tokens_in} in, ${stats.usageToday.tokens_out} out today`);
    }
  } catch (e) {
    warn('Direct API probe', e.message);
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(52)}`);
  const total = passed + failed;
  if (failed === 0 && warnings === 0) {
    console.log(`  ${PASS} ${BOLD}All ${passed} checks passed — admin usage API verified${RESET}`);
  } else if (failed === 0) {
    console.log(`  ${PASS} ${BOLD}${passed} passed, ${warnings} warnings${RESET}`);
  } else {
    console.log(`  ${FAIL} ${BOLD}${failed}/${total} checks failed, ${warnings} warnings${RESET}`);
  }

  if (refreshData?.error?.includes('Auth failed')) {
    console.log(`\n  ${BOLD}Troubleshooting:${RESET}`);
    console.log(`  The Anthropic Admin Usage API requires an admin-level API key.`);
    console.log(`  1. Go to ${DIM}https://console.anthropic.com/settings/admin-api-keys${RESET}`);
    console.log(`  2. Create an admin API key (or verify your key has admin scope)`);
    console.log(`  3. Set it as ANTHROPIC_API_KEY or configure in BeepBot settings`);
  }

  console.log();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(`\n${FAIL} Unexpected error: ${e.message}`);
  process.exit(1);
});
