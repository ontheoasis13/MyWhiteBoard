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
