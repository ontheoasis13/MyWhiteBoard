import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyProductStructureProposal, createProductStructureProposal } from "../core/product-proposals.mjs";
import { scanProductGrounding } from "../core/product-grounding.mjs";
import { callWorkspaceTool } from "../server/mcp.mjs";
import { createWorkspaceHttpService } from "../server/workspace-http.mjs";

const fixture = path.resolve("tests/fixtures/vanilla-fullstack-workbench");

async function fixtureCopy(prefix = "my-whiteboard-state-coherence-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await cp(fixture, root, { recursive: true });
  return root;
}

async function pendingProposal(root, agentId = "state-coherence-agent") {
  const scan = await scanProductGrounding(root);
  const evidence = Object.values(scan.model.evidence).find((item) => item.type === "request");
  const proposal = await createProductStructureProposal(root, {
    proposedByAgentId: agentId,
    groups: [{ proposalKey: "delivery", name: "项目推进" }],
    features: [{ proposalKey: "health", name: "健康检查", groupKey: "delivery", evidenceRefs: [evidence.id], rationale: "来自真实项目 Evidence" }],
  });
  return { scan, proposal };
}

async function sessionHeaders(opened) {
  const url = new URL(opened.url);
  return {
    url,
    headers: {
      "x-my-whiteboard-session": url.searchParams.get("session"),
      "x-my-whiteboard-token": url.searchParams.get("token"),
      "content-type": "application/json",
    },
  };
}

test("T1 NEEDS_INTERPRETATION is mutually exclusive with confirmation and CTAs", async () => {
  const root = await fixtureCopy();
  const service = createWorkspaceHttpService();
  try {
    await scanProductGrounding(root);
    const opened = await service.openWorkspace({ projectRoot: root });
    const session = await sessionHeaders(opened);
    const response = await fetch(`${session.url.origin}/api/session/product-model`, { headers: session.headers });
    const payload = await response.json();
    assert.equal(payload.lifecycleState, "NEEDS_INTERPRETATION");
    assert.equal(payload.recommendedNextAction, "PRODUCT_STRUCTURE_PROPOSAL");
    assert.equal(payload.productStructureStatus, "PROPOSED");
    assert.equal(payload.proposals.length, 0);
    assert.equal(payload.freshness, "CURRENT");
  } finally { await service.stop(); await rm(root, { recursive: true, force: true }); }
});

test("T2 PROPOSAL_PENDING exposes only the human confirmation lifecycle", async () => {
  const root = await fixtureCopy();
  const service = createWorkspaceHttpService();
  try {
    const { proposal } = await pendingProposal(root);
    const opened = await service.openWorkspace({ projectRoot: root });
    const session = await sessionHeaders(opened);
    const payload = await (await fetch(`${session.url.origin}/api/session/product-model`, { headers: session.headers })).json();
    assert.equal(payload.lifecycleState, "PROPOSAL_PENDING");
    assert.equal(payload.productStructureStatus, "AWAITING_HUMAN_CONFIRMATION");
    assert.equal(payload.recommendedNextAction, "HUMAN_CONFIRM_PRODUCT_STRUCTURE");
    assert.equal(payload.proposals[0].id, proposal.id);
    assert.equal(payload.freshness, "CURRENT");
  } finally { await service.stop(); await rm(root, { recursive: true, force: true }); }
});

