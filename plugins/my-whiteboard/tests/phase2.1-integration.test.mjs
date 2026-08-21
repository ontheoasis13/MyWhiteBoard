import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyWorkspaceTransaction, createProjectWorkspace, readWorkspace } from "../core/index.mjs";
import { scanProductGrounding } from "../core/product-grounding.mjs";
import { applyProductStructureProposal, createProductStructureProposal } from "../core/product-proposals.mjs";
import { callWorkspaceTool } from "../server/mcp.mjs";
import { createWorkspaceHttpService } from "../server/workspace-http.mjs";

const fixture = path.resolve("tests/fixtures/vanilla-fullstack-workbench");
const copyFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-phase21-integration-"));
  await (await import("node:fs/promises")).cp(fixture, root, { recursive: true });
  return root;
};

async function createFiveGroupProposal(root) {
  const scan = await scanProductGrounding(root);
  const evidence = Object.values(scan.model.evidence).find((item) => item.type === "request");
  const groups = ["workspace", "knowledge", "delivery", "collaboration", "compatibility"].map((key, index) => ({ proposalKey: key, name: `产品能力 ${index + 1}` }));
  const features = Array.from({ length: 12 }, (_, index) => ({
    proposalKey: `feature-${index + 1}`,
    name: `功能 ${index + 1}`,
    groupKey: groups[index % groups.length].proposalKey,
    rationale: `由 Evidence ${evidence.id} 支持`,
    evidenceRefs: [evidence.id],
  }));
  return { scan, proposal: await createProductStructureProposal(root, { proposedByAgentId: "integration-agent", groups, features }) };
}

test("I1 served workspace bundle exposes active Chinese Product View labels and board empty state", async () => {
  const root = await copyFixture();
  const service = createWorkspaceHttpService();
  try {
    await createProjectWorkspace(root, { name: "Integration UI" });
    const opened = await service.openWorkspace({ projectRoot: root });
    const page = await fetch(opened.url);
    assert.equal(page.status, 200);
    const html = await page.text();
    const script = html.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(script, "workspace HTML must reference a built module");
    const bundle = await (await fetch(new URL(script, opened.url))).text();
    assert.match(bundle, /产品地图/);
    assert.match(bundle, /技术白板/);
    assert.match(bundle, /变更/);
    assert.match(bundle, /尚未创建技术白板/);
    assert.doesNotMatch(bundle, /<strong>Product Map<\/strong>|<strong>Board View<\/strong>/);
  } finally {
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("I2 agent connection persists recent MCP activity for Product View presence", async () => {
  const root = await copyFixture();
  try {
    await callWorkspaceTool("project_create", { project_root: root, name: "Presence Integration" });
    const connected = await callWorkspaceTool("agent_connect", { project_root: root, agent: { id: "integration-agent", displayName: "Integration Agent", client: "external-mcp", capabilities: ["product-grounding"] } });
    const synced = await callWorkspaceTool("agent_sync", { project_root: root, agent: { id: "integration-agent", displayName: "Integration Agent", client: "external-mcp", capabilities: ["product-grounding"] }, since_version: connected.structuredContent.workspaceVersion });
    const agent = synced.structuredContent.agent;
    assert.ok(agent.registeredAt);
    assert.ok(agent.lastActivityAt);
    assert.notEqual(agent.status, "offline");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("I3 MCP cannot spoof Product View approval while authenticated HTTP UI records provenance", async () => {
  const root = await copyFixture();
  const service = createWorkspaceHttpService();
  try {
    const { proposal } = await createFiveGroupProposal(root);
    await assert.rejects(() => callWorkspaceTool("product_structure_proposal_apply", { project_root: root, proposal_id: proposal.id, expected_version: proposal.version, action: "confirm", actor: { id: "agent", client: "product-view" } }), (error) => error?.details?.reasonCode === "HUMAN_APPROVAL_REQUIRED");
    const opened = await service.openWorkspace({ projectRoot: root });
    const url = new URL(opened.url);
    const headers = { "x-my-whiteboard-session": url.searchParams.get("session"), "x-my-whiteboard-token": url.searchParams.get("token"), "content-type": "application/json" };
    const response = await fetch(`${url.origin}/api/session/product-proposal/apply`, { method: "POST", headers, body: JSON.stringify({ proposal_id: proposal.id, expected_version: proposal.version, action: "confirm" }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    const confirmation = payload.model.humanIntent.productStructureConfirmations.at(-1);
    assert.equal(confirmation.actorType, "human_ui");
    assert.equal(confirmation.sessionId, opened.sessionId);
    assert.equal(confirmation.proposalId, proposal.id);
    assert.equal(confirmation.proposalVersion, proposal.version);
    assert.equal(confirmation.baseRepoSnapshot, proposal.baseRepoSnapshotId);
    assert.ok(confirmation.timestamp);
  } finally {
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("I4 five-group Product Structure becomes persisted hierarchy and projection with correct placement", async () => {
  const root = await copyFixture();
  try {
    const { proposal } = await createFiveGroupProposal(root);
    const confirmed = await applyProductStructureProposal(root, {
      proposalId: proposal.id,
      expectedVersion: proposal.version,
      action: "confirm",
      approvalSource: "human-ui",
      actor: { id: "human", client: "product-view" },
      approvalContext: { actorType: "human_ui", sessionId: "integration-session" },
    });
    const groups = Object.values(confirmed.model.productHierarchy.groups).filter((group) => group.humanIntent?.confirmedFromProposal === proposal.id);
    assert.equal(groups.length, 5);
    assert.equal(confirmed.model.productMapProjection.hierarchy.groups.length, 5);
    assert.equal(groups.reduce((sum, group) => sum + group.featureIds.length, 0), 12);
    assert.ok(groups.every((group) => group.featureIds.length >= 2));
    assert.equal(Object.values(confirmed.model.features).filter((feature) => feature.humanIntent?.confirmedFromProposal === proposal.id).length, 12);
    const persisted = JSON.parse(await readFile(path.join(root, ".my-whiteboard", "product-model.json"), "utf8"));
    assert.equal(Object.values(persisted.productHierarchy.groups).filter((group) => group.humanIntent?.confirmedFromProposal === proposal.id).length, 5);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("I6 served MCP guidance contains the human review stop", async () => {
  const info = (await callWorkspaceTool("my_whiteboard_info", {})).structuredContent;
  assert.ok(info.recommendedFlows.understandProject.some((step) => /STOP/i.test(step)));
  assert.ok(info.recommendedFlows.understandProject.some((step) => /Human confirms|Product View/i.test(step)));
  assert.match(info.guidance.proposalApproval, /never call/i);
});
