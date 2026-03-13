/**
 * Test script — verify /api/agent/models returns proper model data
 *
 * Checks:
 * 1. Server reachable
 * 2. /api/agent/models returns models array
 * 3. models array contains haiku, sonnet, opus
 * 4. apiModels array returned with id + displayName from Anthropic API
 * 5. Each apiModel has proper fields (id, displayName)
 * 6. Model IDs follow expected format (claude-*)
 */

const SERVER = 'http://127.0.0.1:3004';
const results = [];

function log(label, pass, detail = '') {
  const icon = pass ? '\x1b[32m PASS\x1b[0m' : '\x1b[31m FAIL\x1b[0m';
  const line = `${icon}  ${label}${detail ? ` — ${detail}` : ''}`;
  console.log(line);
  results.push({ label, pass, detail });
}

async function main() {
  console.log('\n=== BeepBot Model API Test ===\n');

  // 1. Server reachable
  let serverOk = false;
  try {
    const res = await fetch(`${SERVER}/api/health`);
    const data = await res.json();
    serverOk = data.ok === true;
    log('Server reachable', serverOk, serverOk ? 'ok' : JSON.stringify(data));
  } catch (err) {
    log('Server reachable', false, err.message);
    console.log('\nServer not running. Start with: cd server && npx tsx watch src/index.ts\n');
    process.exit(1);
  }

  // 2. Auth check
  try {
    const res = await fetch(`${SERVER}/api/auth/status`);
    const data = await res.json();
    log('Authenticated', data.authenticated === true, `method: ${data.method || 'none'}`);
  } catch (err) {
    log('Authenticated', false, err.message);
  }

  // 3. Fetch /api/agent/models
  let modelsData = null;
  try {
    const res = await fetch(`${SERVER}/api/agent/models`);
    modelsData = await res.json();
    log('Models endpoint responds', res.ok, `status: ${res.status}`);
  } catch (err) {
    log('Models endpoint responds', false, err.message);
    printSummary();
    return;
  }

  // 4. models array present
  const hasModels = Array.isArray(modelsData.models);
  log('models array present', hasModels, hasModels ? `count: ${modelsData.models.length}` : `got: ${typeof modelsData.models}`);

  if (hasModels) {
    // 5. Contains expected short names
    const shortNames = modelsData.models;
    console.log('\n  Short names returned:', JSON.stringify(shortNames));

    for (const expected of ['haiku', 'sonnet', 'opus']) {
      const found = shortNames.includes(expected);
      log(`  Contains "${expected}"`, found, found ? '' : `available: ${shortNames.join(', ')}`);
    }
  }

  // 6. apiModels present
  const hasApiModels = Array.isArray(modelsData.apiModels);
  log('apiModels array present', hasApiModels, hasApiModels ? `count: ${modelsData.apiModels.length}` : 'not returned (auth may be missing)');

  if (hasApiModels && modelsData.apiModels.length > 0) {
    console.log('\n  API Models from Anthropic:');
    console.log('  ┌─────────────────────────────────────────┬──────────────────────────┐');
    console.log('  │ Model ID                                │ Display Name             │');
    console.log('  ├─────────────────────────────────────────┼──────────────────────────┤');

    for (const m of modelsData.apiModels) {
      const id = (m.id || '').padEnd(39);
      const name = (m.displayName || '').padEnd(24);
      console.log(`  │ ${id} │ ${name} │`);
    }
    console.log('  └─────────────────────────────────────────┴──────────────────────────┘');

    // 7. Validate apiModel fields
    const first = modelsData.apiModels[0];
    log('apiModel has id field', typeof first.id === 'string' && first.id.length > 0, `id: ${first.id}`);
    log('apiModel has displayName field', typeof first.displayName === 'string' && first.displayName.length > 0, `displayName: ${first.displayName}`);

    // 8. Check ID format
    const claudeModels = modelsData.apiModels.filter(m => m.id.startsWith('claude-'));
    log('Model IDs start with "claude-"', claudeModels.length > 0, `${claudeModels.length} / ${modelsData.apiModels.length} models`);

    // 9. Check that short names can match API models
    if (hasModels) {
      console.log('\n  Short name -> API model mapping:');
      for (const short of modelsData.models) {
        const match = modelsData.apiModels.find(a => a.id.includes(short));
        if (match) {
          console.log(`    ${short} -> ${match.id} (${match.displayName})`);
        } else {
          console.log(`    ${short} -> \x1b[33mNO MATCH\x1b[0m`);
        }
        log(`  "${short}" maps to API model`, !!match, match ? match.id : 'no match found');
      }
    }
  } else if (!hasApiModels) {
    console.log('\n  No apiModels returned. This likely means:');
    console.log('  - No OAuth token available, or');
    console.log('  - Anthropic /v1/models API call failed');
  }

  // 10. Direct Anthropic API test (if we can get the token)
  console.log('\n--- Direct Anthropic /v1/models test ---\n');
  try {
    const authRes = await fetch(`${SERVER}/api/auth/status`);
    const authData = await authRes.json();

    if (authData.authenticated) {
      // We can't get the raw token from the client, but we can verify
      // the server-side call works by checking if apiModels was populated
      log('Server-side Anthropic API call', hasApiModels && modelsData.apiModels?.length > 0,
        hasApiModels ? `returned ${modelsData.apiModels.length} models` : 'no models returned despite auth');
    } else {
      log('Server-side Anthropic API call', false, 'skipped — not authenticated');
    }
  } catch (err) {
    log('Server-side Anthropic API call', false, err.message);
  }

  printSummary();
}

function printSummary() {
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const total = results.length;

  console.log('\n=== Summary ===');
  console.log(`${passed}/${total} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\nFailed checks:');
    for (const r of results.filter(r => !r.pass)) {
      console.log(`  - ${r.label}: ${r.detail}`);
    }
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
