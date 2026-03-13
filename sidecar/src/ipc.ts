/**
 * IPC Bridge — communication between Agent Runtime and API Server
 * Uses a Unix socket (or named pipe on Windows) for low-latency local IPC.
 */

import net from 'net';
import { EventEmitter } from 'events';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { getDataDir } from './db.js';

const IPC_SOCKET_PATH = join(getDataDir(), 'agent-runtime.sock');

// Message framing: newline-delimited JSON
interface IPCMessage {
  id: string;
  type: string;
  payload: unknown;
}

type IPCHandler = (payload: unknown) => Promise<unknown> | unknown;

/**
 * IPC Server — runs in the Agent Runtime process.
 * Accepts connections from the API Server and handles chat/agent commands.
 */
export class IPCServer extends EventEmitter {
  private server: net.Server | null = null;
  private clients = new Set<net.Socket>();
  private handlers = new Map<string, IPCHandler>();

  /** Register a handler for a message type */
  handle(type: string, handler: IPCHandler): void {
    this.handlers.set(type, handler);
  }

  /** Start listening for connections */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Clean up stale socket
      if (existsSync(IPC_SOCKET_PATH)) {
        try { unlinkSync(IPC_SOCKET_PATH); } catch { /* ignore */ }
      }

      this.server = net.createServer((socket) => {
        this.clients.add(socket);
        console.log('[ipc-server] API Server connected');

        let buffer = '';
        socket.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line) as IPCMessage;
              void this.handleMessage(msg, socket);
            } catch {
              console.error('[ipc-server] Bad message:', line.slice(0, 100));
            }
          }
        });

        socket.on('close', () => {
          this.clients.delete(socket);
          console.log('[ipc-server] API Server disconnected');
        });

        socket.on('error', (err) => {
          console.error('[ipc-server] Socket error:', err.message);
          this.clients.delete(socket);
        });
      });

      this.server.on('error', reject);
      this.server.listen(IPC_SOCKET_PATH, () => {
        console.log(`[ipc-server] Listening on ${IPC_SOCKET_PATH}`);
        resolve();
      });
    });
  }

  /** Broadcast an event to all connected API servers */
  broadcast(type: string, payload: unknown): void {
    const msg = JSON.stringify({ id: '', type, payload }) + '\n';
    for (const client of this.clients) {
      try { client.write(msg); } catch { /* disconnected */ }
    }
  }

  /** Stop the IPC server */
  stop(): void {
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();
    this.server?.close();
    this.server = null;
    try { unlinkSync(IPC_SOCKET_PATH); } catch { /* ignore */ }
  }

  private async handleMessage(msg: IPCMessage, socket: net.Socket): Promise<void> {
    const handler = this.handlers.get(msg.type);
    if (!handler) {
      this.sendResponse(socket, msg.id, { error: `Unknown message type: ${msg.type}` });
      return;
    }

    try {
      const result = await handler(msg.payload);
      this.sendResponse(socket, msg.id, { ok: true, result });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.sendResponse(socket, msg.id, { error: errMsg });
    }
  }

  private sendResponse(socket: net.Socket, id: string, payload: unknown): void {
    try {
      socket.write(JSON.stringify({ id, type: 'response', payload }) + '\n');
    } catch { /* disconnected */ }
  }
}

/**
 * IPC Client — runs in the API Server process.
 * Connects to the Agent Runtime and sends chat/agent commands.
 */
export class IPCClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private connected = false;
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private buffer = '';
  private requestCounter = 0;

  /** Connect to the Agent Runtime */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(IPC_SOCKET_PATH, () => {
        this.connected = true;
        console.log('[ipc-client] Connected to Agent Runtime');
        this.emit('connected');
        resolve();
      });

      this.socket.on('data', (chunk) => {
        this.buffer += chunk.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as IPCMessage;
            if (msg.type === 'response') {
              // Response to a request we sent
              const pending = this.pendingRequests.get(msg.id);
              if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(msg.id);
                const result = msg.payload as { error?: string; result?: unknown };
                if (result.error) {
                  pending.reject(new Error(result.error));
                } else {
                  pending.resolve(result.result);
                }
              }
            } else {
              // Broadcast event from agent runtime
              this.emit('event', msg.type, msg.payload);
            }
          } catch {
            // ignore malformed
          }
        }
      });

      this.socket.on('close', () => {
        this.connected = false;
        console.warn('[ipc-client] Disconnected from Agent Runtime');
        this.emit('disconnected');
        // Auto-reconnect
        this.scheduleReconnect();
      });

      this.socket.on('error', (err) => {
        if (!this.connected) {
          reject(err);
          return;
        }
        console.error('[ipc-client] Socket error:', err.message);
        this.scheduleReconnect();
      });
    });
  }

  /** Connect with retries */
  async connectWithRetry(maxRetries = 30, intervalMs = 1000): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.connect();
        return;
      } catch {
        if (i < maxRetries - 1) {
          await new Promise(r => setTimeout(r, intervalMs));
        }
      }
    }
    throw new Error(`Failed to connect to Agent Runtime after ${maxRetries} attempts`);
  }

  /** Send a request and wait for response */
  request(type: string, payload: unknown, timeoutMs = 900_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.socket) {
        reject(new Error('Not connected to Agent Runtime'));
        return;
      }

      const id = `req_${++this.requestCounter}_${Date.now()}`;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`IPC request ${type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        this.socket.write(JSON.stringify({ id, type, payload } as IPCMessage) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Send a fire-and-forget message (no response expected) */
  send(type: string, payload: unknown): void {
    if (!this.connected || !this.socket) return;
    try {
      this.socket.write(JSON.stringify({ id: '', type, payload } as IPCMessage) + '\n');
    } catch { /* disconnected */ }
  }

  /** Check if connected */
  isConnected(): boolean {
    return this.connected;
  }

  /** Disconnect */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('IPC client disconnected'));
      this.pendingRequests.delete(id);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('[ipc-client] Attempting reconnect...');
      void this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, 2000);
  }
}

export function getSocketPath(): string {
  return IPC_SOCKET_PATH;
}
