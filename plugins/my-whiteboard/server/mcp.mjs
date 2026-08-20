import readline from "node:readline";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  analyzeSemanticCodeBoard,
  applyDomainChanges,
  applyWorkspaceTransaction,
  connectAgent,
  createHandoff,
  createBoardEntity,
  createProjectCodeBoard,
  createProjectWorkspace,
  correctProductFeature,
  discoverLegacyBoards,
  getChangesSince,
  getMessages,
  importLegacyBoards,
  readProductGrounding,
  readWorkspace,
  scanProductGrounding,
  sendMessage,
  summarizeProductMap,
  syncAgent,
  updateHandoff,
  workspacePaths,
} from "../core/index.mjs";
import { exportSemanticBoard } from "../export/semantic-export.mjs";
import { SupabaseWorkspaceAdapter } from "../adapters/supabase-adapter.mjs";
import { launchStandaloneWorkspace } from "./workspace-launcher.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(await readFile(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8")).version;

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const mutating = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const actorSchema = { type: "object", properties: { id: { type: "string" }, displayName: { type: "string" }, client: { type: "string" } }, required: ["id"], additionalProperties: true };
const agentSchema = { type: "object", properties: { id: { type: "string" }, displayName: { type: "string" }, client: { type: "string" }, status: { type: "string", enum: ["connected", "idle", "working", "offline", "error"] }, capabilities: { type: "array", items: { type: "string" } }, metadata: { type: "object" } }, required: ["id", "displayName", "client"], additionalProperties: false };
const taskStatusSchema = { type: "string", enum: ["todo", "in_progress", "blocked", "done", "cancelled"] };
const domainChangeSchema = {
  oneOf: [
    { type: "object", properties: { op: { const: "create" }, entity: { type: "object" } }, required: ["op", "entity"], additionalProperties: false },
    { type: "object", properties: { op: { const: "update" }, id: { type: "string" }, expected_version: { type: "integer", minimum: 1 }, patch: { type: "object" } }, required: ["op", "id", "expected_version", "patch"], additionalProperties: false },
    { type: "object", properties: { op: { const: "delete" }, id: { type: "string" }, expected_version: { type: "integer", minimum: 1 } }, required: ["op", "id", "expected_version"], additionalProperties: false },
  ],
};
const taskEntitySchema = { type: "object", properties: { status: taskStatusSchema }, additionalProperties: true };
const taskChangeSchema = {
  oneOf: [
    { type: "object", properties: { op: { const: "create" }, entity: taskEntitySchema }, required: ["op", "entity"], additionalProperties: false },
    { type: "object", properties: { op: { const: "update" }, id: { type: "string" }, expected_version: { type: "integer", minimum: 1 }, patch: taskEntitySchema }, required: ["op", "id", "expected_version", "patch"], additionalProperties: false },
    { type: "object", properties: { op: { const: "delete" }, id: { type: "string" }, expected_version: { type: "integer", minimum: 1 } }, required: ["op", "id", "expected_version"], additionalProperties: false },
  ],
};
const boardElementSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    kind: { type: "string", enum: ["node", "edge", "text", "note", "group", "section"] },
    semanticType: { type: "string" },
    label: { type: "string" },
    properties: { type: "object" },
    layout: { type: "object" },
  },
  additionalProperties: true,
};
const boardChangeSchema = {
  oneOf: [
    { type: "object", properties: { op: { const: "create" }, element: boardElementSchema }, required: ["op", "element"], additionalProperties: false },
    { type: "object", properties: { op: { const: "update" }, id: { type: "string" }, expectedVersion: { type: "integer", minimum: 1 }, patch: { type: "object" } }, required: ["op", "id", "expectedVersion", "patch"], additionalProperties: false },
    { type: "object", properties: { op: { const: "delete" }, id: { type: "string" }, expectedVersion: { type: "integer", minimum: 1 } }, required: ["op", "id", "expectedVersion"], additionalProperties: false },
  ],
};
const handoffSchema = { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, summary: { type: "string" }, fromAgentId: { type: "string" }, toAgentId: { type: "string" }, status: { type: "string", enum: ["open", "accepted", "completed", "cancelled"] }, taskIds: { type: "array", items: { type: "string" } }, artifactIds: { type: "array", items: { type: "string" } }, boardIds: { type: "array", items: { type: "string" } }, metadata: { type: "object" } }, required: ["title", "summary", "fromAgentId", "toAgentId"], additionalProperties: false };
const messageSchema = { type: "object", properties: { id: { type: "string" }, fromAgentId: { type: "string" }, toAgentId: { type: ["string", "null"] }, channel: { type: "string" }, kind: { type: "string", enum: ["update", "request", "response", "conflict", "system"] }, body: { type: "string" }, relatedEntityRefs: { type: "array", items: { type: "object", properties: { collection: { type: "string" }, id: { type: "string" } }, required: ["collection", "id"], additionalProperties: false } }, readBy: { type: "array", items: { type: "string" } } }, required: ["fromAgentId", "body"], additionalProperties: false };

