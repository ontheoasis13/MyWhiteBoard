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
  assert.equal(feature.actionability, "grounded");
  assert.ok(feature.groundingRefs.length >= 3);
  assert.ok(feature.groundingRefs.every((id) => first.model.evidence[id]));
  assert.ok(feature.groundingRefs.some((id) => first.model.evidence[id].certainty === "confirmed"));
  assert.ok(feature.groundingRefs.some((id) => first.model.evidence[id].type === "semantic_inference" && first.model.evidence[id].certainty === "possible"));

  const corrected = await correctProductFeature(root, {
    featureId: feature.id,
    expectedVersion: feature.version,
    patch: { name: "订阅与账单", description: "用户管理订阅方案与账单状态。" },
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
  assert.ok(after.groundingRefs.some((id) => rescanned.model.evidence[id].type === "human_confirmation"));
  assert.ok(after.groundingRefs.some((id) => rescanned.model.evidence[id].observedAt === "2026-08-20T05:02:00.000Z"));
  assert.equal((await readProductGrounding(root)).features[feature.id].name, "订阅与账单");
});

test("exposes Product Grounding through the Agent-neutral MCP boundary", async () => {
  const root = await fixtureCopy();
  assert.equal(workspaceTools.length, 31);

  const scanned = await callWorkspaceTool("product_grounding_scan", { project_root: root, max_files: 100 });
  const billing = scanned.structuredContent.model.features["feature-billing"];
  assert.ok(billing);
  assert.ok(scanned.content[0].text.includes("Structured result (JSON):"));

  const corrected = await callWorkspaceTool("product_feature_correct", {
    project_root: root,
    feature_id: billing.id,
    expected_version: billing.version,
    patch: { name: "订阅中心" },
    reason: "用户确认",
    actor: { id: "human", displayName: "用户", client: "human" },
  });
  assert.equal(corrected.structuredContent.feature.name, "订阅中心");

  const current = await callWorkspaceTool("product_grounding_get", { project_root: root, include_evidence: false });
  assert.equal(current.structuredContent.productMap.features.find((item) => item.id === billing.id).name, "订阅中心");
  assert.deepEqual(current.structuredContent.model.evidence, {});
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
  assert.ok(productMap.features.every((feature) => feature.groundingRefs.every((id) => result.model.evidence[id])));

  const packageSource = await readFile(path.join(pluginRoot, "package.json"), "utf8");
  assert.ok(packageSource.includes("my-whiteboard-workspace"));
  assert.equal(result.path, null);
});
