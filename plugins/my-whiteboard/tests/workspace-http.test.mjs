import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { applyWorkspaceTransaction, createBoardEntity, createProjectWorkspace } from "../core/index.mjs";
import { createWorkspaceHttpService } from "../server/workspace-http.mjs";
import { launchStandaloneWorkspace } from "../server/workspace-launcher.mjs";

test("serves a token-protected standalone workspace without iframe embedding", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-http-"));
  await createProjectWorkspace(projectRoot, { name: "HTTP Demo" });
  await applyWorkspaceTransaction(projectRoot, {
    operations: [{ type: "entity.create", collection: "boards", entity: createBoardEntity({ id: "main", title: "Main" }) }],
  });
  const service = createWorkspaceHttpService();
  try {
    const opened = await service.openWorkspace({ projectRoot, boardId: "main" });
    const url = new URL(opened.url);
    assert.equal(url.pathname, "/workspace/");
    assert.equal(url.searchParams.get("board"), "main");
    const page = await fetch(opened.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(await page.text(), /My Whiteboard 工作区/);
    const headers = {
      "x-my-whiteboard-session": url.searchParams.get("session"),
      "x-my-whiteboard-token": url.searchParams.get("token"),
    };
    const session = await fetch(`${url.origin}/api/session`, { headers });
    assert.equal(session.status, 200);
    const snapshot = await session.json();
    assert.equal(snapshot.activeBoardId, "main");
    assert.equal(snapshot.workspace.entities.boards.main.title, "Main");
    const transaction = await fetch(`${url.origin}/api/session/transaction`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ operations: [{ type: "board.apply", boardId: "main", changes: [{ op: "create", element: { id: "node-1", kind: "node", semanticType: "concept", label: "Selected" } }] }] }),
    });
    assert.equal(transaction.status, 200);
    const selection = await fetch(`${url.origin}/api/session/selection`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ boardId: "main", elementIds: ["node-1", "not-semantic"] }),
    });
    assert.equal(selection.status, 200);
    const persistedSelection = await selection.json();
    assert.deepEqual(persistedSelection.selection.elementIds, ["node-1"]);
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
  await applyWorkspaceTransaction(projectRoot, {
    operations: [{ type: "entity.create", collection: "boards", entity: createBoardEntity({ id: "main", title: "Main" }) }],
  });
  const opened = await launchStandaloneWorkspace({ projectRoot, boardId: "main", name: "Detached HTTP Demo" }, { idleMs: 5_000 });
  try {
    assert.equal(opened.detached, true);
    assert.notEqual(opened.processId, process.pid);
    const page = await fetch(opened.url);
    assert.equal(page.status, 200);
    const url = new URL(opened.url);
    const session = await fetch(`${url.origin}/api/session`, {
      headers: {
        "x-my-whiteboard-session": url.searchParams.get("session"),
        "x-my-whiteboard-token": url.searchParams.get("token"),
      },
    });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).workspace.workspaceVersion, 2);
  } finally {
    try { process.kill(opened.processId, "SIGTERM"); } catch {}
  }
});