export const workspaceTools = [
  {
    name: "project_create",
    title: "Create or open a My Whiteboard project",
    description: "Initialize an Agent-neutral local workspace under <project>/.my-whiteboard. Existing workspaces are returned unchanged.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, name: { type: "string" }, actor: { type: "object" } }, required: ["project_root"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "project_get",
    title: "Get project overview",
    description: "Read the Project entity and collection counts without returning the full event log.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" } }, required: ["project_root"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "workspace_get",
    title: "Get workspace state",
    description: "Read the current structured Project, Shared Context, Boards, Tasks, Decisions, Artifacts, Agents, Handoffs, Messages, and versions.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, include_events: { type: "boolean" } }, required: ["project_root"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "workspace_get_changes",
    title: "Get workspace delta",
    description: "Return events committed after a Workspace Version so an Agent does not need to reread the full workspace.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, since_version: { type: "integer", minimum: 0 } }, required: ["project_root", "since_version"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "board_create",
    title: "Create a Semantic Board",
    description: "Create a board whose semantic elements are authoritative. Excalidraw is generated as a visual projection.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, id: { type: "string" }, title: { type: "string" }, board_type: { type: "string" }, description: { type: "string" }, elements: { type: "array", items: { type: "object" } }, actor: { type: "object" } }, required: ["project_root", "title"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "board_get",
    title: "Get a Semantic Board",
    description: "Read one board with semantic elements, layouts, entity versions, and related current selection.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, board_id: { type: "string" } }, required: ["project_root", "board_id"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "board_apply",
    title: "Apply a Semantic Board transaction",
    description: "Batch create, update, or delete semantic elements. Create uses { op: 'create', element: { ... } }. Update and delete use camelCase expectedVersion and return a conflict instead of silently overwriting stale state.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, board_id: { type: "string" }, changes: { type: "array", items: boardChangeSchema, minItems: 1 }, actor: { type: "object" } }, required: ["project_root", "board_id", "changes"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "workspace_open",
    title: "Open standalone Web Workspace",
    description: "Return a direct token-protected loopback URL for the standalone Excalidraw workspace. This tool never requests iframe embedding.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, board_id: { type: "string" }, name: { type: "string" }, actor: { type: "object" } }, required: ["project_root"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "selection_get",
    title: "Get persisted board selection",
    description: "Return only the semantic elements currently selected by the user, including code, task, decision, and artifact references.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, board_id: { type: "string" } }, required: ["project_root", "board_id"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "context_apply",
    title: "Apply Shared Context changes",
    description: "Batch create, update, or delete versioned project/code context records. Updates and deletes require expected_version.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, changes: { type: "array", items: domainChangeSchema, minItems: 1 }, actor: actorSchema }, required: ["project_root", "changes"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "tasks_apply",
    title: "Apply Task changes",
    description: "Batch create, update, or delete versioned tasks with status, priority, dependencies, Agent assignment, and board references. Valid statuses are todo, in_progress, blocked, done, and cancelled; completed is a Handoff status, not a Task status.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, changes: { type: "array", items: taskChangeSchema, minItems: 1 }, actor: actorSchema }, required: ["project_root", "changes"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "decisions_apply",
    title: "Apply Decision changes",
    description: "Batch create, update, or delete versioned decisions with rationale, status, alternatives, and board references.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, changes: { type: "array", items: domainChangeSchema, minItems: 1 }, actor: actorSchema }, required: ["project_root", "changes"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "artifacts_apply",
    title: "Apply Artifact changes",
    description: "Batch create, update, or delete versioned file, URI, and board artifacts.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, changes: { type: "array", items: domainChangeSchema, minItems: 1 }, actor: actorSchema }, required: ["project_root", "changes"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "agent_connect",
    title: "Connect or refresh Agent identity",
    description: "Upsert one Agent identity with client, status, capabilities, metadata, last-seen time, and Entity Version.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, agent: agentSchema, actor: actorSchema }, required: ["project_root", "agent"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "agent_sync",
    title: "Connect Agent and get Delta",
    description: "Refresh Agent identity and return Event Log entries after since_version in one synchronization call.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, agent: agentSchema, since_version: { type: "integer", minimum: 0 }, actor: actorSchema }, required: ["project_root", "agent", "since_version"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "handoff_create",
    title: "Create Agent Handoff",
    description: "Create a versioned handoff between two connected Agents with shared summary and Task, Artifact, and Board references.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, handoff: handoffSchema, actor: actorSchema }, required: ["project_root", "handoff"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "handoff_update",
    title: "Update Agent Handoff",
    description: "Accept, complete, cancel, or revise a handoff using expected_version optimistic concurrency.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, handoff_id: { type: "string" }, expected_version: { type: "integer", minimum: 1 }, patch: { type: "object" }, actor: { type: "object" } }, required: ["project_root", "handoff_id", "expected_version", "patch"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "message_send",
    title: "Send Agent Message",
    description: "Append a versioned Agent-to-Agent or workspace-channel message with related entity references.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, message: messageSchema, actor: actorSchema }, required: ["project_root", "message"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "messages_get",
    title: "Get Agent Messages",
    description: "Read messages filtered by Agent, channel, and optional Workspace Version cursor.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, agent_id: { type: "string" }, channel: { type: "string" }, after_version: { type: "integer", minimum: 0 } }, required: ["project_root"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "cloud_status",
    title: "Get optional cloud sync status",
    description: "Report whether user-scoped Supabase sync is configured and show non-secret local sync cursors.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" } }, required: ["project_root"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "cloud_push",
    title: "Push Semantic Workspace to Supabase",
    description: "Push versioned Semantic Workspace Entities through RLS and object-level optimistic concurrency. Supabase Secret Keys are never accepted.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, actor: { type: "object" } }, required: ["project_root"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "cloud_pull",
    title: "Pull Supabase Workspace Delta",
    description: "Apply cloud Event Log entries after the saved Cloud Workspace Version. Refuses to overwrite unsynchronized local changes.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, actor: { type: "object" } }, required: ["project_root"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "cloud_get_changes",
    title: "Read Supabase Workspace Delta",
    description: "Read cloud events after a Cloud Workspace Version without changing the local Workspace.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, since_version: { type: "integer", minimum: 0 } }, required: ["project_root", "since_version"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "legacy_discover",
    title: "Discover Beta 5 boards",
    description: "List legacy .codex/whiteboards files available for read-only migration.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" } }, required: ["project_root"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "legacy_import",
    title: "Import Beta 5 boards",
    description: "Copy and convert legacy boards into Semantic Board State without modifying or deleting the source files. Repeated imports are idempotent by source hash.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, actor: { type: "object" } }, required: ["project_root"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "code_board_create",
    title: "Create a semantic code architecture board",
    description: "Scan bounded project source files and relative imports, then create code nodes and dependency edges in Semantic Board State.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, id: { type: "string" }, title: { type: "string" }, max_files: { type: "integer", minimum: 1, maximum: 300 }, actor: { type: "object" } }, required: ["project_root"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "code_board_analyze",
    title: "Analyze semantic code board",
    description: "Report code files, dependencies, dangling edges, risks, and test references from semantic metadata.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, board_id: { type: "string" } }, required: ["project_root", "board_id"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "product_grounding_scan",
    title: "Scan a product-grounded project model",
    description: "Build deterministic TS/JS code observations, traceable Evidence, and a Product Map while preserving durable Human Intent corrections.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, max_files: { type: "integer", minimum: 1, maximum: 2000 }, actor: actorSchema }, required: ["project_root"], additionalProperties: false },
    annotations: mutating,
  },
  {
    name: "product_grounding_get",
    title: "Read the product-grounded project model",
    description: "Read the current Product Map and its Feature-to-Evidence trace without scanning or changing the repository.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, include_evidence: { type: "boolean" } }, required: ["project_root"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "product_feature_correct",
    title: "Persist a Human Intent correction",
    description: "Correct a grounded Feature using Entity Version concurrency. The correction survives restart and rescan without overwriting observed code truth.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string" },
        feature_id: { type: "string" },
        expected_version: { type: "integer", minimum: 1 },
        patch: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, parentFeatureId: { oneOf: [{ type: "string" }, { type: "null" }] }, groupId: { type: "string" }, productState: { type: "string" }, actionability: { type: "string" }, hidden: { type: "boolean" } }, additionalProperties: false },
        reason: { type: "string" },
        actor: actorSchema,
      },
      required: ["project_root", "feature_id", "expected_version", "patch"],
      additionalProperties: false,
    },
    annotations: mutating,
  },
  {
    name: "board_export",
    title: "Export Semantic Board",
    description: "Export the authoritative Semantic Board as JSON, SVG, or PNG under .my-whiteboard/exports.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, board_id: { type: "string" }, format: { type: "string", enum: ["json", "svg", "png"] } }, required: ["project_root", "board_id", "format"], additionalProperties: false },
    annotations: mutating,
  },
];

