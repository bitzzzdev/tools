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

## VPS service

The MCP server runs as a systemd service on the VPS and binds to `127.0.0.1:8788`. Keep it bound to loopback. Do not open port 8788 to the public internet.

The service requires `DEVTOOLS_MCP_TOKEN`, a random token of at least 32 characters. Store it only in the VPS environment file. The server's `/mcp` endpoint validates this Bearer token.

## Vercel reverse proxy

This directory also contains a Vercel Node.js Function that forwards only `/mcp` and `/health` to the VPS. It streams request and response bodies so Streamable HTTP and SSE responses can pass through.

Configure the Vercel project with this repository and set its Root Directory to `codex-remote/mcp`. The project's Production Branch can be `dev` because this is a separate MCP project. Do not attach portfolio domains to it.

Set the Vercel environment variable `MCP_UPSTREAM_URL` to the HTTPS origin of a secure tunnel or reverse proxy that reaches the VPS MCP service. Use an origin only, for example `https://your-vps-tunnel.example`, with no trailing `/mcp` path. Add it to Production and Preview environments as needed, then redeploy.

The Vercel public endpoints are:

- `https://devmcp.vercel.app/mcp`
- `https://devmcp.vercel.app/health`

The proxy forwards the incoming Authorization header to the VPS. It does not store or embed the MCP token. Keep the VPS token private and configure it in the MCP client as a Bearer token.

The upstream must use HTTPS. Keep the VPS MCP listener on loopback and expose it only through a secure tunnel or TLS reverse proxy. Do not configure the proxy to use a public plaintext HTTP endpoint.

## Connect a client

Configure the MCP client with `https://devmcp.vercel.app/mcp` and a Bearer token using the client's supported remote MCP authentication settings. Keep the token private. Do not put it in source control, browser JavaScript, or a public URL.

## Security

- Bearer tokens must be at least 32 characters and are compared with a timing-safe check.
- The Vercel proxy forwards only the fixed `mcp` and `health` paths.
- The VPS service binds to loopback; do not expose port 8788 directly to the internet.
- Optional comma-separated Origin allowlist is configured with `DEVTOOLS_MCP_ALLOWED_ORIGINS`. Leave unset for non-browser MCP clients.
- No arbitrary shell, command string, or filesystem tool is exposed.
- GitHub/GitLab/Vercel access is limited by the CLI credentials of the service account.
- Run as an unprivileged service user with only the required CLI config files readable.
- The initial toolset is read-only. Add write tools only with explicit branch and production safeguards.
