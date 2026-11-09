/**
 * TabPilot Popup Controller
 * Manages tab selection, manual action testing, inspector queries, prompt templates,
 * and user settings.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // DOM Elements
  const navBtns = document.querySelectorAll(".nav-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  const statusDot = document.getElementById("status-dot");
  const statusName = document.getElementById("status-name");
  const targetTitle = document.getElementById("target-title");
  const targetUrl = document.getElementById("target-url");

  const btnRefreshTarget = document.getElementById("btn-refresh-target");
  const btnToggleBadges = document.getElementById("btn-toggle-badges");
  const btnScreenshot = document.getElementById("btn-screenshot");
  const btnRefreshTabs = document.getElementById("btn-refresh-tabs");
  const tabSearch = document.getElementById("tab-search");
  const tabsList = document.getElementById("tabs-list");

  // Runner elements
  const runnerActionType = document.getElementById("runner-action-type");
  const runnerDynamicFields = document.getElementById("runner-dynamic-fields");
  const btnExecuteManual = document.getElementById("btn-execute-manual");
  const runnerFeedback = document.getElementById("runner-feedback");
  const btnInspectElements = document.getElementById("btn-inspect-elements");
  const inspectorBox = document.getElementById("inspector-box");

  // Prompt elements
  const promptTemplateText = document.getElementById("prompt-template-text");
  const btnCopyPrompt = document.getElementById("btn-copy-prompt");
  const btnCopySnapshot = document.getElementById("btn-copy-snapshot");

  // Settings elements
  const settingDelay = document.getElementById("setting-delay");
  const settingCompact = document.getElementById("setting-compact");
  const settingHighlight = document.getElementById("setting-highlight");
  const btnSaveSettings = document.getElementById("btn-save-settings");
  const btnClearLogs = document.getElementById("btn-clear-logs");
  const logsContainer = document.getElementById("logs-container");

  let allTabs = [];
  let currentTargetTab = null;

  const PROMPT_TEMPLATE = `You are a browser automation pilot with direct control over a browser tab.
Examine the Target Tab State and Interactive Elements provided below.
When you want to interact with the tab, provide your planned steps in a JSON code block:

\`\`\`json
{
  "thought": "Reasoning for the next actions",
  "actions": [
    {"type": "click", "ref": 1},
    {"type": "type", "ref": 2, "text": "value to enter", "clear": true, "enter": true},
    {"type": "scroll", "direction": "down", "amount": 400},
    {"type": "wait", "timeout": 1500}
  ]
}
\`\`\`

Available actions:
- click: {"type": "click", "ref": <number>, "selector": "<css>", "text": "<string>"}
- type: {"type": "type", "ref": <number>, "text": "<string>", "clear": true/false, "enter": true/false}
- scroll: {"type": "scroll", "direction": "down"|"up"|"top"|"bottom", "amount": <pixels>}
- select: {"type": "select", "ref": <number>, "value": "<val>"}
- check / uncheck: {"type": "check"|"uncheck", "ref": <number>}
- wait: {"type": "wait", "timeout": <ms>}
- pressKey: {"type": "pressKey", "key": "Enter"|"Tab"|"Escape"}
- navigate: {"type": "navigate", "url": "<url>"}
- read: {"type": "read", "ref": <number>}
- reload: {"type": "reload"}
`;

  promptTemplateText.value = PROMPT_TEMPLATE;

  // Tab navigation switching
  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.tab;
      navBtns.forEach((b) => b.classList.remove("active"));
      tabPanes.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add("active");
    });
  });

  // Render dynamic action runner fields
  function updateRunnerFields() {
    const act = runnerActionType.value;
    let html = "";

    if (act === "click") {
      html = `
        <div class="form-group">
          <label>Element Ref (#) or Selector</label>
          <input type="text" id="runner-param-ref" placeholder="Ref index (e.g. 1) or CSS selector">
        </div>
        <div class="form-group">
          <label>Optional visible text match</label>
          <input type="text" id="runner-param-text" placeholder="e.g. Submit or Search">
        </div>
      `;
    } else if (act === "type") {
      html = `
        <div class="form-group">
          <label>Element Ref (#) or Selector</label>
          <input type="text" id="runner-param-ref" placeholder="Ref index (e.g. 2) or selector">
        </div>
        <div class="form-group">
          <label>Text to type</label>
          <input type="text" id="runner-param-text" placeholder="Text to enter">
        </div>
        <div style="display:flex; gap:12px; margin-top:4px;">
          <label><input type="checkbox" id="runner-param-clear" checked> Clear first</label>
          <label><input type="checkbox" id="runner-param-enter"> Press Enter</label>
        </div>
      `;
    } else if (act === "scroll") {
      html = `
        <div class="form-group">
          <label>Scroll Direction</label>
          <select id="runner-param-dir">
            <option value="down">Down</option>
            <option value="up">Up</option>
            <option value="top">To Top</option>
            <option value="bottom">To Bottom</option>
          </select>
        </div>
        <div class="form-group">
          <label>Scroll Amount (pixels)</label>
          <input type="number" id="runner-param-amount" value="500">
        </div>
      `;
    } else if (act === "select") {
      html = `
        <div class="form-group">
          <label>Element Ref (#)</label>
          <input type="text" id="runner-param-ref" placeholder="Ref index of <select>">
        </div>
        <div class="form-group">
          <label>Option value or text</label>
          <input type="text" id="runner-param-val" placeholder="Value or text of option">
        </div>
      `;
    } else if (act === "navigate") {
      html = `
        <div class="form-group">
          <label>URL</label>
          <input type="text" id="runner-param-url" placeholder="https://example.com">
        </div>
      `;
    } else if (act === "wait") {
      html = `
        <div class="form-group">
          <label>Duration (milliseconds)</label>
          <input type="number" id="runner-param-ms" value="1500" step="500">
        </div>
      `;
    } else if (act === "read") {
      html = `
        <div class="form-group">
          <label>Element Ref (#) (leave empty to read entire page)</label>
          <input type="text" id="runner-param-ref" placeholder="Ref index or selector">
        </div>
      `;
    }

    runnerDynamicFields.innerHTML = html;
  }

  runnerActionType.addEventListener("change", updateRunnerFields);
  updateRunnerFields();

  // Load state and open tabs
  async function loadState() {
    try {
      const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      if (state && state.targetTabInfo) {
        currentTargetTab = state.targetTabInfo;
        statusDot.classList.add("active");
        statusName.textContent = currentTargetTab.title || "Connected";
        targetTitle.textContent = currentTargetTab.title || "Untitled Tab";
        targetUrl.textContent = currentTargetTab.url || "";
      } else {
        currentTargetTab = null;
        statusDot.classList.remove("active");
        statusName.textContent = "No Target";
        targetTitle.textContent = "No target tab connected";
        targetUrl.textContent = "Choose a browser tab below to begin";
      }

      if (state && state.settings) {
        settingDelay.value = state.settings.stepDelay || 600;
        settingCompact.checked = state.settings.compactSnapshot !== false;
        settingHighlight.checked = Boolean(state.settings.autoHighlight);
      }

      renderLogs(state ? state.actionLog || [] : []);
    } catch (err) {
      console.error("Failed to load TabPilot state", err);
    }
  }

  // Load and render list of open tabs
  async function loadOpenTabs() {
    tabsList.innerHTML = '<div class="empty-state">Scanning open tabs...</div>';
    try {
      const res = await chrome.runtime.sendMessage({ type: "LIST_TABS" });
      allTabs = res.tabs || [];
      renderTabsList(allTabs);
    } catch (err) {
      tabsList.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
    }
  }

  function renderTabsList(tabs) {
    const query = tabSearch.value.toLowerCase().trim();
    const filtered = tabs.filter(
      (t) =>
        t.title.toLowerCase().includes(query) ||
        t.url.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      tabsList.innerHTML = '<div class="empty-state">No matching tabs found.</div>';
      return;
    }

    tabsList.innerHTML = "";
    for (const tab of filtered) {
      const isTarget = currentTargetTab && currentTargetTab.id === tab.id;
      const item = document.createElement("div");
      item.className = `tab-item ${isTarget ? "is-target" : ""}`;

      item.innerHTML = `
        <div class="tab-item-info">
          <div class="tab-item-title">${escapeHtml(tab.title)}</div>
          <div class="tab-item-url">${escapeHtml(tab.url)}</div>
        </div>
        <button class="btn btn-sm ${isTarget ? "btn-secondary" : "btn-primary"}">
          ${isTarget ? "Connected" : "Select"}
        </button>
      `;

      item.addEventListener("click", async () => {
        await selectTargetTab(tab.id);
      });

      tabsList.appendChild(item);
    }
  }

  async function selectTargetTab(tabId) {
    try {
      const res = await chrome.runtime.sendMessage({ type: "SET_TARGET_TAB", tabId });
      if (res.success) {
        await loadState();
        await loadOpenTabs();
      } else {
        alert(`Failed to set target tab: ${res.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }

  tabSearch.addEventListener("input", () => {
    renderTabsList(allTabs);
  });

  btnRefreshTabs.addEventListener("click", loadOpenTabs);
  btnRefreshTarget.addEventListener("click", loadState);

  // Toggle numeric badges on target tab
  btnToggleBadges.addEventListener("click", async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "TOGGLE_OVERLAYS" });
      if (res.success) {
        runnerFeedback.textContent = res.overlays
          ? `Badges shown (${res.count} elements)`
          : "Badges hidden";
      } else {
        runnerFeedback.textContent = `Badges error: ${res.error}`;
      }
    } catch (err) {
      runnerFeedback.textContent = `Error: ${err.message}`;
    }
  });

  // Capture screenshot of target tab
  btnScreenshot.addEventListener("click", async () => {
    runnerFeedback.textContent = "Capturing screenshot...";
    try {
      const res = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
      if (res.success && res.dataUrl) {
        runnerFeedback.textContent = "Screenshot captured. Opening preview...";
        const w = window.open("");
        w.document.write(`<img src="${res.dataUrl}" style="max-width:100%; border:1px solid #ccc;"/>`);
      } else {
        runnerFeedback.textContent = `Screenshot failed: ${res.error}`;
      }
    } catch (err) {
      runnerFeedback.textContent = `Error: ${err.message}`;
    }
  });

  // Execute manual test action
  btnExecuteManual.addEventListener("click", async () => {
    if (!currentTargetTab) {
      runnerFeedback.textContent = "Please select a target tab first.";
      return;
    }

    const type = runnerActionType.value;
    const action = { type };

    if (type === "click") {
      const refVal = document.getElementById("runner-param-ref")?.value.trim();
      const textVal = document.getElementById("runner-param-text")?.value.trim();
      if (/^\d+$/.test(refVal)) action.ref = parseInt(refVal, 10);
      else if (refVal) action.selector = refVal;
      if (textVal) action.text = textVal;
    } else if (type === "type") {
      const refVal = document.getElementById("runner-param-ref")?.value.trim();
      if (/^\d+$/.test(refVal)) action.ref = parseInt(refVal, 10);
      else if (refVal) action.selector = refVal;
      action.text = document.getElementById("runner-param-text")?.value || "";
      action.clear = document.getElementById("runner-param-clear")?.checked;
      action.enter = document.getElementById("runner-param-enter")?.checked;
    } else if (type === "scroll") {
      action.direction = document.getElementById("runner-param-dir")?.value || "down";
      action.amount = parseInt(document.getElementById("runner-param-amount")?.value, 10) || 500;
    } else if (type === "select") {
      const refVal = document.getElementById("runner-param-ref")?.value.trim();
      if (/^\d+$/.test(refVal)) action.ref = parseInt(refVal, 10);
      action.value = document.getElementById("runner-param-val")?.value.trim() || "";
    } else if (type === "navigate") {
      action.url = document.getElementById("runner-param-url")?.value.trim();
    } else if (type === "wait") {
      action.timeout = parseInt(document.getElementById("runner-param-ms")?.value, 10) || 1500;
    } else if (type === "read") {
      const refVal = document.getElementById("runner-param-ref")?.value.trim();
      if (/^\d+$/.test(refVal)) action.ref = parseInt(refVal, 10);
      else if (refVal) action.selector = refVal;
    }

    runnerFeedback.textContent = `Executing ${type}...`;
    try {
      const res = await chrome.runtime.sendMessage({
        type: "EXECUTE_SINGLE_ACTION",
        action,
      });

      if (res.success) {
        runnerFeedback.textContent = `Success: ${res.message || "Action finished"}`;
        if (res.data) {
          inspectorBox.textContent = JSON.stringify(res.data, null, 2);
        }
      } else {
        runnerFeedback.textContent = `Failed: ${res.error}`;
      }
      await loadState();
    } catch (err) {
      runnerFeedback.textContent = `Error: ${err.message}`;
    }
  });

  // Inspect page elements
  btnInspectElements.addEventListener("click", async () => {
    if (!currentTargetTab) {
      inspectorBox.textContent = "No target tab selected.";
      return;
    }

    inspectorBox.textContent = "Scanning interactive elements...";
    try {
      const res = await chrome.runtime.sendMessage({
        type: "GET_SNAPSHOT",
        options: { compact: settingCompact.checked },
      });

      if (res.success && res.snapshot) {
        inspectorBox.textContent = res.snapshot.markdown;
      } else {
        inspectorBox.textContent = `Error: ${res.error}`;
      }
    } catch (err) {
      inspectorBox.textContent = `Error: ${err.message}`;
    }
  });

  // Copy prompt template
  btnCopyPrompt.addEventListener("click", () => {
    navigator.clipboard.writeText(PROMPT_TEMPLATE).then(() => {
      btnCopyPrompt.textContent = "Copied to Clipboard!";
      setTimeout(() => {
        btnCopyPrompt.textContent = "Copy Prompt Template";
      }, 2000);
    });
  });

  // Copy live tab snapshot
  btnCopySnapshot.addEventListener("click", async () => {
    if (!currentTargetTab) {
      alert("No target tab connected.");
      return;
    }

    try {
      const res = await chrome.runtime.sendMessage({
        type: "GET_SNAPSHOT",
        options: { compact: settingCompact.checked },
      });

      if (res.success && res.snapshot) {
        const fullPayload = `[TabPilot Target Tab State]\n${res.snapshot.markdown}`;
        await navigator.clipboard.writeText(fullPayload);
        btnCopySnapshot.textContent = "Snapshot Copied!";
        setTimeout(() => {
          btnCopySnapshot.textContent = "Copy Live Tab Snapshot";
        }, 2000);
      } else {
        alert(`Error: ${res.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  });

  // Save Settings
  btnSaveSettings.addEventListener("click", async () => {
    const settings = {
      stepDelay: parseInt(settingDelay.value, 10) || 600,
      compactSnapshot: settingCompact.checked,
      autoHighlight: settingHighlight.checked,
    };

    try {
      await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
      btnSaveSettings.textContent = "Settings Saved!";
      setTimeout(() => {
        btnSaveSettings.textContent = "Save Settings";
      }, 1800);
    } catch (err) {
      alert(`Failed to save settings: ${err.message}`);
    }
  });

  // Clear Logs
  btnClearLogs.addEventListener("click", async () => {
    try {
      await chrome.runtime.sendMessage({ type: "CLEAR_LOGS" });
      renderLogs([]);
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  });

  // Render Action Logs
  function renderLogs(logs) {
    if (!logs || logs.length === 0) {
      logsContainer.innerHTML = '<div class="empty-state">No actions logged yet.</div>';
      return;
    }

    logsContainer.innerHTML = "";
    for (const entry of logs) {
      const item = document.createElement("div");
      item.className = `log-entry ${entry.success ? "success" : "failure"}`;
      const timeStr = entry.timestamp ? entry.timestamp.split("T")[1]?.slice(0, 8) : "";
      item.textContent = `[${timeStr}] [${entry.action}] ${entry.message || (entry.success ? "ok" : "failed")}`;
      logsContainer.appendChild(item);
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Initial load
  await loadState();
  await loadOpenTabs();
});
