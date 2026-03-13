const API_BASE = 'http://127.0.0.1:3004/api';
const WS_URL = 'ws://127.0.0.1:3004/ws';

export async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  return res.json();
}

export type WsMessage = {
  type: string;
  [key: string]: unknown;
};

// Singleton WebSocket connection with proper cleanup
let globalWs: WebSocket | null = null;
let globalOnMessage: ((msg: WsMessage) => void) | null = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

export function disconnectWs(): void {
  if (globalWs) {
    console.log('[hill-debug] 🔌 Disconnecting WebSocket');
    globalWs.close();
    globalWs = null;
    globalOnMessage = null;
    connectionAttempts = 0;
  }
}

export function connectWs(onMessage: (msg: WsMessage) => void): WebSocket {
  // Prevent multiple connection attempts
  if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
    console.log('[hill-debug] ⚠️ Max connection attempts reached, not retrying');
    return { close: () => {} } as WebSocket; // Return dummy WebSocket
  }

  // If already connected and working, just update message handler
  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    console.log('[hill-debug] ♻️ WebSocket already connected, updating message handler');
    globalOnMessage = onMessage;
    return globalWs;
  }
  
  // If connection exists but not open, clean it up first
  if (globalWs && globalWs.readyState !== WebSocket.OPEN) {
    console.log('[hill-debug] 🧹 Cleaning up previous WebSocket connection (state: ' + globalWs.readyState + ')');
    globalWs.close();
    globalWs = null;
  }
  
  globalOnMessage = onMessage;
  connectionAttempts++;
  console.log(`[hill-debug] 🔄 Creating new WebSocket connection to: ${WS_URL} (attempt ${connectionAttempts})`);
  
  try {
    globalWs = new WebSocket(WS_URL);
    
    globalWs.onopen = () => {
      console.log('[hill-debug] ✅ WebSocket connected successfully!');
      connectionAttempts = 0; // Reset on successful connection
    };
    
    globalWs.onmessage = (e) => {
      if (!globalOnMessage) return;
      
      try {
        const msg = JSON.parse(e.data);
        console.log('[hill-debug] 📨 WebSocket event:', msg.type);
        
        if (msg.type === 'hill_chat') {
          console.log('[hill-debug] 🗨️ Hill chat message received:', msg.data?.content?.slice(0, 50) + '...');
        }
        
        globalOnMessage(msg);
      } catch (err) {
        console.error('[hill-debug] ❌ Failed to parse WebSocket message:', e.data, err);
      }
    };
    
    globalWs.onerror = (err) => {
      console.error('[hill-debug] ❌ WebSocket error:', err);
    };
    
    globalWs.onclose = (event) => {
      console.log('[hill-debug] 🔌 WebSocket closed:', event.code, event.reason);
      globalWs = null;
      
      // Only auto-reconnect if under max attempts and not a normal close
      if (connectionAttempts < MAX_CONNECTION_ATTEMPTS && event.code !== 1000 && globalOnMessage) {
        setTimeout(() => {
          console.log('[hill-debug] 🔄 Attempting WebSocket reconnection...');
          connectWs(globalOnMessage!);
        }, 3000);
      } else {
        console.log('[hill-debug] 🛑 Not reconnecting (attempts: ' + connectionAttempts + ', code: ' + event.code + ')');
        connectionAttempts = 0;
      }
    };
    
    return globalWs;
  } catch (error) {
    console.error('[hill-debug] ❌ Failed to create WebSocket:', error);
    connectionAttempts = 0;
    return { close: () => {} } as WebSocket; // Return dummy WebSocket
  }
}
