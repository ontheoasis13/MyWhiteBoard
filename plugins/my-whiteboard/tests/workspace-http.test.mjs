import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { applyWorkspaceTransaction, createBoardEntity, createProjectWorkspace, startDevelopment } from "../core/index.mjs";
import { createWorkspaceHttpService } from "../server/workspace-http.mjs";
import { launchStandaloneWorkspace } from "../server/workspace-launcher.mjs";

test("serves a token-protected standalone workspace and Product View data", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-http-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "http-product-demo", type: "module" }), "utf8");
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "server.js"), "export function createServer(app) { app.get('/api/health', () => ({ status: 'ok' })); return app; }\n", "utf8");
  await createProjectWorkspace(projectRoot, { name: "HTTP Demo" });
  await applyWorkspaceTransaction(projectRoot, { operations: [{ type: "entity.create", collection: "boards", entity: createBoardEntity({ id: "main", title: "Main" }) }] });
  const service = createWorkspaceHttpService();
  try {
    const opened = await service.openWorkspace({ projectRoot, boardId: "main" });
    const url = new URL(opened.url);
    assert.equal(url.pathname, "/workspace/");
    assert.equal(url.searchParams.get("board"), "main");
    const page = await fetch(opened.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(await page.text(), /My Whiteboard/);
    const headers = { "x-my-whiteboard-session": url.searchParams.get("session"), "x-my-whiteboard-token": url.searchParams.get("token") };
    const session = await fetch(`${url.origin}/api/session`, { headers });
    assert.equal(session.status, 200);
    const snapshot = await session.json();
    assert.equal(snapshot.activeBoardId, "main");
    assert.equal(snapshot.workspace.entities.boards.main.title, "Main");

    const product = await fetch(`${url.origin}/api/session/product-model`, { headers });
    assert.equal(product.status, 200);
    const productPayload = await product.json();
    assert.equal(productPayload.model.modelType, "ProjectModel");
    assert.ok(productPayload.model.productMapProjection);
    assert.ok(["READY", "PARTIAL", "FAILED"].includes(productPayload.status));

    const started = await startDevelopment(projectRoot, { goal: "Add health endpoint", event_id: "http-start", actor: { id: "codex", client: "codex" } });
    const development = await fetch(`${url.origin}/api/session/development`, { headers });
    assert.equal(development.status, 200);
    const developmentPayload = await development.json();
    assert.equal(developmentPayload.primaryDevelopment.status, "IN_PROGRESS");
    const detail = await fetch(`${url.origin}/api/session/development/${started.change.id}`, { headers });
    assert.equal((await detail.json()).change.id, started.change.id);
    const accepted = await fetch(`${url.origin}/api/session/development/${started.change.id}/accept`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ expected_change_version: started.change.version }) });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).development.status, "ACCEPTED");

    const transaction = await fetch(`${url.origin}/api/session/transaction`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ operations: [{ type: "board.apply", boardId: "main", changes: [{ op: "create", element: { id: "node-1", kind: "node", semanticType: "concept", label: "Selected" } }] }] }) });
    assert.equal(transaction.status, 200);
    const selection = await fetch(`${url.origin}/api/session/selection`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ boardId: "main", elementIds: ["node-1", "not-semantic"] }) });
    assert.equal(selection.status, 200);
    assert.deepEqual((await selection.json()).selection.elementIds, ["node-1"]);
    const afterSelection = await fetch(`${url.origin}/api/session`, { headers });
    assert.deepEqual((await afterSelection.json()).workspace.entities.selections.main.elementIds, ["node-1"]);
    const rejected = await fetch(`${url.origin}/api/session`, { headers: { ...headers, "x-my-whiteboard-token": "invalid" } });
    assert.equal(rejected.status, 401);
  } finally {
    await service.stop();
  }
});

test("workspace_open launches a detached runtime that survives the MCP process lifecycle", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-detached-http-"));
  await createProjectWorkspace(projectRoot, { name: "Detached HTTP Demo" });
  await applyWorkspaceTransaction(projectRoot, { operations: [{ type: "entity.create", collection: "boards", entity: createBoardEntity({ id: "main", title: "Main" }) }] });
  const opened = await launchStandaloneWorkspace({ projectRoot, boardId: "main", name: "Detached HTTP Demo" }, { idleMs: 5_000 });
  try {
    assert.equal(opened.detached, true);
    assert.notEqual(opened.processId, process.pid);
    const page = await fetch(opened.url);
    assert.equal(page.status, 200);
    const url = new URL(opened.url);
    const session = await fetch(`${url.origin}/api/session`, { headers: { "x-my-whiteboard-session": url.searchParams.get("session"), "x-my-whiteboard-token": url.searchParams.get("token") } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).workspace.workspaceVersion, 2);
  } finally {
    try { process.kill(opened.processId, "SIGTERM"); } catch {}
  }
});
