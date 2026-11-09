# Contributing to Tools

Thank you for contributing to this collection of tools and browser extensions.

## Development Workflow

1. Fork and clone the repository.
2. If working on browser extensions, load the extension directory unpacked in your Chromium browser via `chrome://extensions` in Developer mode.
3. If modifying or adding tools, ensure any new tool subdirectory contains a valid `README.md` and (for extensions) a valid `manifest.json`.
4. Run the automated test suite before opening a pull request:
   ```bash
   node --test tests/test_tab_pilot.js
   ```
5. Update the tools directory table in `README.md`:
   ```bash
   python3 scripts/update_readme_table.py
   ```

## Pull Request Guidelines

- Keep pull requests focused on a single tool, feature, or bug fix.
- Ensure all tests pass cleanly.
- Document any new options or features in the corresponding tool README.
- Add an entry under the `[Unreleased]` section of `CHANGELOG.md`.
- Avoid adding third-party tracking, analytics, or external telemetry scripts to extensions.
