import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createBoardEntity, slug } from "./schema.mjs";
import { applyWorkspaceTransaction, createProjectWorkspace, readWorkspace } from "./store.mjs";

const CODE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".kt", ".cs", ".rb", ".php", ".swift"]);
const EXCLUDED_DIRECTORIES = new Set([".git", ".codex", ".my-whiteboard", "node_modules", "dist", "build", "coverage", ".next", ".venv", "venv"]);

export async function scanProjectGraph(projectRoot, maxFiles = 80) {
  const root = path.resolve(projectRoot);
  const files = [];
  async function visit(directory) {
    if (files.length >= maxFiles) return;
    let entries = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.name.startsWith(".") && ![".github"].includes(entry.name)) continue;
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  }
  await visit(root);
  const relativeFiles = files.map((file) => path.relative(root, file).replaceAll(path.sep, "/"));
  const byFile = new Map();
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, files.length))));
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
  for (const [index, file] of files.entries()) {
    const relative = relativeFiles[index];
    let source = "";
    try { source = await readFile(file, "utf8"); } catch {}
    const imports = [...source.matchAll(/(?:from\s*["']|require\(\s*["']|import\s*["'])([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((specifier) => specifier.startsWith("."));
    for (const specifier of imports) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
      const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.ts`, `${base}.tsx`, `${base}.jsx`, `${base}/index.js`, `${base}/index.ts`, `${base}/index.tsx`];
      const target = candidates.find((candidate) => byFile.has(candidate));
      if (!target || target === relative) continue;
      elements.push({
        id: `dependency-${byFile.get(relative)}-${byFile.get(target)}`.slice(0, 120),
        kind: "edge",
        semanticType: "dependency",
        label: "imports",
        properties: { sourceId: byFile.get(relative), targetId: byFile.get(target), points: [[0, 0], [160, 0]], style: { strokeColor: "#94a3b8", roughness: 0 } },
        layout: { x: 0, y: 0, width: 160, height: 1 },
      });
    }
  }
  return { root, files: relativeFiles, elements };
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
