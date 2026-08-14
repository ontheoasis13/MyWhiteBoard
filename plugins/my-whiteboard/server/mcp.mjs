import readline from "node:readline";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  analyzeSemanticCodeBoard,
  applyWorkspaceTransaction,
  createBoardEntity,
  createProjectCodeBoard,
  createProjectWorkspace,
  discoverLegacyBoards,
  getChangesSince,
  importLegacyBoards,
  readWorkspace,
  workspacePaths,
} from "../core/index.mjs";
import { exportSemanticBoard } from "../export/semantic-export.mjs";
import { createWorkspaceHttpService } from "./workspace-http.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(await readFile(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8")).version;

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const mutating = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

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
    description: "Batch create, update, or delete semantic elements. Updates and deletes require expectedVersion and return a conflict instead of silently overwriting stale state.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, board_id: { type: "string" }, changes: { type: "array", items: { type: "object" }, minItems: 1 }, actor: { type: "object" } }, required: ["project_root", "board_id", "changes"], additionalProperties: false },
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
    name: "board_export",
    title: "Export Semantic Board",
    description: "Export the authoritative Semantic Board as JSON, SVG, or PNG under .my-whiteboard/exports.",
    inputSchema: { type: "object", properties: { project_root: { type: "string" }, board_id: { type: "string" }, format: { type: "string", enum: ["json", "svg", "png"] } }, required: ["project_root", "board_id", "format"], additionalProperties: false },
    annotations: mutating,
  },
];

function content(message, data) {
  return { content: [{ type: "text", text: message }], structuredContent: data };
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
    const opened = await httpService.openWorkspace({ projectRoot: args.project_root, boardId: args.board_id, name: args.name, actor: args.actor });
    return content(`Open My Whiteboard directly: ${opened.url}`, { ...opened, embedded: false, authority: "semantic-board-state" });
  }
  if (name === "selection_get") {
    const workspace = await readWorkspace(args.project_root);
    const board = requireBoard(workspace, args.board_id);
    const selection = workspace.entities.selections[args.board_id] || { id: args.board_id, boardId: args.board_id, elementIds: [], version: 0 };
    const elements = selection.elementIds.map((id) => board.elements[id]).filter(Boolean);
    return content(`${elements.length} selected semantic element(s).`, { selection, elements, workspaceVersion: workspace.workspaceVersion });
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
  const httpService = options.httpService || createWorkspaceHttpService();
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
