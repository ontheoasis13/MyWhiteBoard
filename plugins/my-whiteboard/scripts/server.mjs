import http from "node:http";
import readline from "node:readline";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
function loadSharp() {
  try { return require("sharp"); } catch {}
  const runtimeModule = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "sharp");
  try { return require(runtimeModule); } catch {}
  throw new Error("PNG export needs the Sharp module. SVG and JSON exports remain available.");
}
const WEB_ROOT = path.join(ROOT, "assets", "canvas");
const PLATFORM_CONFIG_ROOT = process.platform === "win32"
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "My Whiteboard")
  : process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "My Whiteboard")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "my-whiteboard");
const CONFIG_ROOT = process.env.MY_WHITEBOARD_CONFIG_HOME
  ? resolveUserPath(process.env.MY_WHITEBOARD_CONFIG_HOME)
  : PLATFORM_CONFIG_ROOT;
const CONFIG_FILE = path.join(CONFIG_ROOT, "settings.json");
const DEFAULT_BOARD_ROOT = path.join(os.homedir(), "Documents", "My Whiteboards");
const VERSION = JSON.parse(await readFile(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8")).version;
const TYPES = new Set(["rectangle", "ellipse", "diamond", "text", "note", "arrow", "line"]);
const STYLE_KEYS = new Set(["fill", "stroke", "strokeWidth", "color", "fontSize", "fontFamily", "radius", "opacity", "textAlign", "fontWeight"]);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml; charset=utf-8", ".json": "application/json; charset=utf-8" };
let httpServer;
let httpPort;
let boardRoot = DEFAULT_BOARD_ROOT;
const selections = new Map();
const WIDGET_URI = "ui://my-whiteboard/canvas-v3.html";

function resolveUserPath(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("Storage directory cannot be empty.");
  if (input === "~") return os.homedir();
  if (input.startsWith(`~${path.sep}`) || input.startsWith("~/") || input.startsWith("~\\")) return path.resolve(os.homedir(), input.slice(2));
  return path.resolve(input);
}
async function loadStorageSettings() {
  if (process.env.MY_WHITEBOARD_HOME) return resolveUserPath(process.env.MY_WHITEBOARD_HOME);
  try {
    const settings = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
    if (settings.storageDirectory) return resolveUserPath(settings.storageDirectory);
  } catch {}
  return DEFAULT_BOARD_ROOT;
}
boardRoot = await loadStorageSettings();
await mkdir(boardRoot, { recursive: true });

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function ok(id, result) { send({ jsonrpc: "2.0", id, result }); }
function fail(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }
function slug(value) {
  const ascii = String(value || "board").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  return ascii || `board-${Date.now()}`;
}
function boardPath(boardId) { return path.join(boardRoot, `${slug(boardId)}.whiteboard.json`); }
function historyRoot(boardId) { return path.join(boardRoot, ".history", slug(boardId)); }
function now() { return new Date().toISOString(); }
function escapeXml(value = "") { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]); }
function number(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function safeStyle(input = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) if (STYLE_KEYS.has(key)) output[key] = value;
  return output;
}
function normalizeElement(input, index = 0) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`elements[${index}] must be an object.`);
  const type = TYPES.has(input.type) ? input.type : "rectangle";
  const element = {
    id: String(input.id || `${type}-${randomUUID().slice(0, 8)}`),
    type,
    x: number(input.x, 80),
    y: number(input.y, 80),
    width: Math.max(1, number(input.width, type === "text" ? 220 : 180)),
    height: Math.max(1, number(input.height, type === "text" ? 44 : 100)),
    text: String(input.text || ""),
    style: safeStyle(input.style),
    locked: Boolean(input.locked),
  };
  if (input.groupId) element.groupId = String(input.groupId);
  if (input.sourceId) element.sourceId = String(input.sourceId);
  if (input.targetId) element.targetId = String(input.targetId);
  if (type === "arrow" || type === "line") {
    element.points = Array.isArray(input.points) && input.points.length >= 2
      ? input.points.map((point) => [number(point?.[0], 0), number(point?.[1], 0)])
      : [[0, 0], [160, 0]];
    const xs = element.points.map((point) => point[0]);
    const ys = element.points.map((point) => point[1]);
    element.width = Math.max(1, Math.max(...xs) - Math.min(...xs));
    element.height = Math.max(1, Math.max(...ys) - Math.min(...ys));
  }
  return element;
}
function makeBoard(title, width = 1280, height = 800) {
  const stamp = now();
  return { schemaVersion: 1, id: slug(title), title: String(title || "Untitled whiteboard"), width: Math.max(320, number(width, 1280)), height: Math.max(240, number(height, 800)), background: "#f8fafc", createdAt: stamp, updatedAt: stamp, revision: 1, elements: [] };
}
function contactTemplate(board) {
  board.title = "Contact form wireframe";
  board.elements = [
    { id: "page", type: "rectangle", x: 60, y: 40, width: 1160, height: 720, text: "", style: { fill: "#f8fafc", stroke: "#cbd5e1", strokeWidth: 2, radius: 16 } },
    { id: "nav", type: "rectangle", x: 60, y: 40, width: 1160, height: 72, text: "ACME                                      Home    Services    About    Contact", style: { fill: "#ffffff", stroke: "#e2e8f0", strokeWidth: 2, color: "#334155", fontSize: 18, fontWeight: 700, radius: 16 } },
    { id: "heading", type: "text", x: 420, y: 150, width: 440, height: 62, text: "Get in touch", style: { color: "#0f172a", fontSize: 40, fontWeight: 700, textAlign: "center" } },
    { id: "intro", type: "text", x: 330, y: 214, width: 620, height: 42, text: "Have a question or want to work together? Send us a message.", style: { color: "#64748b", fontSize: 18, textAlign: "center" } },
    { id: "form-card", type: "rectangle", x: 350, y: 278, width: 580, height: 426, text: "", style: { fill: "#ffffff", stroke: "#e2e8f0", strokeWidth: 2, radius: 16 } },
    { id: "name-label", type: "text", x: 394, y: 306, width: 150, height: 30, text: "Name", style: { color: "#334155", fontSize: 16, fontWeight: 700 } },
    { id: "name-input", type: "rectangle", x: 394, y: 338, width: 492, height: 50, text: "Jane Smith", style: { fill: "#ffffff", stroke: "#cbd5e1", strokeWidth: 2, color: "#94a3b8", fontSize: 16, radius: 9 } },
    { id: "email-label", type: "text", x: 394, y: 406, width: 150, height: 30, text: "Email", style: { color: "#334155", fontSize: 16, fontWeight: 700 } },
    { id: "email-input", type: "rectangle", x: 394, y: 438, width: 492, height: 50, text: "jane@example.com", style: { fill: "#ffffff", stroke: "#cbd5e1", strokeWidth: 2, color: "#94a3b8", fontSize: 16, radius: 9 } },
    { id: "message-label", type: "text", x: 394, y: 506, width: 150, height: 30, text: "Message", style: { color: "#334155", fontSize: 16, fontWeight: 700 } },
    { id: "message-input", type: "rectangle", x: 394, y: 538, width: 492, height: 88, text: "How can we help?", style: { fill: "#ffffff", stroke: "#cbd5e1", strokeWidth: 2, color: "#94a3b8", fontSize: 16, radius: 9 } },
    { id: "submit-button", type: "rectangle", x: 394, y: 646, width: 492, height: 46, text: "Send message", style: { fill: "#6d5ef7", stroke: "#6d5ef7", strokeWidth: 2, color: "#ffffff", fontSize: 16, fontWeight: 700, radius: 10, textAlign: "center" } }
  ].map(normalizeElement);
  return board;
}
function applyTemplate(board, template) {
  if (template === "contact-form") return contactTemplate(board);
  if (template === "flowchart") board.elements = [
    { id: "start", type: "ellipse", x: 100, y: 170, width: 160, height: 72, text: "Start", style: { fill: "#dcfce7", stroke: "#22c55e", color: "#166534", fontWeight: 700 } },
    { id: "process", type: "rectangle", x: 370, y: 150, width: 220, height: 112, text: "Process", style: { fill: "#eef2ff", stroke: "#6366f1", color: "#312e81", radius: 12 } },
    { id: "decision", type: "diamond", x: 710, y: 140, width: 180, height: 132, text: "Approved?", style: { fill: "#fef3c7", stroke: "#f59e0b", color: "#92400e" } },
    { id: "a-b", type: "arrow", x: 260, y: 206, points: [[0,0],[110,0]], style: { stroke: "#64748b", strokeWidth: 2 } },
    { id: "b-c", type: "arrow", x: 590, y: 206, points: [[0,0],[120,0]], style: { stroke: "#64748b", strokeWidth: 2 } }
  ].map(normalizeElement);
  return board;
}
async function loadBoard(boardId) {
  const file = boardPath(boardId);
  const board = JSON.parse(await readFile(file, "utf8"));
  board.elements = (board.elements || []).map(normalizeElement);
  return { board, file };
}
async function saveBoard(board, file = boardPath(board.id)) {
  board.updatedAt = now();
  board.revision = number(board.revision, 0) + 1;
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(board, null, 2)}\n`, "utf8");
  await rename(temp, file);
  const versions = historyRoot(board.id);
  await mkdir(versions, { recursive: true });
  await writeFile(path.join(versions, `${String(board.revision).padStart(12, "0")}.json`), `${JSON.stringify(board, null, 2)}\n`, "utf8");
  return file;
}
async function listHistory(boardId) {
  const folder = historyRoot(boardId);
  let files = []; try { files = await readdir(folder); } catch { return []; }
  const versions = [];
  for (const name of files.filter((item) => item.endsWith(".json")).sort().reverse().slice(0, 100)) {
    try { const value = JSON.parse(await readFile(path.join(folder, name), "utf8")); versions.push({ revision: value.revision, updatedAt: value.updatedAt, element_count: value.elements?.length || 0 }); } catch {}
  }
  return versions;
}
async function readHistory(boardId, revision) { return JSON.parse(await readFile(path.join(historyRoot(boardId), `${String(revision).padStart(12, "0")}.json`), "utf8")); }
function svgFor(board) {
  const defs = `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#64748b"/></marker></defs>`;
  const render = (e) => {
    const s = e.style || {}; const fill = s.fill || (e.type === "note" ? "#fef3c7" : "#ffffff"); const stroke = s.stroke || "#64748b"; const sw = number(s.strokeWidth, 2); const color = s.color || "#1e293b"; const fs = number(s.fontSize, 18); const opacity = number(s.opacity, 100) / 100;
    const label = e.text ? `<text x="${e.x + e.width / 2}" y="${e.y + e.height / 2}" dominant-baseline="middle" text-anchor="middle" fill="${escapeXml(color)}" font-family="${escapeXml(s.fontFamily || "Inter, Arial, sans-serif")}" font-size="${fs}" font-weight="${escapeXml(s.fontWeight || 400)}">${escapeXml(e.text)}</text>` : "";
    if (e.type === "text") return `<text x="${e.x + (s.textAlign === "center" ? e.width / 2 : 0)}" y="${e.y + fs}" text-anchor="${s.textAlign === "center" ? "middle" : "start"}" fill="${escapeXml(color)}" font-family="${escapeXml(s.fontFamily || "Inter, Arial, sans-serif")}" font-size="${fs}" font-weight="${escapeXml(s.fontWeight || 400)}" opacity="${opacity}">${escapeXml(e.text)}</text>`;
    if (e.type === "ellipse") return `<ellipse cx="${e.x + e.width/2}" cy="${e.y + e.height/2}" rx="${e.width/2}" ry="${e.height/2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>${label}`;
    if (e.type === "diamond") return `<polygon points="${e.x+e.width/2},${e.y} ${e.x+e.width},${e.y+e.height/2} ${e.x+e.width/2},${e.y+e.height} ${e.x},${e.y+e.height/2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>${label}`;
    if (e.type === "line" || e.type === "arrow") { const source = board.elements.find((item) => item.id === e.sourceId); const target = board.elements.find((item) => item.id === e.targetId); const points = source && target ? `${source.x+source.width/2},${source.y+source.height/2} ${target.x+target.width/2},${target.y+target.height/2}` : (e.points || []).map(([px,py]) => `${e.x+px},${e.y+py}`).join(" "); return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="${sw}" ${e.type === "arrow" ? 'marker-end="url(#arrow)"' : ""} opacity="${opacity}"/>`; }
    return `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${number(s.radius, e.type === "note" ? 8 : 4)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>${label}`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${board.width}" height="${board.height}" viewBox="0 0 ${board.width} ${board.height}"><rect width="100%" height="100%" fill="${escapeXml(board.background || "#f8fafc")}"/>${defs}${board.elements.map(render).join("")}</svg>`;
}
async function ensureHttp() {
  if (httpServer) return httpPort;
  httpServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/boards/")) {
        const rest = decodeURIComponent(url.pathname.slice("/api/boards/".length));
        const [boardId, action, revision] = rest.split("/");
        if (action === "history" && req.method === "GET") { if (revision) { const board = await readHistory(boardId, revision); res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" }); res.end(JSON.stringify({ board })); return; } const versions = await listHistory(boardId); res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" }); res.end(JSON.stringify({ versions })); return; }
        if (req.method === "GET") { const { board } = await loadBoard(boardId); res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" }); res.end(JSON.stringify(board)); return; }
        if (req.method === "PUT") { let body = ""; for await (const chunk of req) body += chunk; const incoming = JSON.parse(body); const { board, file } = await loadBoard(boardId); incoming.id = board.id; incoming.createdAt = board.createdAt; incoming.elements = (incoming.elements || []).map(normalizeElement); await saveBoard(incoming, file); res.writeHead(200, { "content-type": MIME[".json"] }); res.end(JSON.stringify({ saved: true, revision: incoming.revision })); return; }
      }
      if (url.pathname.startsWith("/api/selection/")) { const boardId = decodeURIComponent(url.pathname.slice("/api/selection/".length)); if (req.method === "GET") { res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" }); res.end(JSON.stringify(selections.get(boardId) || { ids: [], elements: [] })); return; } if (req.method === "PUT") { let body = ""; for await (const chunk of req) body += chunk; selections.set(boardId, JSON.parse(body)); res.writeHead(200, { "content-type": MIME[".json"] }); res.end(JSON.stringify({ saved: true })); return; } }
      const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
      const file = path.resolve(WEB_ROOT, relative);
      if (!file.startsWith(WEB_ROOT)) throw new Error("Invalid path");
      const bytes = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" }); res.end(bytes);
    } catch (error) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end(error instanceof Error ? error.message : "Not found"); }
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  httpPort = httpServer.address().port;
  return httpPort;
}
function content(message, data) { return { content: [{ type: "text", text: message }], structuredContent: data }; }
const tools = [
  { name: "create_board", title: "Create local whiteboard", description: "Create a new editable local whiteboard. Templates: blank, contact-form, flowchart.", inputSchema: { type: "object", properties: { title: { type: "string" }, template: { type: "string", enum: ["blank", "contact-form", "flowchart"] }, width: { type: "number" }, height: { type: "number" } }, required: ["title"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "list_boards", title: "List local whiteboards", description: "List locally stored whiteboards ordered by most recently modified.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "open_board", title: "Open editable whiteboard", description: "Start the private local canvas and return a loopback URL for editing a board.", inputSchema: { type: "object", properties: { board_id: { type: "string" } }, required: ["board_id"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "query_elements", title: "Inspect whiteboard elements", description: "Return board elements, optionally filtered by ids, type, or text. Always use before modifying an existing board.", inputSchema: { type: "object", properties: { board_id: { type: "string" }, ids: { type: "array", items: { type: "string" } }, type: { type: "string" }, text: { type: "string" } }, required: ["board_id"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "add_elements", title: "Add whiteboard elements", description: "Add editable rectangle, ellipse, diamond, text, note, arrow, or line elements to a board.", inputSchema: { type: "object", properties: { board_id: { type: "string" }, elements: { type: "array", items: { type: "object", additionalProperties: true } } }, required: ["board_id", "elements"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "update_elements", title: "Update whiteboard elements", description: "Patch existing elements by stable id. Only supplied fields change.", inputSchema: { type: "object", properties: { board_id: { type: "string" }, elements: { type: "array", items: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: true } } }, required: ["board_id", "elements"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "delete_elements", title: "Delete whiteboard elements", description: "Delete specified elements from a board by id.", inputSchema: { type: "object", properties: { board_id: { type: "string" }, ids: { type: "array", items: { type: "string" } } }, required: ["board_id", "ids"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "layout_board", title: "Arrange whiteboard elements", description: "Arrange selected or all non-line elements in a grid or horizontal/vertical flow.", inputSchema: { type: "object", properties: { board_id: { type: "string" }, ids: { type: "array", items: { type: "string" } }, mode: { type: "string", enum: ["grid", "horizontal", "vertical"] }, gap: { type: "number" }, start_x: { type: "number" }, start_y: { type: "number" } }, required: ["board_id", "mode"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "export_board", title: "Export whiteboard", description: "Export a board as editable JSON, SVG, or PNG to the same local whiteboard folder.", inputSchema: { type: "object", properties: { board_id: { type: "string" }, format: { type: "string", enum: ["json", "svg", "png"] } }, required: ["board_id", "format"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "get_storage_info", title: "Get whiteboard storage", description: "Show the active local or synced directory where editable whiteboards are stored.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "set_storage_directory", title: "Set whiteboard storage", description: "Choose a local or cloud-synced directory for future whiteboard reads and writes. Existing files are not moved.", inputSchema: { type: "object", properties: { directory: { type: "string", description: "Absolute path or a path beginning with ~/" } }, required: ["directory"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }
  ,{ name: "get_board_context", title: "Get active whiteboard context", description: "Return the board plus the element selection currently active in the editor. Use before applying a request that refers to selected or current elements.", inputSchema: { type: "object", properties: { board_id: { type: "string" } }, required: ["board_id"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }
  ,{ name: "get_board_history", title: "Get whiteboard history", description: "List up to 100 locally saved versions of a whiteboard.", inputSchema: { type: "object", properties: { board_id: { type: "string" } }, required: ["board_id"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }
  ,{ name: "restore_board_version", title: "Restore whiteboard version", description: "Restore a previous local whiteboard version and save it as a new revision.", inputSchema: { type: "object", properties: { board_id: { type: "string" }, revision: { type: "number" } }, required: ["board_id", "revision"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }
  ,{ name: "render_board", title: "Show interactive whiteboard", description: "Render the editable whiteboard UI after creating or fetching a board. Use this for an inline or fullscreen visual experience.", inputSchema: { type: "object", properties: { board_id: { type: "string" } }, required: ["board_id"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { resourceUri: WIDGET_URI }, "openai/outputTemplate": WIDGET_URI, "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Opening whiteboard…", "openai/toolInvocation/invoked": "Whiteboard ready" } }
];
async function callTool(name, args = {}) {
  if (name === "get_storage_info") return content(`Whiteboards are stored under ${boardRoot}`, { root: boardRoot, config_file: CONFIG_FILE, overridden_by_environment: Boolean(process.env.MY_WHITEBOARD_HOME) });
  if (name === "set_storage_directory") {
    if (process.env.MY_WHITEBOARD_HOME) throw new Error("MY_WHITEBOARD_HOME is set for this MCP server. Remove that environment override before changing storage with this tool.");
    const nextRoot = resolveUserPath(args.directory);
    await mkdir(nextRoot, { recursive: true });
    await mkdir(CONFIG_ROOT, { recursive: true });
    await writeFile(CONFIG_FILE, `${JSON.stringify({ storageDirectory: nextRoot }, null, 2)}\n`, "utf8");
    boardRoot = nextRoot;
    return content(`Whiteboard storage changed to ${boardRoot}. Existing files were not moved.`, { root: boardRoot, config_file: CONFIG_FILE });
  }
  if (name === "get_board_history") return content("Whiteboard version history.", { board_id: args.board_id, versions: await listHistory(args.board_id) });
  if (name === "restore_board_version") { const previous = await readHistory(args.board_id, args.revision); const { board: current, file } = await loadBoard(args.board_id); previous.id = current.id; previous.createdAt = current.createdAt; previous.revision = current.revision; await saveBoard(previous, file); return content(`Restored revision ${args.revision} as revision ${previous.revision}.`, { board_id: previous.id, revision: previous.revision, restored_from: args.revision }); }
  if (name === "create_board") { let board = makeBoard(args.title, args.width, args.height); board = applyTemplate(board, args.template || "blank"); let file = boardPath(board.id); try { await stat(file); board.id = `${board.id}-${Date.now()}`; file = boardPath(board.id); } catch {} await saveBoard(board, file); return content(`Created local whiteboard “${board.title}”.`, { board_id: board.id, path: file, revision: board.revision, element_count: board.elements.length }); }
  if (name === "list_boards") { const files = (await readdir(boardRoot)).filter((file) => file.endsWith(".whiteboard.json")); const boards = []; for (const file of files) { try { const board = JSON.parse(await readFile(path.join(boardRoot, file), "utf8")); boards.push({ id: board.id, title: board.title, updatedAt: board.updatedAt, revision: board.revision, element_count: board.elements?.length || 0 }); } catch {} } boards.sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))); return content(`${boards.length} local whiteboard(s).`, { boards, root: boardRoot }); }
  const { board, file } = await loadBoard(args.board_id);
  if (name === "get_board_context") { const selection = selections.get(board.id) || { ids: [], elements: [] }; return content(`${selection.ids?.length || 0} selected element(s) on “${board.title}”.`, { board, selection }); }
  if (name === "open_board") { const port = await ensureHttp(); const url = `http://127.0.0.1:${port}/?board=${encodeURIComponent(board.id)}`; return content(`Open the editable local canvas: ${url}`, { board_id: board.id, url, path: file, revision: board.revision }); }
  if (name === "render_board") { const port = await ensureHttp(); const url = `http://127.0.0.1:${port}/?board=${encodeURIComponent(board.id)}&embedded=1`; return { ...content(`Interactive whiteboard ready for “${board.title}”.`, { board_id: board.id, title: board.title, revision: board.revision, element_count: board.elements.length, url }), _meta: { ui: { resourceUri: WIDGET_URI }, "openai/outputTemplate": WIDGET_URI } }; }
  if (name === "query_elements") { let elements = board.elements; if (args.ids?.length) { const ids = new Set(args.ids); elements = elements.filter((e) => ids.has(e.id)); } if (args.type) elements = elements.filter((e) => e.type === args.type); if (args.text) elements = elements.filter((e) => e.text.toLowerCase().includes(String(args.text).toLowerCase())); return content(`${elements.length} matching element(s).`, { board: { id: board.id, title: board.title, width: board.width, height: board.height, revision: board.revision }, elements }); }
  if (name === "add_elements") { const incoming = (args.elements || []).map(normalizeElement); const existing = new Set(board.elements.map((e) => e.id)); for (const element of incoming) { if (existing.has(element.id)) throw new Error(`Duplicate element id: ${element.id}`); existing.add(element.id); } board.elements.push(...incoming); await saveBoard(board, file); return content(`Added ${incoming.length} element(s).`, { board_id: board.id, revision: board.revision, ids: incoming.map((e) => e.id) }); }
  if (name === "update_elements") { const byId = new Map(board.elements.map((e) => [e.id, e])); const changed = []; for (const patch of args.elements || []) { const current = byId.get(patch.id); if (!current) throw new Error(`Unknown element id: ${patch.id}`); const next = normalizeElement({ ...current, ...patch, style: { ...current.style, ...(patch.style || {}) }, id: current.id }); Object.assign(current, next); changed.push(current.id); } await saveBoard(board, file); return content(`Updated ${changed.length} element(s).`, { board_id: board.id, revision: board.revision, ids: changed }); }
  if (name === "delete_elements") { const ids = new Set(args.ids || []); const before = board.elements.length; board.elements = board.elements.filter((e) => !ids.has(e.id)); await saveBoard(board, file); return content(`Deleted ${before - board.elements.length} element(s).`, { board_id: board.id, revision: board.revision, deleted: before - board.elements.length }); }
  if (name === "layout_board") { const ids = args.ids?.length ? new Set(args.ids) : null; const selected = board.elements.filter((e) => !["line","arrow"].includes(e.type) && (!ids || ids.has(e.id))); const gap = Math.max(8, number(args.gap, 32)); const startX = number(args.start_x, 80); const startY = number(args.start_y, 80); const cols = args.mode === "grid" ? Math.ceil(Math.sqrt(selected.length)) : args.mode === "vertical" ? 1 : selected.length; const maxW = Math.max(1, ...selected.map((e) => e.width)); const maxH = Math.max(1, ...selected.map((e) => e.height)); selected.forEach((e, i) => { e.x = startX + (i % cols) * (maxW + gap); e.y = startY + Math.floor(i / cols) * (maxH + gap); }); await saveBoard(board, file); return content(`Arranged ${selected.length} element(s) in ${args.mode} layout.`, { board_id: board.id, revision: board.revision, ids: selected.map((e) => e.id) }); }
  if (name === "export_board") { const format = args.format; let output; if (format === "json") { output = path.join(boardRoot, `${board.id}.export.json`); await writeFile(output, `${JSON.stringify(board, null, 2)}\n`, "utf8"); } else { const svg = svgFor(board); const svgPath = path.join(boardRoot, `${board.id}.svg`); await writeFile(svgPath, svg, "utf8"); output = svgPath; if (format === "png") { try { const sharp = loadSharp(); output = path.join(boardRoot, `${board.id}.png`); await sharp(Buffer.from(svg)).png().toFile(output); } catch (error) { throw new Error(`PNG export failed. SVG was saved at ${svgPath}. ${error.message}`); } } } return content(`Exported ${format.toUpperCase()} to ${output}`, { board_id: board.id, format, path: output, sha256: createHash("sha256").update(await readFile(output)).digest("hex") }); }
  throw new Error(`Unknown tool: ${name}`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", async (line) => {
  if (!line.trim()) return;
  let message; try { message = JSON.parse(line); } catch { return; }
  const { id, method, params } = message;
  try {
    if (method === "initialize") return ok(id, { protocolVersion: params?.protocolVersion || "2025-11-25", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "My Whiteboard", version: VERSION }, instructions: `Create and edit structured whiteboards stored under ${boardRoot}. Query elements before modifying existing boards and call render_board after creating a first pass. Use get_board_context for requests that refer to selected elements. Storage may be pointed at a synced folder with set_storage_directory.` });
    if (method === "ping") return ok(id, {});
    if (method === "tools/list") return ok(id, { tools });
    if (method === "tools/call") return ok(id, await callTool(params?.name, params?.arguments || {}));
    if (method === "resources/list") return ok(id, { resources: [{ uri: WIDGET_URI, name: "My Whiteboard canvas", mimeType: "text/html;profile=mcp-app" }] });
    if (method === "resources/read" && params?.uri === WIDGET_URI) {
      const widget = `<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0;font-family:system-ui;background:#eef1f7}.shell{height:100%;display:grid;grid-template-rows:auto 1fr}.bar{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:white;border-bottom:1px solid #ddd}.bar button{border:0;border-radius:8px;padding:8px 12px;background:#6d5ef7;color:#fff}.bar small{color:#748096}iframe{width:100%;height:100%;border:0}</style><div class="shell"><div class="bar"><div><strong id="title">My Whiteboard</strong><br><small id="state">Interactive editable canvas</small></div><button id="full">Fullscreen</button></div><iframe id="frame" title="Editable whiteboard"></iframe></div><script>const openai=window.openai;function update(data){if(!data)return;document.getElementById('title').textContent=data.title||'My Whiteboard';if(data.url)document.getElementById('frame').src=data.url;}update(openai?.toolOutput);window.addEventListener('openai:set_globals',()=>update(openai?.toolOutput));window.addEventListener('message',event=>{if(event.data?.method==='ui/notifications/tool-result')update(event.data.params?.structuredContent)});document.getElementById('full').onclick=()=>openai?.requestDisplayMode?.({mode:'fullscreen'});</script>`;
      return ok(id, { contents: [{ uri: WIDGET_URI, mimeType: "text/html;profile=mcp-app", text: widget, _meta: { ui: { prefersBorder: false, csp: { connectDomains: ["http://127.0.0.1"], resourceDomains: ["http://127.0.0.1"] } } } }] });
    }
    if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
  } catch (error) { if (id !== undefined) fail(id, -32602, error instanceof Error ? error.message : String(error)); }
});

process.on("SIGTERM", () => { httpServer?.close(); process.exit(0); });

if (process.argv[2] === "--preview" && process.argv[3]) {
  const previewBoard = (await loadBoard(process.argv[3])).board;
  const previewPort = await ensureHttp();
  process.stdout.write(`${JSON.stringify({ preview: true, board_id: previewBoard.id, url: `http://127.0.0.1:${previewPort}/?board=${encodeURIComponent(previewBoard.id)}` })}\n`);
}
