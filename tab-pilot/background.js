/**
 * TabPilot Service Worker
 * Manages target tab connections, tab enumeration, action execution routing,
 * and state persistence across AI web tabs and target tabs.
 */

const DEFAULT_SETTINGS = {
  stepDelay: 600,
  autoHighlight: false,
  compactSnapshot: true,
  autoRun: false,
};

let currentTargetTabId = null;
let actionLog = [];
const MAX_LOG_ENTRIES = 60;

// Initialize state from storage
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(["targetTabId", "settings"]);
  if (stored.settings) {
    // Keep existing settings
  } else {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  if (stored.targetTabId) {
    try {
      const tab = await chrome.tabs.get(stored.targetTabId);
      if (tab) {
        currentTargetTabId = tab.id;
        updateBadge(true);
      }
    } catch {
      await chrome.storage.local.set({ targetTabId: null });
      currentTargetTabId = null;
    }
  }
});

// Update extension icon badge
function updateBadge(connected) {
  if (connected && currentTargetTabId !== null) {
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// Push to in-memory log
function logAction(entry) {
  const item = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  actionLog.unshift(item);
  if (actionLog.length > MAX_LOG_ENTRIES) {
    actionLog.pop();
  }
}

// Clean target tab if closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTargetTabId) {
    currentTargetTabId = null;
    chrome.storage.local.set({ targetTabId: null });
    updateBadge(false);
    logAction({ action: "target_closed", success: true, message: "Target tab was closed" });
  }
});

// Helper: ensure target agent content script is injected
async function ensureAgentInjected(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "TABPILOT_PING" });
    if (response && response.status === "pong") {
      return true;
    }
  } catch {
    // Content script not ready; attempt dynamic injection
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["target-agent.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["target-agent.css"],
    });
    return true;
  } catch (err) {
    console.error("Failed to inject target agent into tab", tabId, err);
    return false;
  }
}

