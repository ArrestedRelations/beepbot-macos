import fs from 'fs';
import path from 'path';
import { getDataDir } from './db.js';

const WORKSPACE_DIR = path.join(getDataDir(), 'workspace');

/** Bootstrap files that get injected into agent context — mirrors OpenClaw's workspace.ts */
const BOOTSTRAP_FILES = [
  { name: 'SOUL.md', description: 'Core identity and values' },
  { name: 'USER.md', description: 'User context and preferences' },
  { name: 'AGENTS.md', description: 'Available agents reference' },
  { name: 'IDENTITY.md', description: 'Self-description, emoji, vibe' },
  { name: 'TOOLS.md', description: 'Custom tools and scripts' },
  { name: 'HEARTBEAT.md', description: 'Periodic check instructions' },
] as const;

export interface BootstrapFile {
  name: string;
  path: string;
  content: string;
  description: string;
}

export interface AgentIdentity {
  name?: string;
  emoji?: string;
  theme?: string;
  creature?: string;
  vibe?: string;
}

function ensureWorkspaceDir(): void {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
}

/** Load all bootstrap files from workspace, skipping missing ones */
export function loadBootstrapFiles(): BootstrapFile[] {
  ensureWorkspaceDir();
  const files: BootstrapFile[] = [];

  for (const entry of BOOTSTRAP_FILES) {
    const filePath = path.join(WORKSPACE_DIR, entry.name);
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (content) {
        files.push({
          name: entry.name,
          path: filePath,
          content,
          description: entry.description,
        });
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  return files;
}

/** Parse IDENTITY.md into structured fields (mirrors OpenClaw's identity-file.ts) */
export function parseIdentity(content: string): AgentIdentity {
  const identity: AgentIdentity = {};
  for (const line of content.split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^\s*-\s*/, '');
    const colonIdx = cleaned.indexOf(':');
    if (colonIdx === -1) continue;
    const label = cleaned.slice(0, colonIdx).replace(/[*_]/g, '').trim().toLowerCase();
    const value = cleaned.slice(colonIdx + 1).replace(/^[*_]+|[*_]+$/g, '').trim();
    if (!value) continue;
    if (label === 'name') identity.name = value;
    else if (label === 'emoji') identity.emoji = value;
    else if (label === 'theme') identity.theme = value;
    else if (label === 'creature') identity.creature = value;
    else if (label === 'vibe') identity.vibe = value;
  }
  return identity;
}

/**
 * Build the workspace context string for agent prompt injection.
 * Loads all bootstrap files + formats them as context sections.
 */
export function buildWorkspaceContext(): string {
  const files = loadBootstrapFiles();
  if (files.length === 0) return '';

  const sections: string[] = [];

  for (const file of files) {
    // Truncate very large files
    const content = file.content.length > 8000
      ? file.content.slice(0, 8000) + '\n...(truncated)'
      : file.content;
    sections.push(`## ${file.name}\n${content}`);
  }

  return '\n\n## Workspace Context\nThe following files are loaded from your workspace (~/.beepbot-v2/workspace/).\n\n' + sections.join('\n\n');
}

/** Read a single workspace file */
export function readWorkspaceFile(filename: string): string | null {
  ensureWorkspaceDir();
  const filePath = path.join(WORKSPACE_DIR, filename);
  // Path traversal check
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(WORKSPACE_DIR)) return null;
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Write a workspace file */
export function writeWorkspaceFile(filename: string, content: string): boolean {
  ensureWorkspaceDir();
  const filePath = path.join(WORKSPACE_DIR, filename);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(WORKSPACE_DIR)) return false;
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** List workspace files with metadata */
export function listWorkspaceFiles(): Array<{ name: string; exists: boolean; size: number; modified: string | null; description: string }> {
  ensureWorkspaceDir();
  return BOOTSTRAP_FILES.map(entry => {
    const filePath = path.join(WORKSPACE_DIR, entry.name);
    try {
      const stat = fs.statSync(filePath);
      return { name: entry.name, exists: true, size: stat.size, modified: stat.mtime.toISOString(), description: entry.description };
    } catch {
      return { name: entry.name, exists: false, size: 0, modified: null, description: entry.description };
    }
  });
}

export function getWorkspaceDir(): string {
  ensureWorkspaceDir();
  return WORKSPACE_DIR;
}
