import { randomUUID } from "node:crypto";
import path from "node:path";
import { ValidationError } from "./errors.mjs";

export const WORKSPACE_SCHEMA_VERSION = 2;
export const ENTITY_COLLECTIONS = Object.freeze([
  "contexts",
  "boards",
  "tasks",
  "decisions",
  "artifacts",
  "agents",
  "handoffs",
  "messages",
  "selections",
  "changes",
  "executions",
]);

export const BOARD_KINDS = new Set(["node", "edge", "text", "note", "group", "section"]);
export const TASK_STATUSES = new Set(["todo", "in_progress", "blocked", "done", "cancelled"]);
export const DECISION_STATUSES = new Set(["proposed", "accepted", "rejected", "superseded"]);
export const AGENT_STATUSES = new Set(["connected", "idle", "working", "offline", "error"]);
export const HANDOFF_STATUSES = new Set(["open", "accepted", "completed", "cancelled"]);
export const MESSAGE_KINDS = new Set(["update", "request", "response", "conflict", "system"]);
export const CHANGE_STATUSES = new Set(["draft", "approved", "executing", "completed", "interrupted", "failed", "cancelled"]);
export const EXECUTION_STATUSES = new Set(["queued", "running", "completed", "interrupted", "failed", "cancelled"]);

const ENTITY_DEFAULTS = Object.freeze({
  contexts: { kind: "project", title: "Context", content: "", sources: [], tags: [] },
  tasks: { status: "todo", priority: "medium", description: "", dependsOn: [], assigneeAgentId: null, boardElementIds: [] },
  decisions: { status: "proposed", rationale: "", alternatives: [], boardElementIds: [] },
  artifacts: { kind: "file", status: "current", path: null, uri: null, boardId: null, metadata: {} },
  agents: { status: "connected", capabilities: [], metadata: {} },
  handoffs: { status: "open", taskIds: [], artifactIds: [], boardIds: [], metadata: {} },
  messages: { kind: "update", toAgentId: null, channel: "workspace", relatedEntityRefs: [], readBy: [] },
  selections: { elementIds: [] },
  changes: { status: "draft", intent: "", featureId: null, targetFeatureIds: [], baseline: null, contract: {}, desiredState: {}, acceptanceCriteria: [], constraints: [], relatedEntityRefs: [] },
  executions: { status: "queued", changeId: null, agentId: null, adapterId: null, input: {}, output: {}, error: null, lifecycle: [], repoBefore: null, repoAfter: null, repoChange: null },
});

export function timestamp() {
  return new Date().toISOString();
}

export function slug(value, fallback = "project") {
  const result = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  return result || `${fallback}-${randomUUID().slice(0, 8)}`;
}

export function clone(value) {
  return structuredClone(value);
}

/**
 * Add collections introduced after Workspace schema v2 without changing the
 * schema version. This keeps existing 0.2 workspaces readable and makes the
 * migration explicit instead of silently dropping execution state.
 */
export function migrateWorkspaceDocument(input) {
  const workspace = clone(input);
  workspace.entities ||= {};
  for (const collection of ENTITY_COLLECTIONS) workspace.entities[collection] ||= {};
  return workspace;
}

