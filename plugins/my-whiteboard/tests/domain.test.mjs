import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import {
  applyDomainChanges,
  connectAgent,
  createProjectWorkspace,
  readWorkspace,
} from "../core/index.mjs";

test("builds the complete Single-Agent Workspace domain model", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-domain-"));
  await createProjectWorkspace(projectRoot, { name: "Domain" });
  const connected = await connectAgent(projectRoot, { id: "codex", displayName: "Codex", client: "codex", capabilities: ["code", "board"] });
  assert.equal(connected.agent.version, 1);
  await applyDomainChanges(projectRoot, "contexts", [{ op: "create", entity: { id: "goal", title: "Goal", content: "Ship the semantic workspace", sources: ["README.md"] } }], { id: "codex", client: "codex" });
  await applyDomainChanges(projectRoot, "tasks", [{ op: "create", entity: { id: "task-1", title: "Implement workspace", assigneeAgentId: "codex" } }], { id: "codex", client: "codex" });
  await applyDomainChanges(projectRoot, "tasks", [{ op: "create", entity: { id: "task-2", title: "Verify workspace", dependsOn: ["task-1"] } }], { id: "codex", client: "codex" });
  await applyDomainChanges(projectRoot, "decisions", [{ op: "create", entity: { id: "semantic-authority", title: "Semantic authority", rationale: "Avoid three live state models", status: "accepted" } }]);
  await applyDomainChanges(projectRoot, "artifacts", [{ op: "create", entity: { id: "workspace-json", title: "Workspace state", kind: "file", path: ".my-whiteboard/workspace.json" } }]);

  const workspace = await readWorkspace(projectRoot);
  assert.equal(workspace.entities.agents.codex.status, "connected");
  assert.equal(workspace.entities.contexts.goal.content, "Ship the semantic workspace");
  assert.deepEqual(workspace.entities.tasks["task-2"].dependsOn, ["task-1"]);
  assert.equal(workspace.entities.decisions["semantic-authority"].status, "accepted");
  assert.equal(workspace.entities.artifacts["workspace-json"].path, ".my-whiteboard/workspace.json");
});

test("domain entities enforce Entity Version and referential integrity", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-domain-conflict-"));
  await createProjectWorkspace(projectRoot, { name: "Domain conflicts" });
  await applyDomainChanges(projectRoot, "tasks", [{ op: "create", entity: { id: "task", title: "First" } }]);
  const updated = await applyDomainChanges(projectRoot, "tasks", [{ op: "update", id: "task", expected_version: 1, patch: { status: "done" } }]);
  assert.equal(updated.entities.task.version, 2);
  await assert.rejects(
    () => applyDomainChanges(projectRoot, "tasks", [{ op: "update", id: "task", expected_version: 1, patch: { title: "Stale" } }]),
    (error) => error.code === "VERSION_CONFLICT",
  );
  const before = await readWorkspace(projectRoot);
  await assert.rejects(
    () => applyDomainChanges(projectRoot, "tasks", [{ op: "create", entity: { id: "invalid", title: "Invalid", dependsOn: ["missing"] } }]),
    (error) => error.code === "VALIDATION_ERROR",
  );
  assert.equal((await readWorkspace(projectRoot)).workspaceVersion, before.workspaceVersion);
});
