import path from "node:path";
import { createBoardEntity, slug } from "./schema.mjs";
import { applyWorkspaceTransaction, createProjectWorkspace, readWorkspace } from "./store.mjs";
import { scanProjectSources } from "./source-observation.mjs";

const CODE_BOARD_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".kt", ".cs", ".rb", ".php", ".swift"]);

export async function scanProjectGraph(projectRoot, maxFiles = 80) {
  const scanned = await scanProjectSources(projectRoot, { maxFiles, extensions: CODE_BOARD_EXTENSIONS });
  const relativeFiles = scanned.files.map((file) => file.relative);
  const byFile = new Map();
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, scanned.files.length))));
  const elements = [];
  for (const [index, relative] of relativeFiles.entries()) {
    const id = `file-${slug(relative).slice(0, 72)}`;
    byFile.set(relative, id);
    elements.push({
      id,
      kind: "node",
      semanticType: "code",
      label: path.basename(relative),
      properties: {
        code: { file: relative, symbol: "", line: null, kind: "file" },
        status: "todo",
        riskTags: [],
        testRefs: [],
        style: { backgroundColor: "#eef2ff", strokeColor: "#6366f1", roughness: 0 },
      },
      layout: { x: 80 + (index % columns) * 280, y: 80 + Math.floor(index / columns) * 150, width: 240, height: 100 },
    });
  }
  const edgeIds = new Set();
  for (const [index, file] of scanned.files.entries()) {
    const relative = relativeFiles[index];
    for (const dependency of file.imports) {
      const target = dependency.target;
      if (!target || target === relative) continue;
      const edgeId = `dependency-${byFile.get(relative)}-${byFile.get(target)}`.slice(0, 120);
      if (edgeIds.has(edgeId)) continue;
      edgeIds.add(edgeId);
      elements.push({
        id: edgeId,
        kind: "edge",
        semanticType: "dependency",
        label: "imports",
        properties: { sourceId: byFile.get(relative), targetId: byFile.get(target), specifier: dependency.specifier, line: dependency.line, points: [[0, 0], [160, 0]], style: { strokeColor: "#94a3b8", roughness: 0 } },
        layout: { x: 0, y: 0, width: 160, height: 1 },
      });
    }
  }
  return { root: scanned.root, files: relativeFiles, elements, config: scanned.config, aliases: scanned.aliases };
}

export async function createProjectCodeBoard(projectRoot, options = {}) {
  await createProjectWorkspace(projectRoot, { name: options.projectName, actor: options.actor });
  const graph = await scanProjectGraph(projectRoot, Math.max(1, Math.min(300, Number(options.maxFiles || 80))));
  const workspace = await readWorkspace(projectRoot);
  let id = slug(options.id || options.title || "code-architecture", "board");
  if (workspace.entities.boards[id]) id = `${id}-${Date.now()}`;
  const board = createBoardEntity({ id, title: options.title || "Code Architecture", boardType: "code", elements: graph.elements });
  await applyWorkspaceTransaction(projectRoot, { actor: options.actor || "code-scanner", operations: [{ type: "entity.create", collection: "boards", entity: board }] });
  return { boardId: id, scannedFiles: graph.files, elementCount: graph.elements.length };
}

export function analyzeSemanticCodeBoard(board) {
  const elements = Object.values(board?.elements || {});
  const nodes = elements.filter((element) => element.kind !== "edge");
  const edges = elements.filter((element) => element.kind === "edge");
  const nodeIds = new Set(nodes.map((element) => element.id));
  const risks = [];
  const tests = [];
  const files = new Map();
  for (const node of nodes) {
    const code = node.properties?.code;
    if (code?.file) files.set(code.file, (files.get(code.file) || 0) + 1);
    for (const risk of node.properties?.riskTags || []) risks.push({ elementId: node.id, risk });
    for (const reference of node.properties?.testRefs || []) tests.push({ elementId: node.id, reference });
  }
  const danglingEdges = edges.filter((edge) => {
    const source = edge.properties?.sourceId;
    const target = edge.properties?.targetId;
    return (source && !nodeIds.has(source)) || (target && !nodeIds.has(target));
  }).map((edge) => edge.id);
  return {
    nodes: nodes.length,
    edges: edges.length,
    files: [...files.entries()].map(([file, references]) => ({ file, references })),
    risks,
    tests,
    danglingEdges,
  };
}
