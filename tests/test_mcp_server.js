import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../codex-remote/mcp");
const source = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("MCP server uses the official SDK and Streamable HTTP transport", () => {
  assert.match(source, /@modelcontextprotocol\/sdk\/server\/mcp\.js/);
  assert.match(source, /StreamableHTTPServerTransport/);
  assert.match(source, /sessionIdGenerator: undefined/);
  assert.equal(packageJson.dependencies["@modelcontextprotocol/sdk"] !== undefined, true);
});

test("MCP endpoint requires timing-safe bearer authentication", () => {
  assert.match(source, /DEVTOOLS_MCP_TOKEN/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /url\.pathname !== "\/mcp"/);
});

test("Only explicit provider tools are exposed, with no arbitrary shell tool", () => {
  for (const name of ["provider_auth_status", "github_repository", "github_branches", "github_pull_requests", "gitlab_project", "gitlab_branches", "vercel_projects", "vercel_deployments", "vercel_inspect"]) {
    assert.match(source, new RegExp('"' + name + '"'));
  }
  assert.doesNotMatch(source, /registerTool\(server,\s*["'](?:shell|exec|run_command)["']/);
  assert.doesNotMatch(source, /exec\(input\./);
});

test("Provider arguments are validated and Vercel inspection is HTTPS-only", () => {
  assert.match(source, /validGitHubRepo/);
  assert.match(source, /validGitLabProject/);
  assert.match(source, /validVercelProject/);
  assert.match(source, /parsed\.protocol !== "https:"/);
  assert.match(source, /endsWith\("\.vercel\.app"\)/);
});
