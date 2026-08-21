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
  assert.ok(result.model.observedFiles.some((file) => file.relative === "public/debug.html" && file.classification === "auxiliary_html"));
  assert.ok(result.model.observedFiles.some((file) => file.relative === "项目地图.html" && file.classification === "generated_artifact"));
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
    const confirmed = await applyProductStructureProposal(root, { proposalId: proposal.id, expectedVersion: proposal.version, action: "confirm", approvalSource: "human-ui", actor: { id: "human", client: "product-view" } });
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
    await assert.rejects(() => applyProductStructureProposal(root, { proposalId: proposal.id, expectedVersion: proposal.version, action: "confirm", approvalSource: "human-ui", actor: { id: "human", client: "product-view" } }), (error) => error.code === "VERSION_CONFLICT");
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
  assert.ok(result.structuredContent.guidance.proposalApproval.includes("never call"));
});

test("proposal approval is human UI only and structure relations are Core-derived", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-phase21-control-"));
  try {
    await import("node:fs/promises").then(({ cp }) => cp(fixture, root, { recursive: true }));
    const scan = await scanProductGrounding(root);
    const evidence = Object.values(scan.model.evidence).find((item) => item.type === "request");
    const proposal = await createProductStructureProposal(root, {
      proposedByAgentId: "agent-a",
      groups: [{ proposalKey: "content", name: "内容" }],
      features: [{ proposalKey: "generate", name: "内容生成", groupKey: "content", rationale: "存在生成 API", evidenceRefs: [evidence.id] }],
    });
    assert.deepEqual(proposal.groups[0].memberFeatureKeys, ["generate"]);
    const edited = await applyProductStructureProposal(root, { proposalId: proposal.id, expectedVersion: proposal.version, action: "update", patch: { features: [{ ...proposal.features[0], name: "内容生成（调整后）" }] } });
    assert.equal(edited.features[0].name, "内容生成（调整后）");
    await assert.rejects(() => callWorkspaceTool("product_structure_proposal_apply", { project_root: root, proposal_id: proposal.id, expected_version: edited.version, action: "confirm" }), (error) => error.code === "VALIDATION_ERROR" && error.details?.reasonCode === "HUMAN_APPROVAL_REQUIRED");
    const confirmed = await applyProductStructureProposal(root, { proposalId: proposal.id, expectedVersion: edited.version, action: "confirm", approvalSource: "human-ui", actor: { id: "human", client: "product-view" } });
    assert.equal(confirmed.proposal.status, "confirmed");
    assert.equal(confirmed.model.features["feature-proposed-generate"].name, "内容生成（调整后）");
    assert.deepEqual(confirmed.model.productHierarchy.groups["group-proposed-content"].featureIds, ["feature-proposed-generate"]);
    const second = await createProductStructureProposal(root, {
      proposedByAgentId: "agent-a",
      groups: [{ proposalKey: "content", name: "内容" }],
      features: [{ proposalKey: "generate-2", name: "第二个功能", groupKey: "content", evidenceRefs: [evidence.id] }],
    });
    await assert.rejects(() => callWorkspaceTool("product_structure_proposal_apply", { project_root: root, proposal_id: second.id, expected_version: second.version, action: "reject" }), (error) => error.code === "VALIDATION_ERROR" && error.details?.reasonCode === "HUMAN_APPROVAL_REQUIRED");
    const rejected = await applyProductStructureProposal(root, { proposalId: second.id, expectedVersion: second.version, action: "reject", approvalSource: "human-ui", actor: { id: "human", client: "product-view" } });
    assert.equal(rejected.status, "rejected");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("malformed Product Structure proposals are rejected and latest pending replaces prior pending", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-phase21-structure-"));
  try {
    await import("node:fs/promises").then(({ cp }) => cp(fixture, root, { recursive: true }));
    const scan = await scanProductGrounding(root);
    const evidence = Object.values(scan.model.evidence).find((item) => item.type === "request");
    const base = { proposedByAgentId: "agent-b", groups: [{ proposalKey: "content", name: "内容" }], features: [{ proposalKey: "generate", name: "内容生成", evidenceRefs: [evidence.id] }] };
    await assert.rejects(() => createProductStructureProposal(root, base), /groupKey/);
    await assert.rejects(() => createProductStructureProposal(root, { ...base, features: [{ proposalKey: "generate", name: "内容生成", groupKey: "missing", evidenceRefs: [evidence.id] }] }), /groupKey/);
    await assert.rejects(() => createProductStructureProposal(root, { ...base, features: [{ proposalKey: "generate", name: "", evidenceRefs: [evidence.id] }] }), /name/);
    await assert.rejects(() => createProductStructureProposal(root, { ...base, groups: [{ proposalKey: "content", name: "内容" }, { proposalKey: "content", name: "其他" }], features: [{ proposalKey: "generate", name: "内容生成", groupKey: "content", evidenceRefs: [evidence.id] }] }), /proposalKey/);
    await assert.rejects(() => createProductStructureProposal(root, { ...base, groups: [{ proposalKey: "content", name: "内容" }, { proposalKey: "other", name: "内容" }], features: [{ proposalKey: "generate", name: "内容生成", groupKey: "content", evidenceRefs: [evidence.id] }] }), /names/);
    await assert.rejects(() => createProductStructureProposal(root, { ...base, groups: [], features: [{ proposalKey: "generate", name: "内容生成", explicitlyUngrouped: true, evidenceRefs: [evidence.id] }, { proposalKey: "generate", name: "另一个", explicitlyUngrouped: true, evidenceRefs: [evidence.id] }] }), /proposalKey/);
    const first = await createProductStructureProposal(root, { ...base, groups: [], features: [{ proposalKey: "generate", name: "内容生成", explicitlyUngrouped: true, evidenceRefs: [evidence.id] }] });
    const second = await createProductStructureProposal(root, { ...base, groups: [], features: [{ proposalKey: "generate", name: "内容生成新版", explicitlyUngrouped: true, evidenceRefs: [evidence.id] }] });
    const stored = await getProductStructureProposals(root);
    assert.equal(stored.find((item) => item.id === first.id).status, "superseded");
    assert.equal(stored.find((item) => item.id === second.id).status, "pending");
  } finally { await rm(root, { recursive: true, force: true }); }
});
