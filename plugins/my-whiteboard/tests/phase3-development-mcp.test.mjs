import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { createProjectWorkspace } from "../core/index.mjs";
import { callWorkspaceTool, workspaceTools } from "../server/mcp.mjs";

test("MCP exposes the minimal four-tool Development protocol and state handoff", async () => {
  const names = workspaceTools.map((tool) => tool.name);
  assert.deepEqual(names.filter((name) => name.startsWith("development_")), ["development_context_get", "development_start", "development_update", "development_result"]);
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-phase3-mcp-"));
  await createProjectWorkspace(root, { name: "MCP Development" });
  const started = await callWorkspaceTool("development_start", { project_root: root, goal: "Add AI Interview", target_feature_ids: [], event_id: "start-1", agent: { id: "codex", displayName: "Codex", client: "codex" } }, {});
  assert.equal(started.structuredContent.change.development.status, "IN_PROGRESS");
  const context = await callWorkspaceTool("development_context_get", { project_root: root }, {});
  assert.equal(context.structuredContent.change.id, started.structuredContent.change.id);
  const result = await callWorkspaceTool("development_result", { project_root: root, change_id: started.structuredContent.change.id, event_id: "result-1", expected_change_version: started.structuredContent.change.version, summary: "完成实现", agent: { id: "codex", displayName: "Codex", client: "codex" } }, {});
  assert.equal(result.structuredContent.change.development.status, "READY_FOR_REVIEW");
});

