# AI Chat Exporter

A lightweight Chrome Manifest V3 extension that exports the conversation currently open in the active tab to:

- **Markdown** (`.md`)
- **PDF** (opens a print-ready page; choose **Save as PDF** in the browser print dialog)
- **JSON** (`.json`)
- **Plain text** (`.txt`)

It includes provider-aware selectors for ChatGPT, Claude, and Gemini, plus generic DOM heuristics for other AI chat websites.

## Install in Chrome / Chromium

1. Download and extract `ai-chat-exporter.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted `chat-exporter-extension` folder.
6. Open an AI conversation, click the extension icon, choose a format, and click **Export current chat**.

## Notes and limitations

- Runs locally in your browser. It does not send conversation content to a server.
- It exports messages currently rendered in the page. If a site lazy-loads older messages, scroll upward first to load them.
- AI websites change their page structure. The extension uses provider-specific selectors and generic fallbacks, but some sites may need a selector update.
- Some complex formatting, attachments, images, audio, tool traces, and interactive artifacts may not be represented in text exports.
- PDF export uses the browser's print dialog. Select **Save as PDF**.
- The generic fallback may not identify speaker roles perfectly on every website.

## Permissions

- `activeTab`: access the tab only after the user invokes the extension.
- `scripting`: inject the extractor into the active tab after invocation.
- `downloads`: reserved for browser download support; file downloads are initiated from the extension popup.

## Privacy

No analytics, remote requests, or external services are used.


---

## Author
Made by [bitzzdev](https://github.com/bitzzdev)
