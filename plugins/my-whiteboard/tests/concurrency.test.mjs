import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { applyWorkspaceTransaction, createProjectWorkspace, readWorkspace } from "../core/index.mjs";

function runWorker(projectRoot, actor) {
  const worker = fileURLToPath(new URL("./concurrency-worker.mjs", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, projectRoot, actor], { stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Worker exited with ${code}`));
      else resolve(JSON.parse(output));
    });
  });
}

test("two processes cannot silently overwrite the same entity version", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-concurrency-"));
  await createProjectWorkspace(projectRoot, { name: "Concurrency" });
  await applyWorkspaceTransaction(projectRoot, { operations: [{ type: "entity.create", collection: "tasks", entity: { id: "shared", title: "Shared" } }] });
  const results = await Promise.all([runWorker(projectRoot, "codex"), runWorker(projectRoot, "claude")]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.code === "VERSION_CONFLICT").length, 1);
  const workspace = await readWorkspace(projectRoot);
  assert.equal(workspace.entities.tasks.shared.version, 2);
  assert.ok(["codex", "claude"].includes(workspace.entities.tasks.shared.assignee));
});
