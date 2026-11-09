/**
 * TabPilot Target Agent
 * Runs in target tabs to inspect DOM, generate structured accessibility snapshots,
 * display visual badges, and execute high-fidelity simulated browser actions.
 */

(function initTabPilotTargetAgent() {
  if (window.__tabpilot_target_agent_loaded) return;
  window.__tabpilot_target_agent_loaded = true;

  // Active ref registry for the current snapshot
  const refMap = new Map();
  let overlaysContainer = null;
  let overlaysVisible = false;

  // Check if an element is visible to a human user
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return false;
    return true;
  }

  // Get trimmed text of an element (excluding script/style)
  function getCleanText(el, maxLen = 80) {
    if (!el) return "";
    let text = el.innerText || el.textContent || "";
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > maxLen) {
      text = text.slice(0, maxLen) + "...";
    }
    return text;
  }

  // Generate a clean CSS selector for fallback
  function getSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
    if (el.id) {
      const safeId = CSS.escape(el.id);
      return `#${safeId}`;
    }
    const path = [];
    let cur = el;
    while (cur && cur.nodeType === Node.ELEMENT_NODE && path.length < 4) {
      let selector = cur.nodeName.toLowerCase();
      if (cur.className && typeof cur.className === "string") {
        const classes = cur.className.trim().split(/\s+/).filter((c) => c && !c.startsWith("tabpilot"));
        if (classes.length > 0) {
          selector += "." + CSS.escape(classes[0]);
        }
      }
      path.unshift(selector);
      if (cur.parentElement && cur.parentElement.id) {
        path.unshift(`#${CSS.escape(cur.parentElement.id)}`);
        break;
      }
      cur = cur.parentElement;
    }
    return path.join(" > ");
  }

  // Query all interactive elements on the page
  function collectInteractiveElements() {
    refMap.clear();
    const candidates = document.querySelectorAll(
      "a[href], button, input, textarea, select, [role='button'], [role='link'], " +
      "[role='checkbox'], [role='tab'], [role='menuitem'], [role='switch'], " +
      "[role='combobox'], [contenteditable='true'], [tabindex]:not([tabindex='-1'])"
    );

    const items = [];
    let refIndex = 1;

    for (const el of candidates) {
      if (!isVisible(el)) continue;

      const tag = el.tagName.toLowerCase();
      const rect = el.getBoundingClientRect();
      const role = el.getAttribute("role") || "";
      const type = el.getAttribute("type") || (tag === "input" ? "text" : "");
      const name = el.getAttribute("name") || "";
      const text = getCleanText(el);
      const placeholder = el.getAttribute("placeholder") || "";
      const ariaLabel = el.getAttribute("aria-label") || el.getAttribute("title") || "";
      const disabled = Boolean(el.disabled || el.getAttribute("aria-disabled") === "true");

      let value = "";
      if (tag === "input" || tag === "textarea" || tag === "select") {
        value = el.value || "";
      }

      let checked = undefined;
      if (tag === "input" && (type === "checkbox" || type === "radio")) {
        checked = el.checked;
      }

      refMap.set(refIndex, el);

      items.push({
        ref: refIndex,
        tag,
        type: role ? `${tag}[${role}]` : (type ? `${tag}:${type}` : tag),
        text,
        name,
        value: value ? (value.length > 40 ? value.slice(0, 40) + "..." : value) : "",
        placeholder,
        ariaLabel,
        disabled,
        checked,
        selector: getSelector(el),
        rect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });

      refIndex++;
      if (refIndex > 300) break; // Limit to 300 elements to prevent context blowup
    }

    return items;
  }

  // Extract page content summary and headings
  function extractPageOutline() {
    const headings = [];
    const headingEls = document.querySelectorAll("h1, h2, h3, h4, [role='heading']");
    for (const h of headingEls) {
      if (!isVisible(h)) continue;
      const level = h.tagName.toLowerCase();
      const text = getCleanText(h, 100);
      if (text) {
        headings.push(`${level.toUpperCase()}: ${text}`);
      }
    }

    // Check for alerts or dialogs
    const alerts = [];
    const alertEls = document.querySelectorAll("[role='alert'], [role='dialog'], .alert, .modal");
    for (const a of alertEls) {
      if (!isVisible(a)) continue;
      const text = getCleanText(a, 120);
      if (text) alerts.push(text);
    }

    return { headings, alerts };
  }

  // Build markdown representation of current page state
  function buildMarkdownSnapshot(metadata, items, outline, compact = true) {
    const lines = [];
    lines.push(`## Target Tab: ${metadata.title || "Untitled"}`);
    lines.push(`- **URL**: ${metadata.url}`);
    lines.push(`- **Scroll**: ${metadata.scrollY}px / ${metadata.scrollHeight}px (${metadata.scrollPercent}%)`);
    lines.push(`- **Viewport**: ${metadata.innerWidth}x${metadata.innerHeight}`);

    if (outline.alerts.length > 0) {
      lines.push("\n### Notices / Modals");
      for (const alert of outline.alerts) {
        lines.push(`- Notice: ${alert}`);
      }
    }

    if (outline.headings.length > 0) {
      lines.push("\n### Page Outline");
      for (const h of outline.headings.slice(0, 10)) {
        lines.push(`- ${h}`);
      }
    }

    lines.push("\n### Interactive Elements");
    if (items.length === 0) {
      lines.push("No interactive elements detected.");
    } else {
      for (const item of items) {
        let desc = `[#${item.ref}] <${item.type}>`;
        if (item.text) desc += ` "${item.text}"`;
        if (item.ariaLabel && item.ariaLabel !== item.text) desc += ` aria="${item.ariaLabel}"`;
        if (item.placeholder) desc += ` placeholder="${item.placeholder}"`;
        if (item.value !== "") desc += ` value="${item.value}"`;
        if (item.checked !== undefined) desc += ` checked=${item.checked}`;
        if (item.disabled) desc += ` [DISABLED]`;
        lines.push(desc);
      }
    }

    return lines.join("\n");
  }

  // Generate full snapshot payload
  function generateSnapshot(options = {}) {
    const compact = options.compact !== false;
    const items = collectInteractiveElements();
    const outline = extractPageOutline();

    const scrollHeight = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0
    );
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const scrollPercent = scrollHeight > window.innerHeight
      ? Math.round((scrollY / (scrollHeight - window.innerHeight)) * 100)
      : 100;

    const metadata = {
      title: document.title,
      url: window.location.href,
      scrollY,
      scrollHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollPercent,
    };

    const markdown = buildMarkdownSnapshot(metadata, items, outline, compact);

    if (overlaysVisible || options.highlight) {
      renderOverlays(items);
    }

    return {
      metadata,
      elementsCount: items.length,
      elements: items,
      outline,
      markdown,
    };
  }

  // Render visual numeric badges over interactive elements
  function renderOverlays(items) {
    removeOverlays();
    overlaysContainer = document.createElement("div");
    overlaysContainer.id = "tabpilot-overlays-root";

    for (const item of items) {
      const el = refMap.get(item.ref);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) continue;

      const badge = document.createElement("div");
      badge.className = "tabpilot-overlay-badge";
      badge.textContent = `${item.ref}`;
      badge.style.left = `${Math.max(0, rect.left + window.scrollX)}px`;
      badge.style.top = `${Math.max(0, rect.top + window.scrollY)}px`;
      overlaysContainer.appendChild(badge);
    }

    document.documentElement.appendChild(overlaysContainer);
    overlaysVisible = true;
  }

  // Clear visual badges
  function removeOverlays() {
    if (overlaysContainer && overlaysContainer.parentNode) {
      overlaysContainer.parentNode.removeChild(overlaysContainer);
    }
    overlaysContainer = null;
    overlaysVisible = false;
  }

  // Show animated ripple when an action clicks coordinates
  function showClickRipple(x, y) {
    const ripple = document.createElement("div");
    ripple.className = "tabpilot-click-ripple";
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    document.documentElement.appendChild(ripple);
    setTimeout(() => {
      if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
    }, 700);
  }

  // Resolve target element from ref, selector, or visible text
  function resolveElement(action) {
    if (action.ref !== undefined && action.ref !== null) {
      const refNum = parseInt(action.ref, 10);
      const el = refMap.get(refNum);
      if (el && el.isConnected) return el;
    }

    if (action.selector) {
      try {
        const el = document.querySelector(action.selector);
        if (el) return el;
      } catch {
        // Selector syntax error fallback
      }
    }

    if (action.text) {
      const query = action.text.toLowerCase().trim();
      const candidates = document.querySelectorAll("a, button, input[type='button'], input[type='submit'], [role='button']");
      for (const c of candidates) {
        if (!isVisible(c)) continue;
        const cText = (c.innerText || c.textContent || "").toLowerCase().trim();
        if (cText === query || cText.includes(query)) {
          return c;
        }
      }
    }

    return null;
  }

  // Set input value cleanly supporting React/Vue/Angular synthetic event trackers
  function setNativeInputValue(element, value) {
    const isTextArea = element.tagName.toLowerCase() === "textarea";
    const proto = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");

    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  // Execute a single action on the target page
  async function executeAction(action) {
    const type = String(action.type || action.action || "").toLowerCase();

    switch (type) {
      case "click": {
        const el = resolveElement(action);
        if (!el) {
          return {
            success: false,
            error: `Click target not found (ref: ${action.ref}, selector: ${action.selector || "none"}, text: ${action.text || "none"})`,
          };
        }

        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        await new Promise((r) => setTimeout(r, 120));

        const rect = el.getBoundingClientRect();
        const clientX = Math.round(rect.left + rect.width / 2);
        const clientY = Math.round(rect.top + rect.height / 2);

        showClickRipple(clientX, clientY);

        const eventOptions = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          screenX: clientX,
          screenY: clientY,
        };

        el.dispatchEvent(new PointerEvent("pointerover", eventOptions));
        el.dispatchEvent(new MouseEvent("mouseover", eventOptions));
        el.dispatchEvent(new PointerEvent("pointerdown", eventOptions));
        el.dispatchEvent(new MouseEvent("mousedown", eventOptions));

        if (typeof el.focus === "function") {
          el.focus();
        }

        el.dispatchEvent(new PointerEvent("pointerup", eventOptions));
        el.dispatchEvent(new MouseEvent("mouseup", eventOptions));
        el.dispatchEvent(new MouseEvent("click", eventOptions));

        return {
          success: true,
          message: `Clicked element [${el.tagName.toLowerCase()}] "${getCleanText(el, 40)}"`,
        };
      }

      case "type": {
        const el = resolveElement(action);
        if (!el) {
          return { success: false, error: `Type target not found (ref: ${action.ref}, selector: ${action.selector})` };
        }

        el.scrollIntoView({ behavior: "smooth", block: "center" });
        if (typeof el.focus === "function") el.focus();

        const textToType = action.text !== undefined ? String(action.text) : "";

        if (action.clear) {
          setNativeInputValue(el, "");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        if (el.isContentEditable) {
          if (action.clear) el.textContent = "";
          document.execCommand("insertText", false, textToType);
        } else {
          const finalVal = action.clear ? textToType : (el.value || "") + textToType;
          setNativeInputValue(el, finalVal);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        if (action.enter) {
          el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
          if (el.form && typeof el.form.requestSubmit === "function") {
            el.form.requestSubmit();
          }
        }

        return {
          success: true,
          message: `Typed "${textToType}" into [${el.tagName.toLowerCase()}]`,
        };
      }

      case "select": {
        const el = resolveElement(action);
        if (!el || el.tagName.toLowerCase() !== "select") {
          return { success: false, error: "Select action requires a <select> element" };
        }

        let found = false;
        const targetVal = String(action.value || action.text || "").toLowerCase();

        for (let i = 0; i < el.options.length; i++) {
          const opt = el.options[i];
          if (
            opt.value.toLowerCase() === targetVal ||
            opt.text.toLowerCase().includes(targetVal)
          ) {
            el.selectedIndex = i;
            found = true;
            break;
          }
        }

        if (!found && action.value) {
          el.value = action.value;
        }

        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));

        return {
          success: true,
          message: `Selected option in [select] (index: ${el.selectedIndex})`,
        };
      }

      case "check":
      case "uncheck": {
        const el = resolveElement(action);
        if (!el || (el.tagName.toLowerCase() !== "input" && el.getAttribute("role") !== "checkbox")) {
          return { success: false, error: "Check action requires an input checkbox or role=checkbox" };
        }

        const shouldCheck = type === "check";
        if (el.checked !== shouldCheck) {
          el.checked = shouldCheck;
          el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        return {
          success: true,
          message: `Set checkbox to ${shouldCheck}`,
        };
      }

      case "scroll": {
        const direction = String(action.direction || "down").toLowerCase();
        const amount = parseInt(action.amount, 10) || 500;

        if (action.ref || action.selector) {
          const el = resolveElement(action);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            return { success: true, message: "Scrolled element into view" };
          }
        }

        if (direction === "top") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else if (direction === "bottom") {
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        } else if (direction === "up") {
          window.scrollBy({ top: -amount, behavior: "smooth" });
        } else {
          window.scrollBy({ top: amount, behavior: "smooth" });
        }

        await new Promise((r) => setTimeout(r, 200));
        return { success: true, message: `Scrolled ${direction} ${amount}px` };
      }

      case "presskey":
      case "key": {
        const key = action.key || "Enter";
        const target = document.activeElement || document.body;

        const keyEvtInit = {
          key,
          code: key,
          bubbles: true,
          cancelable: true,
        };

        target.dispatchEvent(new KeyboardEvent("keydown", keyEvtInit));
        target.dispatchEvent(new KeyboardEvent("keypress", keyEvtInit));
        target.dispatchEvent(new KeyboardEvent("keyup", keyEvtInit));

        return { success: true, message: `Pressed key ${key}` };
      }

      case "hover": {
        const el = resolveElement(action);
        if (!el) return { success: false, error: "Hover target not found" };

        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const rect = el.getBoundingClientRect();
        const evt = { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };

        el.dispatchEvent(new MouseEvent("mouseenter", evt));
        el.dispatchEvent(new MouseEvent("mouseover", evt));
        el.dispatchEvent(new MouseEvent("mousemove", evt));

        return { success: true, message: `Hovered over element [${el.tagName.toLowerCase()}]` };
      }

      case "read": {
        if (action.ref || action.selector) {
          const el = resolveElement(action);
          if (!el) return { success: false, error: "Read target not found" };
          const text = getCleanText(el, 2000);
          return {
            success: true,
            data: {
              text,
              value: el.value || null,
              html: el.innerHTML.slice(0, 500),
            },
            message: `Read element [${el.tagName.toLowerCase()}]: ${text.slice(0, 60)}...`,
          };
        }

        // Return main page text
        const bodyText = (document.body ? document.body.innerText : "").slice(0, 5000);
        return {
          success: true,
          data: { text: bodyText },
          message: "Read main page body text",
        };
      }

      case "evaluate": {
        if (!action.script) return { success: false, error: "Missing script expression to evaluate" };
        try {
          // eslint-disable-next-line no-eval
          const result = window.eval(action.script);
          return {
            success: true,
            data: result,
            message: "Evaluated script successfully",
          };
        } catch (err) {
          return { success: false, error: `Evaluation error: ${err.message}` };
        }
      }

      default:
        return { success: false, error: `Unsupported target action type: ${type}` };
    }
  }

  // Runtime message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case "TABPILOT_PING":
        sendResponse({ status: "pong", url: window.location.href, title: document.title });
        break;

      case "TABPILOT_GET_SNAPSHOT": {
        try {
          const snapshot = generateSnapshot(message.options || {});
          sendResponse(snapshot);
        } catch (err) {
          sendResponse({ error: err.message });
        }
        break;
      }

      case "TABPILOT_TOGGLE_OVERLAYS": {
        if (message.show === false) {
          removeOverlays();
          sendResponse({ overlays: false });
        } else if (message.show === true) {
          const items = collectInteractiveElements();
          renderOverlays(items);
          sendResponse({ overlays: true, count: items.length });
        } else {
          // Toggle
          if (overlaysVisible) {
            removeOverlays();
            sendResponse({ overlays: false });
          } else {
            const items = collectInteractiveElements();
            renderOverlays(items);
            sendResponse({ overlays: true, count: items.length });
          }
        }
        break;
      }

      case "TABPILOT_EXECUTE_ACTION": {
        executeAction(message.action)
          .then((res) => sendResponse(res))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true; // async reply
      }

      default:
        break;
    }
  });
})();