export function createWorkspaceDocument({ projectRoot, name, projectId, actor = "system" }) {
  const now = timestamp();
  const id = projectId || slug(name || path.basename(projectRoot), "project");
  const project = {
    id,
    entityType: "project",
    version: 1,
    name: String(name || path.basename(projectRoot) || "My Whiteboard Project"),
    root: path.resolve(projectRoot),
    overview: "",
    createdAt: now,
    updatedAt: now,
  };
  const event = {
    id: randomUUID(),
    transactionId: randomUUID(),
    workspaceVersion: 1,
    index: 0,
    type: "project.created",
    entityType: "project",
    entityId: id,
    actor: normalizeActor(actor),
    timestamp: now,
    payload: { project: clone(project) },
  };
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    workspaceVersion: 1,
    project,
    entities: Object.fromEntries(ENTITY_COLLECTIONS.map((collection) => [collection, {}])),
    imports: {},
    eventLog: [event],
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeActor(actor) {
  if (typeof actor === "string") return { id: actor, displayName: actor, client: "unknown" };
  const input = actor && typeof actor === "object" ? actor : {};
  const id = String(input.id || input.agent_id || "system");
  return {
    id,
    displayName: String(input.displayName || input.display_name || id),
    client: String(input.client || "unknown"),
  };
}

export function normalizeEntity(collection, input, now = timestamp()) {
  if (!ENTITY_COLLECTIONS.includes(collection)) throw new ValidationError(`Unknown entity collection: ${collection}`);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("Entity must be an object.");
  const id = String(input.id || `${collection.slice(0, -1)}-${randomUUID().slice(0, 8)}`);
  const entity = {
    ...clone(ENTITY_DEFAULTS[collection] || {}),
    ...clone(input),
    id,
    entityType: String(input.entityType || collection.slice(0, -1)),
    version: 1,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
  if (collection === "agents") {
    entity.displayName ||= id;
    entity.client ||= "unknown";
  }
  return entity;
}

export function normalizeBoardElement(input, now = timestamp()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("Board element must be an object.");
  const kind = BOARD_KINDS.has(input.kind) ? input.kind : "node";
  const id = String(input.id || `${kind}-${randomUUID().slice(0, 8)}`);
  const layout = input.layout && typeof input.layout === "object" ? clone(input.layout) : {};
  return {
    ...clone(input),
    id,
    kind,
    semanticType: String(input.semanticType || (kind === "node" ? "concept" : kind)),
    label: String(input.label || ""),
    properties: input.properties && typeof input.properties === "object" ? clone(input.properties) : {},
    layout,
    version: 1,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

export function createBoardEntity({ id, title, boardType = "diagram", description = "", elements = [] }) {
  const now = timestamp();
  const normalized = elements.map((element) => normalizeBoardElement(element, now));
  return {
    id: id || slug(title || "board", "board"),
    entityType: "board",
    version: 1,
    title: String(title || "Untitled board"),
    boardType: String(boardType),
    description: String(description),
    elements: Object.fromEntries(normalized.map((element) => [element.id, element])),
    order: normalized.map((element) => element.id),
    createdAt: now,
    updatedAt: now,
  };
}

function requireText(entity, field, collection) {
  if (!String(entity[field] || "").trim()) throw new ValidationError(`${collection}.${field} is required.`, { collection, entityId: entity.id, field });
}

function requireStringArray(entity, field, collection) {
  if (!Array.isArray(entity[field]) || entity[field].some((value) => typeof value !== "string")) {
    throw new ValidationError(`${collection}.${field} must be an array of strings.`, { collection, entityId: entity.id, field });
  }
}

export function validateDomainEntity(collection, entity, workspace) {
  if (!entity?.id || !Number.isInteger(entity.version) || entity.version < 1) throw new ValidationError("Entity identity or version is invalid.", { collection, entityId: entity?.id });
  if (collection === "boards") {
    requireText(entity, "title", collection);
    if (!entity.elements || typeof entity.elements !== "object" || !Array.isArray(entity.order)) throw new ValidationError("Board elements and order are required.", { entityId: entity.id });
  }
  if (collection === "contexts") {
    requireText(entity, "title", collection);
    requireText(entity, "content", collection);
    requireStringArray(entity, "sources", collection);
  }
  if (collection === "tasks") {
    requireText(entity, "title", collection);
    if (!TASK_STATUSES.has(entity.status)) throw new ValidationError(`Invalid task status: ${entity.status}`, { entityId: entity.id });
    requireStringArray(entity, "dependsOn", collection);
    if (entity.dependsOn.includes(entity.id)) throw new ValidationError("A task cannot depend on itself.", { entityId: entity.id });
    for (const dependencyId of entity.dependsOn) {
      if (workspace && !workspace.entities.tasks[dependencyId]) throw new ValidationError("Task dependency does not exist.", { entityId: entity.id, dependencyId });
    }
    if (entity.assigneeAgentId && workspace && !workspace.entities.agents[entity.assigneeAgentId]) throw new ValidationError("Assigned Agent does not exist.", { entityId: entity.id, assigneeAgentId: entity.assigneeAgentId });
  }
  if (collection === "decisions") {
    requireText(entity, "title", collection);
    requireText(entity, "rationale", collection);
    if (!DECISION_STATUSES.has(entity.status)) throw new ValidationError(`Invalid decision status: ${entity.status}`, { entityId: entity.id });
  }
  if (collection === "artifacts") {
    requireText(entity, "title", collection);
    requireText(entity, "kind", collection);
    if (!entity.path && !entity.uri && !entity.boardId) throw new ValidationError("Artifact requires path, uri, or boardId.", { entityId: entity.id });
  }
  if (collection === "agents") {
    requireText(entity, "displayName", collection);
    requireText(entity, "client", collection);
    if (!AGENT_STATUSES.has(entity.status)) throw new ValidationError(`Invalid Agent status: ${entity.status}`, { entityId: entity.id });
    requireStringArray(entity, "capabilities", collection);
  }
  if (collection === "handoffs") {
    requireText(entity, "title", collection);
    requireText(entity, "summary", collection);
    requireText(entity, "fromAgentId", collection);
    requireText(entity, "toAgentId", collection);
    if (entity.fromAgentId === entity.toAgentId) throw new ValidationError("Handoff requires two different Agents.", { entityId: entity.id });
    if (!HANDOFF_STATUSES.has(entity.status)) throw new ValidationError(`Invalid handoff status: ${entity.status}`, { entityId: entity.id });
    for (const field of ["taskIds", "artifactIds", "boardIds"]) requireStringArray(entity, field, collection);
    if (workspace) {
      if (!workspace.entities.agents[entity.fromAgentId] || !workspace.entities.agents[entity.toAgentId]) throw new ValidationError("Handoff Agent does not exist.", { entityId: entity.id });
      for (const id of entity.taskIds) if (!workspace.entities.tasks[id]) throw new ValidationError("Handoff Task does not exist.", { entityId: entity.id, taskId: id });
      for (const id of entity.artifactIds) if (!workspace.entities.artifacts[id]) throw new ValidationError("Handoff Artifact does not exist.", { entityId: entity.id, artifactId: id });
      for (const id of entity.boardIds) if (!workspace.entities.boards[id]) throw new ValidationError("Handoff Board does not exist.", { entityId: entity.id, boardId: id });
    }
  }
  if (collection === "messages") {
    requireText(entity, "fromAgentId", collection);
    requireText(entity, "body", collection);
    if (!MESSAGE_KINDS.has(entity.kind)) throw new ValidationError(`Invalid message kind: ${entity.kind}`, { entityId: entity.id });
    if (!entity.toAgentId && !entity.channel) throw new ValidationError("Message requires toAgentId or channel.", { entityId: entity.id });
    requireStringArray(entity, "readBy", collection);
    if (!Array.isArray(entity.relatedEntityRefs)) throw new ValidationError("messages.relatedEntityRefs must be an array.", { entityId: entity.id });
    if (workspace) {
      if (!workspace.entities.agents[entity.fromAgentId]) throw new ValidationError("Message sender Agent does not exist.", { entityId: entity.id, agentId: entity.fromAgentId });
      if (entity.toAgentId && !workspace.entities.agents[entity.toAgentId]) throw new ValidationError("Message recipient Agent does not exist.", { entityId: entity.id, agentId: entity.toAgentId });
    }
  }
  if (collection === "selections") {
    requireText(entity, "boardId", collection);
    requireStringArray(entity, "elementIds", collection);
  }
  if (collection === "changes") {
    requireText(entity, "title", collection);
    if (!CHANGE_STATUSES.has(entity.status)) throw new ValidationError(`Invalid Change status: ${entity.status}`, { entityId: entity.id });
    if (!entity.contract || typeof entity.contract !== "object" || Array.isArray(entity.contract)) throw new ValidationError("Change contract must be an object.", { entityId: entity.id });
    if (!Array.isArray(entity.acceptanceCriteria) || entity.acceptanceCriteria.some((value) => typeof value !== "string")) throw new ValidationError("Change acceptanceCriteria must be an array of strings.", { entityId: entity.id });
    if (!Array.isArray(entity.constraints) || entity.constraints.some((value) => typeof value !== "string")) throw new ValidationError("Change constraints must be an array of strings.", { entityId: entity.id });
  }
  if (collection === "executions") {
    requireText(entity, "changeId", collection);
    requireText(entity, "agentId", collection);
    requireText(entity, "adapterId", collection);
    if (!EXECUTION_STATUSES.has(entity.status)) throw new ValidationError(`Invalid Execution status: ${entity.status}`, { entityId: entity.id });
    if (!Array.isArray(entity.lifecycle)) throw new ValidationError("Execution lifecycle must be an array.", { entityId: entity.id });
  }
  return entity;
}

export function validateWorkspace(workspace) {
  if (!workspace || typeof workspace !== "object") throw new ValidationError("Workspace document must be an object.");
  if (workspace.schemaVersion !== WORKSPACE_SCHEMA_VERSION) throw new ValidationError(`Unsupported workspace schema: ${workspace.schemaVersion}`);
  if (!Number.isInteger(workspace.workspaceVersion) || workspace.workspaceVersion < 1) throw new ValidationError("workspaceVersion must be a positive integer.");
  if (!workspace.project?.id || !Number.isInteger(workspace.project.version)) throw new ValidationError("Project entity is invalid.");
  if (!workspace.entities || typeof workspace.entities !== "object") throw new ValidationError("Workspace entities are missing.");
  for (const collection of ENTITY_COLLECTIONS) {
    if (!workspace.entities[collection] || typeof workspace.entities[collection] !== "object") throw new ValidationError(`Entity collection is missing: ${collection}`);
    for (const entity of Object.values(workspace.entities[collection])) validateDomainEntity(collection, entity, workspace);
  }
  if (!Array.isArray(workspace.eventLog)) throw new ValidationError("eventLog must be an array.");
  if (!workspace.imports || typeof workspace.imports !== "object") throw new ValidationError("imports must be an object.");
  return workspace;
}
