import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PROJECT_MODEL_VERSION = 1;
export const EVIDENCE_SCHEMA_VERSION = 1;
export const ACTIONABILITY_STATES = Object.freeze(["UNDERSTOOD", "GROUNDED", "ACTIONABLE", "EXECUTABLE"]);

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
  const status = await git(root, ["status", "--porcelain", "--untracked-files=all"]);
  const changedFiles = parseChangedFiles(status);
  const fileHashes = files.map((file) => ({ relative: file.relative, sourceHash: file.sourceHash })).sort((a, b) => a.relative.localeCompare(b.relative));
  const workingTreeFingerprint = hash(JSON.stringify({ headRevision, status, fileHashes }));
  return {
    schemaVersion: 1,
    headRevision,
    dirty: Boolean(status.trim()),
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

function stateFromLegacy(value) {
  const normalized = String(value || "").toUpperCase();
  if (ACTIONABILITY_STATES.includes(normalized)) return normalized;
  if (normalized === "GROUNDED") return "GROUNDED";
  if (normalized === "ACTIONABLE") return "ACTIONABLE";
  if (normalized === "EXECUTABLE") return "EXECUTABLE";
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
    if (confirmed && fresh && feature.productState !== "unobserved") {
      state = "ACTIONABLE";
      reasons.push("Confirmed evidence matches the current RepoSnapshot.");
    } else if (confirmed) reasons.push("Evidence does not match the current RepoSnapshot.");
  }
  const intent = String(feature.humanIntent?.actionability || feature.actionability || "").toUpperCase();
  if (state === "ACTIONABLE" && intent === "EXECUTABLE" && !repoSnapshot.dirty && feature.hidden !== true) {
    state = "EXECUTABLE";
    reasons.push("Human Intent explicitly permits execution and the RepoSnapshot is clean.");
  } else if (intent === "EXECUTABLE" && repoSnapshot.dirty) {
    reasons.push("Execution is gated while the working tree is dirty.");
  }
  return { state, reasons, checkedAt: repoSnapshot.capturedAt || null };
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
      name: feature.name,
      description: feature.description,
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
  normalized.evidence = Object.fromEntries(Object.entries(normalized.evidence || {}).map(([id, item]) => [id, normalizeEvidenceRecord(item, repoSnapshot)]));
  normalized.features = Object.fromEntries(Object.entries(normalized.features || {}).map(([id, feature]) => {
    const actionabilityGate = evaluateActionability(feature, normalized.evidence, repoSnapshot);
    return [id, { ...feature, actionability: actionabilityGate.state, actionabilityGate }];
  }));
  normalized.productMapProjection = projectMapProjection(normalized);
  return normalized;
}
