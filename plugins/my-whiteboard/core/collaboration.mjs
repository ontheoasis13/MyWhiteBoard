import { randomUUID } from "node:crypto";
import { applyWorkspaceTransaction, getChangesSince, readWorkspace } from "./store.mjs";
import { clone } from "./schema.mjs";
import { connectAgent } from "./domain.mjs";
import { ValidationError } from "./errors.mjs";

export async function createHandoff(projectRoot, input, actor) {
  const entity = {
    id: String(input?.id || `handoff-${randomUUID().slice(0, 8)}`),
    title: String(input?.title || ""),
    summary: String(input?.summary || ""),
    fromAgentId: String(input?.fromAgentId || input?.from_agent_id || ""),
    toAgentId: String(input?.toAgentId || input?.to_agent_id || ""),
    status: String(input?.status || "open"),
    taskIds: Array.isArray(input?.taskIds || input?.task_ids) ? (input.taskIds || input.task_ids).map(String) : [],
    artifactIds: Array.isArray(input?.artifactIds || input?.artifact_ids) ? (input.artifactIds || input.artifact_ids).map(String) : [],
    boardIds: Array.isArray(input?.boardIds || input?.board_ids) ? (input.boardIds || input.board_ids).map(String) : [],
    metadata: clone(input?.metadata || {}),
  };
  const result = await applyWorkspaceTransaction(projectRoot, { actor, operations: [{ type: "entity.create", collection: "handoffs", entity }] });
  const workspace = await readWorkspace(projectRoot);
  return { ...result, handoff: workspace.entities.handoffs[entity.id] };
}

export async function updateHandoff(projectRoot, input, actor) {
  const id = String(input?.id || "");
  const expectedVersion = input?.expected_version ?? input?.expectedVersion;
  if (!id) throw new ValidationError("Handoff id is required.");
  const patch = clone(input?.patch || {});
  if (patch.status === "accepted") patch.acceptedAt ||= new Date().toISOString();
  if (patch.status === "completed") patch.completedAt ||= new Date().toISOString();
  const result = await applyWorkspaceTransaction(projectRoot, { actor, operations: [{ type: "entity.update", collection: "handoffs", id, expectedVersion, patch }] });
  const workspace = await readWorkspace(projectRoot);
  return { ...result, handoff: workspace.entities.handoffs[id] };
}

export async function sendMessage(projectRoot, input, actor) {
  const entity = {
    id: String(input?.id || `message-${randomUUID().slice(0, 8)}`),
    fromAgentId: String(input?.fromAgentId || input?.from_agent_id || ""),
    toAgentId: input?.toAgentId || input?.to_agent_id ? String(input.toAgentId || input.to_agent_id) : null,
    channel: String(input?.channel || "workspace"),
    kind: String(input?.kind || "update"),
    body: String(input?.body || ""),
    relatedEntityRefs: Array.isArray(input?.relatedEntityRefs || input?.related_entity_refs) ? clone(input.relatedEntityRefs || input.related_entity_refs) : [],
    readBy: [String(input?.fromAgentId || input?.from_agent_id || "")].filter(Boolean),
  };
  const result = await applyWorkspaceTransaction(projectRoot, { actor, operations: [{ type: "entity.create", collection: "messages", entity }] });
  const workspace = await readWorkspace(projectRoot);
  return { ...result, message: workspace.entities.messages[entity.id] };
}

export async function getMessages(projectRoot, filters = {}) {
  const workspace = await readWorkspace(projectRoot);
  const afterVersion = Number(filters.afterVersion ?? filters.after_version ?? 0);
  const eventEntityIds = afterVersion > 0
    ? new Set(workspace.eventLog.filter((event) => event.workspaceVersion > afterVersion && event.entityType === "message").map((event) => event.entityId))
    : null;
  const messages = Object.values(workspace.entities.messages)
    .filter((message) => !filters.agentId && !filters.agent_id || [message.fromAgentId, message.toAgentId].includes(filters.agentId || filters.agent_id))
    .filter((message) => !filters.channel || message.channel === filters.channel)
    .filter((message) => !eventEntityIds || eventEntityIds.has(message.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { messages, workspaceVersion: workspace.workspaceVersion };
}

export async function syncAgent(projectRoot, input) {
  const sinceVersion = Number(input?.sinceVersion ?? input?.since_version ?? 0);
  const connected = await connectAgent(projectRoot, input.agent, input.actor || input.agent);
  const delta = await getChangesSince(projectRoot, sinceVersion);
  return { agent: connected.agent, ...delta };
}
