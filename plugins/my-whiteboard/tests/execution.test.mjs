import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import {
  claimHostedExecution,
  connectAgent,
  createChange,
  createProjectWorkspace,
  getExecution,
  reportHostedExecution,
  resumeExecution,
  startExecution,
  stopExecution,
} from "../core/index.mjs";

const execFileAsync = promisify(execFile);

async function waitFor(projectRoot, executionId, predicate, timeoutMs = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = await getExecution(projectRoot, executionId);
    if (predicate(current.execution)) return current.execution;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for Execution ${executionId}.`);
}

async function gitProject() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-execution-"));
  await writeFile(path.join(projectRoot, "README.md"), "baseline\n", "utf8");
  await execFileAsync("git", ["init", "-q"], { cwd: projectRoot });
  await execFileAsync("git", ["add", "README.md"], { cwd: projectRoot });
  await execFileAsync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "baseline"], { cwd: projectRoot });
  await createProjectWorkspace(projectRoot, { name: "Execution Proof" });
  return projectRoot;
}

function processAdapter(agentPath) {
  return { kind: "process", adapterId: "test-real-process-agent", command: process.execPath, args: [agentPath] };
}

test("starts a real process for an approved Change and persists repo evidence", async () => {
  const projectRoot = await gitProject();
  const agentPath = path.join(projectRoot, "agent.mjs");
  await writeFile(agentPath, `import { appendFile } from "node:fs/promises";\nawait appendFile(process.env.MY_WHITEBOARD_REPO_ROOT + "/README.md", "agent-change\\n");\nconsole.log(JSON.stringify({ changeId: process.env.MY_WHITEBOARD_CHANGE_ID }));\n`, "utf8");
  const { change } = await createChange(projectRoot, {
    id: "change-real-agent",
    title: "Record agent change",
    intent: "Append one line",
    status: "approved",
    contract: { files: ["README.md"], operation: "append" },
    acceptanceCriteria: ["README contains agent-change"],
  }, { id: "human", client: "test" });
  const started = await startExecution(projectRoot, {
    changeId: change.id,
    agentId: "reference-agent",
    adapter: processAdapter(agentPath),
    actor: { id: "reference-agent", client: "test" },
  });
  assert.equal(started.execution.changeId, change.id);
  assert.equal(started.execution.status, "running");
  const completed = await waitFor(projectRoot, started.execution.id, (execution) => execution.status === "completed");
  assert.equal(completed.lifecycle.some((event) => event.type === "started"), true);
  assert.equal(completed.lifecycle.some((event) => event.type === "completed"), true);
  assert.match(await readFile(path.join(projectRoot, "README.md"), "utf8"), /agent-change/);
  assert.equal(completed.repoAfter.available, true);
  assert.equal(completed.repoChange.files.includes("README.md"), true);
  assert.equal((await getExecution(projectRoot, completed.id)).execution.status, "completed");
});

test("stop persists interrupted state and resume creates a linked Execution", async () => {
  const projectRoot = await gitProject();
  const agentPath = path.join(projectRoot, "slow-agent.mjs");
  await writeFile(agentPath, `setTimeout(() => process.exit(0), 5000);\n`, "utf8");
  const { change } = await createChange(projectRoot, { id: "change-stop", title: "Interruptible change", status: "approved", contract: {} }, { id: "human", client: "test" });
  const started = await startExecution(projectRoot, { changeId: change.id, agentId: "reference-agent", adapter: processAdapter(agentPath), actor: { id: "reference-agent", client: "test" } });
  await stopExecution(projectRoot, started.execution.id, { id: "human", client: "test" });
  const interrupted = await waitFor(projectRoot, started.execution.id, (execution) => execution.status === "interrupted");
  assert.equal(interrupted.lifecycle.some((event) => event.type === "interrupted"), true);
  const resumed = await resumeExecution(projectRoot, interrupted.id, { id: "reference-agent", client: "test" });
  assert.equal(resumed.execution.parentExecutionId, interrupted.id);
  await stopExecution(projectRoot, resumed.execution.id, { id: "human", client: "test" });
  await waitFor(projectRoot, resumed.execution.id, (execution) => execution.status === "interrupted");
});

test("hosted Agent can claim and report an approved Change through the neutral API", async () => {
  const projectRoot = await gitProject();
  await connectAgent(projectRoot, { id: "external-host", displayName: "External MCP Host", client: "external-mcp", capabilities: ["execution"] });
  const { change } = await createChange(projectRoot, { id: "change-hosted", title: "Hosted change", status: "approved", contract: { files: ["README.md"], operation: "append" }, acceptanceCriteria: ["README contains hosted-change"] }, { id: "human", client: "test" });
  const claimed = await claimHostedExecution(projectRoot, { changeId: change.id, agentId: "external-host", actor: { id: "external-host", client: "external-mcp" } });
  assert.equal(claimed.execution.status, "running");
  assert.equal(claimed.execution.changeId, change.id);
  await appendFile(path.join(projectRoot, "README.md"), "hosted-change\n", "utf8");
  const reported = await reportHostedExecution(projectRoot, { executionId: claimed.execution.id, agentId: "external-host", status: "completed", output: { summary: "Host completed" }, result: { accepted: true }, actor: { id: "external-host", client: "external-mcp" } });
  assert.equal(reported.execution.status, "completed");
  assert.equal(reported.change.status, "completed");
  assert.equal(reported.execution.repoChange.files.includes("README.md"), true);
  await assert.rejects(
    reportHostedExecution(projectRoot, { executionId: claimed.execution.id, agentId: "other-agent", status: "completed" }),
    /claimed Agent/,
  );
});