test("T3 CONFIRMED survives HTTP refresh and MCP re-read", async () => {
  const root = await fixtureCopy();
  const service = createWorkspaceHttpService();
  try {
    const { proposal } = await pendingProposal(root);
    const opened = await service.openWorkspace({ projectRoot: root });
    const session = await sessionHeaders(opened);
    const response = await fetch(`${session.url.origin}/api/session/product-proposal/apply`, {
      method: "POST",
      headers: session.headers,
      body: JSON.stringify({ proposal_id: proposal.id, expected_version: proposal.version, action: "confirm" }),
    });
    assert.equal(response.status, 200);
    const after = await (await fetch(`${session.url.origin}/api/session/product-model`, { headers: session.headers })).json();
    assert.equal(after.lifecycleState, "CONFIRMED");
    assert.equal(after.productStructureStatus, "CONFIRMED");
    assert.notEqual(after.recommendedNextAction, "PRODUCT_STRUCTURE_PROPOSAL");
    assert.equal(after.proposals.length, 0);
    assert.ok(Object.values(after.model.productHierarchy.groups).some((group) => group.humanIntent?.confirmedFromProposal === proposal.id));
    const mcp = await callWorkspaceTool("product_grounding_get", { project_root: root, include_evidence: false });
    assert.ok(Object.values(mcp.structuredContent.model.productHierarchy.groups).some((group) => group.humanIntent?.confirmedFromProposal === proposal.id));
    const persisted = JSON.parse(await readFile(path.join(root, ".my-whiteboard", "product-model.json"), "utf8"));
    assert.equal(persisted.recommendedNextAction, null);
  } finally { await service.stop(); await rm(root, { recursive: true, force: true }); }
});

test("T4 My Whiteboard self-write does not make Product View stale", async () => {
  const root = await fixtureCopy();
  const service = createWorkspaceHttpService();
  try {
    await scanProductGrounding(root);
    await writeFile(path.join(root, ".my-whiteboard", "ui-session-state.json"), JSON.stringify({ selected: null }), "utf8");
    const opened = await service.openWorkspace({ projectRoot: root });
    const session = await sessionHeaders(opened);
    const payload = await (await fetch(`${session.url.origin}/api/session/product-model`, { headers: session.headers })).json();
    assert.equal(payload.freshness, "CURRENT");
  } finally { await service.stop(); await rm(root, { recursive: true, force: true }); }
});

test("T5 real source change makes Product View stale", async () => {
  const root = await fixtureCopy();
  const service = createWorkspaceHttpService();
  try {
    await scanProductGrounding(root);
    await writeFile(path.join(root, "server.js"), "\n// real product source change\n", { flag: "a" });
    const opened = await service.openWorkspace({ projectRoot: root });
    const session = await sessionHeaders(opened);
    const payload = await (await fetch(`${session.url.origin}/api/session/product-model`, { headers: session.headers })).json();
    assert.equal(payload.freshness, "STALE");
    assert.ok(payload.model.repoSnapshot.changedFiles.includes("server.js"));
  } finally { await service.stop(); await rm(root, { recursive: true, force: true }); }
});

test("T6 GROUNDED Feature actionability does not imply stale freshness", async () => {
  const root = await fixtureCopy();
  const service = createWorkspaceHttpService();
  try {
    const scan = await scanProductGrounding(root);
    const modelPath = path.join(root, ".my-whiteboard", "product-model.json");
    const persisted = JSON.parse(await readFile(modelPath, "utf8"));
    const evidence = Object.values(persisted.evidence)[0];
    evidence.certainty = "confirmed";
    evidence.status = "confirmed";
    evidence.repoSnapshotId = persisted.repoSnapshot.workingTreeFingerprint;
    persisted.features = {
      "feature-grounded-fixture": {
        id: "feature-grounded-fixture",
        name: "Grounded fixture feature",
        description: "Controlled integration-test feature",
        productState: "inferred",
        groundingRefs: [evidence.id],
      },
    };
    await writeFile(modelPath, JSON.stringify(persisted, null, 2), "utf8");
    const opened = await service.openWorkspace({ projectRoot: root });
    const session = await sessionHeaders(opened);
    const payload = await (await fetch(`${session.url.origin}/api/session/product-model`, { headers: session.headers })).json();
    assert.ok(Object.values(payload.model.features).some((feature) => feature.actionability === "GROUNDED"));
    assert.equal(payload.freshness, "CURRENT");
  } finally { await service.stop(); await rm(root, { recursive: true, force: true }); }
});
