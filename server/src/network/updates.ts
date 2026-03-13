/**
 * Update Manager — Version control and code distribution for the BeepBot network.
 *
 * Each bot tracks its codebase hash. When code changes, it can announce updates
 * to the network. Other bots can preview, request, and apply updates.
 */

import { createHash, randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import type Database from 'better-sqlite3';
import { getIdentity, sign } from '../identity.js';
import type {
  UpdateAnnouncePayload,
  UpdateRequestPayload,
  UpdateResponsePayload,
  UpdateAppliedPayload,
} from './protocols.js';

export type UpdateStatus = 'available' | 'downloading' | 'ready' | 'applied' | 'rejected' | 'failed';

export interface StoredUpdate {
  id: string;
  fromBotId: string;
  fromShortId: string;
  description: string;
  codebaseHash: string;
  previousHash: string;
  changedFiles: string;   // JSON array
  status: UpdateStatus;
  signature: string;
  createdAt: string;
  appliedAt: string | null;
}

// Directories to track for codebase hashing
const TRACKED_DIRS = ['server/src', 'dashboard/src'];
const TRACKED_EXTENSIONS = ['.ts', '.tsx', '.css', '.json', '.md'];
const IGNORE_PATTERNS = ['node_modules', 'dist', '.git', 'target'];

export class UpdateManager {
  private projectRoot: string;
  private broadcast: ((data: Record<string, unknown>) => void) | null = null;

  constructor(private db: Database.Database, projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcast = fn;
  }

  /** Compute SHA-256 tree hash of the tracked codebase */
  computeCodebaseHash(): string {
    const files = this.getTrackedFiles();
    const hasher = createHash('sha256');

    for (const file of files) {
      const absPath = join(this.projectRoot, file);
      try {
        const content = readFileSync(absPath);
        hasher.update(`${file}:${content.length}:`);
        hasher.update(content);
      } catch {
        // File might have been deleted
      }
    }

    return hasher.digest('hex');
  }

  /** Get list of all tracked files (sorted for deterministic hashing) */
  getTrackedFiles(): string[] {
    const files: string[] = [];

    for (const dir of TRACKED_DIRS) {
      const absDir = join(this.projectRoot, dir);
      if (!existsSync(absDir)) continue;
      this.walkDir(absDir, files);
    }

    return files.map(f => relative(this.projectRoot, f)).sort();
  }

  /** Compute hash for a single file */
  hashFile(filePath: string): string {
    const absPath = join(this.projectRoot, filePath);
    const content = readFileSync(absPath);
    return createHash('sha256').update(content).digest('hex');
  }

  /** Detect changed files since a given codebase hash by comparing with git or stored state */
  detectChanges(): Array<{ path: string; hash: string; size: number; action: 'add' | 'modify' | 'delete' }> {
    const changes: Array<{ path: string; hash: string; size: number; action: 'add' | 'modify' | 'delete' }> = [];

    try {
      // Use git to detect changes
      const gitCmd = process.platform === 'win32'
        ? 'git diff --name-status HEAD~1 2>nul || git diff --name-status --cached 2>nul || echo.'
        : 'git diff --name-status HEAD~1 2>/dev/null || git diff --name-status --cached 2>/dev/null || echo ""';
      const gitOutput = execSync(gitCmd, {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      if (gitOutput) {
        for (const line of gitOutput.split('\n')) {
          const [status, filePath] = line.split('\t');
          if (!filePath) continue;

          // Only track our directories
          if (!TRACKED_DIRS.some(d => filePath.startsWith(d))) continue;
          if (!TRACKED_EXTENSIONS.some(ext => filePath.endsWith(ext))) continue;

          const absPath = join(this.projectRoot, filePath);

          if (status === 'D') {
            changes.push({ path: filePath, hash: '', size: 0, action: 'delete' });
          } else if (status === 'A') {
            const stat = statSync(absPath);
            changes.push({ path: filePath, hash: this.hashFile(filePath), size: stat.size, action: 'add' });
          } else {
            const stat = statSync(absPath);
            changes.push({ path: filePath, hash: this.hashFile(filePath), size: stat.size, action: 'modify' });
          }
        }
      }
    } catch {
      // If git fails, fall back to comparing with stored file hashes
    }

    // If no git changes detected, compare all tracked files against stored hashes
    if (changes.length === 0) {
      const storedHashes = this.getStoredFileHashes();
      const currentFiles = this.getTrackedFiles();

      for (const filePath of currentFiles) {
        const absPath = join(this.projectRoot, filePath);
        try {
          const hash = this.hashFile(filePath);
          const stat = statSync(absPath);
          const stored = storedHashes.get(filePath);

          if (!stored) {
            changes.push({ path: filePath, hash, size: stat.size, action: 'add' });
          } else if (stored !== hash) {
            changes.push({ path: filePath, hash, size: stat.size, action: 'modify' });
          }
        } catch { /* deleted */ }
      }

      // Check for deleted files
      for (const [filePath] of storedHashes) {
        if (!currentFiles.includes(filePath)) {
          changes.push({ path: filePath, hash: '', size: 0, action: 'delete' });
        }
      }
    }

    return changes;
  }

  /** Create and announce an update to the network */
  createUpdate(description: string): UpdateAnnouncePayload | null {
    const identity = getIdentity();
    const changes = this.detectChanges();

    if (changes.length === 0) return null;

    const previousHash = this.getLastKnownCodebaseHash();
    const codebaseHash = this.computeCodebaseHash();

    const payload: UpdateAnnouncePayload = {
      updateId: randomUUID(),
      fromBotId: identity.botId,
      fromShortId: identity.shortId,
      description,
      codebaseHash,
      previousHash,
      changedFiles: changes,
      timestamp: Date.now(),
    };

    // Store locally
    this.db.prepare(`
      INSERT INTO updates (id, from_bot_id, from_short_id, description, codebase_hash, previous_hash, changed_files, status, signature, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', ?, datetime('now'))
    `).run(
      payload.updateId, identity.botId, identity.shortId, description,
      codebaseHash, previousHash, JSON.stringify(changes),
      sign(JSON.stringify(payload)),
    );

    // Update stored file hashes
    this.updateStoredFileHashes();

    // Store codebase hash
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('codebase_hash', ?, datetime('now'))").run(codebaseHash);

    if (this.broadcast) {
      this.broadcast({ type: 'update_announced', data: payload });
    }

    return payload;
  }

  /** Handle an incoming update announcement from a peer */
  handleUpdateAnnounce(payload: UpdateAnnouncePayload, signature: string): void {
    // Check if we already have this update
    const existing = this.db.prepare('SELECT id FROM updates WHERE id = ?').get(payload.updateId);
    if (existing) return;

    // Store the update
    this.db.prepare(`
      INSERT INTO updates (id, from_bot_id, from_short_id, description, codebase_hash, previous_hash, changed_files, status, signature, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, datetime('now'))
    `).run(
      payload.updateId, payload.fromBotId, payload.fromShortId, payload.description,
      payload.codebaseHash, payload.previousHash, JSON.stringify(payload.changedFiles),
      signature,
    );

    console.log(`[updates] New update from ${payload.fromShortId}: ${payload.description} (${payload.changedFiles.length} files)`);

    if (this.broadcast) {
      this.broadcast({ type: 'update_available', data: payload });
    }
  }

  /** Get file contents for an update request */
  getUpdateFiles(updateId: string, requestedFiles: string[]): UpdateResponsePayload {
    const files: Array<{ path: string; content: string; hash: string }> = [];

    for (const filePath of requestedFiles) {
      const absPath = join(this.projectRoot, filePath);
      try {
        const content = readFileSync(absPath);
        const hash = createHash('sha256').update(content).digest('hex');
        files.push({
          path: filePath,
          content: content.toString('base64'),
          hash,
        });
      } catch {
        // File doesn't exist (might be deleted)
      }
    }

    return { updateId, files };
  }

  /** Apply an update from a peer */
  applyUpdate(updateId: string, files: Array<{ path: string; content: string; hash: string }>): boolean {
    const update = this.getUpdate(updateId);
    if (!update || update.status !== 'available' && update.status !== 'ready') return false;

    try {
      // Apply each file
      for (const file of files) {
        const absPath = join(this.projectRoot, file.path);
        const content = Buffer.from(file.content, 'base64');

        // Verify hash
        const hash = createHash('sha256').update(content).digest('hex');
        if (hash !== file.hash) {
          console.error(`[updates] Hash mismatch for ${file.path}`);
          this.db.prepare("UPDATE updates SET status = 'failed' WHERE id = ?").run(updateId);
          return false;
        }

        writeFileSync(absPath, content);
        console.log(`[updates] Applied: ${file.path}`);
      }

      // Handle deletions
      const changedFiles = JSON.parse(update.changedFiles) as Array<{ path: string; action: string }>;
      for (const cf of changedFiles) {
        if (cf.action === 'delete') {
          const absPath = join(this.projectRoot, cf.path);
          try {
            // Use trash/unlink
            execSync(`rm "${absPath}"`, { timeout: 3000 });
            console.log(`[updates] Deleted: ${cf.path}`);
          } catch { /* already gone */ }
        }
      }

      // Update status
      this.db.prepare("UPDATE updates SET status = 'applied', applied_at = datetime('now') WHERE id = ?").run(updateId);

      // Update stored hashes
      this.updateStoredFileHashes();
      const newHash = this.computeCodebaseHash();
      this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('codebase_hash', ?, datetime('now'))").run(newHash);

      if (this.broadcast) {
        this.broadcast({ type: 'update_applied', data: { updateId, newCodebaseHash: newHash } });
      }

      return true;
    } catch (err) {
      console.error(`[updates] Failed to apply update ${updateId}:`, err instanceof Error ? err.message : String(err));
      this.db.prepare("UPDATE updates SET status = 'failed' WHERE id = ?").run(updateId);
      return false;
    }
  }

  /** Reject an update */
  rejectUpdate(updateId: string): void {
    this.db.prepare("UPDATE updates SET status = 'rejected' WHERE id = ?").run(updateId);
  }

  /** Get a stored update */
  getUpdate(updateId: string): StoredUpdate | null {
    return this.db.prepare('SELECT * FROM updates WHERE id = ?').get(updateId) as StoredUpdate | null;
  }

  /** List updates */
  listUpdates(status?: UpdateStatus): StoredUpdate[] {
    if (status) {
      return this.db.prepare('SELECT * FROM updates WHERE status = ? ORDER BY created_at DESC').all(status) as StoredUpdate[];
    }
    return this.db.prepare('SELECT * FROM updates ORDER BY created_at DESC').all() as StoredUpdate[];
  }

  /** Get current codebase hash */
  getCurrentHash(): string {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'codebase_hash'").get() as { value: string } | undefined;
    return row?.value || this.computeCodebaseHash();
  }

  /** Get stats */
  getStats(): Record<string, unknown> {
    const all = this.listUpdates();
    return {
      currentHash: this.getCurrentHash(),
      totalUpdates: all.length,
      available: all.filter(u => u.status === 'available').length,
      applied: all.filter(u => u.status === 'applied').length,
      trackedFiles: this.getTrackedFiles().length,
    };
  }

  // --- Private helpers ---

  private getLastKnownCodebaseHash(): string {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'codebase_hash'").get() as { value: string } | undefined;
    return row?.value || '0'.repeat(64);
  }

  private getStoredFileHashes(): Map<string, string> {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'file_hashes'").get() as { value: string } | undefined;
    if (!row?.value) return new Map();
    try {
      return new Map(Object.entries(JSON.parse(row.value) as Record<string, string>));
    } catch {
      return new Map();
    }
  }

  private updateStoredFileHashes(): void {
    const files = this.getTrackedFiles();
    const hashes: Record<string, string> = {};
    for (const file of files) {
      try {
        hashes[file] = this.hashFile(file);
      } catch { /* deleted */ }
    }
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('file_hashes', ?, datetime('now'))").run(JSON.stringify(hashes));
  }

  private walkDir(dir: string, files: string[]): void {
    try {
      const entries = require('fs').readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_PATTERNS.some(p => entry.name.includes(p))) continue;

        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          this.walkDir(fullPath, files);
        } else if (TRACKED_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch { /* can't read dir */ }
  }
}
