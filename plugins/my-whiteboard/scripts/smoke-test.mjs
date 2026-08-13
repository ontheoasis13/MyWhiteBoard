import { spawn } from "node:child_process";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";

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
  assert(listed.result.tools.length === 15, "unexpected tool count");
  const renderedTool = listed.result.tools.find((tool) => tool.name === "render_board");
  assert(renderedTool?._meta?.ui?.resourceUri === "ui://my-whiteboard/canvas-v3.html", "widget metadata missing");
  const configured = await request("tools/call", { name: "set_storage_directory", arguments: { directory: testStorage } });
  assert(configured.result.structuredContent.root === testStorage, "storage configuration failed");
  const storage = await request("tools/call", { name: "get_storage_info", arguments: {} });
  assert(storage.result.structuredContent.root === testStorage, "portable storage lookup failed");
  assert(storage.result.structuredContent.overridden_by_environment === false, "unexpected environment override");
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
  assert(rendered.result._meta.ui.resourceUri === "ui://my-whiteboard/canvas-v3.html", "render board failed");
  const resources = await request("resources/list");
  assert(resources.result.resources[0].uri === "ui://my-whiteboard/canvas-v3.html", "resource listing failed");
  const widget = await request("resources/read", { uri: "ui://my-whiteboard/canvas-v3.html" });
  assert(widget.result.contents[0].mimeType === "text/html;profile=mcp-app", "widget resource failed");
  process.stdout.write(`${JSON.stringify({ ok: true, board_id: boardId, url: opened.result.structuredContent.url, svg: exported.result.structuredContent.path, png: png.result.structuredContent.path }, null, 2)}\n`);
} finally {
  child.kill();
}
