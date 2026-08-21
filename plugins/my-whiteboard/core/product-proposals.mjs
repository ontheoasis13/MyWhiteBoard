import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ConflictError, NotFoundError, ValidationError } from "./errors.mjs";
import { withWorkspaceLock } from "./store.mjs";
import { formalizeProjectModel } from "./project-model.mjs";
import { persistProductGroundingModel, readProductGrounding } from "./product-grounding.mjs";

const SCHEMA_VERSION = 1;

function proposalPath(projectRoot) {
  return path.join(path.resolve(projectRoot), ".my-whiteboard", "product-proposals.json");
}

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function stable(value) { return JSON.stringify(value, Object.keys(value || {}).sort()); }
function ensureArray(value) { return Array.isArray(value) ? value : []; }

async function readStore(projectRoot) {
  try { return JSON.parse(await readFile(proposalPath(projectRoot), "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return { schemaVersion: SCHEMA_VERSION, proposals: {} }; throw error; }
}

async function writeStore(projectRoot, store) {
  const target = proposalPath(projectRoot);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

function assertProject(model, projectId) {
  if (projectId && String(projectId) !== String(model.project?.id)) throw new ValidationError("Proposal project does not match the current ProjectModel.", { projectId, actualProjectId: model.project?.id });
}

function validateEvidence(model, evidenceRefs) {
  const refs = [...new Set(ensureArray(evidenceRefs).map(String).filter(Boolean))];
  if (!refs.length) throw new ValidationError("Each proposed Feature requires at least one Evidence ref.");
  for (const ref of refs) {
    const evidence = model.evidence?.[ref];
    if (!evidence) throw new ValidationError("Proposal references missing Evidence.", { evidenceRef: ref });
    if (!evidence.source || !evidence.repoSnapshotId || evidence.repoSnapshotId !== model.repoSnapshot?.workingTreeFingerprint) throw new ValidationError("Proposal Evidence must belong to the current RepoSnapshot.", { evidenceRef: ref });
  }
  return refs;
}

function normalizePayload(model, input) {
  assertProject(model, input.projectId);
  const groups = ensureArray(input.groups).map((group, index) => ({
    proposalKey: String(group.proposalKey || group.key || `group-${index + 1}`),
    name: String(group.name || "未命名产品能力").trim(),
    description: String(group.description || "").trim(),
    memberFeatureKeys: ensureArray(group.memberFeatureKeys).map(String),
  }));
  const features = ensureArray(input.features).map((feature, index) => ({
    proposalKey: String(feature.proposalKey || feature.key || `feature-${index + 1}`),
    name: String(feature.name || "未命名产品功能").trim(),
    description: String(feature.description || "").trim(),
    evidenceRefs: validateEvidence(model, feature.evidenceRefs),
    groupKey: feature.groupKey ? String(feature.groupKey) : null,
    parentFeatureKey: feature.parentFeatureKey ? String(feature.parentFeatureKey) : null,
    rationale: String(feature.rationale || "").trim(),
  }));
  if (!features.length) throw new ValidationError("A Product Structure Proposal must include at least one Feature.");
  const keys = new Set(features.map((feature) => feature.proposalKey));
  for (const group of groups) group.memberFeatureKeys = group.memberFeatureKeys.filter((key) => keys.has(key));
  return { groups, features };
}

export async function getProductStructureProposals(projectRoot, options = {}) {
  const store = await readStore(projectRoot);
  const list = Object.values(store.proposals || {});
  return options.status ? list.filter((proposal) => proposal.status === options.status) : list;
}

export async function createProductStructureProposal(projectRoot, input = {}) {
  const model = await readProductGrounding(projectRoot);
  const baseRepoSnapshotId = String(input.baseRepoSnapshotId || input.base_repo_snapshot_id || model.repoSnapshot?.workingTreeFingerprint || "");
  if (!baseRepoSnapshotId || baseRepoSnapshotId !== model.repoSnapshot?.workingTreeFingerprint) throw new ConflictError("Proposal must be bound to the current RepoSnapshot.", { expected: baseRepoSnapshotId, actual: model.repoSnapshot?.workingTreeFingerprint });
  const payload = normalizePayload(model, input);
  return withWorkspaceLock(projectRoot, async () => {
    const store = await readStore(projectRoot);
    const signature = createHash("sha256").update(JSON.stringify({ projectId: model.project.id, baseRepoSnapshotId, groups: payload.groups, features: payload.features })).digest("hex");
    const duplicate = Object.values(store.proposals || {}).find((proposal) => proposal.signature === signature && ["pending", "confirmed"].includes(proposal.status));
    if (duplicate) throw new ConflictError("An equivalent Product Structure Proposal already exists.", { proposalId: duplicate.id });
    const now = input.now || new Date().toISOString();
    const proposal = {
      id: String(input.id || `proposal-${randomUUID()}`),
      projectId: model.project.id,
      baseRepoSnapshotId,
      proposedByAgentId: String(input.proposedByAgentId || input.proposed_by_agent_id || "host-agent"),
      status: "pending",
      groups: payload.groups,
      features: payload.features,
      signature,
      createdAt: now,
      updatedAt: now,
      version: 1,
      provenance: { kind: "product_inference", certainty: "possible", evidenceRefs: [...new Set(payload.features.flatMap((feature) => feature.evidenceRefs))] },
    };
    store.proposals ||= {};
    store.proposals[proposal.id] = proposal;
    await writeStore(projectRoot, store);
    return clone(proposal);
  });
}

export async function applyProductStructureProposal(projectRoot, input = {}) {
  const proposalId = String(input.proposalId || input.proposal_id || "");
  if (!proposalId) throw new ValidationError("proposalId is required.");
  return withWorkspaceLock(projectRoot, async () => {
    const store = await readStore(projectRoot);
    const proposal = store.proposals?.[proposalId];
    if (!proposal) throw new NotFoundError("Product Structure Proposal not found.", { proposalId });
    const expectedVersion = Number(input.expectedVersion ?? input.expected_version ?? proposal.version);
    if (expectedVersion !== proposal.version) throw new ConflictError("Proposal version is stale.", { proposalId, expectedVersion, actualVersion: proposal.version });
    const action = String(input.action || "").toLowerCase();
    const now = input.now || new Date().toISOString();
    if (action === "reject") {
      if (proposal.status !== "pending") throw new ConflictError("Only pending proposals can be rejected.", { proposalId, status: proposal.status });
      proposal.status = "rejected"; proposal.updatedAt = now; proposal.version += 1;
      await writeStore(projectRoot, store); return clone(proposal);
    }
    if (action === "update") {
      if (proposal.status !== "pending") throw new ConflictError("Only pending proposals can be edited.", { proposalId, status: proposal.status });
      const model = await readProductGrounding(projectRoot);
      const payload = normalizePayload(model, { ...proposal, ...input.patch });
      Object.assign(proposal, payload, { updatedAt: now, version: proposal.version + 1 });
      proposal.provenance.evidenceRefs = [...new Set(payload.features.flatMap((feature) => feature.evidenceRefs))];
      await writeStore(projectRoot, store); return clone(proposal);
    }
    if (action !== "confirm") throw new ValidationError("Proposal action must be confirm, update, or reject.");
    if (proposal.status !== "pending") throw new ConflictError("Only pending proposals can be confirmed.", { proposalId, status: proposal.status });
    const model = await readProductGrounding(projectRoot);
    if (model.repoSnapshot?.workingTreeFingerprint !== proposal.baseRepoSnapshotId) {
      proposal.status = "superseded"; proposal.staleReason = "REPO_SNAPSHOT_STALE"; proposal.updatedAt = now; proposal.version += 1;
      await writeStore(projectRoot, store);
      throw new ConflictError("Proposal is stale and cannot be silently confirmed.", { proposalId, status: proposal.status, expected: proposal.baseRepoSnapshotId, actual: model.repoSnapshot?.workingTreeFingerprint });
    }
    const featureIds = [];
    model.productHierarchy ||= { version: 1, levels: 2, roots: [], groups: {} };
    model.productHierarchy.groups ||= {};
    for (const group of proposal.groups) {
      const id = `group-proposed-${group.proposalKey}`;
      model.productHierarchy.groups[id] = { id, nodeKind: "group", entityType: "product-group", level: 1, parentGroupId: null, version: 1, name: group.name, description: group.description, featureIds: [], inferenceRefs: [], humanIntent: { confirmedFromProposal: proposal.id } };
      model.productHierarchy.roots = [...new Set([...(model.productHierarchy.roots || []), id])];
    }
    for (const item of proposal.features) {
      const id = `feature-proposed-${item.proposalKey}`;
      const group = proposal.groups.find((candidate) => candidate.proposalKey === item.groupKey);
      model.features[id] = { id, entityType: "feature", version: 1, name: item.name, description: item.description, parentFeatureId: item.parentFeatureKey ? `feature-proposed-${item.parentFeatureKey}` : null, childFeatureIds: [], groupId: group ? `group-proposed-${group.proposalKey}` : null, productState: "inferred", groundingRefs: [...item.evidenceRefs], humanIntent: { confirmedFromProposal: proposal.id, confirmedAt: now }, actionability: "GROUNDED", hidden: false, updatedAt: now };
      featureIds.push(id);
      if (group) model.productHierarchy.groups[`group-proposed-${group.proposalKey}`].featureIds.push(id);
    }
    model.humanIntent ||= { featureCorrections: {} };
    model.humanIntent.productStructureConfirmations ||= [];
    model.humanIntent.productStructureConfirmations.push({ proposalId: proposal.id, actor: input.actor || { id: "human", displayName: "用户", client: "human" }, confirmedAt: now, featureIds });
    model.version = Number(model.version || 0) + 1; model.updatedAt = now;
    const formalized = formalizeProjectModel(model, model.repoSnapshot);
    await persistProductGroundingModel(projectRoot, formalized);
    proposal.status = "confirmed"; proposal.confirmedAt = now; proposal.updatedAt = now; proposal.version += 1;
    await writeStore(projectRoot, store);
    return { proposal: clone(proposal), model: formalized };
  });
}
