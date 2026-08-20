import { applyWorkspaceTransaction, readWorkspace } from "./store.mjs";
import { clone } from "./schema.mjs";
import { ValidationError } from "./errors.mjs";

export const DOMAIN_COLLECTIONS = Object.freeze(["contexts", "tasks", "decisions", "artifacts", "changes"]);

const DEFAULTS = {
  contexts: { kind: "project", title: "Context", content: "", sources: [], tags: [] },
  tasks: { title: "Task", status: "todo", priority: "medium", description: "", dependsOn: [], assigneeAgentId: null, boardElementIds: [] },
  decisions: { title: "Decision", status: "proposed", rationale: "", alternatives: [], boardElementIds: [] },
  artifacts: { title: "Artifact", kind: "file", status: "current", path: null, uri: null, boardId: null, metadata: {} },
  changes: { title: "Change", status: "draft", intent: "", featureId: null, contract: {}, desiredState: {}, acceptanceCriteria: [], constraints: [], relatedEntityRefs: [] },
};

function createEntity(collection, input) {
  return { ...clone(DEFAULTS[collection]), ...clone(input || {}) };
}

export function domainChangesToOperations(collection, changes) {
  if (!DOMAIN_COLLECTIONS.includes(collection)) throw new ValidationError(`Unsupported domain collection: ${collection}`);
  if (!Array.isArray(changes) || !changes.length) throw new ValidationError("At least one domain change is required.");
  return changes.map((change) => {
    if (change.op === "create") return { type: "entity.create", collection, entity: createEntity(collection, change.entity) };
    if (change.op === "update") return { type: "entity.update", collection, id: String(change.id || ""), expectedVersion: change.expected_version ?? change.expectedVersion, patch: clone(change.patch || {}) };
    if (change.op === "delete") return { type: "entity.delete", collection, id: String(change.id || ""), expectedVersion: change.expected_version ?? change.expectedVersion };
    throw new ValidationError(`Unsupported domain change: ${change.op}`);
  });
}

export async function applyDomainChanges(projectRoot, collection, changes, actor) {
  const result = await applyWorkspaceTransaction(projectRoot, { actor, operations: domainChangesToOperations(collection, changes) });
  const workspace = await readWorkspace(projectRoot);
  return { ...result, entities: workspace.entities[collection] };
}

export async function connectAgent(projectRoot, input, actor = input) {
  const agent = {
    id: String(input?.id || input?.agent_id || ""),
    displayName: String(input?.displayName || input?.display_name || input?.id || ""),
    client: String(input?.client || "unknown"),
    status: String(input?.status || "connected"),
    capabilities: Array.isArray(input?.capabilities) ? input.capabilities.map(String) : [],
    metadata: clone(input?.metadata || {}),
    lastSeenAt: new Date().toISOString(),
  };
  if (!agent.id) throw new ValidationError("Agent id is required.");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workspace = await readWorkspace(projectRoot);
    const current = workspace.entities.agents[agent.id];
    const operation = current
      ? { type: "entity.update", collection: "agents", id: agent.id, expectedVersion: current.version, patch: agent }
      : { type: "entity.create", collection: "agents", entity: agent };
    try {
      const result = await applyWorkspaceTransaction(projectRoot, { actor, operations: [operation] });
      const updated = await readWorkspace(projectRoot);
      return { ...result, agent: updated.entities.agents[agent.id] };
    } catch (error) {
      if (error?.code !== "VERSION_CONFLICT" || attempt === 2) throw error;
    }
  }
}
