import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile, cp } from "node:fs/promises";
import {
  connectAgent,
  createProjectWorkspace,
  readWorkspace,
  PRESENCE_TIMEOUT_MS,
} from "../core/index.mjs";

async function tempProject() {
  return mkdtemp(path.join(os.tmpdir(), "my-whiteboard-presence-"));
}

async function readRawWorkspace(projectRoot) {
  const file = path.join(projectRoot, ".my-whiteboard", "workspace.json");
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeRawWorkspace(projectRoot, workspace) {
  const file = path.join(projectRoot, ".my-whiteboard", "workspace.json");
  await writeFile(file, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Project Root Portability
// ---------------------------------------------------------------------------

test("project.root is rebound to the current runtime path after a clone", async () => {
  const dirA = await tempProject();
  await createProjectWorkspace(dirA, { name: "Portability" });

  // Simulate a clone: copy .my-whiteboard/workspace.json to a different path.
  const dirB = await tempProject();
  await mkdir(path.join(dirB, ".my-whiteboard"), { recursive: true });
  await cp(
    path.join(dirA, ".my-whiteboard", "workspace.json"),
    path.join(dirB, ".my-whiteboard", "workspace.json"),
  );

  const workspace = await readWorkspace(dirB);
  assert.equal(workspace.project.root, path.resolve(dirB));
  assert.notEqual(workspace.project.root, path.resolve(dirA));
});

test("project.root rebind does not advance workspaceVersion", async () => {
  const projectRoot = await tempProject();
  const created = await createProjectWorkspace(projectRoot, { name: "NoAdvance" });
  const before = created.workspaceVersion;

  const read1 = await readWorkspace(projectRoot);
  const read2 = await readWorkspace(projectRoot);
  assert.equal(read1.workspaceVersion, before);
  assert.equal(read2.workspaceVersion, before);
});

test("project.root rebind is pure in-memory — disk value is unchanged", async () => {
  const projectRoot = await tempProject();
  await createProjectWorkspace(projectRoot, { name: "DiskUnchanged" });

  // Read through readWorkspace (which rebinds).
  const rebound = await readWorkspace(projectRoot);
  assert.equal(rebound.project.root, path.resolve(projectRoot));

  // Read the raw file directly (bypasses rebind).
  const raw = await readRawWorkspace(projectRoot);
  assert.equal(raw.project.root, path.resolve(projectRoot));

  // Simulate a different machine path by writing a stale root to disk.
  raw.project.root = "C:\\fake\\other\\machine\\path";
  await writeRawWorkspace(projectRoot, raw);

  // readWorkspace should return the current path, not the stale disk value.
  const reboundAgain = await readWorkspace(projectRoot);
  assert.equal(reboundAgain.project.root, path.resolve(projectRoot));

  // The disk value should still be the stale one (rebind is in-memory only).
  const rawAgain = await readRawWorkspace(projectRoot);
  assert.equal(rawAgain.project.root, "C:\\fake\\other\\machine\\path");
});

// ---------------------------------------------------------------------------
// Agent Presence
// ---------------------------------------------------------------------------

test("agent with recent lastSeenAt shows as connected", async () => {
  const projectRoot = await tempProject();
  await createProjectWorkspace(projectRoot, { name: "Recent" });
  await connectAgent(projectRoot, { id: "codex", displayName: "Codex", client: "codex" });

  const workspace = await readWorkspace(projectRoot);
  assert.equal(workspace.entities.agents.codex.status, "connected");
  assert.ok(workspace.entities.agents.codex.lastSeenAt);
});

test("agent with stale lastSeenAt shows as offline", async () => {
  const projectRoot = await tempProject();
  await createProjectWorkspace(projectRoot, { name: "Stale" });
  await connectAgent(projectRoot, { id: "codex", displayName: "Codex", client: "codex" });

  // Manually set lastSeenAt to well beyond the timeout.
  const stale = new Date(Date.now() - PRESENCE_TIMEOUT_MS - 60_000).toISOString();
  const raw = await readRawWorkspace(projectRoot);
  raw.entities.agents.codex.lastSeenAt = stale;
  await writeRawWorkspace(projectRoot, raw);

  const workspace = await readWorkspace(projectRoot);
  assert.equal(workspace.entities.agents.codex.status, "offline");
});

test("agent with missing lastSeenAt shows as offline", async () => {
  const projectRoot = await tempProject();
  await createProjectWorkspace(projectRoot, { name: "Missing" });
  await connectAgent(projectRoot, { id: "codex", displayName: "Codex", client: "codex" });

  // Remove lastSeenAt to simulate extremely old data.
  const raw = await readRawWorkspace(projectRoot);
  delete raw.entities.agents.codex.lastSeenAt;
  await writeRawWorkspace(projectRoot, raw);

  const workspace = await readWorkspace(projectRoot);
  assert.equal(workspace.entities.agents.codex.status, "offline");
});

test("agent with invalid lastSeenAt shows as offline", async () => {
  const projectRoot = await tempProject();
  await createProjectWorkspace(projectRoot, { name: "Invalid" });
  await connectAgent(projectRoot, { id: "codex", displayName: "Codex", client: "codex" });

  // Set lastSeenAt to an unparseable value.
  const raw = await readRawWorkspace(projectRoot);
  raw.entities.agents.codex.lastSeenAt = "not-a-date";
  await writeRawWorkspace(projectRoot, raw);

  const workspace = await readWorkspace(projectRoot);
  assert.equal(workspace.entities.agents.codex.status, "offline");
});

test("agent recovers to connected after agent_sync refreshes lastSeenAt", async () => {
  const projectRoot = await tempProject();
  await createProjectWorkspace(projectRoot, { name: "Recovery" });
  await connectAgent(projectRoot, { id: "codex", displayName: "Codex", client: "codex" });

  // Make the agent stale.
  const stale = new Date(Date.now() - PRESENCE_TIMEOUT_MS - 60_000).toISOString();
  const raw = await readRawWorkspace(projectRoot);
  raw.entities.agents.codex.lastSeenAt = stale;
  await writeRawWorkspace(projectRoot, raw);

  // Verify it shows offline before recovery.
  const before = await readWorkspace(projectRoot);
  assert.equal(before.entities.agents.codex.status, "offline");

  // Reconnect — this should refresh lastSeenAt and set status to connected.
  await connectAgent(projectRoot, { id: "codex", displayName: "Codex", client: "codex" });

  const after = await readWorkspace(projectRoot);
  assert.equal(after.entities.agents.codex.status, "connected");
  assert.ok(new Date(after.entities.agents.codex.lastSeenAt).getTime() > new Date(stale).getTime());
});

test("presence inference does not advance workspaceVersion", async () => {
  const projectRoot = await tempProject();
  await createProjectWorkspace(projectRoot, { name: "NoVersionAdvance" });
  await connectAgent(projectRoot, { id: "codex", displayName: "Codex", client: "codex" });

  // Make the agent stale.
  const stale = new Date(Date.now() - PRESENCE_TIMEOUT_MS - 60_000).toISOString();
  const raw = await readRawWorkspace(projectRoot);
  raw.entities.agents.codex.lastSeenAt = stale;
  await writeRawWorkspace(projectRoot, raw);

  const versionBefore = (await readRawWorkspace(projectRoot)).workspaceVersion;
  const read1 = await readWorkspace(projectRoot);
  const read2 = await readWorkspace(projectRoot);
  assert.equal(read1.workspaceVersion, versionBefore);
  assert.equal(read2.workspaceVersion, versionBefore);
});

test("presence inference is pure in-memory — disk status is unchanged", async () => {
  const projectRoot = await tempProject();
  await createProjectWorkspace(projectRoot, { name: "DiskStatus" });
  await connectAgent(projectRoot, { id: "codex", displayName: "Codex", client: "codex" });

  // Make the agent stale.
  const stale = new Date(Date.now() - PRESENCE_TIMEOUT_MS - 60_000).toISOString();
  const raw = await readRawWorkspace(projectRoot);
  raw.entities.agents.codex.lastSeenAt = stale;
  await writeRawWorkspace(projectRoot, raw);

  // readWorkspace should return "offline" (runtime inference).
  const rebound = await readWorkspace(projectRoot);
  assert.equal(rebound.entities.agents.codex.status, "offline");

  // The raw disk file should still have the original persisted status.
  const rawAgain = await readRawWorkspace(projectRoot);
  assert.equal(rawAgain.entities.agents.codex.status, "connected");
  assert.equal(rawAgain.entities.agents.codex.lastSeenAt, stale);
});

test("presence inference does not change the event log", async () => {
  const projectRoot = await tempProject();
  await createProjectWorkspace(projectRoot, { name: "EventLog" });
  await connectAgent(projectRoot, { id: "codex", displayName: "Codex", client: "codex" });

  // Make the agent stale.
  const stale = new Date(Date.now() - PRESENCE_TIMEOUT_MS - 60_000).toISOString();
  const raw = await readRawWorkspace(projectRoot);
  raw.entities.agents.codex.lastSeenAt = stale;
  await writeRawWorkspace(projectRoot, raw);

  const eventsBefore = (await readRawWorkspace(projectRoot)).eventLog.length;
  await readWorkspace(projectRoot);
  await readWorkspace(projectRoot);
  const eventsAfter = (await readRawWorkspace(projectRoot)).eventLog.length;
  assert.equal(eventsAfter, eventsBefore);
});
