import { spawn } from "node:child_process";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";

const testStorage = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-test-"));
const testConfig = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-config-test-"));

const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    MY_WHITEBOARD_CONFIG_HOME: testConfig,
    MY_WHITEBOARD_HOME: "",
  },
});
const output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
let sequence = 0;
output.on("line", (line) => {
  const message = JSON.parse(line);
  const resolver = pending.get(message.id);
  if (resolver) { pending.delete(message.id); resolver(message); }
});
function request(method, params = {}) {
  const id = ++sequence;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`Timed out: ${method}`)), 8000);
  });
}
function assert(value, message) { if (!value) throw new Error(message); }

try {
  const init = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {} });
  assert(init.result?.serverInfo?.name === "My Whiteboard", "initialize failed");
  const listed = await request("tools/list");
  assert(listed.result.tools.length === 19, "unexpected tool count");
  const renderedTool = listed.result.tools.find((tool) => tool.name === "render_board");
  assert(renderedTool, "render tool missing");
  const configured = await request("tools/call", { name: "set_storage_directory", arguments: { directory: testStorage } });
  assert(configured.result.structuredContent.root === testStorage, "storage configuration failed");
  const storage = await request("tools/call", { name: "get_storage_info", arguments: {} });
  assert(storage.result.structuredContent.root === testStorage, "portable storage lookup failed");
  assert(storage.result.structuredContent.overridden_by_environment === false, "unexpected environment override");
  const projectRoot = path.join(testStorage, "sample-project");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "index.js"), "export const answer = 42;\n", "utf8");
  const codeBoard = await request("tools/call", { name: "create_code_board", arguments: { title: "Auth architecture", project_root: projectRoot } });
  const codeBoardId = codeBoard.result.structuredContent.board_id;
  assert(codeBoard.result.structuredContent.path.includes(`${path.sep}.codex${path.sep}whiteboards${path.sep}`), "project board path missing");
  assert(codeBoard.result.structuredContent.scanned_files >= 1, "project scan failed");
  await request("tools/call", { name: "add_elements", arguments: { board_id: codeBoardId, elements: [{ id: "auth-node", type: "rectangle", x: 100, y: 100, width: 220, height: 90, text: "Auth service" }, { id: "db-node", type: "rectangle", x: 440, y: 100, width: 220, height: 90, text: "Database" }, { id: "auth-db", type: "arrow", x: 320, y: 145, points: [[0, 0], [120, 0]], sourceId: "auth-node", targetId: "db-node" }] } });
  const linked = await request("tools/call", { name: "link_code_elements", arguments: { board_id: codeBoardId, links: [{ id: "auth-node", code: { file: "src/auth/service.ts", symbol: "AuthService", line: 42, kind: "class" }, status: "处理中", riskTags: ["高耦合"], testRefs: ["tests/auth.test.ts"] }] } });
  assert(linked.result.structuredContent.ids[0] === "auth-node", "code link failed");
  const analysis = await request("tools/call", { name: "analyze_code_board", arguments: { board_id: codeBoardId } });
  assert(analysis.result.structuredContent.analysis.nodes >= 2 && analysis.result.structuredContent.analysis.tests.length === 1, "code analysis failed");
  const created = await request("tools/call", { name: "create_board", arguments: { title: "Contact form acceptance", template: "contact-form" } });
  const boardId = created.result.structuredContent.board_id;
  assert(created.result.structuredContent.element_count === 12, "contact template incomplete");
  const query = await request("tools/call", { name: "query_elements", arguments: { board_id: boardId, ids: ["submit-button"] } });
  assert(query.result.structuredContent.elements[0].text === "Send message", "query failed");
  const update = await request("tools/call", { name: "update_elements", arguments: { board_id: boardId, elements: [{ id: "submit-button", text: "Send it" }] } });
  assert(update.result.structuredContent.ids[0] === "submit-button", "update failed");
  const context = await request("tools/call", { name: "get_board_context", arguments: { board_id: boardId } });
  assert(context.result.structuredContent.board.id === boardId, "board context failed");
  const history = await request("tools/call", { name: "get_board_history", arguments: { board_id: boardId } });
  assert(history.result.structuredContent.versions.length >= 2, "version history failed");
  const exported = await request("tools/call", { name: "export_board", arguments: { board_id: boardId, format: "svg" } });
  assert(exported.result.structuredContent.path.endsWith(".svg"), "SVG export failed");
  const png = await request("tools/call", { name: "export_board", arguments: { board_id: boardId, format: "png" } });
  assert(png.result.structuredContent.path.endsWith(".png"), "PNG export failed");
  const opened = await request("tools/call", { name: "open_board", arguments: { board_id: boardId } });
  const response = await fetch(opened.result.structuredContent.url);
  assert(response.ok && (await response.text()).includes("My Whiteboard"), "canvas HTTP server failed");
  const rendered = await request("tools/call", { name: "render_board", arguments: { board_id: boardId } });
  assert(rendered.result.structuredContent.embedded === false && rendered.result.structuredContent.url.startsWith("http://127.0.0.1:"), "direct render failed");
  process.stdout.write(`${JSON.stringify({ ok: true, board_id: boardId, url: opened.result.structuredContent.url, svg: exported.result.structuredContent.path, png: png.result.structuredContent.path }, null, 2)}\n`);
} finally {
  child.kill();
}
