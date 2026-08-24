import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError, ValidationError } from "./errors.mjs";
import { applyWorkspaceTransaction, readWorkspace } from "./store.mjs";
import { clone, DEVELOPMENT_STATUSES, timestamp } from "./schema.mjs";
import { captureRepoSnapshot, normalizeRepoSnapshot } from "./project-model.mjs";
import { bridgeImplementationEvidence, readProductGrounding } from "./product-grounding.mjs";

const DEVELOPMENT_LABELS = Object.freeze({
  IN_PROGRESS: "正在开发",
  WAITING_FOR_USER: "需要你处理",
  VERIFYING: "正在验证",
  READY_FOR_REVIEW: "等待你查看",
  ACCEPTED: "已完成",
  PAUSED: "已暂停",
});

const TRUSTED_CONNECTION_SOURCES = new Set(["PROCESS_ADAPTER", "TRUSTED_HOST", "TRUSTED_ADAPTER"]);

function text(value) {
  return String(value || "").trim();
}

function actorIdentity(actor = {}) {
  const id = text(actor.id || actor.agent_id || "external-agent") || "external-agent";
  return {
    id,
    displayName: text(actor.displayName || actor.display_name || id) || id,
    client: text(actor.client || "unknown") || "unknown",
    identityTrust: actor.identityTrust || actor.identity_trust || "REPORTED",
  };
}

function normalizeProgressItems(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError("progressItems must be an array.");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ValidationError("Each progress item must be an object.", { index });
    const id = text(item.id || `item-${index + 1}`);
    const label = text(item.label || item.title);
    if (!label) throw new ValidationError("Each progress item requires a label.", { index });
    const status = text(item.status || "in_progress").toLowerCase();
    if (!["todo", "in_progress", "done", "blocked"].includes(status)) throw new ValidationError(`Invalid progress item status: ${status}`, { index });
    return { ...clone(item), id, label, status };
  });
}

export function validateDevelopmentEvent(input = {}, options = {}) {
  const eventId = text(input.eventId || input.event_id);
  if (!eventId) throw new ValidationError("event_id is required for Development updates.");
  const status = input.status === undefined ? undefined : text(input.status).toUpperCase();
  if (status !== undefined && !DEVELOPMENT_STATUSES.has(status)) throw new ValidationError(`Invalid Development status: ${status}`);
  if (options.existing && !Number.isInteger(Number(input.expectedChangeVersion ?? input.expected_change_version))) {
    throw new ValidationError("expected_change_version is required for Development updates.");
  }
  if (input.summary !== undefined && !text(input.summary)) throw new ValidationError("Development summary cannot be empty.");
  return { eventId, status, expectedChangeVersion: input.expectedChangeVersion ?? input.expected_change_version };
}

function requireChange(workspace, changeId) {
  const id = text(changeId);
  const change = workspace.entities.changes?.[id];
  if (!change) throw new NotFoundError("Change not found.", { changeId: id });
  return change;
}

function acceptedEvent(workspace, changeId, eventId) {
  const change = workspace.entities.changes?.[changeId];
  if (change?.development?.lastEventId === eventId) return true;
  return workspace.eventLog.some((event) => event.collection === "changes"
    && event.entityId === changeId
    && event.payload?.patch?.development?.lastEventId === eventId);
}

function developmentSnapshot(current, input, kind, status, actor) {
  const previous = current && typeof current === "object" ? current : {};
  const now = input.reportedAt || input.reported_at || timestamp();
  const summary = text(input.summary || previous.summary || input.goal);
  const progressItems = normalizeProgressItems(input.progressItems ?? input.progress_items);
  const next = {
    ...clone(previous),
    schemaVersion: 1,
    status,
    goal: text(input.goal || previous.goal || summary),
    summary,
    lastReportedAt: now,
    lastReportedBy: actorIdentity(actor),
    lastEventId: text(input.eventId || input.event_id),
    lastMilestone: {
      kind,
      summary,
      reportedAt: now,
      reportedBy: actorIdentity(actor),
    },
  };
  if (progressItems !== undefined) {
    next.progressItems = progressItems;
    next.lastMilestone.progressItems = clone(progressItems);
  } else if (!Array.isArray(next.progressItems)) {
    next.progressItems = [];
  }
  if (input.blocking !== undefined) next.blocking = clone(input.blocking);
  if (input.userActionRequired !== undefined || input.user_action_required !== undefined) next.userActionRequired = Boolean(input.userActionRequired ?? input.user_action_required);
  if (next.blocking === undefined) next.blocking = null;
  if (next.userActionRequired === undefined) next.userActionRequired = false;
  return next;
}

