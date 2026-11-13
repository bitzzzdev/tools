import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const configPath = path.resolve(process.env.CODEX_REMOTE_CONFIG || "./config.json");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const token = process.env.CODEX_REMOTE_TOKEN;
if (!token || token.length < 32) throw new Error("Set CODEX_REMOTE_TOKEN to a random value of at least 32 characters.");
const stateFile = path.resolve(config.stateFile || "./data/tasks.json");
const worktreeRoot = path.resolve(config.worktreeRoot || "./data/worktrees");
const tasks = new Map();
const maxOutput = 180000;
await fs.mkdir(path.dirname(stateFile), {recursive:true});
await fs.mkdir(worktreeRoot, {recursive:true});
try {
  const saved = JSON.parse(await fs.readFile(stateFile, "utf8"));
  for (const task of saved) tasks.set(task.id, {...task, status:task.status === "running" ? "interrupted" : task.status});
} catch (error) { if (error.code !== "ENOENT") throw error; }

async function persist() {
  const temp = stateFile + ".tmp";
  await fs.writeFile(temp, JSON.stringify([...tasks.values()], null, 2), {mode:0o600});
  await fs.rename(temp, stateFile);
}
function safeTask(task) {
  return {
    id:task.id, projectId:task.projectId, projectName:task.projectName, prompt:task.prompt,
    status:task.status, createdAt:task.createdAt, updatedAt:task.updatedAt,
    branch:task.branch, output:task.output, pushed:Boolean(task.pushed)
  };
}
function send(res, status, data) {
  res.writeHead(status, {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  res.end(JSON.stringify(data));
}
function authorized(req) {
  const header = req.headers.authorization || "";
  const supplied = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(token);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1000000) throw new Error("Request body too large.");
  }
  return raw ? JSON.parse(raw) : {};
}
function run(command, args, cwd) {
  return execFile(command, args, {cwd, timeout:120000, maxBuffer:8 * 1024 * 1024});
}
function findProject(id) { return (config.projects || []).find((project) => project.id === id); }
function append(task, chunk) {
  task.output = (task.output + chunk).slice(-maxOutput);
  task.updatedAt = new Date().toISOString();
  persist().catch((error) => console.error("Task persistence failed:", error));
}
async function startTask(project, prompt) {
  const id = crypto.randomUUID();
  const branch = "codex/" + id;
  const worktree = path.join(worktreeRoot, id);
  const task = {
    id, projectId:project.id, projectName:project.name, prompt, status:"preparing",
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    branch, worktree, output:"", pushed:false
  };
  tasks.set(id, task);
  await persist();
  try {
    const root = path.resolve(project.path);
    const current = await run("git", ["branch", "--show-current"], root);
    if (current.stdout.trim() !== project.baseBranch) throw new Error("Project checkout must be on " + project.baseBranch + ".");
    const dirty = await run("git", ["status", "--porcelain"], root);
    if (dirty.stdout.trim()) throw new Error("Project checkout has local changes. Clean it before starting a task.");
    const remote = project.remote || "origin";
    await run("git", ["fetch", remote, project.baseBranch], root);
    await run("git", ["worktree", "add", "-b", branch, worktree, remote + "/" + project.baseBranch], root);
    task.status = "running";
    append(task, "Worktree ready: " + worktree + "\nBranch: " + branch + "\nStarting Codex...\n");
    const child = spawn(config.codexCommand || "codex", [
      "exec", "--json", "--cd", worktree, "--sandbox", "workspace-write", "--ephemeral", prompt
    ], {cwd:worktree, env:process.env, stdio:["ignore","pipe","pipe"]});
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => append(task, chunk));
    child.stderr.on("data", (chunk) => append(task, chunk));
    child.on("error", (error) => {
      task.status = "failed";
      append(task, "\nCodex process error: " + error.message + "\n");
    });
    child.on("close", async (code) => {
      task.status = code === 0 ? "completed" : "failed";
      append(task, "\nCodex exited with code " + code + ".\n");
      try { await run("git", ["add", "-N", "-A"], worktree); } catch {}
      await persist();
    });
  } catch (error) {
    task.status = "failed";
    append(task, "\nTask setup failed: " + error.message + "\n");
  }
  return safeTask(task);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const origins = config.allowedOrigins || [];
  if (origin && !origins.includes(origin)) return send(res, 403, {error:"Origin not allowed."});
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (!authorized(req)) return send(res, 401, {error:"Unauthorized."});
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      let version = null;
      try { version = (await run(config.codexCommand || "codex", ["--version"], process.cwd())).stdout.trim(); } catch {}
      return send(res, 200, {ok:true, codexVersion:version});
    }
    if (req.method === "GET" && url.pathname === "/api/projects") {
      return send(res, 200, {projects:(config.projects || []).map(({id,name}) => ({id,name}))});
    }
    if (req.method === "GET" && url.pathname === "/api/tasks") {
      const list = [...tasks.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,50).map(safeTask);
      return send(res, 200, {tasks:list});
    }
    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const input = await readBody(req);
      const project = findProject(input.projectId);
      if (!project) return send(res, 400, {error:"Unknown project."});
      if (typeof input.prompt !== "string" || input.prompt.trim().length < 3 || input.prompt.length > 20000) {
        return send(res, 400, {error:"Prompt must contain 3 to 20,000 characters."});
      }
      return send(res, 202, {task:await startTask(project, input.prompt.trim())});
    }
    const match = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)(?:\/(diff|push))?$/);
    if (match) {
      const task = tasks.get(match[1]);
      if (!task) return send(res, 404, {error:"Task not found."});
      const action = match[2];
      if (req.method === "GET" && !action) return send(res, 200, safeTask(task));
      if (req.method === "GET" && action === "diff") {
        try {
          await run("git", ["add", "-N", "-A"], task.worktree);
          const result = await run("git", ["diff", "--no-ext-diff", "--"], task.worktree);
          return send(res, 200, {diff:result.stdout});
        } catch (error) { return send(res, 200, {diff:"", error:error.message}); }
      }
      if (req.method === "POST" && action === "push") {
        if (task.status !== "completed" || task.pushed) return send(res, 409, {error:"Only completed, unpushed tasks can be approved."});
        const project = findProject(task.projectId);
        if (!project || project.baseBranch !== "dev") return send(res, 403, {error:"This project is not configured to push to dev."});
        const remote = project.remote || "origin";
        await run("git", ["add", "-A"], task.worktree);
        await run("git", ["diff", "--cached", "--check"], task.worktree);
        const staged = await run("git", ["diff", "--cached", "--name-only"], task.worktree);
        if (!staged.stdout.trim()) return send(res, 409, {error:"There are no changes to push."});
        await run("git", ["fetch", remote, "dev"], task.worktree);
        const ancestry = await run("git", ["merge-base", "--is-ancestor", remote + "/dev", "HEAD"], task.worktree).then(() => true).catch(() => false);
        if (!ancestry) return send(res, 409, {error:"The remote dev branch has moved. This task cannot be pushed as a fast-forward. Rebase or restart it."});
        await run("git", ["commit", "-m", "Codex task " + task.id], task.worktree);
        await run("git", ["push", remote, "HEAD:refs/heads/dev"], task.worktree);
        task.pushed = true; task.updatedAt = new Date().toISOString(); await persist();
        return send(res, 200, {ok:true,message:"Changes pushed to dev."});
      }
    }
    return send(res, 404, {error:"Route not found."});
  } catch (error) {
    console.error(error);
    return send(res, 500, {error:error.message || "Internal server error."});
  }
});
server.listen(config.port || 8787, config.host || "127.0.0.1", () => {
  console.log("Codex Remote listening on " + (config.host || "127.0.0.1") + ":" + (config.port || 8787));
});