import net from 'net';
import { EventEmitter } from 'events';
import type { NetworkMessage } from './protocol.js';
import { serializeMessage, parseMessages } from './protocol.js';

export interface PeerConnection {
  botId: string | null;   // null until HELLO received
  socket: net.Socket;
  host: string;
  port: number;
  buffer: Buffer;
  outbound: boolean;     // true if we initiated the connection
  connectedAt: number;
  lastActivity: number;
}

export class Transport extends EventEmitter {
  private server: net.Server | null = null;
  private connections = new Map<string, PeerConnection>(); // key = host:port or botId
  private listenPort: number;

  constructor(port: number) {
    super();
    this.listenPort = port;
  }

  /** Start listening for incoming P2P connections */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleIncoming(socket);
      });

      this.server.on('error', (err) => {
        console.error(`[transport] Server error:`, err.message);
        reject(err);
      });

      this.server.listen(this.listenPort, '0.0.0.0', () => {
        console.log(`[transport] P2P server listening on port ${this.listenPort}`);
        resolve();
      });
    });
  }

  /** Stop the transport layer */
  stop(): void {
    for (const conn of this.connections.values()) {
      conn.socket.destroy();
    }
    this.connections.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /** Connect to a peer */
  connect(host: string, port: number): Promise<PeerConnection> {
    const key = `${host}:${port}`;
    const existing = this.connections.get(key);
    if (existing && !existing.socket.destroyed) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        const conn = this.createConnection(socket, host, port, true);
        this.connections.set(key, conn);
        console.log(`[transport] Connected to ${key}`);
        this.emit('connected', conn);
        resolve(conn);
      });

      socket.on('error', (err) => {
        console.error(`[transport] Connection error to ${key}:`, err.message);
        reject(err);
      });

      socket.setTimeout(10_000, () => {
        socket.destroy(new Error('Connection timeout'));
      });
    });
  }

  /** Send a message to a specific peer */
  send(peerKey: string, msg: NetworkMessage): boolean {
    const conn = this.connections.get(peerKey) ?? this.findByBotId(peerKey);
    if (!conn || conn.socket.destroyed) return false;

    try {
      conn.socket.write(serializeMessage(msg));
      conn.lastActivity = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  /** Broadcast a message to all connected peers */
  broadcastToAll(msg: NetworkMessage): number {
    const data = serializeMessage(msg);
    let sent = 0;
    for (const conn of this.connections.values()) {
      if (!conn.socket.destroyed) {
        try {
          conn.socket.write(data);
          conn.lastActivity = Date.now();
          sent++;
        } catch { /* skip failed */ }
      }
    }
    return sent;
  }

  /** Disconnect from a peer */
  disconnect(peerKey: string): void {
    const conn = this.connections.get(peerKey) ?? this.findByBotId(peerKey);
    if (conn) {
      conn.socket.destroy();
      // Remove from connections
      for (const [key, c] of this.connections) {
        if (c === conn) {
          this.connections.delete(key);
          break;
        }
      }
    }
  }

  /** Get all active connections */
  getConnections(): PeerConnection[] {
    return Array.from(this.connections.values()).filter(c => !c.socket.destroyed);
  }

  /** Get connection count */
  getConnectionCount(): number {
    return this.getConnections().length;
  }

  /** Associate a botId with a connection */
  associateBotId(hostPort: string, botId: string): void {
    const conn = this.connections.get(hostPort);
    if (conn) {
      conn.botId = botId;
      this.connections.set(botId, conn);
    }
  }

  /** Get the listen port */
  getPort(): number {
    return this.listenPort;
  }

  // --- Private ---

  private handleIncoming(socket: net.Socket): void {
    const host = socket.remoteAddress || 'unknown';
    const port = socket.remotePort || 0;
    const key = `${host}:${port}`;

    const conn = this.createConnection(socket, host, port, false);
    this.connections.set(key, conn);

    console.log(`[transport] Incoming connection from ${key}`);
    this.emit('incoming', conn);
  }

  private createConnection(socket: net.Socket, host: string, port: number, outbound: boolean): PeerConnection {
    const conn: PeerConnection = {
      botId: null,
      socket,
      host,
      port,
      buffer: Buffer.alloc(0),
      outbound,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    };

    socket.on('data', (chunk: Buffer) => {
      conn.buffer = Buffer.concat([conn.buffer, chunk]);
      conn.lastActivity = Date.now();

      try {
        const { messages, remaining } = parseMessages(conn.buffer);
        conn.buffer = remaining;

        for (const msg of messages) {
          this.emit('message', msg, conn);
        }
      } catch (err) {
        console.error(`[transport] Parse error from ${host}:${port}:`, (err as Error).message);
        socket.destroy();
      }
    });

    socket.on('close', () => {
      console.log(`[transport] Disconnected: ${conn.botId || `${host}:${port}`}`);
      // Clean up all references
      for (const [key, c] of this.connections) {
        if (c === conn) this.connections.delete(key);
      }
      this.emit('disconnected', conn);
    });

    socket.on('error', (err) => {
      console.error(`[transport] Socket error ${host}:${port}:`, err.message);
    });

    // Disable timeout after connected
    socket.setTimeout(0);

    return conn;
  }

  private findByBotId(botId: string): PeerConnection | undefined {
    for (const conn of this.connections.values()) {
      if (conn.botId === botId) return conn;
    }
    return undefined;
  }
}