function resultField(value, actor, reportedAt) {
  if (value === undefined || value === null || value === "") return undefined;
  return {
    value: clone(value),
    provenance: "AGENT_REPORTED",
    reportedAt,
    reportedBy: actorIdentity(actor),
  };
}

async function commitDevelopmentUpdate(projectRoot, changeId, input, actor, kind, defaultStatus, transformDevelopment = (development) => development) {
  const { eventId, status: requestedStatus, expectedChangeVersion } = validateDevelopmentEvent(input, { existing: true });
  const status = requestedStatus || defaultStatus;
  const expected = Number(expectedChangeVersion);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const workspace = await readWorkspace(projectRoot);
    const change = requireChange(workspace, changeId);
    // Check idempotency before comparing the caller's version. This is safe
    // for retries whose original response was lost after the write committed.
    if (acceptedEvent(workspace, change.id, eventId)) {
      return { change, development: clone(change.development), workspaceVersion: workspace.workspaceVersion, events: [], idempotent: true };
    }
    if (change.version !== expected) {
      throw new ConflictError("Change version is stale.", { changeId: change.id, expectedChangeVersion: expected, actualChangeVersion: change.version, code: "VERSION_CONFLICT" });
    }
    const development = transformDevelopment(developmentSnapshot(change.development, { ...input, eventId }, kind, status, actor), actor);
    try {
      const transaction = await applyWorkspaceTransaction(projectRoot, {
        actor,
        operations: [{ type: "entity.update", collection: "changes", id: change.id, expectedVersion: change.version, patch: { development } }],
      });
      const updated = await readWorkspace(projectRoot);
      const next = updated.entities.changes[change.id];
      return { ...transaction, change: next, development: clone(next.development), idempotent: false };
    } catch (error) {
      if (error?.code !== "VERSION_CONFLICT" || attempt === 1) throw error;
      const latest = await readWorkspace(projectRoot);
      if (acceptedEvent(latest, change.id, eventId)) {
        const current = latest.entities.changes[change.id];
        return { change: current, development: clone(current.development), workspaceVersion: latest.workspaceVersion, events: [], idempotent: true };
      }
      throw error;
    }
  }
  throw new ConflictError("Unable to update Development state.");
}

function baseChange(input, baseline) {
  const targetFeatureIds = Array.isArray(input.targetFeatureIds)
    ? input.targetFeatureIds.map(String)
    : Array.isArray(input.target_feature_ids) ? input.target_feature_ids.map(String) : [];
  const goal = text(input.goal);
  const title = text(input.title || goal || "未命名开发");
  return {
    id: text(input.changeId || input.change_id || input.id || `change-${randomUUID().slice(0, 8)}`),
    title,
    status: "draft",
    intent: goal,
    featureId: targetFeatureIds[0] || null,
    targetFeatureIds,
    baseline: clone(baseline),
    contract: clone(input.contract || {}),
    desiredState: clone(input.desiredState || input.desired_state || {}),
    acceptanceCriteria: Array.isArray(input.acceptanceCriteria) ? input.acceptanceCriteria.map(String) : [],
    constraints: Array.isArray(input.constraints) ? input.constraints.map(String) : [],
    relatedEntityRefs: Array.isArray(input.relatedEntityRefs || input.related_entity_refs) ? clone(input.relatedEntityRefs || input.related_entity_refs) : [],
  };
}

