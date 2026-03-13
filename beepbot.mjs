#!/usr/bin/env node

/**
 * BeepBot CLI Entrypoint
 *
 * Usage:
 *   node beepbot.mjs              - Start BeepBot server
 *   node beepbot.mjs --port 8080  - Start on custom port
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(__dirname, 'server', 'dist', 'index.js');
const runtimeEntry = join(__dirname, 'server', 'dist', 'agent-runtime.js');

// Parse --port flag
const portIdx = process.argv.indexOf('--port');
const port = portIdx !== -1 ? process.argv[portIdx + 1] : '3004';

console.log(`Starting BeepBot on port ${port}...`);

// Start Agent Runtime first
const runtime = spawn('node', [runtimeEntry], {
  cwd: join(__dirname, 'server'),
  env: { ...process.env, PORT: port },
  stdio: 'inherit',
});

// Give runtime a moment to start, then launch API server
setTimeout(() => {
  const server = spawn('node', [serverEntry], {
    cwd: join(__dirname, 'server'),
    env: { ...process.env, PORT: port },
    stdio: 'inherit',
  });

  server.on('close', (code) => {
    runtime.kill();
    process.exit(code ?? 0);
  });
}, 1000);

// Cleanup on exit
process.on('SIGTERM', () => { runtime.kill(); process.exit(0); });
process.on('SIGINT', () => { runtime.kill(); process.exit(0); });
