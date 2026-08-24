import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import {
  createProjectWorkspace,
  startDevelopment,
  updateDevelopment,
  reportDevelopmentResult,
  getDevelopmentContext,
  readWorkspace,
  deriveConnectionProjection,
} from "../core/index.mjs";

async function project() {
  return mkdtemp(path.join(os.tmpdir(), "my-whiteboard-phase3-development-"));
}

test("Development state lives on Change and accepts unknown targets", async () => {
  const root = await project();
  await createProjectWorkspace(root, { name: "Development" });
  const started = await startDevelopment(root, {
    goal: "Add AI Interview",
    targetFeatureIds: [],
    event_id: "start-1",
    actor: { id: "codex", displayName: "Codex", client: "codex" },
  });
  assert.equal(started.change.targetFeatureIds.length, 0);
  assert.equal(started.change.development.status, "IN_PROGRESS");
  assert.equal(started.change.status, "draft");
  assert.equal(started.change.development.lastReportedBy.identityTrust, "REPORTED");
});

test("Development updates are idempotent before stale-version rejection", async () => {
  const root = await project();
  await createProjectWorkspace(root, { name: "Idempotency" });
  const started = await startDevelopment(root, { goal: "Add search", event_id: "start-1", actor: { id: "agent-a", client: "test" } });
  const updated = await updateDevelopment(root, {
    change_id: started.change.id,
    event_id: "update-1",
    expected_change_version: started.change.version,
    status: "VERIFYING",
    summary: "正在验证搜索行为",
    actor: { id: "agent-a", client: "test" },
  });
  const retry = await updateDevelopment(root, {
    change_id: started.change.id,
    event_id: "update-1",
    expected_change_version: started.change.version,
    status: "VERIFYING",
    summary: "正在验证搜索行为",
    actor: { id: "agent-a", client: "test" },
  });
  assert.equal(updated.change.version, retry.change.version);
  assert.equal(retry.idempotent, true);
  await assert.rejects(
    updateDevelopment(root, {
      change_id: started.change.id,
      event_id: "update-2",
      expected_change_version: started.change.version,
      status: "READY_FOR_REVIEW",
      summary: "过期更新",
      actor: { id: "agent-b", client: "test" },
    }),
    (error) => error.code === "VERSION_CONFLICT",
  );
});

test("Result keeps Agent report provenance and context is deterministic", async () => {
  const root = await project();
  await createProjectWorkspace(root, { name: "Result" });
  const started = await startDevelopment(root, { goal: "Add health endpoint", event_id: "start-1", actor: { id: "workbuddy", client: "workbuddy" } });
  const result = await reportDevelopmentResult(root, {
    change_id: started.change.id,
    event_id: "result-1",
    expected_change_version: started.change.version,
    summary: "接口已实现，测试通过",
    implementation_report: { files: ["src/server.js"] },
    verification_report: { tests: "2/2" },
    actor: { id: "workbuddy", client: "workbuddy" },
  });
  assert.equal(result.development.status, "READY_FOR_REVIEW");
  assert.equal(result.development.implementationReport.provenance, "AGENT_REPORTED");
  assert.equal(result.development.verificationReport.provenance, "AGENT_REPORTED");
  const context = await getDevelopmentContext(root, { change_id: started.change.id });
  assert.equal(context.change.id, started.change.id);
  assert.equal(context.recentMilestones.at(-1).kind, "RESULT");
  assert.equal(context.change.developmentProjection.connection.state, "UNKNOWN");
});

test("Presence never infers offline from stale semantic sync time", async () => {
  const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const agent = { id: "codex", status: "connected", lastSeenAt: stale, lastSyncAt: stale };
  assert.equal(deriveConnectionProjection(agent).state, "UNKNOWN");
  const root = await project();
  await createProjectWorkspace(root, { name: "Presence" });
  const workspace = await readWorkspace(root);
  assert.deepEqual(workspace.entities.agents, {});
});