function content(message, data) {
  const fallback = data === undefined
    ? message
    : `${message}\n\nStructured result (JSON):\n${JSON.stringify(data, null, 2)}`;
  return { content: [{ type: "text", text: fallback }], structuredContent: data };
}

function requireBoard(workspace, boardId) {
  const board = workspace.entities.boards[boardId];
  if (!board) throw Object.assign(new Error(`Board not found: ${boardId}`), { code: "NOT_FOUND", details: { boardId } });
  return board;
}

export async function callWorkspaceTool(name, args, httpService) {
  if (name === "project_create") {
    const workspace = await createProjectWorkspace(args.project_root, { name: args.name, actor: args.actor });
    return content(`Project “${workspace.project.name}” is ready.`, { project: workspace.project, workspaceVersion: workspace.workspaceVersion, path: workspacePaths(args.project_root).workspace });
  }
  if (name === "project_get") {
    const workspace = await readWorkspace(args.project_root);
    const counts = Object.fromEntries(Object.entries(workspace.entities).map(([collection, entities]) => [collection, Object.keys(entities).length]));
    return content(`Project “${workspace.project.name}” at Workspace v${workspace.workspaceVersion}.`, { project: workspace.project, workspaceVersion: workspace.workspaceVersion, counts });
  }
  if (name === "workspace_get") {
    const workspace = await readWorkspace(args.project_root);
    if (!args.include_events) workspace.eventLog = [];
    return content(`Workspace v${workspace.workspaceVersion}.`, { workspace });
  }
  if (name === "workspace_get_changes") {
    const delta = await getChangesSince(args.project_root, args.since_version);
    return content(`${delta.events.length} event(s) since Workspace v${args.since_version}.`, delta);
  }
  if (name === "board_create") {
    await createProjectWorkspace(args.project_root, { actor: args.actor });
    const board = createBoardEntity({ id: args.id, title: args.title, boardType: args.board_type, description: args.description, elements: args.elements || [] });
    const result = await applyWorkspaceTransaction(args.project_root, { actor: args.actor, operations: [{ type: "entity.create", collection: "boards", entity: board }] });
    const current = requireBoard(await readWorkspace(args.project_root), board.id);
    return content(`Created Semantic Board “${current.title}”.`, { board: current, workspaceVersion: result.workspaceVersion });
  }
  if (name === "board_get") {
    const workspace = await readWorkspace(args.project_root);
    const board = requireBoard(workspace, args.board_id);
    const selection = workspace.entities.selections[args.board_id] || null;
    return content(`Semantic Board “${board.title}” at v${board.version}.`, { board, selection, workspaceVersion: workspace.workspaceVersion });
  }
  if (name === "board_apply") {
    const result = await applyWorkspaceTransaction(args.project_root, { actor: args.actor, operations: [{ type: "board.apply", boardId: args.board_id, changes: args.changes }] });
    const board = requireBoard(await readWorkspace(args.project_root), args.board_id);
    return content(`Applied ${args.changes.length} semantic board change(s).`, { boardId: board.id, boardVersion: board.version, workspaceVersion: result.workspaceVersion, elementVersions: Object.fromEntries(Object.values(board.elements).map((element) => [element.id, element.version])), events: result.events });
  }
  if (name === "workspace_open") {
    const opened = httpService?.openWorkspace
      ? await httpService.openWorkspace({ projectRoot: args.project_root, boardId: args.board_id, name: args.name, actor: args.actor })
      : await launchStandaloneWorkspace({ projectRoot: args.project_root, boardId: args.board_id, name: args.name, actor: args.actor });
    return content(`Open My Whiteboard directly: ${opened.url}`, { ...opened, embedded: false, authority: "semantic-board-state" });
  }
  if (name === "selection_get") {
    const workspace = await readWorkspace(args.project_root);
    const board = requireBoard(workspace, args.board_id);
    const selection = workspace.entities.selections[args.board_id] || { id: args.board_id, boardId: args.board_id, elementIds: [], version: 0 };
    const elements = selection.elementIds.map((id) => board.elements[id]).filter(Boolean);
    return content(`${elements.length} selected semantic element(s).`, { selection, elements, workspaceVersion: workspace.workspaceVersion });
  }
  const domainCollections = { context_apply: "contexts", tasks_apply: "tasks", decisions_apply: "decisions", artifacts_apply: "artifacts" };
  if (domainCollections[name]) {
    const result = await applyDomainChanges(args.project_root, domainCollections[name], args.changes, args.actor);
    return content(`Applied ${args.changes.length} ${domainCollections[name]} change(s).`, { collection: domainCollections[name], entities: result.entities, workspaceVersion: result.workspaceVersion, events: result.events });
  }
  if (name === "agent_connect") {
    await createProjectWorkspace(args.project_root, { actor: args.actor || args.agent });
    const result = await connectAgent(args.project_root, args.agent, args.actor || args.agent);
    return content(`Agent “${result.agent.displayName}” connected from ${result.agent.client}.`, { agent: result.agent, workspaceVersion: result.workspaceVersion, events: result.events });
  }
  if (name === "agent_sync") {
    await createProjectWorkspace(args.project_root, { actor: args.actor || args.agent });
    const result = await syncAgent(args.project_root, { agent: args.agent, actor: args.actor, since_version: args.since_version });
    return content(`Agent “${result.agent.displayName}” synchronized to Workspace v${result.workspaceVersion}.`, result);
  }
  if (name === "handoff_create") {
    const result = await createHandoff(args.project_root, args.handoff, args.actor || args.handoff);
    return content(`Created handoff “${result.handoff.title}” from ${result.handoff.fromAgentId} to ${result.handoff.toAgentId}.`, { handoff: result.handoff, workspaceVersion: result.workspaceVersion, events: result.events });
  }
  if (name === "handoff_update") {
    const result = await updateHandoff(args.project_root, { id: args.handoff_id, expected_version: args.expected_version, patch: args.patch }, args.actor);
    return content(`Handoff “${result.handoff.title}” is ${result.handoff.status}.`, { handoff: result.handoff, workspaceVersion: result.workspaceVersion, events: result.events });
  }
  if (name === "message_send") {
    const result = await sendMessage(args.project_root, args.message, args.actor || args.message);
    return content(`Message sent by ${result.message.fromAgentId}.`, { message: result.message, workspaceVersion: result.workspaceVersion, events: result.events });
  }
  if (name === "messages_get") {
    const result = await getMessages(args.project_root, { agent_id: args.agent_id, channel: args.channel, after_version: args.after_version });
    return content(`${result.messages.length} message(s) at Workspace v${result.workspaceVersion}.`, result);
  }
  if (name === "cloud_status") {
    const result = await new SupabaseWorkspaceAdapter().status(args.project_root);
    return content(result.configured ? "Optional Supabase sync is configured." : "Optional Supabase sync is not configured.", result);
  }
  if (name === "cloud_push") {
    const result = await new SupabaseWorkspaceAdapter().push(args.project_root, args.actor);
    return content(`Pushed ${result.changes} Semantic Workspace change(s) to Cloud Workspace v${result.cloudWorkspaceVersion}.`, result);
  }
  if (name === "cloud_pull") {
    const result = await new SupabaseWorkspaceAdapter().pull(args.project_root, args.actor);
    return content(`Applied ${result.applied} cloud change(s) from ${result.events} event(s).`, result);
  }
  if (name === "cloud_get_changes") {
    const adapter = new SupabaseWorkspaceAdapter();
    const workspace = await readWorkspace(args.project_root);
    const project = await adapter.findProject(workspace.project.id);
    if (!project) throw Object.assign(new Error("Cloud Workspace not found."), { code: "NOT_FOUND" });
    const events = await adapter.getDelta(project.id, args.since_version);
    return content(`${events.length} cloud event(s) since Cloud Workspace v${args.since_version}.`, { workspaceId: project.id, fromVersion: args.since_version, cloudWorkspaceVersion: events.length ? Number(events.at(-1).workspace_version) : Number(project.workspace_version), events });
  }
  if (name === "legacy_discover") {
    const files = await discoverLegacyBoards(args.project_root);
    return content(`${files.length} legacy board file(s) found.`, { files });
  }
  if (name === "legacy_import") {
    const results = await importLegacyBoards(args.project_root, { actor: args.actor });
    return content(`${results.filter((result) => result.status === "imported").length} legacy board(s) imported.`, { results });
  }
  if (name === "code_board_create") {
    const result = await createProjectCodeBoard(args.project_root, { id: args.id, title: args.title, maxFiles: args.max_files, actor: args.actor });
    return content(`Created semantic code board from ${result.scannedFiles.length} source file(s).`, result);
  }
  if (name === "code_board_analyze") {
    const workspace = await readWorkspace(args.project_root);
    const board = requireBoard(workspace, args.board_id);
    return content(`Code analysis for “${board.title}”.`, { boardId: board.id, analysis: analyzeSemanticCodeBoard(board), workspaceVersion: workspace.workspaceVersion });
  }
  if (name === "product_grounding_scan") {
    const result = await scanProductGrounding(args.project_root, { maxFiles: args.max_files });
    return content(`Grounded ${Object.keys(result.model.features).length} Product Feature(s) from ${result.model.stats.scannedFiles} source file(s).`, { productMap: summarizeProductMap(result.model), model: result.model, path: result.path });
  }
  if (name === "product_grounding_get") {
    const model = await readProductGrounding(args.project_root);
    const structured = { productMap: summarizeProductMap(model), model: args.include_evidence === false ? { ...model, evidence: {} } : model, path: path.join(path.resolve(args.project_root), ".my-whiteboard", "product-model.json") };
    return content(`Product Map v${model.version} contains ${Object.keys(model.features).length} Feature(s).`, structured);
  }
  if (name === "product_feature_correct") {
    const result = await correctProductFeature(args.project_root, { featureId: args.feature_id, expectedVersion: args.expected_version, patch: args.patch, reason: args.reason, actor: args.actor });
    return content(`Feature “${result.feature.name}” corrected as Human Intent at v${result.feature.version}.`, { feature: result.feature, correction: result.correction, productMap: summarizeProductMap(result.model), path: result.path });
  }
  if (name === "board_export") {
    const workspace = await readWorkspace(args.project_root);
    const board = requireBoard(workspace, args.board_id);
    const exported = await exportSemanticBoard(args.project_root, board, args.format);
    return content(`Exported ${args.format.toUpperCase()} to ${exported.path}.`, { boardId: board.id, ...exported });
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: "NOT_FOUND" });
}

