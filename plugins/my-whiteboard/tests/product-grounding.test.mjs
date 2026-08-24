import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  correctProductFeature,
  readProductGrounding,
  scanProductGrounding,
  scanProjectGraph,
  summarizeProductMap,
} from "../core/index.mjs";
import { callWorkspaceTool, workspaceTools } from "../server/mcp.mjs";

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(testDirectory, "fixtures", "product-grounding-alias-app");
const childReader = path.join(testDirectory, "read-product-model-child.mjs");

async function fixtureCopy() {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-grounding-"));
  await cp(fixture, root, { recursive: true });
  return root;
}

test("resolves tsconfig aliases that previously produced 11 nodes and 0 edges", async () => {
  const graph = await scanProjectGraph(fixture, 100);
  const nodes = graph.elements.filter((element) => element.kind !== "edge");
  const edges = graph.elements.filter((element) => element.kind === "edge");

  assert.equal(nodes.length, 11);
  assert.ok(edges.length >= 10, `expected alias edges, received ${edges.length}`);
  assert.equal(graph.config, "tsconfig.json");
  assert.ok(graph.aliases.some((rule) => rule.pattern === "@/*"));
  assert.ok(edges.every((edge) => edge.properties.specifier.startsWith("@/")));
});

test("keeps the existing multi-language Code Board file inventory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-code-board-"));
  await writeFile(path.join(root, "worker.py"), "def run():\n    return True\n", "utf8");
  const graph = await scanProjectGraph(root, 10);
  assert.deepEqual(graph.files, ["worker.py"]);
});

test("grounds Features to deterministic Evidence and preserves Human Intent across restart and rescan", async () => {
  const root = await fixtureCopy();
  const first = await scanProductGrounding(root, { now: "2026-08-20T05:00:00.000Z" });
  const feature = first.model.features["feature-billing"];

  assert.ok(feature);
  assert.equal(feature.actionability, "ACTIONABLE");
  assert.equal(first.model.modelType, "ProjectModel");
  assert.equal(first.model.projectModelVersion, 1);
  assert.equal(first.model.repoSnapshot.dirty, false);
  assert.ok(first.model.productMapProjection);
  assert.ok(feature.groundingRefs.length >= 3);
  assert.ok(feature.groundingRefs.every((id) => first.model.evidence[id]));
  const firstEvidence = first.model.evidence[feature.groundingRefs[0]];
  assert.equal(firstEvidence.evidenceVersion, 1);
  assert.ok(firstEvidence.repoSnapshotId);
  assert.ok(firstEvidence.provenance);
  assert.ok(feature.groundingRefs.some((id) => first.model.evidence[id].certainty === "confirmed"));
  assert.ok(feature.groundingRefs.some((id) => first.model.evidence[id].type === "semantic_inference" && first.model.evidence[id].certainty === "possible"));
  assert.equal(first.model.productHierarchy.levels, 2);
  assert.ok(first.model.productHierarchy.groups["group-project-delivery"]);
  const originalEvidenceIds = Object.keys(first.model.evidence);

  const corrected = await correctProductFeature(root, {
    featureId: feature.id,
    expectedVersion: feature.version,
    patch: { name: "订阅与账单", description: "用户管理订阅方案与账单状态。", groupId: "group-project-knowledge", parentFeatureId: "feature-project" },
    reason: "产品负责人确认该能力的用户语言",
    actor: { id: "product-owner", displayName: "产品负责人", client: "human" },
    now: "2026-08-20T05:01:00.000Z",
  });
  assert.equal(corrected.feature.version, 2);
  assert.equal(corrected.feature.name, "订阅与账单");
  await assert.rejects(
    correctProductFeature(root, { featureId: feature.id, expectedVersion: 1, patch: { name: "stale" } }),
    (error) => error.code === "VERSION_CONFLICT",
  );

  const { stdout } = await execFileAsync(process.execPath, [childReader, root, feature.id], { windowsHide: true });
  const restarted = JSON.parse(stdout);
  assert.equal(restarted.feature.name, "订阅与账单");
  assert.equal(restarted.feature.humanIntent.corrected, true);

  const rescanned = await scanProductGrounding(root, { now: "2026-08-20T05:02:00.000Z" });
  const after = rescanned.model.features[feature.id];
  assert.equal(after.name, "订阅与账单");
  assert.equal(after.description, "用户管理订阅方案与账单状态。");
  assert.equal(after.version, 2);
  assert.equal(after.groupId, "group-project-knowledge");
  assert.equal(after.parentFeatureId, "feature-project");
  assert.ok(rescanned.model.features["feature-project"].childFeatureIds.includes("feature-billing"));
  assert.ok(rescanned.model.productHierarchy.groups["group-project-knowledge"].featureIds.includes("feature-billing"));
  assert.ok(originalEvidenceIds.every((id) => rescanned.model.evidence[id]), "Grounded Evidence was deleted during hierarchy rescan");
  assert.ok(after.groundingRefs.some((id) => rescanned.model.evidence[id].type === "human_confirmation"));
  assert.ok(after.groundingRefs.some((id) => rescanned.model.evidence[id].observedAt === "2026-08-20T05:02:00.000Z"));
  assert.equal((await readProductGrounding(root)).features[feature.id].name, "订阅与账单");
});