export async function startDevelopment(projectRoot, input = {}) {
  const actor = input.actor || input.agent || { id: input.agentId || input.agent_id, client: input.client };
  const { eventId } = validateDevelopmentEvent({ ...input, status: "IN_PROGRESS" });
  const goal = text(input.goal);
  if (!goal) throw new ValidationError("goal is required when Development starts.");
  let changeId = text(input.changeId || input.change_id);
  if (!changeId) {
    const baseline = input.baseline || await captureRepoSnapshot(projectRoot, [], timestamp());
    const change = baseChange(input, baseline);
    change.development = developmentSnapshot(null, { ...input, goal, eventId }, "START", "IN_PROGRESS", actor);
    const transaction = await applyWorkspaceTransaction(projectRoot, { actor, operations: [{ type: "entity.create", collection: "changes", entity: change }] });
    const workspace = await readWorkspace(projectRoot);
    return { ...transaction, change: workspace.entities.changes[change.id], development: workspace.entities.changes[change.id].development, created: true, idempotent: false };
  }
  const workspace = await readWorkspace(projectRoot);
  const change = requireChange(workspace, changeId);
  if (acceptedEvent(workspace, change.id, eventId)) return { change, development: clone(change.development), workspaceVersion: workspace.workspaceVersion, events: [], created: false, idempotent: true };
  const expected = input.expectedChangeVersion ?? input.expected_change_version ?? change.version;
  return commitDevelopmentUpdate(projectRoot, change.id, { ...input, eventId, expectedChangeVersion: expected, status: "IN_PROGRESS", goal }, actor, "START", "IN_PROGRESS");
}

export async function updateDevelopment(projectRoot, input = {}) {
  const actor = input.actor || input.agent || { id: input.agentId || input.agent_id, client: input.client };
  const changeId = text(input.changeId || input.change_id);
  if (!changeId) throw new ValidationError("change_id is required for Development updates.");
  return commitDevelopmentUpdate(projectRoot, changeId, input, actor, "UPDATE", text(input.status).toUpperCase());
}

export async function reportDevelopmentResult(projectRoot, input = {}) {
  const actor = input.actor || input.agent || { id: input.agentId || input.agent_id, client: input.client };
  const changeId = text(input.changeId || input.change_id);
  if (!changeId) throw new ValidationError("change_id is required for Development results.");
  const status = text(input.status || "READY_FOR_REVIEW").toUpperCase();
  if (!DEVELOPMENT_STATUSES.has(status)) throw new ValidationError(`Invalid Development status: ${status}`);
  const currentWorkspace = await readWorkspace(projectRoot);
  const currentChange = requireChange(currentWorkspace, changeId);
  const reportedReferences = input.implementationEvidence ?? input.implementation_evidence;
  let bridge = null;
  if (Array.isArray(reportedReferences) && reportedReferences.length) {
    try {
      bridge = await bridgeImplementationEvidence(projectRoot, { featureIds: [currentChange.featureId, ...(currentChange.targetFeatureIds || [])].filter(Boolean), references: reportedReferences, agentId: actor?.id || actor?.agent_id });
    } catch (error) {
      if (error?.code !== "NOT_FOUND") throw error;
      bridge = { observed: [], rejected: reportedReferences.map((reference) => ({ reference: clone(reference), reason: "PRODUCT_MODEL_NOT_AVAILABLE" })) };
    }
  }
  return commitDevelopmentUpdate(projectRoot, changeId, { ...input, status }, actor, "RESULT", status, (development, reportedBy) => {
    const reportedAt = development.lastReportedAt;
    const next = {
      ...development,
      implementationReport: resultField(input.implementationReport ?? input.implementation_report, reportedBy, reportedAt) || development.implementationReport || null,
      verificationReport: resultField(input.verificationReport ?? input.verification_report, reportedBy, reportedAt) || development.verificationReport || null,
      remainingIssues: clone(input.remainingIssues ?? input.remaining_issues ?? development.remainingIssues ?? []),
      implementationEvidence: clone(input.implementationEvidence ?? input.implementation_evidence ?? development.implementationEvidence ?? []),
      implementationEvidenceObservation: bridge ? { observed: clone(bridge.observed), rejected: clone(bridge.rejected), provenance: "OBSERVED" } : (development.implementationEvidenceObservation || null),
    };
    const acceptance = input.humanAcceptance ?? input.human_acceptance;
    if (acceptance !== undefined) next.acceptance = { value: clone(acceptance), provenance: acceptance?.provenance || "HUMAN_REPORTED_VIA_AGENT", reportedAt, reportedBy: actorIdentity(reportedBy) };
    return next;
  });
}

