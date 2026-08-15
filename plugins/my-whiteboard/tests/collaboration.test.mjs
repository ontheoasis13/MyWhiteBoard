import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import {
  applyDomainChanges,
  applyWorkspaceTransaction,
  connectAgent,
  createBoardEntity,
  createHandoff,
  createProjectWorkspace,
  getMessages,
  readWorkspace,
  sendMessage,
  syncAgent,
  updateHandoff,
} from "../core/index.mjs";
import { callWorkspaceTool, workspaceTools } from "../server/mcp.mjs";

function parseTextFallback(result) {
  const marker = "\n\nStructured result (JSON):\n";
  const text = result.content?.find((item) => item.type === "text")?.text || "";
  const markerIndex = text.indexOf(marker);
  assert.notEqual(markerIndex, -1, "MCP text content must include the structured JSON fallback");
  return JSON.parse(text.slice(markerIndex + marker.length));
}

test("Codex and Claude exchange a versioned handoff, message, and Delta", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-collaboration-"));
  await createProjectWorkspace(projectRoot, { name: "Collaboration" });
  await connectAgent(projectRoot, { id: "codex", displayName: "Codex", client: "codex", capabilities: ["code"] });
  await connectAgent(projectRoot, { id: "claude", displayName: "Claude", client: "claude", capabilities: ["review"] });
  await applyDomainChanges(projectRoot, "tasks", [{ op: "create", entity: { id: "review", title: "Review architecture", assigneeAgentId: "claude" } }], { id: "codex", client: "codex" });
  await applyDomainChanges(projectRoot, "artifacts", [{ op: "create", entity: { id: "brief", title: "Brief", kind: "file", path: "docs/IMPLEMENTATION_BRIEF.md" } }]);
  await applyWorkspaceTransaction(projectRoot, { operations: [{ type: "entity.create", collection: "boards", entity: createBoardEntity({ id: "architecture", title: "Architecture" }) }] });
  const beforeHandoff = (await readWorkspace(projectRoot)).workspaceVersion;

  const created = await createHandoff(projectRoot, {
    id: "codex-to-claude",
    title: "Architecture review",
    summary: "Review the semantic state boundary and report risks.",
    fromAgentId: "codex",
    toAgentId: "claude",
    taskIds: ["review"],
    artifactIds: ["brief"],
    boardIds: ["architecture"],
  }, { id: "codex", client: "codex" });
  assert.equal(created.handoff.version, 1);

  const accepted = await updateHandoff(projectRoot, { id: "codex-to-claude", expected_version: 1, patch: { status: "accepted" } }, { id: "claude", client: "claude" });
  assert.equal(accepted.handoff.version, 2);
  assert.ok(accepted.handoff.acceptedAt);
  await assert.rejects(
    () => updateHandoff(projectRoot, { id: "codex-to-claude", expected_version: 1, patch: { status: "cancelled" } }, { id: "codex", client: "codex" }),
    (error) => error.code === "VERSION_CONFLICT",
  );

  const sent = await sendMessage(projectRoot, { fromAgentId: "claude", toAgentId: "codex", kind: "response", body: "Boundary verified.", relatedEntityRefs: [{ collection: "handoffs", id: "codex-to-claude" }] }, { id: "claude", client: "claude" });
  const messages = await getMessages(projectRoot, { agent_id: "codex", after_version: accepted.workspaceVersion });
  assert.deepEqual(messages.messages.map((message) => message.id), [sent.message.id]);

  const synced = await syncAgent(projectRoot, { agent: { id: "codex", displayName: "Codex", client: "codex", capabilities: ["code"] }, since_version: beforeHandoff });
  assert.ok(synced.events.some((event) => event.type === "handoff.created"));
  assert.ok(synced.events.some((event) => event.type === "message.created"));
  assert.equal(synced.agent.version, 2);
});

