#!/usr/bin/env node

/**
 * Cross-platform stop script for BeepBot.
 * Kills processes on ports 3004, 3005, 7432 and cleans up IPC socket/pipe.
 */

import net from 'net';
import { execSync } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

const PORTS = [3004, 3005, 7432];
const isWin = process.platform === 'win32';

function getDataDir() {
  return process.env.BEEPBOT_DATA_DIR
    || (isWin
      ? join(process.env.APPDATA || os.homedir(), 'beepbot-v2')
      : join(os.homedir(), '.beepbot-v2'));
}

/** Check if a port is in use and kill the process holding it */
function killPort(port) {
  try {
    if (isWin) {
      const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      for (const line of output.split('\n')) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && /^\d+$/.test(pid)) {
          try { process.kill(Number(pid)); } catch { /* already dead */ }
        }
      }
    } else {
      const output = execSync(`lsof -ti :${port}`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      for (const pid of output.split('\n')) {
        if (pid && /^\d+$/.test(pid.trim())) {
          try { process.kill(Number(pid.trim())); } catch { /* already dead */ }
        }
      }
    }
  } catch {
    // No process on this port
  }
}

/** Kill tsx processes by name */
function killTsxProcesses() {
  try {
    if (isWin) {
      execSync('taskkill /F /FI "IMAGENAME eq node.exe" /FI "WINDOWTITLE eq *tsx*" 2>nul', {
        timeout: 5000,
      });
    } else {
      execSync('pkill -f "tsx.*index" 2>/dev/null; pkill -f "tsx.*agent-runtime" 2>/dev/null', {
        timeout: 5000,
        shell: true,
      });
    }
  } catch {
    // No matching processes
  }
}

/** Clean up IPC socket or named pipe */
function cleanupIPC() {
  if (isWin) {
    // Named pipes are cleaned up automatically on Windows
    return;
  }
  const socketPath = join(getDataDir(), 'agent-runtime.sock');
  try {
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }
  } catch {
    // Already cleaned
  }
}

// Run
for (const port of PORTS) {
  killPort(port);
}
killTsxProcesses();
cleanupIPC();

console.log('[stop] BeepBot processes stopped');
