import { spawn } from "node:child_process";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile } from "node:fs/promises";

const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-workspace-smoke-"));
await writeFile(path.join(projectRoot, "index.js"), "import { answer } from './value.js';\napp.get('/api/answers', () => answer);\n", "utf8");
await writeFile(path.join(projectRoot, "value.js"), "export const answer = 42;\n", "utf8");

const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, MY_WHITEBOARD_WORKSPACE_IDLE_MS: "5000" },
});
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

function parseTextFallback(result) {
  const marker = "\n\nStructured result (JSON):\n";
  const text = result.content?.find((item) => item.type === "text")?.text || "";
  const markerIndex = text.indexOf(marker);
  assert(markerIndex >= 0, "MCP text fallback is missing");
  return JSON.parse(text.slice(markerIndex + marker.length));
}

try {
  const initialized = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {} });
  assert(initialized.result?.serverInfo?.name === "My Whiteboard Workspace", "initialize failed");
  const listed = await request("tools/list");
  assert(listed.result.tools.length === 38, "unexpected workspace tool count");
  assert(listed.result.tools.every((tool) => !tool._meta?.["openai/outputTemplate"]), "iframe output template remains");
  const project = await request("tools/call", { name: "project_create", arguments: { project_root: projectRoot, name: "Smoke Project", actor: { id: "codex", client: "codex" } } });
  assert(project.result.structuredContent.workspaceVersion === 1, "project creation failed");
  const agent = await request("tools/call", { name: "agent_connect", arguments: { project_root: projectRoot, agent: { id: "codex", displayName: "Codex", client: "codex", capabilities: ["code", "board"] } } });
  assert(agent.result.structuredContent.agent.version === 1, "Agent identity failed");
  const claude = await request("tools/call", { name: "agent_connect", arguments: { project_root: projectRoot, agent: { id: "claude", displayName: "Claude", client: "claude", capabilities: ["review"] } } });
  assert(claude.result.structuredContent.agent.version === 1, "second Agent identity failed");
  const context = await request("tools/call", { name: "context_apply", arguments: { project_root: projectRoot, changes: [{ op: "create", entity: { id: "goal", title: "Goal", content: "Verify Single-Agent Workspace", sources: ["README.md"] } }] } });
  assert(context.result.structuredContent.entities.goal.version === 1, "context creation failed");
  const tasks = await request("tools/call", { name: "tasks_apply", arguments: { project_root: projectRoot, changes: [{ op: "create", entity: { id: "verify", title: "Verify workspace", assigneeAgentId: "codex" } }] } });
  assert(tasks.result.structuredContent.entities.verify.status === "todo", "task creation failed");
  const decisions = await request("tools/call", { name: "decisions_apply", arguments: { project_root: projectRoot, changes: [{ op: "create", entity: { id: "authority", title: "Semantic authority", rationale: "One authoritative state", status: "accepted" } }] } });
  assert(decisions.result.structuredContent.entities.authority.status === "accepted", "decision creation failed");
  const artifacts = await request("tools/call", { name: "artifacts_apply", arguments: { project_root: projectRoot, changes: [{ op: "create", entity: { id: "state", title: "Workspace state", kind: "file", path: ".my-whiteboard/workspace.json" } }] } });
  assert(artifacts.result.structuredContent.entities.state.kind === "file", "artifact creation failed");
  const created = await request("tools/call", { name: "board_create", arguments: { project_root: projectRoot, id: "architecture", title: "Architecture", elements: [{ id: "api", kind: "node", semanticType: "service", label: "API" }, { id: "db", kind: "node", semanticType: "database", label: "DB" }, { id: "api-db", kind: "edge", semanticType: "dependency", label: "reads", properties: { sourceId: "api", targetId: "db" } }] } });
  assert(created.result.structuredContent.board.elements.api.version === 1, "semantic board creation failed");
  const handoff = await request("tools/call", { name: "handoff_create", arguments: { project_root: projectRoot, handoff: { id: "review-handoff", title: "Review", summary: "Review the architecture board", fromAgentId: "codex", toAgentId: "claude", taskIds: ["verify"], artifactIds: ["state"], boardIds: ["architecture"] } } });
  assert(handoff.result.structuredContent.handoff.version === 1, "handoff creation failed");
  const accepted = await request("tools/call", { name: "handoff_update", arguments: { project_root: projectRoot, handoff_id: "review-handoff", expected_version: 1, patch: { status: "accepted" }, actor: { id: "claude", client: "claude" } } });
  assert(accepted.result.structuredContent.handoff.version === 2, "handoff update failed");
  const message = await request("tools/call", { name: "message_send", arguments: { project_root: projectRoot, message: { fromAgentId: "claude", toAgentId: "codex", kind: "response", body: "Review started" } } });
  const inbox = await request("tools/call", { name: "messages_get", arguments: { project_root: projectRoot, agent_id: "codex" } });
  assert(inbox.result.structuredContent.messages.some((item) => item.id === message.result.structuredContent.message.id), "Agent message failed");