test("exposes Product Grounding through the Agent-neutral MCP boundary", async () => {
  const root = await fixtureCopy();
  assert.equal(workspaceTools.length, 50);

  const scanned = await callWorkspaceTool("product_grounding_scan", { project_root: root, max_files: 100 });
  const billing = scanned.structuredContent.model.features["feature-billing"];
  assert.ok(billing);
  assert.ok(scanned.content[0].text.includes("Structured result (JSON):"));

  const corrected = await callWorkspaceTool("product_feature_correct", {
    project_root: root,
    feature_id: billing.id,
    expected_version: billing.version,
    patch: { name: "订阅中心", groupId: "group-project-knowledge", parentFeatureId: "feature-project" },
    reason: "用户确认",
    actor: { id: "human", displayName: "用户", client: "human" },
  });
  assert.equal(corrected.structuredContent.feature.name, "订阅中心");

  const current = await callWorkspaceTool("product_grounding_get", { project_root: root, include_evidence: false });
  assert.equal(current.structuredContent.productMap.features.find((item) => item.id === billing.id).name, "订阅中心");
  assert.equal(current.structuredContent.productMap.features.find((item) => item.id === billing.id).groupId, "group-project-knowledge");
  assert.deepEqual(current.structuredContent.model.evidence, {});
});

test("Product Group and Hidden Feature remain separate from Feature Actionability", async () => {
  const root = await fixtureCopy();
  const scanned = await scanProductGrounding(root, { now: "2026-08-20T05:10:00.000Z" });
  const feature = scanned.model.features["feature-billing"];
  const originalActionability = feature.actionability;
  const hidden = await correctProductFeature(root, {
    featureId: feature.id,
    expectedVersion: feature.version,
    patch: { hidden: true },
    reason: "暂时隐藏产品地图节点",
    actor: { id: "product-owner", displayName: "产品负责人", client: "human" },
  });
  assert.equal(hidden.feature.hidden, true);
  assert.equal(hidden.feature.actionability, originalActionability);
  assert.ok(hidden.model.productMapProjection.hierarchy.groups.every((group) => group.nodeKind === "group"));
  assert.equal(hidden.model.productMapProjection.features.some((item) => item.id === feature.id), false);

  const restored = await correctProductFeature(root, {
    featureId: feature.id,
    expectedVersion: hidden.feature.version,
    patch: { hidden: false },
    reason: "恢复产品地图节点",
    actor: { id: "product-owner", displayName: "产品负责人", client: "human" },
  });
  assert.equal(restored.feature.hidden, false);
  assert.equal(restored.feature.actionability, originalActionability);
  assert.ok(restored.model.productMapProjection.features.some((item) => item.id === feature.id && item.nodeKind === "feature"));
});

test("grounds the real My Whiteboard TS/JS project without generated asset noise", async () => {
  const pluginRoot = path.resolve(testDirectory, "..");
  const result = await scanProductGrounding(pluginRoot, { persist: false, maxFiles: 1000, now: "2026-08-20T05:03:00.000Z" });
  const productMap = summarizeProductMap(result.model);
  const scannedSources = Object.values(result.model.evidence).filter((item) => item.type === "file").map((item) => item.source);

  assert.ok(result.model.stats.scannedFiles >= 25, `expected a medium project, received ${result.model.stats.scannedFiles} files`);
  assert.ok(result.model.stats.scannedFiles < 100, "generated bundles were not excluded");
  assert.ok(scannedSources.every((source) => !source.startsWith("assets/")));
  for (const featureId of ["feature-board", "feature-workspace", "feature-agent", "feature-task", "feature-cloud", "feature-product-map"]) assert.ok(result.model.features[featureId], `missing ${featureId}`);
  const board = result.model.features["feature-board"];
  assert.ok(board.groundingRefs.some((id) => result.model.evidence[id]?.target?.startsWith("mcp:board_")));
  assert.ok(productMap.features.length >= 10);
  assert.equal(productMap.hierarchy.levels, 2);
  assert.ok(productMap.hierarchy.groups.length >= 5 && productMap.hierarchy.groups.length <= 7);
  assert.ok(productMap.hierarchy.groups.some((group) => group.id === "group-ai-collaboration" && group.featureIds.includes("feature-handoff") && group.featureIds.includes("feature-message") && group.featureIds.includes("feature-selection")));
  assert.ok(productMap.hierarchy.groups.some((group) => group.id === "group-project-knowledge" && group.featureIds.includes("feature-context") && group.featureIds.includes("feature-decision") && group.featureIds.includes("feature-artifact")));
  assert.ok(productMap.hierarchy.groups.some((group) => group.id === "group-compatibility-maintenance" && group.featureIds.includes("feature-legacy")));
  assert.ok(productMap.features.every((feature) => feature.groundingRefs.every((id) => result.model.evidence[id])));

  const packageSource = await readFile(path.join(pluginRoot, "package.json"), "utf8");
  assert.ok(packageSource.includes("my-whiteboard-workspace"));
  assert.equal(result.path, null);
});
