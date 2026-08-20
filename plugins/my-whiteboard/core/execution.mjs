import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { applyWorkspaceTransaction, readWorkspace, workspacePaths } from "./store.mjs";
import { clone, timestamp } from "./schema.mjs";
import { NotFoundError, ValidationError } from "./errors.mjs";

const execFileAsync = promisify(execFile);
const processHandles = new Map();
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/**
 * Agent-neutral lifecycle contract. Host clients provide a concrete adapter;
 * the Core only persists Change and Execution state and never branches on a
 * client name.
 *
 * @typedef {{ capabilities(): Promise<object>, start(input: object): Promise<object>, getStatus(executionId: string): Promise<object>, requestStop?(executionId: string): Promise<void>, resume?(input: object): Promise<object> }} AgentExecutionAdapter
 */

function requireChange(workspace, changeId) {
  const change = workspace.entities.changes?.[changeId];
  if (!change) throw new NotFoundError("Change not found.", { changeId });
  return change;
}

function requireExecution(workspace, executionId) {
  const execution = workspace.entities.executions?.[executionId];
  if (!execution) throw new NotFoundError("Execution not found.", { executionId });
  return execution;
}

function appendLifecycle(execution, type, payload = {}) {
  return [...(execution.lifecycle || []), { type, at: timestamp(), ...clone(payload) }];
}

async function updateEntity(projectRoot, collection, id, patch, actor) {
  const workspace = await readWorkspace(projectRoot);
  const current = workspace.entities[collection]?.[id];
  if (!current) throw new NotFoundError(`${collection} entity not found.`, { id });
  const result = await applyWorkspaceTransaction(projectRoot, {
    actor,
    operations: [{ type: "entity.update", collection, id, expectedVersion: current.version, patch }],
  });
  const updated = await readWorkspace(projectRoot);
  return { ...result, entity: updated.entities[collection][id] };
}

export async function createChange(projectRoot, input, actor) {
  const change = {
    id: String(input?.id || `change-${randomUUID().slice(0, 8)}`),
    title: String(input?.title || "Approved Change"),
    featureId: input?.featureId == null ? null : String(input.featureId),
    intent: String(input?.intent || ""),
    status: String(input?.status || "draft"),
    contract: clone(input?.contract || {}),
    desiredState: clone(input?.desiredState || {}),
    acceptanceCriteria: Array.isArray(input?.acceptanceCriteria) ? input.acceptanceCriteria.map(String) : [],
    constraints: Array.isArray(input?.constraints) ? input.constraints.map(String) : [],
    relatedEntityRefs: Array.isArray(input?.relatedEntityRefs) ? clone(input.relatedEntityRefs) : [],
  };
  const result = await applyWorkspaceTransaction(projectRoot, { actor, operations: [{ type: "entity.create", collection: "changes", entity: change }] });
  const workspace = await readWorkspace(projectRoot);
  return { ...result, change: workspace.entities.changes[change.id] };
}

export async function getChange(projectRoot, changeId) {
  const workspace = await readWorkspace(projectRoot);
  return { change: requireChange(workspace, changeId), workspaceVersion: workspace.workspaceVersion };
}

export async function getExecution(projectRoot, executionId) {
  const workspace = await readWorkspace(projectRoot);
  const execution = requireExecution(workspace, executionId);
  const live = processHandles.get(executionId);
  return { execution, live: live ? { pid: live.child.pid, adapterId: live.adapterId } : null, workspaceVersion: workspace.workspaceVersion };
}

async function gitCommand(projectRoot, args) {
  try {
    const result = await execFileAsync("git", args, { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024 });
    return result.stdout.trim();
  } catch {
    return null;
  }
}

export async function repoSnapshot(projectRoot) {
  const revision = await gitCommand(projectRoot, ["rev-parse", "HEAD"]);
  const status = await gitCommand(projectRoot, ["status", "--short"]);
  const files = status
    ? status.split(/\r?\n/).filter(Boolean).map((line) => line.slice(2).trim()).filter(Boolean)
    : [];
  return { available: Boolean(revision), revision, status: status || "", files, capturedAt: timestamp() };
}

function appendOutput(buffer, chunk) {
  const next = `${buffer}${chunk}`;
  return next.length > MAX_OUTPUT_BYTES ? next.slice(-MAX_OUTPUT_BYTES) : next;
}

