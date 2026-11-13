# Tools

A collection of useful small and large tools, utilities, scripts, and extensions.

Made by [bitzzdev](https://github.com/bitzzdev).

## Directory

<!-- TOOLS_TABLE_START -->
| Tool | Type | Description |
|---|---|---|
| [`chat-exporter`](chat-exporter/) | Browser Extension | Export the currently open AI conversation to Markdown, JSON, TXT, or PDF. |
| [`codex-remote`](codex-remote/) | Browser Extension | Control Codex tasks running on your own VPS through a Chrome side panel, inspect diffs, and explicitly approve pushes to dev. |
| [`tab-pilot`](tab-pilot/) | Browser Extension | Enables ChatGPT, Claude, Gemini, Meta AI, and other AI tools to inspect, click, scroll, type, and automate any chosen browser tab. |
<!-- TOOLS_TABLE_END -->

## Tools overview

### AI Chat Exporter (`chat-exporter`)
A browser extension (Manifest V3) that exports conversations directly to Markdown, PDF, JSON, or Plain Text. Includes native session API integration for Claude.ai and DOM selectors for ChatGPT and Gemini.

- See [`chat-exporter/README.md`](chat-exporter/README.md) for install and usage instructions.

### TabPilot (`tab-pilot`)
A browser automation bridge (Manifest V3) that allows ChatGPT, Claude, Gemini, Meta AI, and other AI chat interfaces to control any chosen browser tab. It extracts interactive DOM element trees with numerical references, provides a floating controller HUD on AI pages, and executes simulated human actions (clicks, keyboard input, scrolling, option selections, and multi-step tasks).

- See [`tab-pilot/README.md`](tab-pilot/README.md) for install and usage instructions.

### Codex Remote (`codex-remote`)
A Chrome side panel for submitting coding tasks to Codex CLI running on a personal VPS. Tasks run in isolated Git worktrees, remain active when the browser closes, and expose logs and diffs for review. Pushing changes is a separate explicit approval and is restricted to the configured `dev` branch.

- See [`codex-remote/README.md`](codex-remote/README.md) for extension setup.
- See [`codex-remote/server/README.md`](codex-remote/server/README.md) for VPS deployment and security configuration.

---

## Author
Made by [bitzzdev](https://github.com/bitzzdev)