const synchronized = await request("tools/call", {
  name: "agent_sync",
  arguments: {
    project_root: projectRoot,
    agent: {
      id: "codex",
      displayName: "Codex",
      client: "codex",
      capabilities: ["code", "board"],
    },
    since_version: accepted.result.structuredContent.workspaceVersion,
  },
});
  assert(synchronized.result.structuredContent.events.some((event) => event.type === "message.created"), "Agent Delta sync failed");
  const synchronizedText = parseTextFallback(synchronized.result);
  assert(synchronizedText.agent.version === synchronized.result.structuredContent.agent.version, "text-only Agent result is incomplete");
  const applied = await request("tools/call", { name: "board_apply", arguments: { project_root: projectRoot, board_id: "architecture", changes: [{ op: "update", id: "api", expectedVersion: 1, patch: { label: "Gateway" } }] } });
  assert(applied.result.structuredContent.elementVersions.api === 2, "entity version update failed");
  const stale = await request("tools/call", { name: "board_apply", arguments: { project_root: projectRoot, board_id: "architecture", changes: [{ op: "update", id: "api", expectedVersion: 1, patch: { label: "Stale" } }] } });
  assert(stale.error?.data?.code === "VERSION_CONFLICT", "stale update did not conflict");
  const codeBoard = await request("tools/call", { name: "code_board_create", arguments: { project_root: projectRoot, title: "Code", max_files: 10 } });
  assert(codeBoard.result.structuredContent.scannedFiles.length === 2, "code scan failed");
  const grounding = await request("tools/call", { name: "product_grounding_scan", arguments: { project_root: projectRoot, max_files: 10 } });
  const answerFeature = grounding.result.structuredContent.model.features["feature-answers"];
  assert(answerFeature?.groundingRefs.length >= 2, "product grounding failed");
  const correctedFeature = await request("tools/call", { name: "product_feature_correct", arguments: { project_root: projectRoot, feature_id: answerFeature.id, expected_version: answerFeature.version, patch: { name: "Answers" }, reason: "Smoke correction", actor: { id: "human", displayName: "Human", client: "smoke" } } });
  assert(correctedFeature.result.structuredContent.feature.version === 2, "Human Intent correction failed");
  const grounded = await request("tools/call", { name: "product_grounding_get", arguments: { project_root: projectRoot, include_evidence: false } });
  assert(grounded.result.structuredContent.productMap.features.some((item) => item.id === answerFeature.id && item.name === "Answers"), "Product Map read failed");
  const executionAgent = path.join(projectRoot, "smoke-agent.mjs");
  await writeFile(executionAgent, "import { writeFile } from 'node:fs/promises';\nawait writeFile(process.env.MY_WHITEBOARD_REPO_ROOT + '/smoke-agent-output.txt', process.env.MY_WHITEBOARD_CHANGE_ID);\n", "utf8");
  const change = await request("tools/call", { name: "change_create", arguments: { project_root: projectRoot, change: { id: "smoke-change", title: "Smoke Change", intent: "Run a real process", status: "approved", contract: { files: ["smoke-agent-output.txt"] }, acceptanceCriteria: ["output file exists"] }, actor: { id: "human", client: "smoke" } } });
  assert(change.result.structuredContent.change.status === "approved", "Change Contract creation failed");
  const capabilities = await request("tools/call", { name: "execution_capabilities", arguments: { adapter: { kind: "process", adapterId: "smoke-process", command: process.execPath, args: [executionAgent] } } });
  assert(capabilities.result.structuredContent.capabilities.supports.repoChangeCapture === true, "Execution capabilities failed");
  const startedExecution = await request("tools/call", { name: "execution_start", arguments: { project_root: projectRoot, change_id: "smoke-change", agent_id: "codex", adapter: { kind: "process", adapterId: "smoke-process", command: process.execPath, args: [executionAgent] }, actor: { id: "codex", client: "smoke" } } });
  assert(["running", "completed"].includes(startedExecution.result.structuredContent.execution.status), "Execution did not start");
  let execution = startedExecution.result.structuredContent.execution;
  for (let attempt = 0; attempt < 100 && !["completed", "failed", "interrupted"].includes(execution.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    const currentExecution = await request("tools/call", { name: "execution_get", arguments: { project_root: projectRoot, execution_id: execution.id } });
    execution = currentExecution.result.structuredContent.execution;
  }
  assert(execution.status === "completed", "Execution did not complete");
  const delta = await request("tools/call", { name: "workspace_get_changes", arguments: { project_root: projectRoot, since_version: 1 } });
  assert(delta.result.structuredContent.events.length >= 3, "workspace delta failed");
  const deltaText = parseTextFallback(delta.result);
  assert(deltaText.events.length === delta.result.structuredContent.events.length, "text-only Delta result is incomplete");
  const exported = await request("tools/call", { name: "board_export", arguments: { project_root: projectRoot, board_id: "architecture", format: "svg" } });
  assert(exported.result.structuredContent.path.endsWith(".svg"), "semantic export failed");
  const opened = await request("tools/call", { name: "workspace_open", arguments: { project_root: projectRoot, board_id: "architecture" } });
  assert(opened.result.structuredContent.embedded === false, "workspace attempted iframe embedding");
  const response = await fetch(opened.result.structuredContent.url);
  assert(response.ok && (await response.text()).includes("My Whiteboard 工作区"), "standalone workspace failed");
  process.stdout.write(`${JSON.stringify({ ok: true, project_root: projectRoot, board_id: "architecture", url: opened.result.structuredContent.url, tools: listed.result.tools.length }, null, 2)}\n`);
} finally {
  child.kill();
}