export function runMcpServer(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const httpService = options.httpService || { openWorkspace: launchStandaloneWorkspace, stop: async () => {} };
  function send(value) { output.write(`${JSON.stringify(value)}\n`); }
  function success(id, result) { send({ jsonrpc: "2.0", id, result }); }
  function failure(id, error) { send({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : String(error), data: { code: error?.code || "INTERNAL_ERROR", details: error?.details || {} } } }); }
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let request;
    try { request = JSON.parse(line); } catch (error) { failure(null, error); return; }
    const { id, method, params } = request;
    try {
      if (method === "initialize") return success(id, { protocolVersion: params?.protocolVersion || "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "My Whiteboard Workspace", version: VERSION }, instructions: "Use project_create with the current project root, then operate on Semantic Board State through batch tools. Read Workspace deltas by version. Use workspace_open for the standalone browser editor; iframe embedding is intentionally disabled." });
      if (method === "notifications/initialized") return;
      if (method === "ping") return success(id, {});
      if (method === "tools/list") return success(id, { tools: workspaceTools });
      if (method === "tools/call") return success(id, await callWorkspaceTool(params?.name, params?.arguments || {}, httpService));
      if (method === "resources/list") return success(id, { resources: [] });
      throw Object.assign(new Error(`Method not found: ${method}`), { code: "NOT_FOUND" });
    } catch (error) {
      failure(id, error);
    }
  });
  lines.on("close", () => httpService.stop().catch(() => {}));
  return { lines, httpService };
}
