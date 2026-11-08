(() => {
  const clean = s => (s || "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // ----------------------------------------------------
  // 1. Direct API extraction for Claude.ai
  // ----------------------------------------------------
  async function extractClaudeViaApi() {
    const conversationId = window.location.pathname.split('/').pop();
    const orgId = document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1];

    if (!conversationId || conversationId.length < 20 || !conversationId.includes('-')) {
      throw new Error("Could not detect Claude conversation ID in URL.");
    }
    if (!orgId) {
      throw new Error("Could not detect Claude session (lastActiveOrg cookie).");
    }

    const url = `/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`;
    const res = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    });

    if (!res.ok) {
      throw new Error(`Claude API returned HTTP ${res.status}`);
    }

    const data = await res.json();
    const all = data?.chat_messages || [];
    if (!all.length) throw new Error("No messages found in Claude conversation API response.");

    // Traverse current branch
    const byUuid = new Map(all.map(m => [m.uuid, m]));
    let ordered = null;
    const leaf = data.current_leaf_message_uuid;
    if (leaf && byUuid.has(leaf)) {
      const path = [];
      const seen = new Set();
      let cur = byUuid.get(leaf);
      while (cur && !seen.has(cur.uuid)) {
        seen.add(cur.uuid);
        path.push(cur);
        cur = cur.parent_message_uuid ? byUuid.get(cur.parent_message_uuid) : null;
      }
      if (path.length) ordered = path.reverse();
    }

    if (!ordered) {
      ordered = [...all].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    }

    // Process artifacts
    const artifacts = new Map();
    for (const m of ordered) {
      for (const block of (m.content || [])) {
        if (block.type !== 'tool_use' || block.name !== 'artifacts') continue;
        const input = block.input || {};
        const id = input.id || '__artifact__';
        let a = artifacts.get(id);
        if (!a) { a = { content: '' }; artifacts.set(id, a); }

        if (input.command === 'update') {
          if (typeof input.old_str === 'string' && typeof input.new_str === 'string') {
            a.content = a.content.replace(input.old_str, () => input.new_str);
          }
        } else if (typeof input.content === 'string') {
          a.content = input.content;
        }
        if (input.title) a.title = input.title;
        if (input.type) a.type = input.type;
        if (input.language) a.language = input.language;
        a.lastVersionUuid = input.version_uuid;
      }
    }

    function renderToolUse(block) {
      const input = block.input || {};
      const name = block.name || '';
      if (name === 'artifacts') {
        const a = artifacts.get(input.id || '__artifact__');
        if (!a || input.version_uuid !== a.lastVersionUuid || !a.content) return '';
        return `\n\`\`\`${a.language || ''}\n// [Artifact: ${a.title || 'untitled'}]\n${a.content}\n\`\`\`\n`;
      }
      if (name === 'create_file' && typeof input.file_text === 'string' && input.file_text) {
        const file = String(input.path || 'file').split('/').pop();
        return `\n\`\`\`\n// [File: ${file}]\n${input.file_text}\n\`\`\`\n`;
      }
      return '';
    }

    const messages = [];
    for (const m of ordered) {
      const parts = [];
      for (const block of (m.content || [])) {
        if (block.type === 'text' && typeof block.text === 'string') {
          const t = block.text.trim();
          if (t) parts.push(t);
        } else if (block.type === 'tool_use') {
          const t = renderToolUse(block);
          if (t) parts.push(t);
        }
      }

      // Add attachments info if present
      for (const file of (m.files || [])) {
        if (file.file_name) parts.unshift(`[Attachment: ${file.file_name}]`);
      }
      for (const att of (m.attachments || [])) {
        const name = att.file_name || att.name || 'Attachment';
        if (att.extracted_content) {
          parts.unshift(`> [Attachment: ${name}]\n> ${att.extracted_content.trim()}`);
        }
      }

      const raw = clean(parts.join('\n\n'));
      if (!raw) continue;

      const role = (m.sender === 'human' || m.sender === 'user') ? 'user' : 'assistant';
      messages.push({ role, text: raw });
    }

    const title = clean(data?.name) || getTitle();
    return {
      title,
      messages
    };
  }

  // ----------------------------------------------------
  // 2. DOM scrolling helper (for providers relying on DOM)
  // ----------------------------------------------------
  const findScrollContainer = () => {
    const candidates = [...document.querySelectorAll("main, [role='main'], div, section")];
    for (const el of candidates) {
      if (el.scrollHeight > el.clientHeight && el.clientHeight > 200) {
        const style = getComputedStyle(el);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          return el;
        }
      }
    }
    return document.scrollingElement || document.documentElement || document.body;
  };

  async function autoScrollAndLoad() {
    const scroller = findScrollContainer();
    if (!scroller) return;

    let previousHeight = 0;
    let stableIterations = 0;

    // Scroll up repeatedly to load older history
    for (let i = 0; i < 30; i++) {
      scroller.scrollTop = 0;
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 200));

      const currentHeight = scroller.scrollHeight;
      if (currentHeight === previousHeight) {
        stableIterations++;
        if (stableIterations >= 4 && i >= 5) break;
      } else {
        stableIterations = 0;
        previousHeight = currentHeight;
      }
    }

    // Scroll down gradually so items mount
    const totalHeight = scroller.scrollHeight;
    const step = Math.max(window.innerHeight, 600);
    for (let pos = 0; pos <= totalHeight; pos += step) {
      scroller.scrollTop = pos;
      window.scrollTo(0, pos);
      await new Promise(r => setTimeout(r, 80));
    }
  }

  // ----------------------------------------------------
  // 3. Fallback DOM extraction
  // ----------------------------------------------------
  const visible = el => {
    if (!el || !el.innerText?.trim()) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  };

  const textFrom = el => {
    const clone = el.cloneNode(true);
    // Remove UI chrome but keep chat text
    clone.querySelectorAll("button, [role=button], nav, [aria-hidden=true], .sr-only, [data-testid*=copy], [data-testid*=feedback]").forEach(n => n.remove());
    // Remove relative timestamps e.g. "3 hours ago", "50 minutes ago"
    clone.querySelectorAll("time, [class*='timestamp'], [class*='time-']").forEach(n => n.remove());

    clone.querySelectorAll("pre").forEach(pre => {
      const code = pre.querySelector("code");
      if (code) pre.replaceWith(document.createTextNode("\n```\n" + code.innerText + "\n```\n"));
    });
    clone.querySelectorAll("a").forEach(a => {
      const label = clean(a.innerText);
      if (label && a.href) a.replaceWith(document.createTextNode(`[${label}](${a.href})`));
    });
    clone.querySelectorAll("br").forEach(br => br.replaceWith(document.createTextNode("\n")));
    clone.querySelectorAll("p, h1, h2, h3, li, blockquote").forEach(n => n.append(document.createTextNode("\n")));
    let t = clean(clone.innerText || clone.textContent);
    // Strip trailing or standalone timestamps like "52 minutes ago", "1 hour ago", "Yesterday at 4:00 PM"
    t = t.replace(/\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/gi, "").trim();
    return t;
  };

  const unique = arr => [...new Set(arr.filter(Boolean))];

  function getTitle() {
    const title = clean(document.querySelector("main h1")?.innerText || document.querySelector("h1")?.innerText || document.title);
    return title.replace(/\s*[|·-]\s*(ChatGPT|Claude|Gemini).*$/i, "").trim() || "AI Chat";
  }

  function extractFromDOM() {
    const host = location.hostname;
    let candidates = [];

    if (/chatgpt\.com|chat\.openai\.com/.test(host)) {
      candidates = [...document.querySelectorAll("main article, [data-testid^='conversation-turn-']")];
    } else if (/claude\.ai/.test(host)) {
      // Look for Claude message elements
      candidates = [...document.querySelectorAll('[data-testid*="user-message"], [data-testid*="assistant-message"], .font-user-message, .font-claude-message')];
      if (!candidates.length) {
        candidates = [...document.querySelectorAll('[data-testid="chat-message"], .message')];
      }
    } else if (/gemini\.google\.com/.test(host)) {
      candidates = [...document.querySelectorAll("main .conversation-container, main [data-message-author], main user-query, main model-response")];
    }

    if (!candidates.length) {
      const selectors = [
        "[data-message-author-role]", "[data-testid*=message]", "[data-testid*=turn]",
        "[role=listitem]", "main article", "main .message", "main [class*=message]",
        "main [class*=turn]"
      ];
      for (const selector of selectors) {
        const found = [...document.querySelectorAll(selector)].filter(visible);
        if (found.length >= 2) { candidates = found; break; }
      }
    }

    candidates = candidates.filter(visible);
    // Filter parent/child duplicates
    candidates = candidates.filter(el => ![...el.children].some(child =>
      candidates.includes(child) && clean(child.innerText).length > 30
    ));

    const messages = [];
    for (const el of candidates) {
      const raw = clean(textFrom(el));
      if (!raw || raw.length < 2) continue;
      // Skip strings that are only a relative timestamp
      if (/^\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago$/i.test(raw)) continue;

      let role = el.getAttribute("data-message-author-role") ||
        el.getAttribute("data-message-author") ||
        el.getAttribute("data-testid") ||
        el.className || "";
      role = role.toLowerCase();

      if (/user|human/.test(role) || el.matches("user-query")) role = "user";
      else if (/assistant|model|claude|gemini|chatgpt/.test(role) || el.matches("model-response")) role = "assistant";
      else {
        const label = clean(el.querySelector("[data-message-author-role], [aria-label*=assistant i], [aria-label*=user i]")?.getAttribute("aria-label"));
        role = /user|you/i.test(label) ? "user" : /assistant|model/i.test(label) ? "assistant" : "message";
      }

      if (messages.length && messages[messages.length - 1].text === raw) continue;
      messages.push({ role, text: raw });
    }

    if (messages.length < 2) {
      const main = document.querySelector("main") || document.body;
      const blocks = [...main.querySelectorAll("p, pre, blockquote, li")].filter(visible)
        .map(el => clean(textFrom(el))).filter(t => t.length > 20 && !/^\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago$/i.test(t));
      const compact = unique(blocks);
      if (compact.length >= 2) {
        return compact.map((text, i) => ({ role: i % 2 ? "assistant" : "user", text }));
      }
    }
    return messages;
  }

  // ----------------------------------------------------
  // 4. Runtime Listener
  // ----------------------------------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type !== "AI_CHAT_EXPORT") return;
    (async () => {
      try {
        let title = getTitle();
        let messages = [];

        // Check if on Claude.ai: attempt direct official session API first
        if (/claude\.ai/.test(location.hostname)) {
          try {
            const apiResult = await extractClaudeViaApi();
            if (apiResult?.messages?.length) {
              messages = apiResult.messages;
              if (apiResult.title) title = apiResult.title;
            }
          } catch (apiErr) {
            console.warn("Claude API extraction failed, falling back to DOM:", apiErr);
          }
        }

        // If not Claude or API failed, load DOM & extract
        if (!messages.length) {
          if (request.autoLoad !== false) {
            await autoScrollAndLoad();
          }
          messages = extractFromDOM();
        }

        if (!messages.length) {
          sendResponse({ ok: false, error: "No chat messages found. Open a conversation and try again." });
          return;
        }

        sendResponse({
          ok: true,
          chat: {
            title,
            site: location.hostname,
            url: location.href,
            exportedAt: new Date().toISOString(),
            messages
          }
        });
      } catch (e) {
        sendResponse({ ok: false, error: `Could not read this page: ${e.message}` });
      }
    })();
    return true;
  });
})();
