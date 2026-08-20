import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { deriveExecutionReadiness, readProductGrounding, scanProductGrounding } from "../core/index.mjs";

const execFileAsync = promisify(execFile);

async function gitProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-project-model-"));
  await mkdir(path.join(root, ".my-whiteboard"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "project-model-fixture", type: "module" }, null, 2));
  await writeFile(path.join(root, "server.js"), `export function createServer(app) { app.get("/api/billing", () => ({ status: "ok" })); return app; }\n`);
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "baseline"], { cwd: root });
  return root;
}

test("RepoSnapshot detects a dirty working tree without a HEAD change", async () => {
  const root = await gitProject();
  const first = await scanProductGrounding(root, { now: "2026-08-20T08:00:00.000Z" });
  const head = first.model.repoSnapshot.headRevision;
  const fingerprint = first.model.repoSnapshot.workingTreeFingerprint;
  await writeFile(path.join(root, "server.js"), `${await readFile(path.join(root, "server.js"), "utf8")}\n// working tree change\n`);
  const current = await readProductGrounding(root);
  assert.equal(current.repoSnapshot.headRevision, head);
  assert.equal(current.repoSnapshot.dirty, true);
  assert.notEqual(current.repoSnapshot.workingTreeFingerprint, fingerprint);
  assert.ok(current.repoSnapshot.changedFiles.includes("server.js"));
  const feature = Object.values(current.features).find((item) => item.id === "feature-billing");
  assert.equal(feature.actionability, "GROUNDED");
});

test("fresh rescan advances actionability while preserving the RepoSnapshot", async () => {
  const root = await gitProject();
  await writeFile(path.join(root, "server.js"), `${await readFile(path.join(root, "server.js"), "utf8")}\n// working tree change\n`);
  const rescanned = await scanProductGrounding(root, { now: "2026-08-20T08:01:00.000Z" });
  const feature = rescanned.model.features["feature-billing"];
  assert.equal(rescanned.model.repoSnapshot.dirty, true);
  assert.equal(feature.actionability, "ACTIONABLE");
  assert.equal(feature.actionabilityGate.state, "ACTIONABLE");
  assert.equal(feature.actionabilityGate.checkedAt, "2026-08-20T08:01:00.000Z");
});

test("legacy Product Model data is formalized without losing identity or evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-legacy-model-"));
  await mkdir(path.join(root, ".my-whiteboard"), { recursive: true });
  const legacy = {
    schemaVersion: 1,
    modelType: "project-model-proof-a",
    version: 2,
    project: { id: "legacy", name: "Legacy", root: "." },
    repoRevision: "abc123+source-deadbeef",
    observedAt: "2026-08-20T08:02:00.000Z",
    features: { "feature-legacy": { id: "feature-legacy", version: 1, name: "Legacy", productState: "observed", actionability: "grounded", groundingRefs: ["e1"], hidden: false } },
    evidence: { e1: { id: "e1", type: "file", source: "server.js", target: "server.js", certainty: "confirmed", details: { sourceHash: "old" } } },
    humanIntent: { featureCorrections: {} },
    productHierarchy: { version: 1, levels: 2, roots: [], groups: {} },
  };
  await writeFile(path.join(root, ".my-whiteboard", "product-model.json"), `${JSON.stringify(legacy, null, 2)}\n`);
  const migrated = await readProductGrounding(root);
  assert.equal(migrated.modelType, "ProjectModel");
  assert.equal(migrated.projectModelVersion, 1);
  assert.ok(migrated.repoSnapshot);
  assert.equal(migrated.evidence.e1.evidenceVersion, 1);
  assert.equal(migrated.features["feature-legacy"].id, "feature-legacy");
});

