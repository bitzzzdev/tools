# DevTools VPS MCP

A remote Model Context Protocol server for the GitHub CLI (`gh`), GitLab CLI (`glab`), and Vercel CLI already authenticated on the VPS. It is designed for the ChatGPT web MCP connector, Codex, and other Streamable HTTP MCP clients.

## Tools

| Tool | Purpose |
|---|---|
| `provider_auth_status` | Check authentication for gh, glab, and Vercel |
| `github_repository` | Read repository metadata |
| `github_branches` | List GitHub branches and SHAs |
| `github_pull_requests` | List GitHub pull requests |
| `gitlab_project` | Read GitLab project metadata |
| `gitlab_branches` | List GitLab branches and SHAs |
| `vercel_projects` | List Vercel projects |
| `vercel_deployments` | List deployments for a project |
| `vercel_inspect` | Inspect a Vercel deployment |

The server does not expose a generic shell tool, arbitrary CLI execution, or arbitrary filesystem access. Every CLI invocation is an explicit, fixed command with validated arguments. Initial tools are read-only.

## Requirements

- Debian/Ubuntu Linux
- Node.js 20+
- `gh`, `glab`, and `vercel` installed and authenticated as the service user
- HTTPS reverse proxy such as Caddy or Nginx

## Install

Run as the same Linux user that owns the existing CLI authentication:

```sh
cd /opt/tools/codex-remote/mcp
npm install --omit=dev
install -d -m 700 /etc/devtools-mcp
openssl rand -hex 32
```

Store the generated secret in `/etc/devtools-mcp.env`:

```ini
DEVTOOLS_MCP_TOKEN=replace-with-a-random-64-character-token
DEVTOOLS_MCP_HOST=127.0.0.1
DEVTOOLS_MCP_PORT=8788
```

Protect the file:

```sh
sudo chown root:dev /etc/devtools-mcp.env
sudo chmod 640 /etc/devtools-mcp.env
```

Install the systemd unit from `devtools-mcp.service.example`, adjust `WorkingDirectory` to the deployed path, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now devtools-mcp
sudo systemctl status devtools-mcp
```

The process binds to localhost only. Do not expose port 8788 directly to the internet.

## HTTPS reverse proxy

Example Caddy site snippet:

```caddy
mcp.example.com {
    reverse_proxy 127.0.0.1:8788
}
```

The public MCP endpoint is `https://mcp.example.com/mcp`; health check is `https://mcp.example.com/health`.

## Connect a client

Configure the MCP client with the HTTPS endpoint and a Bearer token using the client's supported remote MCP authentication settings. Keep the token private. Do not put it in source control, browser JavaScript, or a public URL.

## Security

- Bearer tokens must be at least 32 characters and are compared with a timing-safe check.
- Bind to loopback and terminate TLS at the reverse proxy.
- Optional comma-separated Origin allowlist is configured with `DEVTOOLS_MCP_ALLOWED_ORIGINS`. Leave unset for non-browser MCP clients.
- No arbitrary shell, command string, or filesystem tool is exposed.
- GitHub/GitLab/Vercel access is limited by the CLI credentials of the service account.
- Run as an unprivileged service user with only the required CLI config files readable.
- The initial toolset is read-only. Add write tools only with explicit branch and production safeguards.

## Local development

```sh
npm install
DEVTOOLS_MCP_TOKEN=$(openssl rand -hex 32) npm start
```

Send MCP requests to `http://127.0.0.1:8788/mcp` with `Authorization: Bearer <token>`.
