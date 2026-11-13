# Codex Remote VPS API

A Node.js 20+ companion service for the Codex Remote Chrome extension. It starts Codex CLI tasks in isolated Git worktrees and persists task output between browser sessions.

## Security model

- Bind to 127.0.0.1 and expose the API only through an HTTPS reverse proxy.
- Require CODEX_REMOTE_TOKEN with at least 32 random characters.
- Allow only explicitly configured Chrome extension origins.
- Expose only configured repositories. There is no arbitrary shell or filesystem endpoint.
- Each task gets a separate Git worktree and branch named codex/<task-id>.
- The source checkout must be clean and on the configured base branch before a task starts.
- Changes are pushed only after the user selects Approve and push to dev. Pushes are normal fast-forward pushes, never force pushes.

## Install

1. Ensure Node.js 20+ and Codex CLI are installed for the service user.
2. Copy config.example.json to config.json and set absolute repository paths.
3. Generate a secret token with: openssl rand -hex 32
4. Set CODEX_REMOTE_TOKEN in the service environment.
5. Set CODEX_REMOTE_CONFIG to the absolute path of config.json.
6. Start the API with: node server.mjs

The example config stores task state and worktrees under /var/lib/codex-remote. Create that directory and make it writable by the service account. The API listens on localhost port 8787 by default. Configure Caddy or Nginx to provide HTTPS and proxy to 127.0.0.1:8787. Do not expose port 8787 publicly.

## Configure the extension

Load the codex-remote directory through chrome://extensions -> Developer mode -> Load unpacked. Open extension settings and enter the HTTPS API URL and token.

For an unpacked extension, copy the extension ID shown by Chrome into allowedOrigins in config.json, then restart the service. If Chrome assigns a different extension ID after reinstalling, update the allowlist.

## Project configuration

Every project needs an id, display name, absolute local path, baseBranch, and Git remote. Set baseBranch to dev and create that branch before enabling a repository.

## systemd deployment

Review codex-remote.service.example and adapt its paths, user, and writable directories. Install the unit as /etc/systemd/system/codex-remote.service. Store CODEX_REMOTE_TOKEN and CODEX_REMOTE_CONFIG in a root-readable environment file. Ensure the service account can access Codex authentication and Git credentials, and that the worktree/state directories are writable by that account.

The example unit intentionally restricts filesystem writes. Adjust ReadWritePaths to include the configured worktree root, task state directory, and repository locations used by Git worktrees. Do not grant broad write access to the whole VPS.

## Operational notes

- Tasks continue on the VPS if Chrome closes. Task state and output are stored in the configured state file.
- On restart, tasks that were running are marked interrupted; their worktrees are retained.
- A push fails safely if another commit reaches dev after the task branch was created. Rebase or recreate the task instead of force-pushing.
- Review the diff before approving. The API does not merge into main.
- This is a single-user starter service. Put it behind HTTPS, firewall it, and run it under a dedicated unprivileged account.
