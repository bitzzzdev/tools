/**
 * TabPilot AI Page Bridge
 * Injects a floating HUD onto ChatGPT, Claude, Gemini, Meta AI, and other AI chat pages.
 * Bridges AI chat prompts and responses with the designated target tab.
 */

(function initTabPilotAIBridge() {
  if (window.__tabpilot_hud_loaded) return;
  window.__tabpilot_hud_loaded = true;

  let currentTarget = null;
  let detectedActions = [];
  let isExecuting = false;
  let autoRunEnabled = false;
  let lastProcessedText = "";

  const PROTOCOL_INSTRUCTIONS = `You are operating as a browser automation pilot controlling a real browser tab.
When interacting with the web page, inspect the provided Tab State and Interactive Elements ([#ref]).
Always respond with your planned actions inside a single JSON code block using this exact format:

\`\`\`json
{
  "thought": "Explain your goal and reason for these steps",
  "actions": [
    {"type": "click", "ref": 4},
    {"type": "type", "ref": 2, "text": "search query", "clear": true, "enter": true},
    {"type": "scroll", "direction": "down", "amount": 500},
    {"type": "select", "ref": 6, "value": "option_value"},
    {"type": "wait", "timeout": 1500}
  ]
}
\`\`\`

Available action types:
- click: {"type": "click", "ref": <number>, "selector": "<css>", "text": "<visible text>"}
- type: {"type": "type", "ref": <number>, "text": "<string>", "clear": true/false, "enter": true/false}
- scroll: {"type": "scroll", "direction": "down"|"up"|"top"|"bottom", "amount": <pixels>}
- select: {"type": "select", "ref": <number>, "value": "<val>"}
- check/uncheck: {"type": "check"|"uncheck", "ref": <number>}
- wait: {"type": "wait", "timeout": <ms>}
- pressKey: {"type": "pressKey", "key": "Enter"|"Tab"|"Escape"}
- navigate: {"type": "navigate", "url": "<url>"}
- read: {"type": "read", "ref": <number>, "selector": "<css>"}
- reload: {"type": "reload"}
`;

  // Detect chat input element across different AI platforms
  function findChatInput() {
    const selectors = [
      "#prompt-textarea", // ChatGPT
      "div.ProseMirror[contenteditable='true']", // Claude
      "rich-textarea textarea", // Gemini
      "rich-textarea div[contenteditable='true']", // Gemini rich
      "div.ql-editor[contenteditable='true']", // Quill based
      "div[contenteditable='true'][role='textbox']", // Generic contenteditable
      "textarea[placeholder*='message' i]", // Generic placeholder
      "textarea[placeholder*='ask' i]",
      "textarea[placeholder*='chat' i]",
      "textarea", // Fallback textarea
      "div[contenteditable='true']", // Ultimate fallback
    ];

    for (const sel of selectors) {
      const candidates = document.querySelectorAll(sel);
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return el;
        }
      }
    }
    return null;
  }

  // Insert text into the active AI chat input
  function insertIntoChatInput(text) {
    const input = findChatInput();
    if (!input) {
      alert("Could not locate the chat input box on this page.");
      return false;
    }

    input.focus();

    if (input.isContentEditable) {
      // Modern contenteditable (ProseMirror, Lexical, DraftJS)
      document.execCommand("selectAll", false, null);
      const success = document.execCommand("insertText", false, text);
      if (!success) {
        input.textContent = text;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // Standard textarea / input
      const proto = window.HTMLTextAreaElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(input, text);
      } else {
        input.value = text;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    return true;
  }

  // Extract JSON action blocks from text
  function parseActionsFromText(text) {
    if (!text) return null;

    // Pattern 1: Fenced code block ```json ... ```
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.actions)) return parsed.actions;
      } catch {
        // Fallback to pattern 2
      }
    }

    // Pattern 2: Raw JSON object with "actions" array
    const rawObjectMatch = text.match(/\{[\s\S]*"actions"\s*:\s*\[[\s\S]*?\][\s\S]*\}/);
    if (rawObjectMatch) {
      try {
        const parsed = JSON.parse(rawObjectMatch[0]);
        if (Array.isArray(parsed.actions)) return parsed.actions;
      } catch {
        // Fallback to pattern 3
      }
    }

    // Pattern 3: Raw JSON array of actions
    const rawArrayMatch = text.match(/\[\s*\{[\s\S]*"type"[\s\S]*\}\s*\]/);
    if (rawArrayMatch) {
      try {
        const parsed = JSON.parse(rawArrayMatch[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Ignore
      }
    }

    return null;
  }

  // Find the latest message element in the chat thread
  function findLatestAIMessage() {
    // Selectors for AI responses across platforms
    const candidates = document.querySelectorAll(
      "[data-message-author-role='assistant'], " + // ChatGPT
      ".font-claude-message, [data-is-streaming], div.font-user ~ div, " + // Claude
      "model-response, .model-response-text, " + // Gemini
      "[role='article'], .chat-message" // Generic
    );

    if (candidates.length === 0) return null;
    return candidates[candidates.length - 1];
  }

  // Build Floating HUD DOM
  function createHUD() {
    const existing = document.getElementById("tabpilot-hud");
    if (existing) existing.remove();

    const hud = document.createElement("div");
    hud.id = "tabpilot-hud";
    hud.innerHTML = `
      <div class="tabpilot-hud-header" id="tabpilot-hud-drag">
        <div class="tabpilot-title-group">
          <span class="tabpilot-status-dot" id="tabpilot-hud-status"></span>
          <span>TabPilot</span>
        </div>
        <div class="tabpilot-header-actions">
          <button class="tabpilot-icon-btn" id="tabpilot-hud-min" title="Minimize / Expand">_</button>
        </div>
      </div>
      <div class="tabpilot-hud-body">
        <div class="tabpilot-target-banner">
          <div class="tabpilot-target-label">Target Browser Tab</div>
          <div class="tabpilot-target-title" id="tabpilot-target-name">No tab connected</div>
          <div class="tabpilot-target-url" id="tabpilot-target-url">Open popup to connect a tab</div>
        </div>

        <button class="tabpilot-btn primary" id="tabpilot-btn-snap">Insert Tab State into Chat</button>

        <div class="tabpilot-button-grid">
          <button class="tabpilot-btn" id="tabpilot-btn-rules">Insert Guide</button>
          <button class="tabpilot-btn" id="tabpilot-btn-overlays">Toggle Badges</button>
        </div>

        <div class="tabpilot-detected-section">
          <div class="tabpilot-detected-header">
            <span>Detected AI Actions</span>
            <button class="tabpilot-icon-btn" id="tabpilot-btn-scan" title="Scan latest message">Scan</button>
          </div>
          <div class="tabpilot-actions-list" id="tabpilot-actions-preview">No actions detected yet. Ask AI for actions.</div>
          <button class="tabpilot-btn" id="tabpilot-btn-run" disabled>Run Actions on Target</button>
          <button class="tabpilot-btn" id="tabpilot-btn-return" disabled>Send Result Back to Chat</button>

          <div class="tabpilot-switch-row">
            <label for="tabpilot-autorun-chk">Auto-run AI actions</label>
            <input type="checkbox" id="tabpilot-autorun-chk">
          </div>
        </div>

        <div class="tabpilot-status-text" id="tabpilot-hud-feedback">Ready</div>
      </div>
    `;

    document.body.appendChild(hud);
    bindHUDEvents(hud);
    refreshState();
  }

  // Bind interactions and drag capability to HUD
  function bindHUDEvents(hud) {
    const dragHeader = hud.querySelector("#tabpilot-hud-drag");
    const minBtn = hud.querySelector("#tabpilot-hud-min");
    const snapBtn = hud.querySelector("#tabpilot-btn-snap");
    const rulesBtn = hud.querySelector("#tabpilot-btn-rules");
    const overlaysBtn = hud.querySelector("#tabpilot-btn-overlays");
    const scanBtn = hud.querySelector("#tabpilot-btn-scan");
    const runBtn = hud.querySelector("#tabpilot-btn-run");
    const returnBtn = hud.querySelector("#tabpilot-btn-return");
    const autoRunChk = hud.querySelector("#tabpilot-autorun-chk");
    const feedback = hud.querySelector("#tabpilot-hud-feedback");

    // Minimize toggle
    minBtn.addEventListener("click", () => {
      hud.classList.toggle("minimized");
      minBtn.textContent = hud.classList.contains("minimized") ? "+" : "_";
    });

    // Dragging
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialRight = 24;
    let initialBottom = 24;

    dragHeader.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = hud.getBoundingClientRect();
      initialRight = window.innerWidth - rect.right;
      initialBottom = window.innerHeight - rect.bottom;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = startX - e.clientX;
      const dy = startY - e.clientY;
      hud.style.right = `${Math.max(10, initialRight + dx)}px`;
      hud.style.bottom = `${Math.max(10, initialBottom + dy)}px`;
    });

    window.addEventListener("mouseup", () => {
      isDragging = false;
    });

    // Auto-run checkbox
    autoRunChk.addEventListener("change", (e) => {
      autoRunEnabled = e.target.checked;
      feedback.textContent = autoRunEnabled ? "Auto-execution active" : "Auto-execution disabled";
    });

    // Snap target tab state into chat prompt
    snapBtn.addEventListener("click", async () => {
      feedback.textContent = "Capturing target tab state...";
      snapBtn.disabled = true;

      try {
        const res = await chrome.runtime.sendMessage({
          type: "GET_SNAPSHOT",
          options: { compact: true },
        });

        if (!res.success) {
          feedback.textContent = `Error: ${res.error}`;
          return;
        }

        const promptText = `[TabPilot Target Tab State]\n${res.snapshot.markdown}\n\n[Task]\nPlease analyze the page above and provide the next step or list of actions in JSON format.`;
        const inserted = insertIntoChatInput(promptText);
        if (inserted) {
          feedback.textContent = "Inserted tab state into chat prompt";
        }
      } catch (err) {
        feedback.textContent = `Snap failed: ${err.message}`;
      } finally {
        snapBtn.disabled = false;
      }
    });

    // Insert protocol instructions
    rulesBtn.addEventListener("click", () => {
      const inserted = insertIntoChatInput(PROTOCOL_INSTRUCTIONS);
      if (inserted) {
        feedback.textContent = "Inserted TabPilot instructions into chat";
      }
    });

    // Toggle numeric badge overlays on target tab
    overlaysBtn.addEventListener("click", async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: "TOGGLE_OVERLAYS" });
        if (res.success) {
          feedback.textContent = res.overlays ? `Badges on (${res.count} elements)` : "Badges hidden";
        }
      } catch (err) {
        feedback.textContent = `Badges toggle failed: ${err.message}`;
      }
    });

    // Scan latest message
    scanBtn.addEventListener("click", () => {
      scanAIMessage();
    });

    // Run actions
    runBtn.addEventListener("click", async () => {
      if (detectedActions.length === 0 || isExecuting) return;
      await executeDetectedActions();
    });

    // Send result back to chat
    returnBtn.addEventListener("click", () => {
      const report = returnBtn.dataset.report;
      if (report) {
        insertIntoChatInput(report);
        feedback.textContent = "Pasted execution report into chat";
      }
    });
  }

  // Update HUD with background state
  async function refreshState() {
    try {
      const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      const statusDot = document.getElementById("tabpilot-hud-status");
      const targetName = document.getElementById("tabpilot-target-name");
      const targetUrl = document.getElementById("tabpilot-target-url");
      const snapBtn = document.getElementById("tabpilot-btn-snap");

      if (state && state.targetTabInfo) {
        currentTarget = state.targetTabInfo;
        if (statusDot) statusDot.classList.add("active");
        if (targetName) targetName.textContent = currentTarget.title || "Untitled Tab";
        if (targetUrl) targetUrl.textContent = currentTarget.url || "";
        if (snapBtn) snapBtn.disabled = false;
      } else {
        currentTarget = null;
        if (statusDot) statusDot.classList.remove("active");
        if (targetName) targetName.textContent = "No target tab connected";
        if (targetUrl) targetUrl.textContent = "Select a tab from TabPilot popup";
        if (snapBtn) snapBtn.disabled = true;
      }
    } catch {
      // Background worker might be idle
    }
  }

  // Scan AI chat for actionable commands
  function scanAIMessage() {
    const preview = document.getElementById("tabpilot-actions-preview");
    const runBtn = document.getElementById("tabpilot-btn-run");
    const feedback = document.getElementById("tabpilot-hud-feedback");

    const latest = findLatestAIMessage();
    if (!latest) {
      if (feedback) feedback.textContent = "No AI message found in chat";
      return;
    }

    const text = latest.innerText || latest.textContent || "";
    if (text === lastProcessedText && detectedActions.length > 0) {
      return; // Already processed
    }

    const actions = parseActionsFromText(text);
    if (actions && actions.length > 0) {
      detectedActions = actions;
      lastProcessedText = text;

      const summary = actions
        .map((a, i) => `${i + 1}. [${a.type || a.action}] ${a.ref ? `#${a.ref}` : ""} ${a.text ? `"${a.text}"` : ""} ${a.selector || ""}`)
        .join("\n");

      if (preview) preview.textContent = summary;
      if (runBtn) runBtn.disabled = false;
      if (feedback) feedback.textContent = `Found ${actions.length} action(s)`;

      if (autoRunEnabled && !isExecuting) {
        executeDetectedActions();
      }
    } else {
      if (feedback) feedback.textContent = "No valid action blocks found";
    }
  }

  // Execute detected actions on target tab
  async function executeDetectedActions() {
    if (detectedActions.length === 0) return;

    isExecuting = true;
    const runBtn = document.getElementById("tabpilot-btn-run");
    const returnBtn = document.getElementById("tabpilot-btn-return");
    const feedback = document.getElementById("tabpilot-hud-feedback");

    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = "Executing...";
    }
    if (feedback) feedback.textContent = `Running ${detectedActions.length} action(s)...`;

    try {
      const res = await chrome.runtime.sendMessage({
        type: "EXECUTE_BATCH_ACTIONS",
        actions: detectedActions,
        returnSnapshot: true,
      });

      if (!res.success) {
        if (feedback) feedback.textContent = `Execution failed: ${res.results?.[res.results.length - 1]?.result?.error || "Unknown error"}`;
      } else {
        if (feedback) feedback.textContent = `Completed ${res.completedCount}/${res.totalCount} action(s) successfully`;
      }

      // Prepare feedback report
      const reportLines = [
        `[TabPilot Execution Report]`,
        `Status: ${res.success ? "SUCCESS" : "PARTIAL / FAILED"}`,
        `Completed: ${res.completedCount} of ${res.totalCount} actions`,
        "",
        "Action Details:",
      ];

      for (const r of res.results || []) {
        const desc = r.result.message || r.result.error || "done";
        reportLines.push(`- Step ${r.index + 1} [${r.action.type}]: ${desc}`);
      }

      if (res.postSnapshot && res.postSnapshot.markdown) {
        reportLines.push("\n[Updated Target Tab State]");
        reportLines.push(res.postSnapshot.markdown);
      }

      reportLines.push("\nWhat is the next step?");
      const reportStr = reportLines.join("\n");

      if (returnBtn) {
        returnBtn.dataset.report = reportStr;
        returnBtn.disabled = false;
      }
    } catch (err) {
      if (feedback) feedback.textContent = `Execution error: ${err.message}`;
    } finally {
      isExecuting = false;
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = "Run Actions on Target";
      }
    }
  }

  // Observe chat DOM mutations to detect AI completion
  function setupChatObserver() {
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        scanAIMessage();
      }, 900);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Periodic state check
  setInterval(refreshState, 3500);

  // Initialize
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      createHUD();
      setupChatObserver();
    });
  } else {
    createHUD();
    setupChatObserver();
  }
})();