export class ProcessAgentExecutionAdapter {
  constructor(config = {}) {
    this.adapterId = String(config.adapterId || "process");
    this.command = String(config.command || "");
    this.args = Array.isArray(config.args) ? config.args.map(String) : [];
    this.env = config.env && typeof config.env === "object" ? clone(config.env) : {};
  }

  async capabilities() {
    return {
      adapterId: this.adapterId,
      kind: "process",
      available: Boolean(this.command),
      lifecycle: ["queued", "running", "completed", "interrupted", "failed"],
      supports: { start: true, status: true, stop: true, resume: true, repoChangeCapture: true },
      commandConfigured: Boolean(this.command),
    };
  }

  async start(input) {
    if (!this.command) throw new ValidationError("Process Agent adapter requires a command.");
    const executionDir = path.join(workspacePaths(input.projectRoot).directory, "executions", input.executionId);
    await mkdir(executionDir, { recursive: true });
    const inputPath = path.join(executionDir, "input.json");
    await writeFile(inputPath, `${JSON.stringify({ change: input.change, executionId: input.executionId, projectRoot: input.projectRoot }, null, 2)}\n`, "utf8");
    const child = spawn(this.command, this.args, {
      cwd: input.projectRoot,
      env: {
        ...process.env,
        ...this.env,
        MY_WHITEBOARD_CHANGE_ID: input.change.id,
        MY_WHITEBOARD_EXECUTION_ID: input.executionId,
        MY_WHITEBOARD_CHANGE_CONTRACT_PATH: inputPath,
        MY_WHITEBOARD_REPO_ROOT: input.projectRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    const handle = { child, adapterId: this.adapterId, output: "", errorOutput: "", inputPath };
    child.stdout?.on("data", (chunk) => { handle.output = appendOutput(handle.output, chunk.toString()); });
    child.stderr?.on("data", (chunk) => { handle.errorOutput = appendOutput(handle.errorOutput, chunk.toString()); });
    processHandles.set(input.executionId, handle);
    child.once("error", (error) => {
      handle.error = { name: error.name, message: error.message, code: error.code };
      input.onError?.(error, handle);
    });
    child.once("exit", (code, signal) => {
      processHandles.delete(input.executionId);
      input.onExit?.({ code, signal, output: handle.output, errorOutput: handle.errorOutput, error: handle.error }, handle);
    });
    return { executionId: input.executionId, pid: child.pid, inputPath, adapterId: this.adapterId };
  }

  async getStatus(executionId) {
    const handle = processHandles.get(executionId);
    if (!handle) return { executionId, running: false, available: false };
    return { executionId, running: handle.child.exitCode == null, pid: handle.child.pid, adapterId: handle.adapterId };
  }

  async requestStop(executionId) {
    const handle = processHandles.get(executionId);
    if (!handle || handle.child.exitCode != null) return;
    handle.stopRequested = true;
    handle.child.kill();
  }
}

export function createExecutionAdapter(config) {
  if (!config || typeof config !== "object") throw new ValidationError("Execution adapter configuration is required.");
  if (String(config.kind || "process") !== "process") throw new ValidationError(`Unsupported execution adapter kind: ${config.kind}`);
  return new ProcessAgentExecutionAdapter(config);
}

export async function executionCapabilities(config) {
  return { capabilities: await createExecutionAdapter(config).capabilities() };
}

async function finishExecution(projectRoot, executionId, result, actor) {
  const current = (await getExecution(projectRoot, executionId)).execution;
  if (!["queued", "running"].includes(current.status)) return current;
  const status = result.signal ? (result.stopRequested ? "interrupted" : "failed") : result.code === 0 ? "completed" : "failed";
  const repoAfter = await repoSnapshot(projectRoot);
  const patch = {
    status,
    output: { stdout: result.output || "", stderr: result.errorOutput || "" },
    error: result.error || (status === "failed" && result.code !== 0 ? { message: `Agent exited with code ${result.code}.`, code: result.code } : null),
    repoAfter,
    repoChange: {
      files: [...new Set([...(current.repoBefore?.files || []), ...(repoAfter.files || [])])],
      revisionBefore: current.repoBefore?.revision || null,
      revisionAfter: repoAfter.revision || null,
    },
    lifecycle: appendLifecycle(current, status, { exitCode: result.code, signal: result.signal, pid: current.pid }),
    endedAt: timestamp(),
  };
  const saved = await updateEntity(projectRoot, "executions", executionId, patch, actor || { id: "execution-system", client: "core" });
  const workspace = await readWorkspace(projectRoot);
  const change = workspace.entities.changes[current.changeId];
  if (change && change.status === "executing") {
    await updateEntity(projectRoot, "changes", change.id, { status }, actor || { id: "execution-system", client: "core" });
  }
  return saved.entity;
}

export async function startExecution(projectRoot, options = {}) {
  const actor = options.actor || { id: options.agentId || "agent", client: "unknown" };
  const workspace = await readWorkspace(projectRoot);
  const change = requireChange(workspace, String(options.changeId || ""));
  if (change.status !== "approved") throw new ValidationError("Only an approved Change can start execution.", { changeId: change.id, status: change.status });
  const adapter = createExecutionAdapter(options.adapter);
  const executionId = String(options.executionId || `execution-${randomUUID().slice(0, 8)}`);
  const repoBefore = await repoSnapshot(projectRoot);
  const execution = {
    id: executionId,
    title: `Execution: ${change.title}`,
    changeId: change.id,
    agentId: String(options.agentId || actor.id),
    adapterId: adapter.adapterId,
    status: "queued",
    input: { changeId: change.id, adapter: { kind: "process", adapterId: adapter.adapterId, command: adapter.command, args: adapter.args } },
    output: {},
    error: null,
    lifecycle: [{ type: "queued", at: timestamp() }],
    repoBefore,
    repoAfter: null,
    repoChange: null,
    parentExecutionId: options.parentExecutionId || null,
  };
  const created = await applyWorkspaceTransaction(projectRoot, { actor, operations: [
    { type: "entity.create", collection: "executions", entity: execution },
    { type: "entity.update", collection: "changes", id: change.id, expectedVersion: change.version, patch: { status: "executing" } },
  ] });
  const onExit = (result, handle) => finishExecution(projectRoot, executionId, { ...result, stopRequested: handle.stopRequested }, actor).catch(() => {});
  const onError = (error, handle) => { handle.error = { name: error.name, message: error.message, code: error.code }; };
  try {
    const handle = await adapter.start({ projectRoot, executionId, change: clone(change), onExit, onError });
    const saved = await updateEntity(projectRoot, "executions", executionId, {
      status: "running",
      pid: handle.pid,
      inputPath: handle.inputPath,
      startedAt: timestamp(),
      lifecycle: [{ type: "queued", at: execution.lifecycle[0].at }, { type: "started", at: timestamp(), pid: handle.pid }],
    }, actor);
    return { execution: saved.entity, handle, capabilities: await adapter.capabilities(), workspaceVersion: saved.workspaceVersion };
  } catch (error) {
    const failed = await updateEntity(projectRoot, "executions", executionId, {
      status: "failed",
      error: { name: error.name, message: error.message, code: error.code },
      lifecycle: appendLifecycle(execution, "failed", { error: error.message }),
      endedAt: timestamp(),
    }, actor);
    await updateEntity(projectRoot, "changes", change.id, { status: "failed" }, actor).catch(() => {});
    return { execution: failed.entity, error: failed.entity.error, workspaceVersion: failed.workspaceVersion };
  }
}

export async function stopExecution(projectRoot, executionId, actor) {
  const current = (await getExecution(projectRoot, executionId)).execution;
  if (!["queued", "running"].includes(current.status)) return { execution: current, workspaceVersion: (await readWorkspace(projectRoot)).workspaceVersion };
  const live = processHandles.get(executionId);
  if (live) live.stopRequested = true;
  if (live) live.child.kill();
  else if (current.pid) {
    try { process.kill(Number(current.pid)); } catch {}
  }
  return { execution: (await getExecution(projectRoot, executionId)).execution, workspaceVersion: (await readWorkspace(projectRoot)).workspaceVersion };
}

export async function resumeExecution(projectRoot, executionId, actor) {
  const current = (await getExecution(projectRoot, executionId)).execution;
  if (!["interrupted", "failed", "cancelled"].includes(current.status)) throw new ValidationError("Only an interrupted, failed, or cancelled Execution can resume.", { executionId, status: current.status });
  const workspace = await readWorkspace(projectRoot);
  const change = requireChange(workspace, current.changeId);
  if (change.status !== "approved") {
    await updateEntity(projectRoot, "changes", change.id, { status: "approved" }, actor);
  }
  return startExecution(projectRoot, { changeId: change.id, agentId: current.agentId, adapter: current.input?.adapter, parentExecutionId: current.id, actor });
}
