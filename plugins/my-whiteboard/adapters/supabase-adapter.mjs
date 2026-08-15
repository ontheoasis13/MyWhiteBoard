import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyCloudEvents, readWorkspace, workspacePaths } from "../core/store.mjs";
import { clone, normalizeActor } from "../core/schema.mjs";
import { ConflictError, ValidationError } from "../core/errors.mjs";

const COLLECTION_ORDER = [
  "projects", "contexts", "boards", "board_elements", "agents", "tasks",
  "decisions", "artifacts", "handoffs", "messages", "selections",
];

function rowKey(row) {
  return `${row.collection}\u0000${row.entityId ?? row.entity_id}`;
}

function comparable(value) {
  return JSON.stringify(value);
}

export function flattenWorkspace(workspace) {
  const { root: _localRoot, ...portableProject } = clone(workspace.project);
  const rows = [{ collection: "projects", entityId: workspace.project.id, parentEntityId: null, entityVersion: workspace.project.version, document: portableProject }];
  for (const collection of COLLECTION_ORDER) {
    if (["projects", "board_elements"].includes(collection)) continue;
    const entities = workspace.entities[collection] || {};
    for (const entity of Object.values(entities)) {
      if (collection === "boards") {
        const board = clone(entity);
        const elements = board.elements || {};
        board.elements = {};
        rows.push({ collection, entityId: board.id, parentEntityId: null, entityVersion: board.version, document: board });
        for (const element of Object.values(elements)) {
          rows.push({
            collection: "board_elements",
            entityId: `${board.id}/${element.id}`,
            parentEntityId: board.id,
            entityVersion: element.version,
            document: clone(element),
          });
        }
      } else {
        rows.push({ collection, entityId: entity.id, parentEntityId: null, entityVersion: entity.version, document: clone(entity) });
      }
    }
  }
  return rows.sort((left, right) => COLLECTION_ORDER.indexOf(left.collection) - COLLECTION_ORDER.indexOf(right.collection) || left.entityId.localeCompare(right.entityId));
}

export function buildCloudChanges(localRows, remoteRows, deletedKeys = new Set()) {
  const remote = new Map(remoteRows.map((row) => [rowKey(row), row]));
  const changes = [];
  for (const row of localRows) {
    const key = rowKey(row);
    const current = remote.get(key);
    if (!current) {
      changes.push({ op: "create", collection: row.collection, entityId: row.entityId, parentEntityId: row.parentEntityId, document: row.document });
      continue;
    }
    const remoteVersion = Number(current.entityVersion ?? current.entity_version);
    const remoteDocument = current.document;
    if (row.entityVersion < remoteVersion) throw new ConflictError("Cloud Entity is newer than the local snapshot.", { collection: row.collection, entityId: row.entityId, localVersion: row.entityVersion, cloudVersion: remoteVersion });
    if (row.entityVersion === remoteVersion) {
      if (comparable(row.document) !== comparable(remoteDocument)) throw new ConflictError("Local and cloud Entities have the same version but different content.", { collection: row.collection, entityId: row.entityId, version: row.entityVersion });
      continue;
    }
    changes.push({ op: "update", collection: row.collection, entityId: row.entityId, parentEntityId: row.parentEntityId, expectedVersion: remoteVersion, document: row.document });
  }
  for (const row of remoteRows) {
    if (!deletedKeys.has(rowKey(row))) continue;
    changes.push({ op: "delete", collection: row.collection, entityId: row.entityId ?? row.entity_id, expectedVersion: Number(row.entityVersion ?? row.entity_version) });
  }
  return changes;
}

export function deletedCloudKeysSince(workspace, sinceVersion, remoteRows = []) {
  const keys = new Set();
  const singular = { project: "projects", context: "contexts", board: "boards", task: "tasks", decision: "decisions", artifact: "artifacts", agent: "agents", handoff: "handoffs", message: "messages", selection: "selections" };
  for (const event of workspace.eventLog.filter((item) => item.workspaceVersion > Number(sinceVersion || 0))) {
    if (event.type.endsWith(".deleted") && singular[event.entityType]) keys.add(`${singular[event.entityType]}\u0000${event.entityId}`);
    if (event.type === "board.elements.applied") {
      for (const change of event.payload?.changes || []) if (change.op === "delete") keys.add(`board_elements\u0000${event.entityId}/${change.id}`);
    }
  }
  for (const key of [...keys]) {
    if (!key.startsWith("boards\u0000")) continue;
    const boardId = key.split("\u0000")[1];
    for (const row of remoteRows) if ((row.collection === "board_elements") && (row.parentEntityId ?? row.parent_entity_id) === boardId) keys.add(rowKey(row));
  }
  return keys;
}

export function cloudConfigFromEnv(env = process.env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || "");
  const accessToken = String(env.MY_WHITEBOARD_SUPABASE_ACCESS_TOKEN || "");
  if (publishableKey.startsWith("sb_secret_")) throw new ValidationError("SUPABASE_PUBLISHABLE_KEY must never contain a Supabase Secret Key.");
  return { url, publishableKey, accessToken, configured: Boolean(url && publishableKey && accessToken) };
}

export function cloudStatePath(projectRoot) {
  return path.join(workspacePaths(projectRoot).directory, "cloud.json");
}

