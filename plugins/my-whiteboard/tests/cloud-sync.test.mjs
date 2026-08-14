import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyCloudEvents, applyWorkspaceTransaction, createProjectWorkspace, readWorkspace } from "../core/index.mjs";
import { buildCloudChanges, cloudConfigFromEnv, flattenWorkspace } from "../adapters/supabase-adapter.mjs";

async function temporaryProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "my-whiteboard-cloud-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("flattens Semantic Board State without leaking the local project root", async (t) => {
  const root = await temporaryProject(t);
  await createProjectWorkspace(root, { name: "Portable" });
  await applyWorkspaceTransaction(root, { operations: [{ type: "entity.create", collection: "boards", entity: { id: "architecture", title: "Architecture", boardType: "diagram", description: "", elements: { api: { id: "api", kind: "node", semanticType: "service", label: "API", properties: {}, layout: {}, version: 1, createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" } }, order: ["api"] } }] });
  const rows = flattenWorkspace(await readWorkspace(root));
  const project = rows.find((row) => row.collection === "projects");
  const board = rows.find((row) => row.collection === "boards");
  const element = rows.find((row) => row.collection === "board_elements");
  assert.equal(project.document.root, undefined);
  assert.deepEqual(board.document.elements, {});
  assert.equal(element.parentEntityId, "architecture");
  assert.equal(element.document.id, "api");
});

test("builds object-versioned cloud changes and detects equal-version divergence", () => {
  const remote = [
    { collection: "tasks", entity_id: "a", entity_version: 1, document: { id: "a", version: 1, title: "A" } },
    { collection: "tasks", entity_id: "b", entity_version: 1, document: { id: "b", version: 1, title: "B" } },
  ];
  const local = [
    { collection: "tasks", entityId: "a", entityVersion: 2, document: { id: "a", version: 2, title: "A done" } },
    { collection: "tasks", entityId: "b", entityVersion: 1, document: { id: "b", version: 1, title: "B" } },
  ];
  const changes = buildCloudChanges(local, remote, new Set(["tasks\u0000b"]));
  assert.deepEqual(changes.map((change) => change.op), ["update", "delete"]);
  assert.equal(changes[0].expectedVersion, 1);
  assert.throws(() => buildCloudChanges([{ ...local[1], document: { id: "b", version: 1, title: "different" } }], remote), /same version/i);
});

test("applies Cloud Workspace Delta atomically while preserving the local root", async (t) => {
  const root = await temporaryProject(t);
  const initial = await createProjectWorkspace(root, { name: "Local" });
  const events = [
    { workspace_version: 1, event_index: 0, event_type: "entity.updated", collection: "projects", entity_id: initial.project.id, payload: { document: { ...initial.project, root: "C:/foreign/path", name: "Cloud", version: 2 } } },
    { workspace_version: 1, event_index: 1, event_type: "entity.created", collection: "boards", entity_id: "architecture", payload: { document: { id: "architecture", entityType: "board", version: 1, title: "Architecture", boardType: "diagram", description: "", elements: {}, order: ["api"], createdAt: initial.createdAt, updatedAt: initial.updatedAt } } },
    { workspace_version: 1, event_index: 2, event_type: "entity.created", collection: "board_elements", entity_id: "architecture/api", payload: { parentEntityId: "architecture", document: { id: "api", kind: "node", semanticType: "service", label: "API", properties: {}, layout: {}, version: 1, createdAt: initial.createdAt, updatedAt: initial.updatedAt } } },
    { workspace_version: 1, event_index: 3, event_type: "entity.created", collection: "agents", entity_id: "codex", payload: { document: { id: "codex", entityType: "agent", version: 1, displayName: "Codex", client: "codex", status: "connected", capabilities: [], metadata: {}, createdAt: initial.createdAt, updatedAt: initial.updatedAt } } },
    { workspace_version: 1, event_index: 4, event_type: "entity.created", collection: "tasks", entity_id: "task-a", payload: { document: { id: "task-a", entityType: "task", version: 1, title: "Task A", status: "todo", priority: "medium", description: "", dependsOn: [], assigneeAgentId: "codex", boardElementIds: ["api"], createdAt: initial.createdAt, updatedAt: initial.updatedAt } } },
  ];
  const applied = await applyCloudEvents(root, events, { actor: { id: "claude", client: "claude" } });
  const workspace = await readWorkspace(root);
  assert.equal(applied.applied, 5);
  assert.equal(workspace.project.name, "Cloud");
  assert.equal(workspace.project.root, path.resolve(root));
  assert.equal(workspace.entities.boards.architecture.elements.api.label, "API");
  assert.equal(workspace.entities.tasks["task-a"].assigneeAgentId, "codex");

  await applyCloudEvents(root, [{ workspace_version: 2, event_index: 0, event_type: "entity.updated", collection: "boards", entity_id: "architecture", payload: { document: { ...workspace.entities.boards.architecture, title: "Architecture v2", version: 2, elements: {} } } }]);
  const boardUpdated = await readWorkspace(root);
  assert.equal(boardUpdated.entities.boards.architecture.title, "Architecture v2");
  assert.equal(boardUpdated.entities.boards.architecture.elements.api.label, "API");

  const before = JSON.stringify(boardUpdated);
  await assert.rejects(() => applyCloudEvents(root, [{ workspace_version: 3, event_index: 0, event_type: "entity.updated", collection: "tasks", entity_id: "task-a", payload: { document: { ...boardUpdated.entities.tasks["task-a"], title: "divergent", version: 1 } } }]), /same version/i);
  assert.equal(JSON.stringify(await readWorkspace(root)), before);
});

test("rejects Secret Keys in publishable client configuration", () => {
  assert.throws(() => cloudConfigFromEnv({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_secret_invalid", MY_WHITEBOARD_SUPABASE_ACCESS_TOKEN: "user-jwt" }), /must never contain/i);
});
