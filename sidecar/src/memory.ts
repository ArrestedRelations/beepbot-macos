import fs from 'fs';
import path from 'path';
import { getDataDir } from './db.js';

const WORKSPACE_DIR = path.join(getDataDir(), 'workspace');
const MEMORY_DIR = path.join(WORKSPACE_DIR, 'memory');

function ensureDirs(): void {
  if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

/** List all memory files (MEMORY.md + daily logs) */
export function listMemoryFiles(): Array<{ name: string; path: string; size: number; modified: string }> {
  ensureDirs();
  const files: Array<{ name: string; path: string; size: number; modified: string }> = [];

  // Check for MEMORY.md in workspace root
  const memoryPath = path.join(WORKSPACE_DIR, 'MEMORY.md');
  if (fs.existsSync(memoryPath)) {
    const stat = fs.statSync(memoryPath);
    files.push({ name: 'MEMORY.md', path: 'MEMORY.md', size: stat.size, modified: stat.mtime.toISOString() });
  }

  // Check for HEARTBEAT.md in data dir
  const heartbeatPath = path.join(getDataDir(), 'HEARTBEAT.md');
  if (fs.existsSync(heartbeatPath)) {
    const stat = fs.statSync(heartbeatPath);
    files.push({ name: 'HEARTBEAT.md', path: 'HEARTBEAT.md', size: stat.size, modified: stat.mtime.toISOString() });
  }

  // List daily logs
  if (fs.existsSync(MEMORY_DIR)) {
    const entries = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md')).sort().reverse();
    for (const entry of entries) {
      const filePath = path.join(MEMORY_DIR, entry);
      const stat = fs.statSync(filePath);
      files.push({ name: entry, path: `memory/${entry}`, size: stat.size, modified: stat.mtime.toISOString() });
    }
  }

  return files;
}

/** Read a memory file by relative path */
export function readMemoryFile(filename: string): string | null {
  ensureDirs();
  let filePath: string;

  if (filename === 'MEMORY.md') {
    filePath = path.join(WORKSPACE_DIR, 'MEMORY.md');
  } else if (filename === 'HEARTBEAT.md') {
    filePath = path.join(getDataDir(), 'HEARTBEAT.md');
  } else if (filename.startsWith('memory/')) {
    filePath = path.join(WORKSPACE_DIR, filename);
  } else {
    filePath = path.join(MEMORY_DIR, filename);
  }

  // Prevent path traversal
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(getDataDir())) return null;

  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Write a memory file */
export function writeMemoryFile(filename: string, content: string): boolean {
  ensureDirs();
  let filePath: string;

  if (filename === 'MEMORY.md') {
    filePath = path.join(WORKSPACE_DIR, 'MEMORY.md');
  } else if (filename === 'HEARTBEAT.md') {
    filePath = path.join(getDataDir(), 'HEARTBEAT.md');
  } else if (filename.startsWith('memory/')) {
    filePath = path.join(WORKSPACE_DIR, filename);
  } else {
    filePath = path.join(MEMORY_DIR, filename);
  }

  // Prevent path traversal
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(getDataDir())) return false;

  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** Get today's daily log filename */
export function getTodayLogFilename(): string {
  return new Date().toISOString().slice(0, 10) + '.md';
}

/** Get the static memory context for backwards compatibility with REST APIs */
export function getMemoryContext(): string {
  const parts: string[] = [];

  // Long-term memory (static content only - smart search happens in memory-system.ts)
  const memory = readMemoryFile('MEMORY.md');
  if (memory?.trim()) {
    parts.push(`## Long-Term Memory\n${memory.trim()}`);
  }

  // Today's log
  const today = readMemoryFile(getTodayLogFilename());
  if (today?.trim()) {
    parts.push(`## Today's Log (${new Date().toISOString().slice(0, 10)})\n${today.trim()}`);
  }

  return parts.length > 0 ? '\n\n## Memory System\nYou have a persistent memory system with intelligent search. Files are stored at ~/.beepbot-v2/workspace/.\n' + parts.join('\n\n') : '';
}

/** Get the heartbeat task list */
export function getHeartbeatTasks(): string | null {
  const content = readMemoryFile('HEARTBEAT.md');
  return content?.trim() || null;
}
