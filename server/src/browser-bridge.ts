/**
 * Browser Bridge — WebSocket bridge between the BeepBot server and the
 * Chrome extension (beep-bridge). The extension connects via WebSocket
 * and relays commands to/from the browser.
 */

import { randomUUID } from 'crypto';

interface PendingCommand {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface BridgeSocket {
  send: (data: string) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
}

export class BrowserBridge {
  private socket: BridgeSocket | null = null;
  private pending = new Map<string, PendingCommand>();
  private tabCount = 0;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  /** Attach the extension's WebSocket connection */
  attachSocket(socket: BridgeSocket): void {
    this.socket = socket;

    socket.on('message', (raw: unknown) => {
      try {
        const msg = JSON.parse(String(raw)) as { id?: string; event?: string; result?: unknown; error?: string; tabs?: unknown[] };

        // Response to a command we sent
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error));
          } else {
            p.resolve(msg.result ?? {});
          }
          return;
        }

        // Events from extension
        if (msg.event === 'connected' && Array.isArray(msg.tabs)) {
          this.tabCount = msg.tabs.length;
        } else if (msg.event === 'tab_created') {
          this.tabCount++;
        } else if (msg.event === 'tab_removed') {
          this.tabCount = Math.max(0, this.tabCount - 1);
        }
      } catch {
        // ignore malformed messages
      }
    });

    // Start keepalive pings
    this.keepaliveTimer = setInterval(() => {
      this.sendRaw({ action: 'ping', id: `ping_${Date.now()}` });
    }, 30_000);
  }

  /** Detach the extension socket */
  detachSocket(): void {
    this.socket = null;
    this.tabCount = 0;
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    // Reject all pending commands
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Browser extension disconnected'));
      this.pending.delete(id);
    }
  }

  /** Check if the extension is connected */
  isConnected(): boolean {
    return this.socket !== null;
  }

  /** Get current tab count */
  getTabCount(): number {
    return this.tabCount;
  }

  /** Send a command to the extension and wait for response */
  sendCommand(action: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Browser extension not connected. Install the BeepBot Bridge extension and ensure Chrome is open.'));
        return;
      }

      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser command "${action}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.sendRaw({ id, action, ...params });
    });
  }

  private sendRaw(data: Record<string, unknown>): void {
    try {
      this.socket?.send(JSON.stringify(data));
    } catch {
      // socket may be closing
    }
  }
}
