import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PROJECT_MODEL_VERSION = 1;
export const EVIDENCE_SCHEMA_VERSION = 1;
export const FEATURE_ACTIONABILITY_STATES = Object.freeze(["UNDERSTOOD", "GROUNDED", "ACTIONABLE"]);
export const ACTIONABILITY_STATES = FEATURE_ACTIONABILITY_STATES;
export const EXECUTION_READINESS_STATES = Object.freeze(["READY", "BLOCKED"]);
export const EXECUTION_REASON_CODES = Object.freeze([
  "CHANGE_NOT_APPROVED",
  "REPO_SNAPSHOT_STALE",
  "DIRTY_WORKSPACE_NEEDS_ISOLATION",
  "NO_COMPATIBLE_AGENT",
  "AGENT_OFFLINE",
  "FEATURE_NOT_ACTIONABLE",
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

async function git(projectRoot, args) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", path.resolve(projectRoot), ...args], { windowsHide: true, maxBuffer: 2_000_000 });
    return stdout;
  } catch {
    return "";
  }
}

function parseChangedFiles(status) {
  return status.split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.length > 3 ? line.slice(3).replace(/^"|"$/g, "") : line)
    .map((line) => line.includes(" -> ") ? line.split(" -> ").at(-1) : line)
    .sort();
}

export async function captureRepoSnapshot(projectRoot, files = [], capturedAt = new Date().toISOString()) {
  const root = path.resolve(projectRoot);
  const headRevision = (await git(root, ["rev-parse", "HEAD"])).trim() || null;
  // Workspace persistence is application metadata, not a product-code change.
  // Excluding it keeps a Change baseline stable while the semantic workspace
  // itself is being updated; source and generated-code changes remain visible.
  const status = await git(root, ["status", "--porcelain", "--untracked-files=all", "--", ".", ":!.my-whiteboard"]);
  const fileHashes = await Promise.all(files.map(async (file) => {
    let sourceHash = file.sourceHash;
    try { sourceHash = createHash("sha256").update(await readFile(path.join(root, file.relative))).digest("hex"); } catch {}
    return { relative: file.relative, sourceHash, baselineSourceHash: file.sourceHash || null };
  })).then((items) => items.sort((a, b) => a.relative.localeCompare(b.relative)));
  const changedByHash = fileHashes.filter((file) => file.baselineSourceHash && file.sourceHash !== file.baselineSourceHash).map((file) => file.relative);
  const changedFiles = [...new Set([...parseChangedFiles(status), ...changedByHash])].sort();
  const workingTreeFingerprint = hash(JSON.stringify({ headRevision, status, fileHashes }));
  return {
    schemaVersion: 1,
    headRevision,
    dirty: changedFiles.length > 0,
    workingTreeFingerprint,
    changedFiles,
    capturedAt,
  };
}

export function normalizeRepoSnapshot(model = {}) {
  if (model.repoSnapshot?.workingTreeFingerprint) return clone(model.repoSnapshot);
  const headRevision = model.repoRevision && !String(model.repoRevision).includes("+source-")
    ? model.repoRevision
    : String(model.repoRevision || "").split("+source-")[0] || null;
  return {
    schemaVersion: 1,
    headRevision,
    dirty: false,
    workingTreeFingerprint: hash(JSON.stringify({ headRevision, observedAt: model.observedAt || null })),
    changedFiles: [],
    capturedAt: model.observedAt || null,
  };
}

export function normalizeFeatureActionability(value) {
  const normalized = String(value || "").toUpperCase();
  if (FEATURE_ACTIONABILITY_STATES.includes(normalized)) return normalized;
  // 0.2/early 0.3 persisted EXECUTABLE on Feature. It is a derived label,
  // so migrate it to the highest Feature semantic state without retaining a
  // permanent execution permission on Human Intent.
  if (normalized === "EXECUTABLE") return "ACTIONABLE";
  return "UNDERSTOOD";
}

export function evaluateActionability(feature, evidenceById = {}, repoSnapshot = {}) {
  const refs = (feature?.groundingRefs || []).map((id) => evidenceById[id]).filter(Boolean);
  const reasons = [];
  if (!feature?.id || !feature?.name) return { state: "UNDERSTOOD", reasons: ["Feature identity is incomplete."], checkedAt: repoSnapshot.capturedAt || null };
  let state = "UNDERSTOOD";
  if (!refs.length) reasons.push("No grounding evidence is attached.");
  else {
    state = "GROUNDED";
    const confirmed = refs.some((item) => item.certainty === "confirmed" || item.status === "confirmed");
    if (!confirmed) reasons.push("Evidence exists but is not confirmed.");
    const fresh = repoSnapshot.workingTreeFingerprint && refs.some((item) => item.repoSnapshotId === repoSnapshot.workingTreeFingerprint);
    if (confirmed && fresh && !["unobserved", "inferred"].includes(feature.productState)) {
      state = "ACTIONABLE";
      reasons.push("Confirmed evidence matches the current RepoSnapshot.");
    } else if (confirmed) reasons.push("Evidence does not match the current RepoSnapshot.");
  }
  return { state, reasons, checkedAt: repoSnapshot.capturedAt || null };
}

