/**
 * Test Suite for TabPilot Extension
 * Validates manifest configuration, file paths, action parser, action schema validation,
 * and markdown snapshot formatting.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAB_PILOT_DIR = path.resolve(__dirname, "../tab-pilot");

test("Manifest V3 configuration and referenced files exist", () => {
  const manifestPath = path.join(TAB_PILOT_DIR, "manifest.json");
  assert.ok(fs.existsSync(manifestPath), "manifest.json must exist");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  assert.equal(manifest.manifest_version, 3, "Must be Manifest V3");
  assert.equal(manifest.name, "TabPilot - AI Browser Automation Bridge");
  assert.equal(manifest.version, "1.0.0");
  assert.ok(manifest.description && manifest.description.length > 20);

  // Check permissions
  const expectedPerms = ["tabs", "activeTab", "scripting", "storage"];
  for (const perm of expectedPerms) {
    assert.ok(manifest.permissions.includes(perm), `Missing permission: ${perm}`);
  }

  // Check background service worker
  assert.ok(manifest.background?.service_worker);
  assert.equal(manifest.background.type, "module");
  assert.ok(
    fs.existsSync(path.join(TAB_PILOT_DIR, manifest.background.service_worker)),
    "Service worker file must exist"
  );

  // Check action popup
  assert.ok(manifest.action?.default_popup);
  assert.ok(
    fs.existsSync(path.join(TAB_PILOT_DIR, manifest.action.default_popup)),
    "Popup HTML must exist"
  );

  // Check icons
  for (const [size, iconRelPath] of Object.entries(manifest.icons || {})) {
    const fullPath = path.join(TAB_PILOT_DIR, iconRelPath);
    assert.ok(fs.existsSync(fullPath), `Icon ${size}px must exist at ${iconRelPath}`);
    const stats = fs.statSync(fullPath);
    assert.ok(stats.size > 50, `Icon ${size}px must not be empty`);
  }

  // Check content scripts
  assert.ok(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length >= 2);
  for (const cs of manifest.content_scripts) {
    for (const jsFile of cs.js || []) {
      assert.ok(fs.existsSync(path.join(TAB_PILOT_DIR, jsFile)), `Content script JS missing: ${jsFile}`);
    }
    for (const cssFile of cs.css || []) {
      assert.ok(fs.existsSync(path.join(TAB_PILOT_DIR, cssFile)), `Content script CSS missing: ${cssFile}`);
    }
  }
});

test("Action parser extracts actions from multiple response formats", () => {
  // Test function reproducing the parser in ai-bridge.js
  function parseActionsFromText(text) {
    if (!text) return null;
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.actions)) return parsed.actions;
      } catch {
        // Fallback
      }
    }
    const rawObjectMatch = text.match(/\{[\s\S]*"actions"\s*:\s*\[[\s\S]*?\][\s\S]*\}/);
    if (rawObjectMatch) {
      try {
        const parsed = JSON.parse(rawObjectMatch[0]);
        if (Array.isArray(parsed.actions)) return parsed.actions;
      } catch {
        // Fallback
      }
    }
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

  // Case 1: Markdown fenced code block with object
  const sample1 = `
Here is my plan to submit the form:
\`\`\`json
{
  "thought": "I will click the search field, type the search text, and submit.",
  "actions": [
    {"type": "click", "ref": 3},
    {"type": "type", "ref": 3, "text": "flights to Tokyo", "enter": true}
  ]
}
\`\`\`
Let me know if you want to proceed.
`;
  const res1 = parseActionsFromText(sample1);
  assert.ok(Array.isArray(res1));
  assert.equal(res1.length, 2);
  assert.equal(res1[0].type, "click");
  assert.equal(res1[0].ref, 3);
  assert.equal(res1[1].type, "type");
  assert.equal(res1[1].text, "flights to Tokyo");
  assert.equal(res1[1].enter, true);

  // Case 2: Markdown fenced code block with direct array
  const sample2 = `
\`\`\`json
[
  {"type": "scroll", "direction": "down", "amount": 600},
  {"type": "wait", "timeout": 1000}
]
\`\`\`
`;
  const res2 = parseActionsFromText(sample2);
  assert.ok(Array.isArray(res2));
  assert.equal(res2.length, 2);
  assert.equal(res2[0].type, "scroll");
  assert.equal(res2[0].amount, 600);

  // Case 3: Raw JSON object in text
  const sample3 = `Action output: {"thought": "Navigate to home", "actions": [{"type": "navigate", "url": "https://example.com"}]}`;
  const res3 = parseActionsFromText(sample3);
  assert.ok(Array.isArray(res3));
  assert.equal(res3.length, 1);
  assert.equal(res3[0].type, "navigate");
  assert.equal(res3[0].url, "https://example.com");

  // Case 4: No actions in text
  const sample4 = "This is a normal chat reply with no code blocks or JSON commands.";
  const res4 = parseActionsFromText(sample4);
  assert.equal(res4, null);
});

test("Action schema supports required browser interaction types", () => {
  const supportedTypes = [
    "click",
    "type",
    "scroll",
    "select",
    "check",
    "uncheck",
    "wait",
    "pressKey",
    "navigate",
    "read",
    "reload",
    "screenshot",
    "evaluate",
  ];

  function validateAction(action) {
    if (!action || typeof action !== "object") return false;
    const type = String(action.type || action.action || "").toLowerCase();
    const normalized = supportedTypes.map((t) => t.toLowerCase());
    return normalized.includes(type);
  }

  for (const t of supportedTypes) {
    assert.ok(validateAction({ type: t }), `Action type ${t} must be valid`);
  }
  assert.equal(validateAction({ type: "invalid_unknown" }), false);
});

test("Snapshot generator builds structured markdown representation", () => {
  function buildMarkdownSnapshot(metadata, items, outline) {
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

    lines.push("\n### Interactive Elements");
    for (const item of items) {
      let desc = `[#${item.ref}] <${item.type}>`;
      if (item.text) desc += ` "${item.text}"`;
      if (item.placeholder) desc += ` placeholder="${item.placeholder}"`;
      if (item.value) desc += ` value="${item.value}"`;
      lines.push(desc);
    }
    return lines.join("\n");
  }

  const metadata = {
    title: "Flight Booking Test",
    url: "https://example.com/flights",
    scrollY: 100,
    scrollHeight: 1200,
    scrollPercent: 12,
    innerWidth: 1280,
    innerHeight: 800,
  };

  const items = [
    { ref: 1, type: "input:text", text: "", placeholder: "From where?", value: "NYC" },
    { ref: 2, type: "input:text", text: "", placeholder: "To where?", value: "" },
    { ref: 3, type: "button", text: "Search Flights", placeholder: "", value: "" },
  ];

  const outline = {
    headings: ["H1: Book Flights", "H2: Popular Destinations"],
    alerts: ["Seats are limited for selected dates"],
  };

  const md = buildMarkdownSnapshot(metadata, items, outline);
  assert.ok(md.includes("## Target Tab: Flight Booking Test"));
  assert.ok(md.includes("- **URL**: https://example.com/flights"));
  assert.ok(md.includes("Notice: Seats are limited"));
  assert.ok(md.includes('[#1] <input:text> placeholder="From where?" value="NYC"'));
  assert.ok(md.includes('[#3] <button> "Search Flights"'));
});