async function readCloudState(projectRoot) {
  try { return JSON.parse(await readFile(cloudStatePath(projectRoot), "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return {}; throw error; }
}

async function writeCloudState(projectRoot, state) {
  const file = cloudStatePath(projectRoot);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

function isPristine(workspace) {
  return Object.values(workspace.entities).every((collection) => Object.keys(collection).length === 0);
}

export class SupabaseWorkspaceAdapter {
  constructor(config = cloudConfigFromEnv()) {
    this.config = config;
  }

  assertConfigured() {
    if (!this.config.configured) throw new ValidationError("Cloud sync is not configured. Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and MY_WHITEBOARD_SUPABASE_ACCESS_TOKEN before starting Codex.");
  }

  async request(endpoint, options = {}) {
    this.assertConfigured();
    const response = await fetch(`${this.config.url}/rest/v1/${endpoint}`, {
      method: options.method || "GET",
      headers: {
        apikey: this.config.publishableKey,
        authorization: `Bearer ${this.config.accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = data?.message || data?.error || `Supabase request failed (${response.status}).`;
      if (data?.code === "40001" || /version conflict/i.test(message)) throw new ConflictError(message, data);
      throw Object.assign(new Error(message), { code: data?.code || "CLOUD_ERROR", details: data });
    }
    return data;
  }

  async ensureProject(workspace) {
    return this.request("rpc/ensure_workspace_project", { method: "POST", body: { p_local_id: workspace.project.id, p_name: workspace.project.name, p_schema_version: workspace.schemaVersion, p_project: {} } });
  }

  async findProject(localId) {
    const rows = await this.request(`workspace_projects?select=id,local_id,name,schema_version,workspace_version,updated_at&local_id=eq.${encodeURIComponent(localId)}&limit=1`);
    return rows?.[0] || null;
  }

  async listEntities(workspaceId) {
    return this.request(`workspace_entities?select=collection,entity_id,parent_entity_id,entity_version,document&workspace_id=eq.${encodeURIComponent(workspaceId)}&order=collection.asc,entity_id.asc`);
  }

  async getDelta(workspaceId, sinceVersion = 0) {
    return this.request(`workspace_events?select=workspace_version,event_index,transaction_id,event_type,collection,entity_id,actor,payload,created_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&workspace_version=gt.${Number(sinceVersion || 0)}&order=workspace_version.asc,event_index.asc`);
  }

  async push(projectRoot, actor) {
    const workspace = await readWorkspace(projectRoot);
    const state = await readCloudState(projectRoot);
    const cloudProject = await this.ensureProject(workspace);
    const workspaceId = cloudProject.id;
    if (state.workspaceId && state.workspaceId !== workspaceId) throw new ConflictError("Local cloud metadata points to a different Workspace.", { expected: state.workspaceId, actual: workspaceId });
    const remoteRows = await this.listEntities(workspaceId);
    const localRows = flattenWorkspace(workspace);
    const deletedKeys = deletedCloudKeysSince(workspace, state.lastPushedLocalWorkspaceVersion || 0, remoteRows);
    const changes = buildCloudChanges(localRows, remoteRows, deletedKeys);
    let result = { workspaceVersion: Number(cloudProject.workspace_version || 0), changeCount: 0, idempotent: true };
    if (changes.length) {
      result = await this.request("rpc/apply_workspace_changes", { method: "POST", body: { p_workspace_id: workspaceId, p_transaction_id: randomUUID(), p_actor: normalizeActor(actor || "cloud-sync"), p_changes: changes } });
    }
    await writeCloudState(projectRoot, {
      workspaceId,
      lastPushedLocalWorkspaceVersion: workspace.workspaceVersion,
      lastPulledCloudWorkspaceVersion: Number(result.workspaceVersion || cloudProject.workspace_version || 0),
      lastLocalWorkspaceVersion: workspace.workspaceVersion,
      updatedAt: new Date().toISOString(),
    });
    return { workspaceId, localWorkspaceVersion: workspace.workspaceVersion, cloudWorkspaceVersion: Number(result.workspaceVersion || 0), changes: changes.length };
  }

  async pull(projectRoot, actor) {
    const workspace = await readWorkspace(projectRoot);
    const state = await readCloudState(projectRoot);
    if (state.lastLocalWorkspaceVersion && workspace.workspaceVersion > state.lastLocalWorkspaceVersion) {
      throw new ConflictError("Local changes must be pushed before pulling cloud changes.", { localWorkspaceVersion: workspace.workspaceVersion, lastSynchronizedLocalVersion: state.lastLocalWorkspaceVersion });
    }
    if (!state.lastLocalWorkspaceVersion && !isPristine(workspace)) {
      throw new ConflictError("Initial cloud pull requires an empty local Workspace. Push or back up the local Workspace first.");
    }
    const cloudProject = state.workspaceId
      ? { id: state.workspaceId }
      : await this.findProject(workspace.project.id);
    if (!cloudProject?.id) throw Object.assign(new Error("Cloud Workspace not found."), { code: "NOT_FOUND" });
    const events = await this.getDelta(cloudProject.id, state.lastPulledCloudWorkspaceVersion || 0);
    const cloudWorkspaceVersion = events.length ? Number(events.at(-1).workspace_version) : Number(state.lastPulledCloudWorkspaceVersion || 0);
    const applied = await applyCloudEvents(projectRoot, events, { actor, cloudWorkspaceVersion });
    await writeCloudState(projectRoot, {
      ...state,
      workspaceId: cloudProject.id,
      lastPulledCloudWorkspaceVersion: cloudWorkspaceVersion,
      lastPushedLocalWorkspaceVersion: state.lastPushedLocalWorkspaceVersion || 0,
      lastLocalWorkspaceVersion: applied.workspaceVersion,
      updatedAt: new Date().toISOString(),
    });
    return { workspaceId: cloudProject.id, events: events.length, ...applied };
  }

  async status(projectRoot) {
    const state = await readCloudState(projectRoot);
    return { configured: this.config.configured, workspaceId: state.workspaceId || null, state };
  }
}
