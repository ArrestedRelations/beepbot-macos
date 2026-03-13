import fs from 'fs';
import path from 'path';
import { getDataDir } from './db.js';

export interface FileEvent {
  type: 'change' | 'rename';
  path: string;
  timestamp: string;
}

type BroadcastFn = (data: Record<string, unknown>) => void;

const MAX_EVENTS = 200;
const WORKSPACE_DIR = path.join(getDataDir(), 'workspace');

/**
 * Watches workspace and user-configured directories for file changes.
 * Broadcasts change events via WebSocket for real-time UI updates.
 */
export class FileWatcher {
  private watchers = new Map<string, fs.FSWatcher>();
  private events: FileEvent[] = [];
  private onBroadcast: BroadcastFn | null = null;
  // Debounce: don't fire duplicate events for same path within 500ms
  private debounceMap = new Map<string, number>();

  setBroadcast(fn: BroadcastFn): void {
    this.onBroadcast = fn;
  }

  /** Start watching the workspace directory */
  start(): void {
    // Always watch the workspace dir
    this.addPath(WORKSPACE_DIR);
  }

  /** Add a path to watch */
  addPath(watchPath: string): boolean {
    const resolved = path.resolve(watchPath);
    if (this.watchers.has(resolved)) return true;

    try {
      if (!fs.existsSync(resolved)) return false;

      const watcher = fs.watch(resolved, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        const fullPath = path.join(resolved, filename);
        const now = Date.now();
        const lastEvent = this.debounceMap.get(fullPath) ?? 0;
        if (now - lastEvent < 500) return;
        this.debounceMap.set(fullPath, now);

        const event: FileEvent = {
          type: eventType === 'rename' ? 'rename' : 'change',
          path: fullPath,
          timestamp: new Date().toISOString(),
        };

        this.events.push(event);
        if (this.events.length > MAX_EVENTS) this.events.shift();

        this.onBroadcast?.({
          type: 'file_change',
          data: event,
        });
      });

      this.watchers.set(resolved, watcher);
      return true;
    } catch {
      return false;
    }
  }

  /** Remove a watched path */
  removePath(watchPath: string): boolean {
    const resolved = path.resolve(watchPath);
    const watcher = this.watchers.get(resolved);
    if (!watcher) return false;
    watcher.close();
    this.watchers.delete(resolved);
    return true;
  }

  /** Get all watched paths */
  getWatchedPaths(): string[] {
    return Array.from(this.watchers.keys());
  }

  /** Get recent file events */
  getRecentEvents(limit = 50): FileEvent[] {
    return this.events.slice(-limit);
  }

  /** Get file events since a given ISO timestamp */
  getEventsSince(since: string): FileEvent[] {
    return this.events.filter((e) => e.timestamp > since);
  }

  /** Stop all watchers */
  stop(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}