export async function acceptDevelopment(projectRoot, input = {}) {
  const changeId = text(input.changeId || input.change_id);
  if (!changeId) throw new ValidationError("change_id is required for Development acceptance.");
  const workspace = await readWorkspace(projectRoot);
  const change = requireChange(workspace, changeId);
  const actor = input.actor || { id: "human", displayName: "用户", client: "product-view", identityTrust: "TRUSTED_ADAPTER" };
  const result = await commitDevelopmentUpdate(projectRoot, changeId, {
    ...input,
    eventId: input.eventId || input.event_id || `human-accept-${randomUUID()}`,
    expectedChangeVersion: input.expectedChangeVersion ?? input.expected_change_version ?? change.version,
    status: "ACCEPTED",
    summary: input.summary || change.development?.summary || "用户已确认本次开发结果。",
    humanAcceptance: input.humanAcceptance || input.human_acceptance || { statement: "用户在 My Whiteboard 中确认开发结果。", provenance: "HUMAN_CONFIRMED_IN_UI" },
  }, actor, "ACCEPTANCE", "ACCEPTED", (development, reportedBy) => ({
    ...development,
    acceptance: { value: clone(input.humanAcceptance || input.human_acceptance || { statement: "用户在 My Whiteboard 中确认开发结果。" }), provenance: "HUMAN_CONFIRMED_IN_UI", reportedAt: development.lastReportedAt, reportedBy: actorIdentity(reportedBy) },
  }));
  if (result.idempotent || result.change.status === "completed") return result;
  const current = await readWorkspace(projectRoot);
  const latest = requireChange(current, changeId);
  const mirror = await applyWorkspaceTransaction(projectRoot, {
    actor,
    operations: [{ type: "entity.update", collection: "changes", id: changeId, expectedVersion: latest.version, patch: { status: "completed" } }],
  });
  const updated = await readWorkspace(projectRoot);
  return { ...result, ...mirror, change: updated.entities.changes[changeId], development: clone(updated.entities.changes[changeId].development) };
}

function legacyDevelopment(change) {
  const map = { executing: "IN_PROGRESS", completed: "READY_FOR_REVIEW", interrupted: "PAUSED", failed: "PAUSED" };
  const status = map[change.status];
  return status ? { schemaVersion: 1, status, goal: change.intent || change.title, summary: "历史 Change 没有 Phase 3 语义里程碑。", lastReportedAt: change.updatedAt || change.createdAt || null, lastEventId: null, progressItems: [], blocking: change.status === "failed" ? { reason: "LEGACY_EXECUTION_FAILED" } : null, userActionRequired: change.status === "failed" } : null;
}

export function deriveDevelopmentProjection(change = {}, workspace = {}) {
  const development = change.development || legacyDevelopment(change);
  if (!development) return null;
  const status = DEVELOPMENT_STATUSES.has(development.status) ? development.status : "PAUSED";
  return {
    status,
    label: DEVELOPMENT_LABELS[status],
    goal: development.goal || change.intent || change.title,
    summary: development.summary || "暂无语义里程碑。",
    lastReportedAt: development.lastReportedAt || null,
    lastMilestone: clone(development.lastMilestone || null),
    progressItems: clone(development.progressItems || []),
    blocking: clone(development.blocking || null),
    userActionRequired: Boolean(development.userActionRequired),
    provenance: {
      status: development.lastReportedBy ? "AGENT_REPORTED" : "LEGACY_DERIVED",
      result: development.implementationReport?.provenance || null,
      verification: development.verificationReport?.provenance || null,
    },
    connection: deriveConnectionProjection(workspace.entities?.agents?.[development.lastReportedBy?.id]),
  };
}

export function deriveConnectionProjection(agent) {
  if (!agent) return { state: "UNKNOWN", label: "连接状态未知", lastSyncAt: null, source: null };
  const state = text(agent.connectionState).toUpperCase();
  const source = text(agent.connectionStateSource).toUpperCase();
  const reliable = TRUSTED_CONNECTION_SOURCES.has(source) && ["CONNECTED", "DISCONNECTED"].includes(state);
  return {
    state: reliable ? state : "UNKNOWN",
    label: reliable ? (state === "CONNECTED" ? "已连接" : "已断开") : "连接状态未知",
    lastSyncAt: agent.lastSyncAt || agent.lastSeenAt || null,
    source: reliable ? source : null,
  };
}

