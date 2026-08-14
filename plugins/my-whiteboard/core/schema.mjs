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
]);

export const BOARD_KINDS = new Set(["node", "edge", "text", "note", "group", "section"]);

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
  return {
    ...clone(input),
    id,
    entityType: String(input.entityType || collection.slice(0, -1)),
    version: 1,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
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

export function validateWorkspace(workspace) {
  if (!workspace || typeof workspace !== "object") throw new ValidationError("Workspace document must be an object.");
  if (workspace.schemaVersion !== WORKSPACE_SCHEMA_VERSION) throw new ValidationError(`Unsupported workspace schema: ${workspace.schemaVersion}`);
  if (!Number.isInteger(workspace.workspaceVersion) || workspace.workspaceVersion < 1) throw new ValidationError("workspaceVersion must be a positive integer.");
  if (!workspace.project?.id || !Number.isInteger(workspace.project.version)) throw new ValidationError("Project entity is invalid.");
  if (!workspace.entities || typeof workspace.entities !== "object") throw new ValidationError("Workspace entities are missing.");
  for (const collection of ENTITY_COLLECTIONS) {
    if (!workspace.entities[collection] || typeof workspace.entities[collection] !== "object") throw new ValidationError(`Entity collection is missing: ${collection}`);
  }
  if (!Array.isArray(workspace.eventLog)) throw new ValidationError("eventLog must be an array.");
  if (!workspace.imports || typeof workspace.imports !== "object") throw new ValidationError("imports must be an object.");
  return workspace;
}
