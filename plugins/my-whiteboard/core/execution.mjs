import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { applyWorkspaceTransaction, readWorkspace, workspacePaths } from "./store.mjs";
import { clone, timestamp } from "./schema.mjs";
import { NotFoundError, ValidationError } from "./errors.mjs";
import { captureRepoSnapshot, deriveExecutionReadiness } from "./project-model.mjs";
import { readProductGrounding } from "./product-grounding.mjs";

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
  const baseline = input?.baseline || input?.repoBaseline || await repoSnapshot(projectRoot);
  const targetFeatureIds = Array.isArray(input?.targetFeatureIds)
    ? input.targetFeatureIds.map(String)
    : Array.isArray(input?.contract?.featureIds) ? input.contract.featureIds.map(String) : input?.featureId ? [String(input.featureId)] : [];
  const change = {
    id: String(input?.id || `change-${randomUUID().slice(0, 8)}`),
    title: String(input?.title || "Approved Change"),
    featureId: input?.featureId == null ? null : String(input.featureId),
    targetFeatureIds,
    baseline: clone(baseline),
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

async function featureAndAgentReadiness(projectRoot, workspace, change, options = {}) {
  const snapshot = options.repoSnapshot || await repoSnapshot(projectRoot);
  let model = null;
  try {
    model = await readProductGrounding(projectRoot);
  } catch (error) {
    if (error?.code !== "NOT_FOUND") throw error;
  }
  const targetFeatureIds = [...new Set([
    ...(Array.isArray(change.targetFeatureIds) ? change.targetFeatureIds : []),
    ...(change.featureId ? [change.featureId] : []),
  ].map(String))];
  const features = targetFeatureIds.map((id) => model?.features?.[id] || { id, actionability: "UNDERSTOOD" });
  const requiredCapabilities = Array.isArray(change.contract?.requiredCapabilities)
    ? change.contract.requiredCapabilities.map(String)
    : [];
  const candidates = Object.values(workspace.entities.agents || {}).filter((agent) => {
    if (!["connected", "idle", "working"].includes(agent.status)) return false;
    return requiredCapabilities.every((capability) => (agent.capabilities || []).includes(capability));
  });
  return deriveExecutionReadiness({
    change,
    feature: features[0],
    features,
    featureIds: targetFeatureIds,
    repoSnapshot: snapshot,
    expectedRepoSnapshotId: change.baseline?.workingTreeFingerprint,
    repoSafetyReady: options.repoSafetyReady === undefined ? !snapshot.dirty : options.repoSafetyReady === true,
    compatibleAgentAvailable: options.compatibleAgentAvailable === undefined ? candidates.length > 0 : options.compatibleAgentAvailable === true,
    agentStatus: options.agentStatus || candidates[0]?.status,
  });
}

function readinessError(readiness) {
  return new ValidationError("Change is not execution-ready.", { executionReadiness: readiness });
}

export async function getChange(projectRoot, changeId) {
  const workspace = await readWorkspace(projectRoot);
  const change = requireChange(workspace, changeId);
  const executionReadiness = await featureAndAgentReadiness(projectRoot, workspace, change);
  return { change, executionReadiness, workspaceVersion: workspace.workspaceVersion };
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
  const status = await gitCommand(projectRoot, ["status", "--short", "--untracked-files=all", "--", ".", ":!.my-whiteboard"]);
  const snapshot = await captureRepoSnapshot(projectRoot, [], timestamp());
  return {
    ...snapshot,
    available: Boolean(snapshot.headRevision),
    revision: snapshot.headRevision,
    status: status || "",
    files: snapshot.changedFiles,
  };
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

/**
 * Claim an approved Change for an already-running external Agent Host. The
 * Host owns the actual code execution; Core owns the durable identity and
 * lifecycle record. No client name is stored or inspected here.
 */
export async function claimHostedExecution(projectRoot, options = {}) {
  const actor = options.actor || { id: options.agentId || "agent", client: "unknown" };
  const workspace = await readWorkspace(projectRoot);
  const change = requireChange(workspace, String(options.changeId || ""));
  const agentId = String(options.agentId || actor.id || "");
  const agent = workspace.entities.agents?.[agentId];
  if (!agent) throw new ValidationError("Execution Agent must be connected before claiming a Change.", { agentId });
  const agentCapabilities = new Set(agent.capabilities || []);
  const compatibleAgentAvailable = ["connected", "idle", "working"].includes(agent.status)
    && (agentCapabilities.has("hostedExecution") || agentCapabilities.has("execution"));
  const executionReadiness = await featureAndAgentReadiness(projectRoot, workspace, change, {
    compatibleAgentAvailable,
    agentStatus: agent.status,
  });
  if (executionReadiness.state !== "READY") throw readinessError(executionReadiness);
  const active = Object.values(workspace.entities.executions || {}).find((execution) => execution.changeId === change.id && ["queued", "running"].includes(execution.status));
  if (active) throw new ValidationError("Change already has an active Execution.", { changeId: change.id, executionId: active.id });
  const executionId = String(options.executionId || `execution-${randomUUID().slice(0, 8)}`);
  const repoBefore = await repoSnapshot(projectRoot);
  const execution = {
    id: executionId,
    title: `Hosted Execution: ${change.title}`,
    changeId: change.id,
    agentId,
    adapterId: "hosted",
    status: "running",
    input: { changeId: change.id, contract: clone(change), adapter: { kind: "hosted", adapterId: "hosted" } },
    output: {},
    error: null,
    lifecycle: [
      { type: "queued", at: timestamp() },
      { type: "claimed", at: timestamp(), agentId },
      { type: "started", at: timestamp(), agentId },
    ],
    repoBefore,
    repoAfter: null,
    repoChange: null,
    parentExecutionId: options.parentExecutionId || null,
  };
  const result = await applyWorkspaceTransaction(projectRoot, { actor, operations: [
    { type: "entity.create", collection: "executions", entity: execution },
    { type: "entity.update", collection: "changes", id: change.id, expectedVersion: change.version, patch: { status: "executing" } },
  ] });
  const current = await readWorkspace(projectRoot);
  return { ...result, execution: current.entities.executions[executionId], change: current.entities.changes[change.id] };
}

export async function reportHostedExecution(projectRoot, options = {}) {
  const actor = options.actor || { id: options.agentId || "agent", client: "unknown" };
  const workspace = await readWorkspace(projectRoot);
  const current = requireExecution(workspace, String(options.executionId || ""));
  const agentId = String(options.agentId || actor.id || "");
  if (current.agentId !== agentId) throw new ValidationError("Only the claimed Agent can report an Execution.", { executionId: current.id, expectedAgentId: current.agentId, agentId });
  const status = String(options.status || "");
  if (!["running", "interrupted", "failed", "completed", "cancelled"].includes(status)) throw new ValidationError(`Invalid hosted Execution report status: ${status}`);
  if (!["queued", "running"].includes(current.status)) throw new ValidationError("Execution is already terminal.", { executionId: current.id, status: current.status });
  const terminal = status !== "running";
  const repoAfter = terminal ? await repoSnapshot(projectRoot) : current.repoAfter;
  const patch = {
    status,
    output: options.output && typeof options.output === "object" ? clone(options.output) : current.output,
    result: options.result && typeof options.result === "object" ? clone(options.result) : current.result || {},
    error: options.error && typeof options.error === "object" ? clone(options.error) : status === "failed" ? { message: "Hosted Agent reported failure." } : null,
    lifecycle: appendLifecycle(current, status, { agentId, ...(options.metadata && typeof options.metadata === "object" ? clone(options.metadata) : {}) }),
    ...(terminal ? {
      repoAfter,
      repoChange: {
        files: [...new Set([...(current.repoBefore?.files || []), ...(repoAfter?.files || [])])],
        revisionBefore: current.repoBefore?.revision || null,
        revisionAfter: repoAfter?.revision || null,
      },
      endedAt: timestamp(),
    } : {}),
  };
  const saved = await updateEntity(projectRoot, "executions", current.id, patch, actor);
  if (terminal) {
    const latest = await readWorkspace(projectRoot);
    const change = latest.entities.changes[current.changeId];
    if (change && change.status === "executing") await updateEntity(projectRoot, "changes", change.id, { status }, actor);
  }
  const latest = await readWorkspace(projectRoot);
  return { ...saved, execution: latest.entities.executions[current.id], change: latest.entities.changes[current.changeId] };
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
  const adapter = createExecutionAdapter(options.adapter);
  const adapterCapabilities = await adapter.capabilities();
  const executionReadiness = await featureAndAgentReadiness(projectRoot, workspace, change, {
    compatibleAgentAvailable: adapterCapabilities.available === true && adapterCapabilities.supports?.start === true,
    repoSafetyReady: options.repoSafetyReady === true ? true : undefined,
  });
  if (executionReadiness.state !== "READY") throw readinessError(executionReadiness);
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
    return { execution: saved.entity, handle, capabilities: adapterCapabilities, executionReadiness, workspaceVersion: saved.workspaceVersion };
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

export async function resumeExecution(projectRoot, executionId, actor, options = {}) {
  const current = (await getExecution(projectRoot, executionId)).execution;
  if (!["interrupted", "failed", "cancelled"].includes(current.status)) throw new ValidationError("Only an interrupted, failed, or cancelled Execution can resume.", { executionId, status: current.status });
  let change = requireChange(await readWorkspace(projectRoot), current.changeId);
  if (change.status !== "approved") {
    // The interrupted process can finish its Change transition just after the
    // Execution reaches its terminal state. Re-read and retry the approval so
    // resume never loses to that legitimate last lifecycle write.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await updateEntity(projectRoot, "changes", change.id, { status: "approved" }, actor);
        break;
      } catch (error) {
        if (error?.code !== "VERSION_CONFLICT" || attempt === 2) throw error;
        change = requireChange(await readWorkspace(projectRoot), current.changeId);
        if (change.status === "approved") break;
      }
    }
    change = requireChange(await readWorkspace(projectRoot), current.changeId);
  }
  return startExecution(projectRoot, { changeId: change.id, agentId: current.agentId, adapter: current.input?.adapter, parentExecutionId: current.id, repoSafetyReady: options.repoSafetyReady === true ? true : undefined, actor });
}
