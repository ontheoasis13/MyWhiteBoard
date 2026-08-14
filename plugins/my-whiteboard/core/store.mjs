import { open, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError, ValidationError } from "./errors.mjs";
import {
  ENTITY_COLLECTIONS,
  clone,
  createWorkspaceDocument,
  normalizeActor,
  normalizeBoardElement,
  normalizeEntity,
  timestamp,
  validateDomainEntity,
  validateWorkspace,
} from "./schema.mjs";

const LOCK_RETRY_MS = 35;
const LOCK_TIMEOUT_MS = 7_500;
const STALE_LOCK_MS = 30_000;

export function workspacePaths(projectRoot) {
  const root = path.resolve(projectRoot);
  const directory = path.join(root, ".my-whiteboard");
  return {
    projectRoot: root,
    directory,
    workspace: path.join(directory, "workspace.json"),
    lock: path.join(directory, "lock"),
    snapshots: path.join(directory, "snapshots"),
    imports: path.join(directory, "imports"),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(lockPath, timeoutMs = LOCK_TIMEOUT_MS) {
  const started = Date.now();
  await mkdir(path.dirname(lockPath), { recursive: true });
  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: timestamp() }), "utf8");
      return async () => {
        await handle.close().catch(() => {});
        await unlink(lockPath).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > STALE_LOCK_MS) {
          await unlink(lockPath);
          continue;
        }
      } catch (inspectError) {
        if (inspectError?.code === "ENOENT") continue;
        throw inspectError;
      }
      if (Date.now() - started >= timeoutMs) throw new ConflictError("Workspace is busy. Retry after the active transaction finishes.", { lockPath });
      await sleep(LOCK_RETRY_MS);
    }
  }
}

export async function withWorkspaceLock(projectRoot, action, options = {}) {
  const paths = workspacePaths(projectRoot);
  const release = await acquireLock(paths.lock, options.timeoutMs);
  try {
    return await action(paths);
  } finally {
    await release();
  }
}

async function atomicWriteJson(file, value) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