// Wait for tab navigation to complete
function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let timer = null;

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve({ success: true });
      }
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    };

    timer = setTimeout(() => {
      cleanup();
      resolve({ success: false, error: "Navigation timed out" });
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Delay helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Message routing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    switch (message.type) {
      case "GET_STATE": {
        let tabInfo = null;
        if (currentTargetTabId !== null) {
          try {
            tabInfo = await chrome.tabs.get(currentTargetTabId);
          } catch {
            currentTargetTabId = null;
            await chrome.storage.local.set({ targetTabId: null });
            updateBadge(false);
          }
        }
        const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get("settings");
        return {
          targetTabId: currentTargetTabId,
          targetTabInfo: tabInfo
            ? { id: tabInfo.id, title: tabInfo.title, url: tabInfo.url, favIconUrl: tabInfo.favIconUrl }
            : null,
          settings,
          actionLog,
        };
      }

      case "LIST_TABS": {
        const tabs = await chrome.tabs.query({});
        return {
          tabs: tabs
            .filter((t) => t.id && !t.url.startsWith("chrome://") && !t.url.startsWith("edge://"))
            .map((t) => ({
              id: t.id,
              title: t.title || "Untitled",
              url: t.url || "",
              favIconUrl: t.favIconUrl || "",
              active: t.active,
              isTarget: t.id === currentTargetTabId,
            })),
        };
      }

      case "SET_TARGET_TAB": {
        const { tabId } = message;
        if (!tabId) {
          currentTargetTabId = null;
          await chrome.storage.local.set({ targetTabId: null });
          updateBadge(false);
          return { success: true, targetTabId: null };
        }

        try {
          const tab = await chrome.tabs.get(tabId);
          currentTargetTabId = tab.id;
          await chrome.storage.local.set({ targetTabId: tab.id });
          updateBadge(true);
          await ensureAgentInjected(tab.id);
          logAction({
            action: "set_target",
            success: true,
            message: `Selected tab: ${tab.title || tab.url}`,
          });
          return {
            success: true,
            tab: { id: tab.id, title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl },
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case "GET_SNAPSHOT": {
        if (!currentTargetTabId) {
          return { success: false, error: "No target tab is connected" };
        }

        await ensureAgentInjected(currentTargetTabId);
        try {
          const snapshot = await chrome.tabs.sendMessage(currentTargetTabId, {
            type: "TABPILOT_GET_SNAPSHOT",
            options: message.options || {},
          });
          return { success: true, snapshot };
        } catch (err) {
          return { success: false, error: `Failed to read target tab: ${err.message}` };
        }
      }

      case "TOGGLE_OVERLAYS": {
        if (!currentTargetTabId) {
          return { success: false, error: "No target tab connected" };
        }
        await ensureAgentInjected(currentTargetTabId);
        try {
          const res = await chrome.tabs.sendMessage(currentTargetTabId, {
            type: "TABPILOT_TOGGLE_OVERLAYS",
            show: message.show,
          });
          return { success: true, ...res };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case "EXECUTE_SINGLE_ACTION": {
        if (!currentTargetTabId) {
          return { success: false, error: "No target tab connected" };
        }
        const result = await executeAction(message.action, currentTargetTabId);
        logAction({
          action: message.action.type || "unknown",
          success: result.success,
          message: result.message || result.error,
        });
        return result;
      }

      case "EXECUTE_BATCH_ACTIONS": {
        if (!currentTargetTabId) {
          return { success: false, error: "No target tab connected" };
        }

        const actions = Array.isArray(message.actions) ? message.actions : [];
        if (actions.length === 0) {
          return { success: false, error: "No actions supplied in batch" };
        }

        const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get("settings");
        const delay = message.delay ?? settings.stepDelay ?? 600;
        const results = [];
        let anyFailed = false;

        for (let i = 0; i < actions.length; i++) {
          const act = actions[i];
          const res = await executeAction(act, currentTargetTabId);
          results.push({ index: i, action: act, result: res });
          logAction({
            action: act.type,
            success: res.success,
            message: res.message || res.error,
          });

          if (!res.success && !message.continueOnError) {
            anyFailed = true;
            break;
          }

          if (i < actions.length - 1 && delay > 0) {
            await sleep(delay);
          }
        }

        // Optional post-batch snapshot
        let postSnapshot = null;
        if (message.returnSnapshot) {
          try {
            await ensureAgentInjected(currentTargetTabId);
            postSnapshot = await chrome.tabs.sendMessage(currentTargetTabId, {
              type: "TABPILOT_GET_SNAPSHOT",
              options: { compact: settings.compactSnapshot },
            });
          } catch {
            // Non-fatal if snapshot fails
          }
        }

        return {
          success: !anyFailed,
          completedCount: results.length,
          totalCount: actions.length,
          results,
          postSnapshot,
        };
      }

      case "CAPTURE_SCREENSHOT": {
        if (!currentTargetTabId) {
          return { success: false, error: "No target tab connected" };
        }
        try {
          const tab = await chrome.tabs.get(currentTargetTabId);
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
          return { success: true, dataUrl };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case "SAVE_SETTINGS": {
        const { settings } = message;
        await chrome.storage.local.set({ settings });
        return { success: true, settings };
      }

      case "CLEAR_LOGS": {
        actionLog = [];
        return { success: true };
      }

      default:
        return { success: false, error: `Unknown message type: ${message.type}` };
    }
  };

  handler().then(sendResponse).catch((err) => {
    sendResponse({ success: false, error: err.message });
  });

  return true; // Keep channel open for async response
});

// Low-level action executor on target tab
async function executeAction(action, tabId) {
  if (!action || typeof action !== "object") {
    return { success: false, error: "Action must be an object" };
  }

  const type = String(action.type || action.action || "").toLowerCase();

  // Background-handled actions
  if (type === "navigate" || type === "goto" || type === "open") {
    const url = action.url;
    if (!url) return { success: false, error: "Missing url for navigate action" };
    try {
      await chrome.tabs.update(tabId, { url });
      const loadRes = await waitForTabLoad(tabId, action.timeout || 15000);
      if (!loadRes.success) {
        return { success: false, error: loadRes.error };
      }
      await sleep(400); // Allow render
      return { success: true, message: `Navigated to ${url}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (type === "reload") {
    try {
      await chrome.tabs.reload(tabId);
      await waitForTabLoad(tabId);
      return { success: true, message: "Target tab reloaded" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (type === "screenshot") {
    try {
      const tab = await chrome.tabs.get(tabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      return { success: true, message: "Captured screenshot", dataUrl };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (type === "wait") {
    const ms = action.ms || action.timeout || action.duration || 1000;
    await sleep(ms);
    return { success: true, message: `Waited for ${ms}ms` };
  }

  // Content script handled actions
  await ensureAgentInjected(tabId);
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      type: "TABPILOT_EXECUTE_ACTION",
      action: { ...action, type },
    });
    return res;
  } catch (err) {
    return { success: false, error: `Content script action failed: ${err.message}` };
  }
}
