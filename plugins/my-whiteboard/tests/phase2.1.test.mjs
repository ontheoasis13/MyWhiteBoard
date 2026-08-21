import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanProductGrounding } from "../core/product-grounding.mjs";
import { applyProductStructureProposal, createProductStructureProposal, getProductStructureProposals } from "../core/product-proposals.mjs";
import { callWorkspaceTool, workspaceTools } from "../server/mcp.mjs";

const fixture = path.resolve("tests/fixtures/vanilla-fullstack-workbench");

test("Observation v2 covers vanilla frontend, API, UI, CSS, persistence, and unmapped signals", async () => {
  const result = await scanProductGrounding(fixture, { persist: false });
  assert.equal(result.model.understandingState, "NEEDS_INTERPRETATION");
  assert.ok(result.model.observedFiles.some((file) => file.relative === "public/app.js" && file.classification === "application_source"));
  assert.ok(result.model.observedFiles.some((file) => file.relative === "public/index.html" && file.classification === "ui_entry"));
  assert.ok(result.model.observedFiles.some((file) => file.relative === "public/styles.css" && file.classification === "supporting_asset"));
  assert.ok(!result.model.observedFiles.some((file) => file.relative.includes("vendor")));
  const evidence = Object.values(result.model.evidence);
  assert.ok(evidence.some((item) => item.type === "request" && item.target === "/api/generate"));
  assert.ok(evidence.some((item) => item.type === "database" && item.details?.observationKind === "sqlite_dependency"));
  assert.ok(result.model.unmappedProductSignals.length > 0);
  assert.equal(Object.keys(result.model.productHierarchy.groups || {}).length, 0);
});

test("evidence-backed Product Structure Proposal is pending, durable, and Human-confirmable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-phase21-"));
  try {
    await import("node:fs/promises").then(({ cp }) => cp(fixture, root, { recursive: true }));
    const scan = await scanProductGrounding(root);
    const evidence = Object.values(scan.model.evidence).find((item) => item.type === "request");
    const proposal = await createProductStructureProposal(root, { proposedByAgentId: "phase21-test-agent", features: [{ proposalKey: "content", name: "内容生成", evidenceRefs: [evidence.id] }] });
    assert.equal(proposal.status, "pending");
    assert.equal((await getProductStructureProposals(root)).length, 1);
    const confirmed = await applyProductStructureProposal(root, { proposalId: proposal.id, expectedVersion: proposal.version, action: "confirm" });
    assert.equal(confirmed.proposal.status, "confirmed");
    assert.ok(confirmed.model.humanIntent.productStructureConfirmations.some((item) => item.proposalId === proposal.id));
    assert.ok(confirmed.model.features["feature-proposed-content"]);
    assert.equal(confirmed.model.features["feature-proposed-content"].actionability, "GROUNDED");
    const persisted = JSON.parse(await readFile(path.join(root, ".my-whiteboard", "product-model.json"), "utf8"));
    assert.ok(persisted.features["feature-proposed-content"]);
    const rescanned = await scanProductGrounding(root);
    assert.ok(rescanned.model.features["feature-proposed-content"]);
    assert.ok(rescanned.model.humanIntent.productStructureConfirmations.some((item) => item.proposalId === proposal.id));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale Product Structure Proposal cannot be silently confirmed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-phase21-stale-"));
  try {
    await import("node:fs/promises").then(({ cp }) => cp(fixture, root, { recursive: true }));
    const scan = await scanProductGrounding(root);
    const evidence = Object.values(scan.model.evidence).find((item) => item.type === "request");
    const proposal = await createProductStructureProposal(root, { proposedByAgentId: "phase21-test-agent", features: [{ proposalKey: "content", name: "内容生成", evidenceRefs: [evidence.id] }] });
    await import("node:fs/promises").then(({ appendFile }) => appendFile(path.join(root, "server.js"), "\n// drift\n"));
    await assert.rejects(() => applyProductStructureProposal(root, { proposalId: proposal.id, expectedVersion: proposal.version, action: "confirm" }), (error) => error.code === "VERSION_CONFLICT");
    const stored = (await getProductStructureProposals(root))[0];
    assert.equal(stored.status, "superseded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime truth exposes the actual MCP surface and product-first flow", async () => {
  assert.equal(workspaceTools.length, 46);
  const result = await callWorkspaceTool("my_whiteboard_info", {});
  assert.equal(result.structuredContent.toolCount, 46);
  assert.equal(result.structuredContent.declaredVersion, "0.2.0-alpha.3");
  assert.ok(result.structuredContent.capabilities.productStructureProposal);
  assert.ok(result.structuredContent.recommendedFlows.understandProject.includes("product_grounding_scan"));
});