function relevantRefs(change) {
  return Array.isArray(change?.relatedEntityRefs) ? change.relatedEntityRefs : [];
}

export async function getDevelopmentContext(projectRoot, input = {}) {
  const workspace = await readWorkspace(projectRoot);
  const requestedChangeId = text(input.changeId || input.change_id);
  const requestedFeatureId = text(input.featureId || input.feature_id);
  const changes = Object.values(workspace.entities.changes || {})
    .filter((change) => !requestedChangeId || change.id === requestedChangeId)
    .filter((change) => !requestedFeatureId || [change.featureId, ...(change.targetFeatureIds || [])].map(String).includes(requestedFeatureId))
    .filter((change) => change.development || ["executing", "interrupted", "completed"].includes(change.status))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const selected = changes[0] || null;
  const model = await readProductGrounding(projectRoot, { optional: true, refreshSnapshot: false });
  const targetIds = [...new Set((selected ? [selected.featureId, ...(selected.targetFeatureIds || [])] : []).filter(Boolean).map(String))];
  const featureMap = model?.features || {};
  const features = targetIds.map((id) => featureMap[id]).filter(Boolean).map((feature) => ({
    id: feature.id, name: feature.name, description: feature.description, productState: feature.productState,
    actionability: feature.actionability, groundingRefs: feature.groundingRefs || [], groupId: feature.groupId || null,
  }));
  const evidenceIds = [...new Set(features.flatMap((feature) => feature.groundingRefs || []))];
  const evidence = input.includeEvidence === false ? {} : Object.fromEntries(evidenceIds.map((id) => [id, model?.evidence?.[id]]).filter(([, value]) => value));
  const refs = relevantRefs(selected);
  const linked = { contexts: [], decisions: [], artifacts: [] };
  for (const ref of refs) {
    if (!linked[ref.collection] || !workspace.entities[ref.collection]?.[ref.id]) continue;
    linked[ref.collection].push(clone(workspace.entities[ref.collection][ref.id]));
  }
  const recentMilestones = selected ? workspace.eventLog.filter((event) => event.collection === "changes" && event.entityId === selected.id && event.payload?.patch?.development?.lastMilestone).slice(-10).map((event) => ({ workspaceVersion: event.workspaceVersion, ...clone(event.payload.patch.development.lastMilestone) })) : [];
  return {
    project: clone(workspace.project),
    workspaceVersion: workspace.workspaceVersion,
    change: selected ? { ...clone(selected), developmentProjection: deriveDevelopmentProjection(selected, workspace) } : null,
    changes: changes.slice(0, 5).map((change) => ({ ...clone(change), developmentProjection: deriveDevelopmentProjection(change, workspace) })),
    features,
    evidence,
    latestRepoSnapshot: clone(model?.repoSnapshot || normalizeRepoSnapshot(model || {})),
    recentMilestones,
    linked,
  };
}

export function deriveRealityMismatch(input = {}) {
  const targetIds = new Set((input.targetFeatureIds || input.target_feature_ids || []).map(String));
  const features = input.features || {};
  const changedFiles = new Set((input.changedFiles || input.changed_files || []).map(String));
  const touched = [];
  for (const feature of Object.values(features)) {
    const paths = (feature.groundingRefs || []).map((id) => input.evidence?.[id]?.source).filter(Boolean).map(String);
    if (paths.some((file) => changedFiles.has(file))) touched.push({ featureId: feature.id, files: paths.filter((file) => changedFiles.has(file)) });
  }
  if (!touched.length) return { category: "NO_RELEVANT_EVIDENCE_OBSERVED", certainty: "low", touchedFeatures: [] };
  const shared = touched.some((item) => item.files.some((file) => touched.filter((other) => other.files.includes(file)).length > 1));
  if (shared) return { category: "SHARED_EVIDENCE_CHANGED", certainty: "low", touchedFeatures: touched };
  const other = touched.filter((item) => !targetIds.has(String(item.featureId)));
  if (other.length) return { category: "OTHER_KNOWN_FEATURE_EVIDENCE_CHANGED", certainty: "possible", touchedFeatures: touched };
  return { category: "TARGET_EVIDENCE_CHANGED", certainty: "possible", touchedFeatures: touched };
}
