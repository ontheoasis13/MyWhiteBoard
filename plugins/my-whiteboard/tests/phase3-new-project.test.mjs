import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createProjectWorkspace,
  createProductStructureProposal,
  applyProductStructureProposal,
  readProductGrounding,
  deriveProductLifecycleState,
} from "../core/index.mjs";

const exec = promisify(execFile);
async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-phase3-new-project-"));
  await exec("git", ["init", "-q", root]);
  await exec("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await exec("git", ["-C", root, "config", "user.name", "Phase3 Test"]);
  await writeFile(path.join(root, "README.md"), "initial\n");
  await exec("git", ["-C", root, "add", "README.md"]);
  await exec("git", ["-C", root, "commit", "-qm", "initial"]);
  return root;
}

test("PLANNED_INTENT works before code and survives repo drift", async () => {
  const root = await project();
  await createProjectWorkspace(root, { name: "AI Interview" });
  const proposal = await createProductStructureProposal(root, {
    basis: "PLANNED_INTENT",
    proposedByAgentId: "codex",
    groups: [],
    features: [{ proposalKey: "interview", name: "AI Interview", explicitlyUngrouped: true }],
  });
  await writeFile(path.join(root, "src.js"), "export const interview = true;\n");
  const observedAfterCoding = await readProductGrounding(root);
  assert.notEqual(observedAfterCoding.repoSnapshot.workingTreeFingerprint, proposal.baseRepoSnapshotId);
  const confirmed = await applyProductStructureProposal(root, {
    proposalId: proposal.id,
    expectedVersion: proposal.version,
    action: "confirm",
    approvalSource: "human-ui",
    actor: { id: "human", displayName: "用户", client: "product-view" },
    approvalContext: { actorType: "human_ui", sessionId: "phase3-test" },
  });
  const feature = confirmed.model.features["feature-proposed-interview"];
  assert.equal(feature.productState, "planned");
  assert.equal(feature.actionability, "UNDERSTOOD");
  assert.deepEqual(feature.groundingRefs, []);
  assert.equal(deriveProductLifecycleState({ model: confirmed.model, proposals: [] }).state, "CONFIRMED");
  assert.equal(confirmed.model.productMapProjection.hierarchy.ungroupedFeatureIds.includes(feature.id), true);
});

test("planned proposal can be replaced after repo drift", async () => {
  const root = await project();
  await createProjectWorkspace(root, { name: "Replace" });
  const first = await createProductStructureProposal(root, { basis: "PLANNED_INTENT", proposedByAgentId: "codex", groups: [], features: [{ proposalKey: "a", name: "A", explicitlyUngrouped: true }] });
  await writeFile(path.join(root, "new.js"), "export const value = 1;\n");
  const second = await createProductStructureProposal(root, { basis: "PLANNED_INTENT", proposedByAgentId: "codex", groups: [], features: [{ proposalKey: "b", name: "B", explicitlyUngrouped: true }] });
  assert.equal(second.status, "pending");
  assert.equal(first.id !== second.id, true);
});