function hasSnapshotMismatch(input = {}) {
  if (input.repoSnapshotStale === true) return true;
  const expected = input.expectedRepoSnapshotId || input.change?.baseline?.workingTreeFingerprint || input.change?.repoSnapshotId;
  return Boolean(expected && input.repoSnapshot?.workingTreeFingerprint && expected !== input.repoSnapshot.workingTreeFingerprint);
}

/**
 * Derive execution readiness from a Change/Execution context. This is not a
 * Feature state and is intentionally not persisted as Feature semantic truth.
 */
export function deriveExecutionReadiness(input = {}) {
  const reasons = [];
  const change = input.change || {};
  const feature = input.feature || {};
  const repoSnapshot = input.repoSnapshot || {};
  const featureActionability = String(feature.actionability || input.featureActionability || "").toUpperCase();
  const targets = Array.isArray(input.features) ? input.features : feature?.id || featureActionability ? [feature.id ? feature : { id: null, actionability: featureActionability }] : [];
  const targetFeatureIds = Array.isArray(input.featureIds) ? input.featureIds.map(String) : targets.map((item) => item?.id).filter(Boolean);
  const blockedFeatureIds = targets.filter((item) => !item || String(item.actionability || "").toUpperCase() !== "ACTIONABLE").map((item) => item?.id).filter(Boolean);

  if (change.status !== "approved") reasons.push("CHANGE_NOT_APPROVED");
  if (targets.length && (blockedFeatureIds.length || targets.some((item) => !item))) reasons.push("FEATURE_NOT_ACTIONABLE");
  if (hasSnapshotMismatch(input)) reasons.push("REPO_SNAPSHOT_STALE");
  if (repoSnapshot.dirty && input.repoSafetyReady !== true) reasons.push("DIRTY_WORKSPACE_NEEDS_ISOLATION");
  if (input.compatibleAgentAvailable !== true) reasons.push("NO_COMPATIBLE_AGENT");
  if (["offline", "error"].includes(String(input.agentStatus || "").toLowerCase())) reasons.push("AGENT_OFFLINE");

  const uniqueReasons = [...new Set(reasons)];
  const state = uniqueReasons.length ? "BLOCKED" : "READY";
  return {
    state,
    status: state,
    reasonCodes: uniqueReasons,
    reasons: uniqueReasons.map((code) => ({
      code,
      message: executionReasonMessage(code),
      recoverable: executionReasonRecoverable(code),
      suggestedAction: executionReasonAction(code),
      ...(code === "FEATURE_NOT_ACTIONABLE" ? { featureIds: targetFeatureIds.length ? targetFeatureIds : blockedFeatureIds } : {}),
    })),
    executableLabel: state === "READY" && (!targets.length || targets.every((item) => String(item?.actionability || "").toUpperCase() === "ACTIONABLE")) ? "EXECUTABLE" : null,
    checkedAt: repoSnapshot.capturedAt || null,
  };
}

function executionReasonMessage(code) {
  return {
    CHANGE_NOT_APPROVED: "Change must be explicitly approved before execution.",
    REPO_SNAPSHOT_STALE: "The execution baseline does not match the current RepoSnapshot.",
    DIRTY_WORKSPACE_NEEDS_ISOLATION: "The working tree is dirty and needs safe isolation before execution.",
    NO_COMPATIBLE_AGENT: "No compatible connected Agent is available for this Change.",
    AGENT_OFFLINE: "The selected Agent is offline or unavailable.",
    FEATURE_NOT_ACTIONABLE: "The Feature is not yet actionable from its current Grounding.",
  }[code] || "Execution readiness is blocked.";
}

function executionReasonRecoverable(code) {
  return !["NO_COMPATIBLE_AGENT", "AGENT_OFFLINE"].includes(code);
}

function executionReasonAction(code) {
  return {
    CHANGE_NOT_APPROVED: "APPROVE_CHANGE",
    REPO_SNAPSHOT_STALE: "REFRESH_GROUNDING",
    DIRTY_WORKSPACE_NEEDS_ISOLATION: "ISOLATE_WORKSPACE",
    NO_COMPATIBLE_AGENT: "CONNECT_COMPATIBLE_AGENT",
    AGENT_OFFLINE: "RECONNECT_AGENT",
    FEATURE_NOT_ACTIONABLE: "REFRESH_GROUNDING",
  }[code] || "REVIEW_READINESS";
}

