import { spawn } from "node:child_process";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile } from "node:fs/promises";

const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-workspace-smoke-"));
await writeFile(path.join(projectRoot, "index.js"), "import { answer } from './value.js';\nconsole.log(answer);\n", "utf8");
await writeFile(path.join(projectRoot, "value.js"), "export const answer = 42;\n", "utf8");

const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "inherit"] });
const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
let sequence = 0;
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const callback = pending.get(message.id);
  if (callback) { pending.delete(message.id); callback(message); }
});

function request(method, params = {}) {
  const id = ++sequence;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`Timed out: ${method}`)), 10_000);
  });
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

try {
  const initialized = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {} });
  assert(initialized.result?.serverInfo?.name === "My Whiteboard Workspace", "initialize failed");
  const listed = await request("tools/list");
  assert(listed.result.tools.length === 14, "unexpected workspace tool count");
  assert(listed.result.tools.every((tool) => !tool._meta?.["openai/outputTemplate"]), "iframe output template remains");
  const project = await request("tools/call", { name: "project_create", arguments: { project_root: projectRoot, name: "Smoke Project", actor: { id: "codex", client: "codex" } } });
  assert(project.result.structuredContent.workspaceVersion === 1, "project creation failed");
  const created = await request("tools/call", { name: "board_create", arguments: { project_root: projectRoot, id: "architecture", title: "Architecture", elements: [{ id: "api", kind: "node", semanticType: "service", label: "API" }, { id: "db", kind: "node", semanticType: "database", label: "DB" }, { id: "api-db", kind: "edge", semanticType: "dependency", label: "reads", properties: { sourceId: "api", targetId: "db" } }] } });
  assert(created.result.structuredContent.board.elements.api.version === 1, "semantic board creation failed");
  const applied = await request("tools/call", { name: "board_apply", arguments: { project_root: projectRoot, board_id: "architecture", changes: [{ op: "update", id: "api", expectedVersion: 1, patch: { label: "Gateway" } }] } });
  assert(applied.result.structuredContent.elementVersions.api === 2, "entity version update failed");
  const stale = await request("tools/call", { name: "board_apply", arguments: { project_root: projectRoot, board_id: "architecture", changes: [{ op: "update", id: "api", expectedVersion: 1, patch: { label: "Stale" } }] } });
  assert(stale.error?.data?.code === "VERSION_CONFLICT", "stale update did not conflict");
  const codeBoard = await request("tools/call", { name: "code_board_create", arguments: { project_root: projectRoot, title: "Code", max_files: 10 } });
  assert(codeBoard.result.structuredContent.scannedFiles.length === 2, "code scan failed");
  const delta = await request("tools/call", { name: "workspace_get_changes", arguments: { project_root: projectRoot, since_version: 1 } });
  assert(delta.result.structuredContent.events.length >= 3, "workspace delta failed");
  const exported = await request("tools/call", { name: "board_export", arguments: { project_root: projectRoot, board_id: "architecture", format: "svg" } });
  assert(exported.result.structuredContent.path.endsWith(".svg"), "semantic export failed");
  const opened = await request("tools/call", { name: "workspace_open", arguments: { project_root: projectRoot, board_id: "architecture" } });
  assert(opened.result.structuredContent.embedded === false, "workspace attempted iframe embedding");
  const response = await fetch(opened.result.structuredContent.url);
  assert(response.ok && (await response.text()).includes("My Whiteboard Workspace"), "standalone workspace failed");
  process.stdout.write(`${JSON.stringify({ ok: true, project_root: projectRoot, board_id: "architecture", url: opened.result.structuredContent.url, tools: listed.result.tools.length }, null, 2)}\n`);
} finally {
  child.kill();
}
