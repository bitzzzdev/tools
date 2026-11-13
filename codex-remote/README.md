# Codex Remote

Control Codex CLI running on your own VPS from a Chrome side panel.

## Components

- manifest.json and sidepanel files: Manifest V3 side panel UI.
- api.js: authenticated requests to the VPS API.
- options files: server URL and token configuration.
- server/: Node.js companion API for isolated Codex tasks.

## Install the extension

1. Open chrome://extensions.
2. Enable Developer mode.
3. Select Load unpacked and choose this codex-remote directory.
4. Open extension settings and configure the HTTPS URL and API token.
5. Add the extension ID shown by Chrome to the VPS API allowedOrigins list.

## VPS service

Follow server/README.md. The VPS service must be running and reachable over HTTPS. Chrome does not execute Codex itself; it sends authenticated task requests to your VPS.

## Current scope

This version supports approved project selection, task submission, persistent task status/output, diff inspection, and an explicit fast-forward push to the configured dev branch. It does not expose arbitrary shell commands, access the Codex App Server socket, or connect ChatGPT directly to the VPS. A separate authenticated MCP gateway is required for ChatGPT to invoke these tools directly.