test("handoffs reject missing Agents and references atomically", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-handoff-invalid-"));
  await createProjectWorkspace(projectRoot, { name: "Invalid handoff" });
  await connectAgent(projectRoot, { id: "codex", displayName: "Codex", client: "codex" });
  const before = await readWorkspace(projectRoot);
  await assert.rejects(
    () => createHandoff(projectRoot, { id: "invalid", title: "Invalid", summary: "Missing recipient", fromAgentId: "codex", toAgentId: "claude", taskIds: ["missing"] }),
    (error) => error.code === "VALIDATION_ERROR",
  );
  const after = await readWorkspace(projectRoot);
  assert.equal(after.workspaceVersion, before.workspaceVersion);
  assert.equal(after.entities.handoffs.invalid, undefined);
});

test("MCP text-only clients receive the complete structured result", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-mcp-text-"));
  await callWorkspaceTool("project_create", { project_root: projectRoot, name: "Text Fallback" });
  await callWorkspaceTool("agent_connect", {
    project_root: projectRoot,
    agent: { id: "workbuddy", displayName: "WorkBuddy", client: "WorkBuddy", status: "connected" },
  });

  const workspaceResult = await callWorkspaceTool("workspace_get", { project_root: projectRoot, include_events: false });
  const workspaceText = parseTextFallback(workspaceResult);
  assert.deepEqual(workspaceText, workspaceResult.structuredContent);
  assert.equal(workspaceText.workspace.project.name, "Text Fallback");
  assert.equal(workspaceText.workspace.entities.agents.workbuddy.version, 1);

  const syncResult = await callWorkspaceTool("agent_sync", {
    project_root: projectRoot,
    since_version: 0,
    agent: { id: "workbuddy", displayName: "WorkBuddy", client: "WorkBuddy", status: "connected" },
  });
  const syncText = parseTextFallback(syncResult);
  assert.deepEqual(syncText, syncResult.structuredContent);
  assert.equal(syncText.agent.id, "workbuddy");
  assert.equal(syncText.agent.version, 2);
  assert.ok(syncText.events.length >= 1);

  const deltaResult = await callWorkspaceTool("workspace_get_changes", { project_root: projectRoot, since_version: 0 });
  const deltaText = parseTextFallback(deltaResult);
  assert.deepEqual(deltaText, deltaResult.structuredContent);
  assert.equal(deltaText.workspaceVersion, syncText.workspaceVersion);
  assert.ok(deltaText.events.some((event) => event.type === "agent.updated"));
});

test("MCP schemas expose Board change shapes and valid Task statuses", () => {
  const boardTool = workspaceTools.find((tool) => tool.name === "board_apply");
  const boardVariants = boardTool.inputSchema.properties.changes.items.oneOf;
  const boardCreate = boardVariants.find((variant) => variant.properties.op.const === "create");
  const boardUpdate = boardVariants.find((variant) => variant.properties.op.const === "update");
  assert.deepEqual(boardCreate.required, ["op", "element"]);
  assert.equal(boardCreate.properties.entity, undefined);
  assert.ok(boardUpdate.required.includes("expectedVersion"));
  assert.equal(boardUpdate.properties.expected_version, undefined);

  const taskTool = workspaceTools.find((tool) => tool.name === "tasks_apply");
  const taskVariants = taskTool.inputSchema.properties.changes.items.oneOf;
  const taskCreate = taskVariants.find((variant) => variant.properties.op.const === "create");
  const taskUpdate = taskVariants.find((variant) => variant.properties.op.const === "update");
  assert.deepEqual(taskCreate.properties.entity.properties.status.enum, ["todo", "in_progress", "blocked", "done", "cancelled"]);
  assert.deepEqual(taskUpdate.properties.patch.properties.status.enum, ["todo", "in_progress", "blocked", "done", "cancelled"]);
  assert.equal(taskUpdate.properties.patch.properties.status.enum.includes("completed"), false);
});
