import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { applyWorkspaceTransaction, createProjectWorkspace, readWorkspace, workspacePaths } from "./store.mjs";
import { createBoardEntity, slug } from "./schema.mjs";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function legacyElementToSemantic(element = {}) {
  const edge = element.type === "arrow" || element.type === "line";
  const kind = edge ? "edge" : element.type === "text" ? "text" : element.type === "note" ? "note" : "node";
  const properties = {
    legacyType: String(element.type || "rectangle"),
    style: element.style && typeof element.style === "object" ? structuredClone(element.style) : {},
  };
  if (edge) {
    properties.sourceId = element.sourceId || null;
    properties.targetId = element.targetId || null;
    properties.points = Array.isArray(element.points) ? structuredClone(element.points) : [];
  }
  if (element.groupId) properties.groupId = String(element.groupId);
  if (element.code) properties.code = structuredClone(element.code);
  if (element.status) properties.status = String(element.status);
  if (Array.isArray(element.riskTags)) properties.riskTags = element.riskTags.map(String);
  if (Array.isArray(element.testRefs)) properties.testRefs = element.testRefs.map(String);
  return {
    id: String(element.id || `${kind}-${randomUUID().slice(0, 8)}`),
    kind,
    semanticType: element.code ? "code" : edge ? "relationship" : String(element.type || "shape"),
    label: String(element.text || ""),
    properties,
    layout: {
      x: Number(element.x || 0),
      y: Number(element.y || 0),
      width: Math.max(1, Number(element.width || (kind === "text" ? 220 : 180))),
      height: Math.max(1, Number(element.height || (kind === "text" ? 44 : 100))),
      locked: Boolean(element.locked),
    },
  };
}

export function convertLegacyBoard(legacy, options = {}) {
  const elements = Array.isArray(legacy.elements) ? legacy.elements.map(legacyElementToSemantic) : [];
  const board = createBoardEntity({
    id: options.boardId || slug(legacy.id || legacy.title || "legacy-board", "board"),
    title: legacy.title || "Imported board",
    boardType: legacy.boardType || "legacy-import",
    description: "Imported from My Whiteboard Beta 5",
    elements,
  });
  board.legacy = {
    schemaVersion: legacy.schemaVersion ?? 1,
    revision: legacy.revision ?? null,
    width: legacy.width ?? null,
    height: legacy.height ?? null,
    background: legacy.background ?? null,
  };
  return board;
}

export async function discoverLegacyBoards(projectRoot) {
  const directory = path.join(path.resolve(projectRoot), ".codex", "whiteboards");
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".whiteboard.json"))
    .map((entry) => path.join(directory, entry.name));
}

export async function importLegacyBoards(projectRoot, options = {}) {
  await createProjectWorkspace(projectRoot, options);
  const paths = workspacePaths(projectRoot);
  await mkdir(paths.imports, { recursive: true });
  const files = options.files || await discoverLegacyBoards(projectRoot);
  const results = [];
  for (const file of files) {
    const buffer = await readFile(file);
    const sourceHash = sha256(buffer);
    let workspace = await readWorkspace(projectRoot);
    if (workspace.imports[sourceHash]) {
      results.push({ file, sourceHash, status: "skipped", boardId: workspace.imports[sourceHash].boardId });
      continue;
    }
    const legacy = JSON.parse(buffer.toString("utf8"));
    let boardId = slug(legacy.id || legacy.title || path.basename(file, ".whiteboard.json"), "board");
    if (workspace.entities.boards[boardId]) boardId = `${boardId}-legacy-${sourceHash.slice(0, 8)}`;
    const board = convertLegacyBoard(legacy, { boardId });
    const archiveName = `${path.basename(file, ".json")}.${sourceHash.slice(0, 12)}.json`;
    const archivedPath = path.join(paths.imports, archiveName);
    await copyFile(file, archivedPath);
    await applyWorkspaceTransaction(projectRoot, {
      actor: options.actor || "legacy-importer",
      operations: [
        { type: "entity.create", collection: "boards", entity: board },
        { type: "import.record", record: { sourceHash, sourcePath: path.resolve(file), archivedPath, boardId, warnings: [] } },
      ],
    });
    results.push({ file, sourceHash, status: "imported", boardId, archivedPath });
  }
  return results;
}
