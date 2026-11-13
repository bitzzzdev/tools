import http from "node:http";
import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod/v3";

const execFile = promisify(execFileCallback);
const token = process.env.DEVTOOLS_MCP_TOKEN;
if (!token || token.length < 32) {
  throw new Error("Set DEVTOOLS_MCP_TOKEN to a random value of at least 32 characters.");
}

const host = process.env.DEVTOOLS_MCP_HOST || "127.0.0.1";
const port = Number(process.env.DEVTOOLS_MCP_PORT || 8788);
const allowedOrigins = (process.env.DEVTOOLS_MCP_ALLOWED_ORIGINS || "")
  .split(",").map((value) => value.trim()).filter(Boolean);

function authorized(req) {
  const header = req.headers.authorization || "";
  const supplied = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(token);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function validGitHubRepo(repo) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

function validGitLabProject(project) {
  return /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(project);
}

function validVercelProject(project) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(project);
}

async function cli(command, args, timeout = 45000) {
  try {
    const { stdout, stderr } = await execFile(command, args, {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env: process.env
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const detail = (error.stderr || error.stdout || error.message || "Command failed").toString().trim();
    throw new Error(command + ": " + detail.slice(0, 4000));
  }
}

function resultText(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function registerTool(server, name, description, schema, handler) {
  server.registerTool(name, { description, inputSchema: schema }, async (input) => {
    try {
      return resultText(await handler(input));
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
  });
}

function createMcpServer() {
  const server = new McpServer({
    name: "devtools-vps",
    version: "1.0.0"
  });

  registerTool(server, "provider_auth_status",
    "Check whether GitHub CLI, GitLab CLI, and Vercel CLI are authenticated on this VPS.",
    {}, async () => {
      const checks = await Promise.all([
        ["github", "gh", ["auth", "status"]],
        ["gitlab", "glab", ["auth", "status"]],
        ["vercel", "vercel", ["whoami"]]
      ].map(async ([provider, command, args]) => {
        try {
          const output = await cli(command, args, 20000);
          return { provider, authenticated: true, output: output.stdout || output.stderr };
        } catch (error) {
          return { provider, authenticated: false, error: error.message };
        }
      }));
      return checks;
    });

  registerTool(server, "github_repository",
    "Read metadata for a GitHub repository. Input must be owner/repository.",
    { repo: z.string().min(3).max(200) }, async ({ repo }) => {
      if (!validGitHubRepo(repo)) throw new Error("Repository must use owner/repository format.");
      return (await cli("gh", ["repo", "view", repo, "--json", "nameWithOwner,url,visibility,isPrivate,defaultBranchRef,updatedAt"])).stdout;
    });

  registerTool(server, "github_branches",
    "List branches and commit SHAs for a GitHub repository.",
    { repo: z.string().min(3).max(200) }, async ({ repo }) => {
      if (!validGitHubRepo(repo)) throw new Error("Repository must use owner/repository format.");
      return (await cli("gh", ["api", "--paginate", "repos/" + repo + "/branches", "--jq", "[.[] | {name, protected, sha: .commit.sha}]"])).stdout;
    });

  registerTool(server, "github_pull_requests",
    "List pull requests for a GitHub repository.",
    { repo: z.string().min(3).max(200), state: z.enum(["open", "closed", "merged", "all"]).default("open") },
    async ({ repo, state }) => {
      if (!validGitHubRepo(repo)) throw new Error("Repository must use owner/repository format.");
      return (await cli("gh", ["pr", "list", "--repo", repo, "--state", state, "--limit", "50", "--json", "number,title,state,url,headRefName,baseRefName,updatedAt"])).stdout;
    });

  registerTool(server, "gitlab_project",
    "Read metadata for a GitLab project. Input may be a namespace/project path.",
    { project: z.string().min(3).max(255) }, async ({ project }) => {
      if (!validGitLabProject(project)) throw new Error("Project must be a namespace/project path.");
      return (await cli("glab", ["api", "projects/" + encodeURIComponent(project)])).stdout;
    });

  registerTool(server, "gitlab_branches",
    "List branches and commit SHAs for a GitLab project.",
    { project: z.string().min(3).max(255) }, async ({ project }) => {
      if (!validGitLabProject(project)) throw new Error("Project must be a namespace/project path.");
      return (await cli("glab", ["api", "projects/" + encodeURIComponent(project) + "/repository/branches?per_page=100"])).stdout;
    });

  registerTool(server, "vercel_projects",
    "List Vercel projects visible to the authenticated Vercel CLI account.",
    {}, async () => (await cli("vercel", ["project", "ls"])).stdout);

  registerTool(server, "vercel_deployments",
    "List deployments for a Vercel project. Uses the existing Vercel CLI scope and authentication.",
    { project: z.string().min(1).max(100) }, async ({ project }) => {
      if (!validVercelProject(project)) throw new Error("Invalid Vercel project name.");
      return (await cli("vercel", ["ls", project])).stdout;
    });

  registerTool(server, "vercel_inspect",
    "Inspect a Vercel deployment URL. Only HTTPS Vercel deployment URLs are accepted.",
    { url: z.string().url() }, async ({ url }) => {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".vercel.app")) {
        throw new Error("Only HTTPS *.vercel.app deployment URLs are accepted.");
      }
      return (await cli("vercel", ["inspect", url])).stdout;
    });

  return server;
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ ok: true, service: "devtools-vps-mcp" }));
  }
  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Not found" }));
  }
  const origin = req.headers.origin;
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Origin not allowed" }));
  }
  if (!authorized(req)) {
    res.writeHead(401, { "WWW-Authenticate": "Bearer", "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Unauthorized" }));
  }
  try {
    const mcp = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MCP request failed" }));
    }
  }
});

httpServer.listen(port, host, () => {
  console.log("DevTools VPS MCP listening on " + host + ":" + port + "/mcp");
});