export function normalizeEvidenceRecord(item = {}, repoSnapshot = {}) {
  const kind = item.kind || item.type || "unknown";
  const certainty = item.certainty || item.status || "unknown";
  return {
    ...clone(item),
    evidenceVersion: EVIDENCE_SCHEMA_VERSION,
    kind,
    type: item.type || kind,
    certainty,
    status: item.status || certainty,
    repoSnapshotId: item.repoSnapshotId || repoSnapshot.workingTreeFingerprint || null,
    provenance: item.provenance || { source: item.source || null, target: item.target || null, details: clone(item.details || {}) },
  };
}

export function projectMapProjection(model = {}) {
  const evidence = model.evidence || {};
  return {
    projectionVersion: 1,
    project: clone(model.project),
    repoRevision: model.repoSnapshot?.headRevision || model.repoRevision || null,
    modelVersion: model.version || 0,
    repoSnapshot: clone(model.repoSnapshot),
    features: Object.values(model.features || {}).filter((feature) => !feature.hidden).map((feature) => ({
      id: feature.id,
      nodeKind: "feature",
      name: feature.name,
      description: feature.description,
      rationale: feature.rationale || "",
      level: feature.level || 2,
      groupId: feature.groupId || null,
      parentFeatureId: feature.parentFeatureId || null,
      childFeatureIds: feature.childFeatureIds || [],
      productState: feature.productState,
      actionability: feature.actionability,
      actionabilityGate: clone(feature.actionabilityGate),
      certainty: (feature.groundingRefs || []).some((id) => evidence[id]?.certainty === "confirmed") ? "confirmed" : "possible",
      groundingRefs: feature.groundingRefs || [],
    })),
    hierarchy: {
      levels: model.productHierarchy?.levels || 2,
      roots: (model.productHierarchy?.roots || []).filter((id) => model.productHierarchy?.groups?.[id]?.featureIds?.length),
      groups: Object.values(model.productHierarchy?.groups || {}).filter((group) => group.featureIds?.length).map((group) => ({
        id: group.id,
        nodeKind: "group",
        name: group.name,
        description: group.description,
        level: group.level,
        parentGroupId: group.parentGroupId,
        featureIds: group.featureIds,
        inferenceRefs: group.inferenceRefs,
        certainty: "possible",
      })),
    },
    visualLayout: clone(model.visualLayout || {}),
    layoutAuthority: "visual-arrangement-only",
    stats: clone(model.stats || {}),
  };
}

export function formalizeProjectModel(model, repoSnapshot = normalizeRepoSnapshot(model)) {
  const normalized = clone(model) || {};
  normalized.modelType = "ProjectModel";
  normalized.projectModelVersion = PROJECT_MODEL_VERSION;
  normalized.repoSnapshot = clone(repoSnapshot);
  normalized.repoRevision = repoSnapshot.headRevision || normalized.repoRevision || null;
  normalized.understandingState = normalized.understandingState || (Object.keys(normalized.features || {}).length ? "READY" : (Object.keys(normalized.evidence || {}).length ? "NEEDS_INTERPRETATION" : "UNSUPPORTED"));
  normalized.recommendedNextAction = normalized.recommendedNextAction || (normalized.understandingState === "NEEDS_INTERPRETATION" || normalized.understandingState === "PARTIAL" ? "PRODUCT_STRUCTURE_PROPOSAL" : null);
  normalized.observedFiles ||= Object.values(normalized.evidence || {}).filter((item) => item.type === "file").map((item) => ({ relative: item.source, classification: item.details?.classification || "application_source", sourceHash: item.details?.sourceHash || "" }));
  normalized.unmappedProductSignals ||= [];
  normalized.evidence = Object.fromEntries(Object.entries(normalized.evidence || {}).map(([id, item]) => [id, normalizeEvidenceRecord(item, repoSnapshot)]));
  normalized.humanIntent = clone(normalized.humanIntent || { featureCorrections: {} });
  normalized.humanIntent.featureCorrections ||= {};
  for (const correction of Object.values(normalized.humanIntent.featureCorrections)) {
    if (correction?.patch?.actionability) correction.patch.actionability = normalizeFeatureActionability(correction.patch.actionability);
  }
  normalized.features = Object.fromEntries(Object.entries(normalized.features || {}).map(([id, feature]) => {
    const actionabilityGate = evaluateActionability(feature, normalized.evidence, repoSnapshot);
    const humanIntent = feature.humanIntent ? clone(feature.humanIntent) : feature.humanIntent;
    if (humanIntent?.actionability) humanIntent.actionability = normalizeFeatureActionability(humanIntent.actionability);
    return [id, { ...feature, humanIntent, actionability: actionabilityGate.state, actionabilityGate }];
  }));
  normalized.productMapProjection = projectMapProjection(normalized);
  return normalized;
}
