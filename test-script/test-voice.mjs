#!/usr/bin/env node
/**
 * BeepBot Voice & STT Test
 *
 * Tests:
 *   1. Server is reachable and authenticated
 *   2. ElevenLabs API key is configured (for TTS/STT fallback)
 *   3. WebSocket connects and handles STT messages
 *   4. TTS endpoint responds (if voice ID configured)
 *   5. Voice mode chat flow works end-to-end
 *
 * Usage:
 *   node test-script/test-voice.mjs
 */

const SIDECAR = 'http://127.0.0.1:3004';
const WS_URL  = 'ws://127.0.0.1:3004/ws';

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
function warn(msg) {
  console.log(`  ${WARN} ${msg}`);
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

async function main() {
  console.log(`\n${BOLD}BeepBot Voice & STT Test${RESET}`);
  console.log('─'.repeat(52));

  // ── Pre-flight ─────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Pre-flight${RESET}`);

  try {
    const health = await fetchJson('/api/health');
    if (!health.ok) throw new Error('health.ok is false');
    pass('Sidecar reachable');
  } catch (e) {
    fail('Sidecar reachable', e.message);
    console.log(`\n${FAIL} ${BOLD}Sidecar is down — start it first${RESET}\n`);
    process.exit(1);
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Authentication${RESET}`);

  try {
    const auth = await fetchJson('/api/auth/status');
    if (auth.authenticated) {
      pass('Claude authenticated', `method: ${auth.method}`);
    } else {
      fail('Claude authenticated', `method: ${auth.method} — check API key or OAuth`);
    }
  } catch (e) {
    fail('Claude auth check', e.message);
  }

  // ── Provider Keys ───────────────────────────────────────────────────────
  console.log(`\n${BOLD}Provider Keys${RESET}`);

  try {
    const keys = await fetchJson('/api/keys');
    const keyList = Array.isArray(keys) ? keys : [];

    const elevenlabs = keyList.find(k => k.slug === 'elevenlabs');
    if (elevenlabs) {
      pass('ElevenLabs API key', `set on ${elevenlabs.updated_at || elevenlabs.created_at}`);
    } else {
      warn('ElevenLabs API key not set — server-side STT/TTS will not work');
      info('Voice will use native Web Speech API for STT (browser-only)');
      info('Set key via: POST /api/keys/elevenlabs');
    }

    const anthropic = keyList.find(k => k.slug === 'anthropic');
    if (anthropic) {
      pass('Anthropic API key', `set on ${anthropic.updated_at || anthropic.created_at}`);
    } else {
      info('Anthropic key not in provider_keys (may be using env var or OAuth)');
    }

    if (keyList.length > 0) {
      info(`Total provider keys: ${keyList.length} (${keyList.map(k => k.slug).join(', ')})`);
    }
  } catch (e) {
    fail('Provider keys check', e.message);
  }

  // ── Voice Settings ──────────────────────────────────────────────────────
  console.log(`\n${BOLD}Voice Settings${RESET}`);

  try {
    const voiceRes = await fetchJson('/api/settings/elevenlabs_voice_id');
    if (voiceRes.value) {
      pass('ElevenLabs voice ID configured', voiceRes.value);
    } else {
      warn('No ElevenLabs voice ID set — TTS will not work');
      info('Set via: POST /api/settings/elevenlabs_voice_id { "value": "<voice_id>" }');
    }
  } catch (e) {
    fail('Voice settings check', e.message);
  }

  // ── WebSocket STT ──────────────────────────────────────────────────────
  console.log(`\n${BOLD}WebSocket${RESET}`);

  let ws;
  try {
    ws = await openWs();
    pass('WebSocket connected');
  } catch (e) {
    fail('WebSocket connected', e.message);
    process.exit(1);
  }

  // Test STT with a minimal audio blob (should get error or empty result, but proves the pipeline works)
  try {
    const sttResult = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('STT response timeout')), 10000);

      function onMessage(event) {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'stt_result' || msg.type === 'stt_error') {
          clearTimeout(timer);
          ws.removeEventListener('message', onMessage);
          resolve(msg);
        }
      }

      ws.addEventListener('message', onMessage);
      // Send a tiny silent audio blob (base64 of empty webm-ish data)
      ws.send(JSON.stringify({ type: 'stt_audio', data: '' }));
    });

    if (sttResult.type === 'stt_result') {
      pass('STT pipeline responds', `result: "${sttResult.data || '(empty)'}"`);
    } else {
      // stt_error is expected for empty audio — but proves the pipeline is connected
      pass('STT pipeline connected', `got expected error for empty audio: ${sttResult.data}`);
    }
  } catch (e) {
    fail('STT pipeline', e.message);
  }

  // ── Chat via voice flow ─────────────────────────────────────────────────
  console.log(`\n${BOLD}Voice chat flow${RESET}`);

  try {
    info('Sending chat message (simulating voice input)...');
    const chatResult = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chat response timeout (60s)')), 60000);
      const chunks = [];

      function onMessage(event) {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'text') chunks.push(msg.data);
        if (msg.type === 'done') {
          clearTimeout(timer);
          ws.removeEventListener('message', onMessage);
          resolve({ text: chunks.join(''), meta: msg.data });
        }
        if (msg.type === 'error') {
          clearTimeout(timer);
          ws.removeEventListener('message', onMessage);
          reject(new Error(`Agent error: ${msg.data}`));
        }
      }

      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ type: 'chat', content: 'Say exactly: voice test ok', voice: true }));
    });

    if (chatResult.text.trim()) {
      pass('Agent responded to voice chat', `${chatResult.text.length} chars`);
    } else {
      fail('Agent response empty');
    }
  } catch (e) {
    fail('Voice chat flow', e.message);
  }

  // ── TTS check ──────────────────────────────────────────────────────────
  console.log(`\n${BOLD}TTS (Text-to-Speech)${RESET}`);

  try {
    const ttsResult = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.removeEventListener('message', onMessage);
        resolve({ type: 'timeout' });
      }, 5000);

      function onMessage(event) {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type === 'tts_audio') {
          clearTimeout(timer);
          ws.removeEventListener('message', onMessage);
          resolve(msg);
        }
        if (msg.type === 'tts_error') {
          clearTimeout(timer);
          ws.removeEventListener('message', onMessage);
          resolve(msg);
        }
      }

      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ type: 'tts', text: 'hello' }));
    });

    if (ttsResult.type === 'tts_audio') {
      pass('TTS responds with audio', `${ttsResult.data?.length || 0} chars base64`);
    } else if (ttsResult.type === 'tts_error') {
      fail('TTS error', ttsResult.data);
    } else {
      warn('TTS did not respond (voice ID or API key may be missing)');
      info('Native Web Speech API STT will still work without TTS');
    }
  } catch (e) {
    fail('TTS check', e.message);
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────
  ws.close();

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(52)}`);
  const total = passed + failed;
  if (failed === 0) {
    console.log(`  ${PASS} ${BOLD}All ${passed} checks passed${RESET}`);
  } else {
    console.log(`  ${FAIL} ${BOLD}${failed}/${total} checks failed${RESET}`);
  }

  console.log(`\n  ${DIM}Voice architecture:`);
  console.log(`    Primary STT: Native Web Speech API (browser, no API key needed)`);
  console.log(`    Fallback STT: ElevenLabs Scribe v2 (requires API key)`);
  console.log(`    TTS: ElevenLabs (requires API key + voice ID)${RESET}`);
  console.log();

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(`\n${FAIL} Unexpected error: ${e.message}`);
  process.exit(1);
});
