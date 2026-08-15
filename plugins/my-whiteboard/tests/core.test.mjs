import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import {
  ConflictError,
  applyWorkspaceTransaction,
  createBoardEntity,
  createProjectWorkspace,
  getChangesSince,
  readWorkspace,
  updateProject,
  workspacePaths,
} from "../core/index.mjs";

async function tempProject() {
  return mkdtemp(path.join(os.tmpdir(), "my-whiteboard-core-"));
}

test("creates an Agent-neutral workspace under .my-whiteboard", async () => {
  const projectRoot = await tempProject();
  const workspace = await createProjectWorkspace(projectRoot, { name: "Demo", actor: { id: "codex", client: "codex" } });
  assert.equal(workspace.schemaVersion, 2);
  assert.equal(workspace.workspaceVersion, 1);
  assert.equal(workspace.project.name, "Demo");
  assert.match(workspacePaths(projectRoot).workspace, /\.my-whiteboard[\\/]workspace\.json$/);
});

test("workspace and entity versions allow unrelated writes", async () => {
  const projectRoot = await tempProject();
  await createProjectWorkspace(projectRoot, { name: "Versions" });
  await applyWorkspaceTransaction(projectRoot, {
    actor: "codex",
    operations: [
      { type: "entity.create", collection: "tasks", entity: { id: "task-a", title: "A", status: "todo" } },
      { type: "entity.create", collection: "tasks", entity: { id: "task-b", title: "B", status: "todo" } },
    ],
  });
  const first = await readWorkspace(projectRoot);
  assert.equal(first.workspaceVersion, 2);
  await applyWorkspaceTransaction(projectRoot, {
    actor: "codex",
    observedWorkspaceVersion: 2,
    operations: [{ type: "entity.update", collection: "tasks", id: "task-a", expectedVersion: 1, patch: { status: "done" } }],
  });
  await applyWorkspaceTransaction(projectRoot, {
    actor: "claude",
    observedWorkspaceVersion: 2,
    operations: [{ type: "entity.update", collection: "tasks", id: "task-b", expectedVersion: 1, patch: { status: "in_progress" } }],
  });
  const current = await readWorkspace(projectRoot);
  assert.equal(current.workspaceVersion, 4);
  assert.equal(current.entities.tasks["task-a"].version, 2);
  assert.equal(current.entities.tasks["task-b"].version, 2);
  assert.equal(current.entities.tasks["task-b"].status, "in_progress");
});

test("stale writes to the same entity fail without changing state", async () => {
  const projectRoot = await tempProject();
  await createProjectWorkspace(projectRoot, { name: "Conflicts" });
  await applyWorkspaceTransaction(projectRoot, { operations: [{ type: "entity.create", collection: "tasks", entity: { id: "task-1", title: "Task" } }] });
  await applyWorkspaceTransaction(projectRoot, { operations: [{ type: "entity.update", collection: "tasks", id: "task-1", expectedVersion: 1, patch: { title: "Updated" } }] });
  await assert.rejects(
    applyWorkspaceTransaction(projectRoot, { operations: [{ type: "entity.update", collection: "tasks", id: "task-1", expectedVersion: 1, patch: { title: "Stale" } }] }),
    (error) => error instanceof ConflictError && error.details.actualVersion === 2,
  );
  const workspace = await readWorkspace(projectRoot);
  assert.equal(workspace.entities.tasks["task-1"].title, "Updated");
  assert.equal(workspace.workspaceVersion, 3);
});

test("semantic board elements have independent entity versions", async () => {
  const projectRoot = await tempProject();
  await createProjectWorkspace(projectRoot, { name: "Board versions" });
  const board = createBoardEntity({
    id: "architecture",
    title: "Architecture",
    elements: [
      { id: "api", kind: "node", semanticType: "service", label: "API" },
      { id: "db", kind: "node", semanticType: "database", label: "DB" },
    ],
  });
  await applyWorkspaceTransaction(projectRoot, { operations: [{ type: "entity.create", collection: "boards", entity: board }] });
  await applyWorkspaceTransaction(projectRoot, { operations: [{ type: "board.apply", boardId: "architecture", changes: [{ op: "update", id: "api", expectedVersion: 1, patch: { label: "Gateway" } }] }] });
  await applyWorkspaceTransaction(projectRoot, { operations: [{ type: "board.apply", boardId: "architecture", changes: [{ op: "update", id: "db", expectedVersion: 1, patch: { label: "Postgres" } }] }] });
  const workspace = await readWorkspace(projectRoot);
  assert.equal(workspace.entities.boards.architecture.elements.api.version, 2);
  assert.equal(workspace.entities.boards.architecture.elements.db.version, 2);
  await assert.rejects(
    applyWorkspaceTransaction(projectRoot, { operations: [{ type: "board.apply", boardId: "architecture", changes: [{ op: "delete", id: "api", expectedVersion: 1 }] }] }),
    (error) => error.code === "VERSION_CONFLICT",
  );
});

test("delta context is ordered by Workspace Version", async () => {
  const projectRoot = await tempProject();
  const initial = await createProjectWorkspace(projectRoot, { name: "Delta" });
  await updateProject(projectRoot, { expectedVersion: 1, patch: { overview: "Shared workspace" }, actor: "codex" });
  const delta = await getChangesSince(projectRoot, initial.workspaceVersion);
  assert.equal(delta.workspaceVersion, 2);
  assert.equal(delta.events.length, 1);
  assert.equal(delta.events[0].type, "project.updated");
});
