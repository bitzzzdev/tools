# TabPilot

TabPilot is a Chromium browser extension that allows web AI interfaces (ChatGPT, Claude, Gemini, Meta AI, DeepSeek, and Perplexity) to control and automate a designated browser tab to read content, fill forms, click buttons, scroll, and perform multi-step web tasks.

## Requirements

- Google Chrome, Microsoft Edge, Brave, or any Chromium-based browser supporting Manifest V3 (Chromium version 109 or newer).
- Developer mode enabled in your browser extensions manager.

## Installation

1. Clone or download this repository.
2. Open your browser and navigate to `chrome://extensions` (or `edge://extensions` in Edge).
3. Toggle the **Developer mode** switch in the top-right corner.
4. Click **Load unpacked**.
5. Select the `tab-pilot` folder in this directory:
   ```
   tools/tab-pilot
   ```
6. The TabPilot icon appears in your browser extensions toolbar. Pin it for quick access.

## How to use

### Step 1: Open your target tab
Open the website you want the AI to work on (for example, a flight search, form, dashboard, or data table).

### Step 2: Connect the tab in TabPilot
1. Click the TabPilot icon in your toolbar.
2. Under the **Target Tab** section, find your target tab in the list and click **Select**.
3. The status indicator changes to green, showing the tab is connected.

### Step 3: Use with your favorite AI chat
1. Open your preferred AI website (`chatgpt.com`, `claude.ai`, `gemini.google.com`, or `meta.ai`).
2. A floating TabPilot widget appears in the lower corner of the screen.
3. Click **Insert Tab State into Chat**. TabPilot reads the current page, assigns numeric reference labels (`[#1]`, `[#2]`, etc.) to interactive elements, and pastes a clean Markdown representation into your chat input.
4. Type your instructions (for example, "Fill out the contact form with my details and submit").
5. The AI responds with planned actions in a JSON block.
6. The TabPilot widget detects the actions. Click **Run Actions on Target** (or toggle **Auto-run AI actions** for hands-free execution).
7. Click **Send Result Back to Chat** to give the AI the updated page state so it can continue multi-step tasks.

## Protocol and action schema

The AI returns actions in a standard JSON block:

```json
{
  "thought": "Find the search input, type query, and submit",
  "actions": [
    {"type": "type", "ref": 2, "text": "Chromium extensions", "clear": true, "enter": true},
    {"type": "wait", "timeout": 1500},
    {"type": "read"}
  ]
}
```

### Supported action types

- `click`: clicks an element by ref number (`ref`), CSS selector (`selector`), or visible text (`text`). Triggers full mouse and pointer event chains.
- `type`: inputs text into an input, textarea, or contenteditable element. Supports `clear: true` to empty before typing, and `enter: true` to press the Enter key.
- `scroll`: scrolls the viewport or container. Supports `direction` (`"down"`, `"up"`, `"top"`, `"bottom"`) and `amount` in pixels.
- `select`: chooses an option in an HTML dropdown select element by value or visible text.
- `check` and `uncheck`: toggles checkbox and radio controls.
- `wait`: pauses execution for a specified duration in milliseconds (`timeout`).
- `pressKey`: dispatches keyboard events (`"Enter"`, `"Tab"`, `"Escape"`, `"ArrowDown"`).
- `navigate`: navigates the target tab to a specified URL.
- `read`: extracts text, values, or attributes from an element or the entire page.
- `reload`: reloads the target tab.

## Configuration options

Configure these in the TabPilot popup under **Settings & Logs**:

| Option | Default | Description |
|---|---|---|
| Step Execution Delay | `600` ms | Delay inserted between sequential actions to allow web pages to render updates. |
| Compact Snapshot Mode | `true` | Omits low-priority text nodes to conserve prompt tokens. |
| Highlight Elements on Target | `false` | Displays visual numeric badges directly over elements on the target page. |

## Common problems

- Chromium security policy blocks extensions from scripting chrome:// or edge:// pages. Use standard HTTP or HTTPS URLs.
- If AI output is not detected, verify that the model returned commands inside a markdown JSON code block. Click Insert Guide on the widget to supply the expected format.
- If the target tab was closed, the status changes to "No Target". Open the popup and select an active tab.

## Privacy

TabPilot executes entirely inside your local browser. No data, browsing history, or page snapshots are sent to external servers. Communication occurs solely between your open browser tabs.

---

## Author
Made by [bitzzdev](https://github.com/bitzzdev)
