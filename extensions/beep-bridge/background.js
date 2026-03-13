/**
 * background.js — BeepBot Bridge Extension (MV3 Service Worker)
 *
 * Maintains a WebSocket connection to the BeepBot server and routes
 * commands between the server and content scripts running in pages.
 *
 * Tab-level operations (navigate, new_tab, close_tab, switch_tab, list_tabs)
 * are handled directly via chrome.tabs APIs.
 *
 * Page-level operations (read, click, type, scroll) are forwarded to
 * content.js via chrome.tabs.sendMessage().
 */

const DAEMON_URL = "ws://localhost:3004/ws/browser-bridge";

let ws = null;
let reconnectDelay = 1000;
let reconnectTimer = null;

// ─── WebSocket Connection ────────────────────────────────────────

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    ws = new WebSocket(DAEMON_URL);
  } catch (err) {
    console.log("[BeepBot Bridge] WebSocket constructor failed:", err.message);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log("[BeepBot Bridge] Connected to BeepBot server");
    reconnectDelay = 1000;

    // Send initial state with all open tabs
    chrome.tabs.query({}, (tabs) => {
      send({ event: "connected", tabs: tabs.map(simplifyTab) });
    });
  };

  ws.onmessage = async (event) => {
    let cmd;
    try {
      cmd = JSON.parse(event.data);
    } catch {
      console.warn("[BeepBot Bridge] Invalid JSON from server:", event.data);
      return;
    }

    // Ping/pong keepalive — respond immediately
    if (cmd.action === "ping") {
      send({ id: cmd.id, pong: true });
      return;
    }

    try {
      const result = await handleCommand(cmd);
      send({ id: cmd.id, result });
    } catch (err) {
      send({ id: cmd.id, error: err.message || String(err) });
    }
  };

  ws.onclose = () => {
    console.log("[BeepBot Bridge] Disconnected from server");
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.log("[BeepBot Bridge] WebSocket error:", err.message || "unknown");
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 10000);
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ─── Command Routing ─────────────────────────────────────────────

async function handleCommand(cmd) {
  switch (cmd.action) {
    case "navigate": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error("No active tab");

      if (cmd.newTab) {
        const newTab = await chrome.tabs.create({ url: cmd.url });
        return { tabId: newTab.id, url: cmd.url };
      }
      await chrome.tabs.update(tab.id, { url: cmd.url });
      return { tabId: tab.id, url: cmd.url };
    }

    case "read":
    case "click":
    case "type":
    case "scroll": {
      // Forward to content script in the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error("No active tab");

      if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:"))) {
        throw new Error(`Cannot interact with browser internal page: ${tab.url}`);
      }

      const response = await chrome.tabs.sendMessage(tab.id, cmd);
      if (response && response.error) {
        throw new Error(response.error);
      }
      return response;
    }

    case "new_tab": {
      const tab = await chrome.tabs.create({ url: cmd.url || "about:blank" });
      return { tabId: tab.id, url: tab.url };
    }

    case "close_tab": {
      await chrome.tabs.remove(cmd.tabId);
      return { closed: true };
    }

    case "switch_tab": {
      await chrome.tabs.update(cmd.tabId, { active: true });
      return { switched: true };
    }

    case "list_tabs": {
      const tabs = await chrome.tabs.query({});
      return { tabs: tabs.map(simplifyTab) };
    }

    case "get_url": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab ? { url: tab.url, title: tab.title, tabId: tab.id } : { url: "", title: "" };
    }

    default:
      throw new Error(`Unknown action: ${cmd.action}`);
  }
}

// ─── Tab Event Listeners ─────────────────────────────────────────

chrome.tabs.onCreated.addListener((tab) => {
  send({ event: "tab_created", ...simplifyTab(tab) });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  send({ event: "tab_removed", tabId });
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    send({ event: "tab_switched", ...simplifyTab(tab) });
  } catch {
    // Tab may have been removed between activation and get
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    send({ event: "tab_loading", tabId, url: tab.url });
  } else if (changeInfo.status === "complete") {
    send({ event: "tab_complete", tabId, url: tab.url, title: tab.title });
  }
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) {
    chrome.tabs.get(details.tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      send({ event: "navigated", ...simplifyTab(tab) });
    });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────

function simplifyTab(tab) {
  return {
    id: tab.id,
    url: tab.url || "",
    title: tab.title || "",
    active: tab.active || false,
  };
}

// ─── Start ───────────────────────────────────────────────────────

connect();
