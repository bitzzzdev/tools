import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../codex-remote");
test("Codex Remote manifest is valid Manifest V3 and references existing files", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.ok(manifest.permissions.includes("sidePanel"));
  for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_page, "api.js", "sidepanel.js", "sidepanel.css", "options.js"]) {
    assert.ok(fs.existsSync(path.join(root, file)), "Missing extension file: " + file);
  }
});
test("VPS API restricts pushes to dev and authenticates requests", () => {
  const source = fs.readFileSync(path.join(root, "server/server.mjs"), "utf8");
  assert.match(source, /project\.baseBranch !== "dev"/);
  assert.match(source, /HEAD:refs\/heads\/dev/);
  assert.match(source, /timingSafeEqual/);
  assert.doesNotMatch(source, /req\.body\.command|exec\(input\.command/);
});
test("extension asks for approval before pushing", () => {
  const source = fs.readFileSync(path.join(root, "sidepanel.js"), "utf8");
  assert.match(source, /confirm\("Push this task's reviewed changes to the dev branch\?/);
  assert.match(source, /Approve and push to dev/);
});