test("Product Map projection preserves visual arrangement separately from semantic hierarchy", async () => {
  const root = await gitProject();
  const scanned = await scanProductGrounding(root);
  const featureId = Object.keys(scanned.model.features)[0];
  const modelPath = path.join(root, ".my-whiteboard", "product-model.json");
  const persisted = JSON.parse(await readFile(modelPath, "utf8"));
  persisted.visualLayout = { [featureId]: { x: 640, y: 180 } };
  await writeFile(modelPath, `${JSON.stringify(persisted, null, 2)}\n`);
  const rescanned = await scanProductGrounding(root);
  assert.deepEqual(rescanned.model.visualLayout[featureId], { x: 640, y: 180 });
  assert.deepEqual(rescanned.model.productMapProjection.visualLayout[featureId], { x: 640, y: 180 });
  assert.equal(rescanned.model.productMapProjection.layoutAuthority, "visual-arrangement-only");
});

test("Feature actionability never persists EXECUTABLE and ignores Human Intent execution permission", async () => {
  const root = await gitProject();
  const scanned = await scanProductGrounding(root);
  const modelPath = path.join(root, ".my-whiteboard", "product-model.json");
  const persisted = JSON.parse(await readFile(modelPath, "utf8"));
  const featureId = Object.keys(persisted.features)[0];
  persisted.features[featureId].actionability = "EXECUTABLE";
  persisted.features[featureId].humanIntent = { actionability: "EXECUTABLE" };
  persisted.humanIntent = { featureCorrections: { [featureId]: { version: 1, patch: { actionability: "EXECUTABLE" } } } };
  await writeFile(modelPath, `${JSON.stringify(persisted, null, 2)}\n`);
  const migrated = await readProductGrounding(root);
  assert.notEqual(migrated.features[featureId].actionability, "EXECUTABLE");
  assert.ok(["UNDERSTOOD", "GROUNDED", "ACTIONABLE"].includes(migrated.features[featureId].actionability));
  assert.equal(migrated.features[featureId].humanIntent.actionability, "ACTIONABLE");
  assert.equal(migrated.humanIntent.featureCorrections[featureId].patch.actionability, "ACTIONABLE");
});

test("Execution readiness is derived on Change/Execution context with explainable reasons", () => {
  const base = {
    feature: { actionability: "ACTIONABLE" },
    change: { status: "approved" },
    repoSnapshot: { dirty: false, workingTreeFingerprint: "current", capturedAt: "2026-08-20T08:03:00.000Z" },
    compatibleAgentAvailable: true,
  };
  const ready = deriveExecutionReadiness(base);
  assert.equal(ready.state, "READY");
  assert.deepEqual(ready.reasonCodes, []);
  assert.equal(ready.executableLabel, "EXECUTABLE");

  const blocked = deriveExecutionReadiness({
    ...base,
    change: { status: "draft" },
    repoSnapshot: { ...base.repoSnapshot, dirty: true },
    repoSafetyReady: false,
    compatibleAgentAvailable: false,
    agentStatus: "offline",
    repoSnapshotStale: true,
  });
  assert.equal(blocked.state, "BLOCKED");
  assert.deepEqual(blocked.reasonCodes, [
    "CHANGE_NOT_APPROVED",
    "REPO_SNAPSHOT_STALE",
    "DIRTY_WORKSPACE_NEEDS_ISOLATION",
    "NO_COMPATIBLE_AGENT",
    "AGENT_OFFLINE",
  ]);
  assert.equal(blocked.executableLabel, null);

  const dirtyButIsolated = deriveExecutionReadiness({ ...base, repoSnapshot: { ...base.repoSnapshot, dirty: true }, repoSafetyReady: true });
  assert.equal(dirtyButIsolated.state, "READY");
});

test("Execution readiness aggregates multi-target Feature blockers without changing Feature states", () => {
  const result = deriveExecutionReadiness({
    change: { status: "approved" },
    features: [
      { id: "feature-member", actionability: "ACTIONABLE" },
      { id: "feature-payment", actionability: "GROUNDED" },
    ],
    featureIds: ["feature-member", "feature-payment"],
    repoSnapshot: { dirty: false, workingTreeFingerprint: "current", capturedAt: "2026-08-20T08:04:00.000Z" },
    compatibleAgentAvailable: true,
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["FEATURE_NOT_ACTIONABLE"]);
  assert.deepEqual(result.reasons[0].featureIds, ["feature-member", "feature-payment"]);
  assert.equal(result.reasons[0].suggestedAction, "REFRESH_GROUNDING");
});