async function readWorkspaceFile(file) {
  try {
    return validateWorkspace(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") throw new NotFoundError("My Whiteboard project has not been initialized.", { file });
    throw error;
  }
}

export async function createProjectWorkspace(projectRoot, options = {}) {
  return withWorkspaceLock(projectRoot, async (paths) => {
    await mkdir(paths.projectRoot, { recursive: true });
    await mkdir(paths.directory, { recursive: true });
    await mkdir(paths.snapshots, { recursive: true });
    await mkdir(paths.imports, { recursive: true });
    try {
      return await readWorkspaceFile(paths.workspace);
    } catch (error) {
      if (error?.code !== "NOT_FOUND") throw error;
    }
    const workspace = createWorkspaceDocument({
      projectRoot: paths.projectRoot,
      name: options.name,
      projectId: options.projectId,
      actor: options.actor,
    });
    await atomicWriteJson(paths.workspace, workspace);
    await atomicWriteJson(path.join(paths.snapshots, `${String(workspace.workspaceVersion).padStart(12, "0")}.json`), workspace);
    return clone(workspace);
  });
}

export async function readWorkspace(projectRoot) {
  return clone(await readWorkspaceFile(workspacePaths(projectRoot).workspace));
}

export async function getChangesSince(projectRoot, sinceVersion = 0) {
  const workspace = await readWorkspace(projectRoot);
  const since = Number(sinceVersion || 0);
  if (!Number.isInteger(since) || since < 0) throw new ValidationError("sinceVersion must be a non-negative integer.");
  return {
    projectId: workspace.project.id,
    fromVersion: since,
    workspaceVersion: workspace.workspaceVersion,
    events: workspace.eventLog.filter((event) => event.workspaceVersion > since),
  };
}

function deepMerge(current, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return clone(patch);
  const output = current && typeof current === "object" && !Array.isArray(current) ? clone(current) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (["id", "entityType", "version", "createdAt"].includes(key)) continue;
    output[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge(output[key], value)
      : clone(value);
  }
  return output;
}

function assertExpectedVersion(entity, expectedVersion, details) {
  if (!Number.isInteger(expectedVersion)) throw new ValidationError("expectedVersion is required for updates and deletes.", details);
  if (entity.version !== expectedVersion) {
    throw new ConflictError("Entity version is stale.", {
      ...details,
      expectedVersion,
      actualVersion: entity.version,
    });
  }
}

function eventFor({ transactionId, workspaceVersion, index, type, collection, entityId, actor, payload, now }) {
  return {
    id: randomUUID(),
    transactionId,
    workspaceVersion,
    index,
    type,
    entityType: collection ? collection.slice(0, -1) : "workspace",
    entityId,
    actor,
    timestamp: now,
    payload: clone(payload || {}),
  };
}

function applyEntityOperation(workspace, operation, context) {
  const { collection } = operation;
  if (!ENTITY_COLLECTIONS.includes(collection)) throw new ValidationError(`Unknown entity collection: ${collection}`);
  const entities = workspace.entities[collection];
  if (operation.type === "entity.create") {
    const entity = normalizeEntity(collection, operation.entity, context.now);
    if (entities[entity.id]) throw new ConflictError("Entity ID already exists.", { collection, entityId: entity.id });
    validateDomainEntity(collection, entity, workspace);
    entities[entity.id] = entity;
    return eventFor({ ...context, type: `${entity.entityType}.created`, collection, entityId: entity.id, payload: { entity } });
  }
  const id = String(operation.id || "");
  const current = entities[id];
  if (!current) throw new NotFoundError("Entity not found.", { collection, entityId: id });
  assertExpectedVersion(current, operation.expectedVersion, { collection, entityId: id });
  if (operation.type === "entity.update") {
    const next = deepMerge(current, operation.patch || {});
    next.id = current.id;
    next.entityType = current.entityType;
    next.createdAt = current.createdAt;
    next.version = current.version + 1;
    next.updatedAt = context.now;
    validateDomainEntity(collection, next, workspace);
    entities[id] = next;
    return eventFor({ ...context, type: `${current.entityType}.updated`, collection, entityId: id, payload: { patch: clone(operation.patch || {}), version: next.version } });
  }
  if (operation.type === "entity.delete") {
    delete entities[id];
    return eventFor({ ...context, type: `${current.entityType}.deleted`, collection, entityId: id, payload: { previousVersion: current.version } });
  }
  throw new ValidationError(`Unsupported entity operation: ${operation.type}`);
}

function applyBoardOperation(workspace, operation, context) {
  const boardId = String(operation.boardId || "");
  const board = workspace.entities.boards[boardId];
  if (!board) throw new NotFoundError("Board not found.", { boardId });
  board.elements ||= {};
  board.order ||= [];
  const changes = Array.isArray(operation.changes) ? operation.changes : [];
  if (!changes.length) throw new ValidationError("board.apply requires at least one change.", { boardId });
  const summaries = [];
  for (const change of changes) {
    if (change.op === "create") {
      const element = normalizeBoardElement(change.element, context.now);
      if (board.elements[element.id]) throw new ConflictError("Board element ID already exists.", { boardId, elementId: element.id });
      board.elements[element.id] = element;
      board.order.push(element.id);
      summaries.push({ op: "create", id: element.id, element: clone(element) });
      continue;
    }
    const elementId = String(change.id || "");
    const current = board.elements[elementId];
    if (!current) throw new NotFoundError("Board element not found.", { boardId, elementId });
    assertExpectedVersion(current, change.expectedVersion, { boardId, elementId });
    if (change.op === "update") {
      const next = deepMerge(current, change.patch || {});
      next.id = current.id;
      next.kind = current.kind;
      next.createdAt = current.createdAt;
      next.version = current.version + 1;
      next.updatedAt = context.now;
      board.elements[elementId] = next;
      summaries.push({ op: "update", id: elementId, patch: clone(change.patch || {}), version: next.version });
      continue;
    }
    if (change.op === "delete") {
      delete board.elements[elementId];
      board.order = board.order.filter((id) => id !== elementId);
      summaries.push({ op: "delete", id: elementId, previousVersion: current.version });
      continue;
    }
    throw new ValidationError(`Unsupported board change: ${change.op}`);
  }
  board.version += 1;
  board.updatedAt = context.now;
  return eventFor({ ...context, type: "board.elements.applied", collection: "boards", entityId: boardId, payload: { changes: summaries, boardVersion: board.version } });
}

function applyImportRecord(workspace, operation, context) {
  const record = clone(operation.record || {});
  if (!record.sourceHash) throw new ValidationError("Import record requires sourceHash.");
  if (workspace.imports[record.sourceHash]) throw new ConflictError("Legacy source was already imported.", { sourceHash: record.sourceHash });
  workspace.imports[record.sourceHash] = { ...record, importedAt: context.now };
  return eventFor({ ...context, type: "legacy.imported", entityId: record.boardId, payload: workspace.imports[record.sourceHash] });
}

export async function applyWorkspaceTransaction(projectRoot, transaction) {
  if (!transaction || typeof transaction !== "object") throw new ValidationError("Transaction must be an object.");
  const operations = Array.isArray(transaction.operations) ? transaction.operations : [];
  if (!operations.length) throw new ValidationError("Transaction requires at least one operation.");
  return withWorkspaceLock(projectRoot, async (paths) => {
    const workspace = await readWorkspaceFile(paths.workspace);
    const next = clone(workspace);
    const now = timestamp();
    const transactionId = String(transaction.id || randomUUID());
    const workspaceVersion = workspace.workspaceVersion + 1;
    const actor = normalizeActor(transaction.actor);
    const events = [];
    for (const [index, operation] of operations.entries()) {
      const context = { transactionId, workspaceVersion, index, actor, now };
      if (String(operation.type).startsWith("entity.")) events.push(applyEntityOperation(next, operation, context));
      else if (operation.type === "board.apply") events.push(applyBoardOperation(next, operation, context));
      else if (operation.type === "import.record") events.push(applyImportRecord(next, operation, context));
      else throw new ValidationError(`Unknown transaction operation: ${operation.type}`);
    }
    next.workspaceVersion = workspaceVersion;
    next.updatedAt = now;
    next.eventLog.push(...events);
    validateWorkspace(next);
    await atomicWriteJson(paths.workspace, next);
    await mkdir(paths.snapshots, { recursive: true });
    await atomicWriteJson(path.join(paths.snapshots, `${String(workspaceVersion).padStart(12, "0")}.json`), next).catch(() => {});
    return {
      transactionId,
      previousWorkspaceVersion: workspace.workspaceVersion,
      workspaceVersion,
      events: clone(events),
    };
  });
}

export async function updateProject(projectRoot, { expectedVersion, patch, actor }) {
  return withWorkspaceLock(projectRoot, async (paths) => {
    const workspace = await readWorkspaceFile(paths.workspace);
    assertExpectedVersion(workspace.project, expectedVersion, { entityType: "project", entityId: workspace.project.id });
    const now = timestamp();
    const transactionId = randomUUID();
    const workspaceVersion = workspace.workspaceVersion + 1;
    const project = deepMerge(workspace.project, patch || {});
    project.id = workspace.project.id;
    project.entityType = "project";
    project.createdAt = workspace.project.createdAt;
    project.version = workspace.project.version + 1;
    project.updatedAt = now;
    workspace.project = project;
    workspace.workspaceVersion = workspaceVersion;
    workspace.updatedAt = now;
    const event = eventFor({ transactionId, workspaceVersion, index: 0, type: "project.updated", entityId: project.id, actor: normalizeActor(actor), now, payload: { patch: clone(patch || {}), version: project.version } });
    workspace.eventLog.push(event);
    await atomicWriteJson(paths.workspace, workspace);
    await atomicWriteJson(path.join(paths.snapshots, `${String(workspaceVersion).padStart(12, "0")}.json`), workspace).catch(() => {});
    return { transactionId, workspaceVersion, project: clone(project), events: [event] };
  });
}

function cloudEventFields(event) {
  return {
    type: String(event.eventType || event.event_type || ""),
    collection: String(event.collection || ""),
    entityId: String(event.entityId || event.entity_id || ""),
    payload: clone(event.payload || {}),
    cloudWorkspaceVersion: Number(event.workspaceVersion ?? event.workspace_version ?? 0),
    cloudEventIndex: Number(event.eventIndex ?? event.event_index ?? 0),
  };
}

function sameDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeIncomingEntity(current, incoming, details) {
  if (!current) return clone(incoming);
  if (current.version > incoming.version) {
    throw new ConflictError("Local Entity is newer than the cloud Delta.", {
      ...details,
      localVersion: current.version,
      cloudVersion: incoming.version,
    });
  }
  if (current.version === incoming.version && !sameDocument(current, incoming)) {
    throw new ConflictError("Local and cloud Entities have the same version but different content.", {
      ...details,
      version: current.version,
    });
  }
  return current.version === incoming.version ? current : clone(incoming);
}

export async function applyCloudEvents(projectRoot, cloudEvents, options = {}) {
  if (!Array.isArray(cloudEvents)) throw new ValidationError("cloudEvents must be an array.");
  if (!cloudEvents.length) {
    const workspace = await readWorkspace(projectRoot);
    return { applied: 0, workspaceVersion: workspace.workspaceVersion, cloudWorkspaceVersion: Number(options.cloudWorkspaceVersion || 0) };
  }
  return withWorkspaceLock(projectRoot, async (paths) => {
    const workspace = await readWorkspaceFile(paths.workspace);
    const ordered = cloudEvents.map(cloudEventFields).sort((left, right) =>
      left.cloudWorkspaceVersion - right.cloudWorkspaceVersion || left.cloudEventIndex - right.cloudEventIndex
    );
    let applied = 0;
    for (const event of ordered) {
      const incoming = event.payload.document;
      const isDelete = event.type === "entity.deleted";
      if (!event.collection || !event.entityId) throw new ValidationError("Cloud event is missing collection or entity ID.", { event });
      if (event.collection === "projects") {
        if (isDelete) throw new ValidationError("Cloud Project deletion must be handled explicitly.");
        if (!incoming?.version) throw new ValidationError("Cloud Project event is missing a versioned document.");
        const candidate = { ...clone(incoming), id: workspace.project.id, root: workspace.project.root };
        const merged = mergeIncomingEntity(workspace.project, candidate, { collection: "projects", entityId: event.entityId });
        if (merged !== workspace.project) { workspace.project = merged; applied += 1; }
        continue;
      }
      if (event.collection === "board_elements") {
        const boardId = String(event.payload.parentEntityId || event.payload.parent_entity_id || "");
        const board = workspace.entities.boards[boardId];
        if (!board) throw new ValidationError("Cloud board element references a missing board.", { boardId, entityId: event.entityId });
        const elementId = incoming?.id || event.entityId.split("/").slice(1).join("/");
        const current = board.elements[elementId];
        if (isDelete) {
          if (current && current.version !== Number(event.payload.previousVersion)) {
            throw new ConflictError("Cloud deletion conflicts with the local board element.", { boardId, elementId, localVersion: current.version, cloudVersion: event.payload.previousVersion });
          }
          if (current) {
            delete board.elements[elementId];
            board.order = board.order.filter((id) => id !== elementId);
            applied += 1;
          }
        } else {
          if (!incoming?.version) throw new ValidationError("Cloud board element event is missing a versioned document.");
          const merged = mergeIncomingEntity(current, incoming, { collection: "board_elements", boardId, entityId: elementId });
          if (merged !== current) {
            board.elements[elementId] = merged;
            if (!board.order.includes(elementId)) board.order.push(elementId);
            applied += 1;
          }
        }
        continue;
      }
      if (event.collection === "boards" && !isDelete) {
        if (!incoming?.version) throw new ValidationError("Cloud Board event is missing a versioned document.", { entityId: event.entityId });
        const current = workspace.entities.boards[event.entityId];
        const candidate = { ...clone(incoming), elements: clone(current?.elements || incoming.elements || {}) };
        const merged = mergeIncomingEntity(current, candidate, { collection: "boards", entityId: event.entityId });
        if (merged !== current) { workspace.entities.boards[event.entityId] = merged; applied += 1; }
        continue;
      }
      if (!ENTITY_COLLECTIONS.includes(event.collection)) throw new ValidationError("Unsupported cloud collection.", { collection: event.collection });
      const entities = workspace.entities[event.collection];
      const current = entities[event.entityId];
      if (isDelete) {
        if (current && current.version !== Number(event.payload.previousVersion)) {
          throw new ConflictError("Cloud deletion conflicts with the local Entity.", { collection: event.collection, entityId: event.entityId, localVersion: current.version, cloudVersion: event.payload.previousVersion });
        }
        if (current) { delete entities[event.entityId]; applied += 1; }
      } else {
        if (!incoming?.version) throw new ValidationError("Cloud Entity event is missing a versioned document.", { collection: event.collection, entityId: event.entityId });
        const merged = mergeIncomingEntity(current, incoming, { collection: event.collection, entityId: event.entityId });
        if (merged !== current) { entities[event.entityId] = merged; applied += 1; }
      }
    }
    if (applied) {
      const now = timestamp();
      const workspaceVersion = workspace.workspaceVersion + 1;
      workspace.workspaceVersion = workspaceVersion;
      workspace.updatedAt = now;
      workspace.eventLog.push({
        id: randomUUID(),
        transactionId: randomUUID(),
        workspaceVersion,
        index: 0,
        type: "cloud.delta.applied",
        entityType: "workspace",
        entityId: workspace.project.id,
        actor: normalizeActor(options.actor || "cloud-sync"),
        timestamp: now,
        payload: {
          applied,
          cloudWorkspaceVersion: Math.max(...ordered.map((event) => event.cloudWorkspaceVersion)),
        },
      });
      validateWorkspace(workspace);
      await atomicWriteJson(paths.workspace, workspace);
      await atomicWriteJson(path.join(paths.snapshots, `${String(workspaceVersion).padStart(12, "0")}.json`), workspace).catch(() => {});
    }
    return {
      applied,
      workspaceVersion: workspace.workspaceVersion,
      cloudWorkspaceVersion: Math.max(...ordered.map((event) => event.cloudWorkspaceVersion)),
    };
  });
}
