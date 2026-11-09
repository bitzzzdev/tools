# Changelog

All notable changes to this project are listed here.
The format follows Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added
- TabPilot Chromium extension (`tab-pilot`) enabling ChatGPT, Claude, Gemini, Meta AI, DeepSeek, and Perplexity to control and automate a selected browser tab.
- Interactive element indexer in `target-agent.js` that assigns numeric reference tags to clickable elements, forms, and inputs.
- Action execution engine supporting clicks, realistic text typing, viewport scrolling, select dropdown changes, checkboxes, waits, and keyboard events.
- Floating draggable controller HUD (`ai-bridge.js`) for AI chat websites with one-click tab snapshot injection and action detection.
- Popup interface (`popup.html`) for selecting target browser tabs, testing manual actions, copying prompt templates, and adjusting execution settings.
- Node.js test suite in `tests/test_tab_pilot.js` covering Manifest V3 structure, action parser formats, action schema validation, and markdown snapshot creation.
- Continuous integration workflow in `.github/workflows/test.yml` running the test suite on push and pull requests.
- MIT License, Contributing Guide, Code of Conduct, Security Policy, Terms draft, and Privacy Policy draft.

### Changed
- Updated root `README.md` tools directory table and tools overview to document TabPilot.
- Updated `scripts/update_readme_table.py` to ignore `tests` and `docs` directories when scanning for tools.

## [1.0.0] - 2026-11-09

### Added
- Initial release of the `tools` repository.
- AI Chat Exporter extension (`chat-exporter`) for exporting active AI conversations to Markdown, PDF, JSON, and text.
- Automated tools table generator script `scripts/update_readme_table.py` and GitHub Actions workflow.
