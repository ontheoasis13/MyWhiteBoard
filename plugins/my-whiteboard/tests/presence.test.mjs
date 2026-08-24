import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { connectAgent, createProjectWorkspace, readWorkspace, deriveConnectionProjection } from "../core/index.mjs";

async function tempProject() { return mkdtemp(path.join(os.tmpdir(), "my-whiteboard-presence-")); }
async function readRawWorkspace(projectRoot) { return JSON.parse(await readFile(path.join(projectRoot, ".my-whiteboard", "workspace.json"), "utf8")); }
async function writeRawWorkspace(projectRoot, workspace) { await writeFile(path.join(projectRoot, ".my-whiteboard", "workspace.json"), `${JSON.stringify(workspace, null, 2)}\n`, "utf8"); }

test("project.root is rebound to the current runtime path after a clone", async () => {
  const dirA = await tempProject(); await createProjectWorkspace(dirA, { name: "Portability" });
  const dirB = await tempProject(); await mkdir(path.join(dirB, ".my-whiteboard"), { recursive: true });
  await cp(path.join(dirA, ".my-whiteboard", "workspace.json"), path.join(dirB, ".my-whiteboard", "workspace.json"));
  const workspace = await readWorkspace(dirB);
  assert.equal(workspace.project.root, path.resolve(dirB));
  assert.notEqual(workspace.project.root, path.resolve(dirA));
});
test("project.root rebind does not advance workspaceVersion", async () => {
  const root = await tempProject(); const created = await createProjectWorkspace(root, { name: "NoAdvance" });
  assert.equal((await readWorkspace(root)).workspaceVersion, created.workspaceVersion);
  assert.equal((await readWorkspace(root)).workspaceVersion, created.workspaceVersion);
});

test("project.root rebind is pure in-memory — disk value is unchanged", async () => {
  const root = await tempProject(); await createProjectWorkspace(root, { name: "DiskUnchanged" });
  const raw = await readRawWorkspace(root); raw.project.root = "C:\\fake\\other\\machine\\path"; await writeRawWorkspace(root, raw);
  assert.equal((await readWorkspace(root)).project.root, path.resolve(root));
  assert.equal((await readRawWorkspace(root)).project.root, "C:\\fake\\other\\machine\\path");
});

test("Agent sync records lastSyncAt but stale time does not imply offline", async () => {
  const root = await tempProject(); await createProjectWorkspace(root, { name: "Presence" });
  await connectAgent(root, { id: "codex", displayName: "Codex", client: "codex" });
  const raw = await readRawWorkspace(root); const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  raw.entities.agents.codex.lastSeenAt = stale; raw.entities.agents.codex.lastSyncAt = stale; await writeRawWorkspace(root, raw);
  const workspace = await readWorkspace(root);
  assert.equal(workspace.entities.agents.codex.status, "connected");
  assert.equal(workspace.entities.agents.codex.connectionState, "UNKNOWN");
  assert.equal(deriveConnectionProjection(workspace.entities.agents.codex).state, "UNKNOWN");
});

test("trusted adapter connection state is preserved as a projection", async () => {
  assert.equal(deriveConnectionProjection({ connectionState: "CONNECTED", connectionStateSource: "PROCESS_ADAPTER" }).state, "CONNECTED");
  assert.equal(deriveConnectionProjection({ connectionState: "CONNECTED", connectionStateSource: "MCP_SYNC" }).state, "UNKNOWN");
});

test("presence reads do not advance Workspace version or event log", async () => {
  const root = await tempProject(); await createProjectWorkspace(root, { name: "ReadOnly" }); await connectAgent(root, { id: "codex", displayName: "Codex", client: "codex" });
  const before = await readRawWorkspace(root); await readWorkspace(root); await readWorkspace(root); const after = await readRawWorkspace(root);
  assert.equal(after.workspaceVersion, before.workspaceVersion); assert.equal(after.eventLog.length, before.eventLog.length);
});
