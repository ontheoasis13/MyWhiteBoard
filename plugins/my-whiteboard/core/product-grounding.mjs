import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ConflictError, NotFoundError, ValidationError } from "./errors.mjs";
import { OBSERVATION_EXTENSIONS, scanProjectSources } from "./source-observation.mjs";
import { slug } from "./schema.mjs";
import { captureRepoSnapshot, formalizeProjectModel, normalizeEvidenceRecord, normalizeFeatureActionability, normalizeRepoSnapshot, projectMapProjection } from "./project-model.mjs";

const execFileAsync = promisify(execFile);
const MODEL_SCHEMA_VERSION = 1;
const CERTAINTIES = new Set(["confirmed", "possible", "unknown"]);
const ALLOWED_CORRECTION_FIELDS = new Set(["name", "description", "parentFeatureId", "groupId", "productState", "actionability", "hidden"]);

const CONCEPT_LABELS = Object.freeze({
  "agent": "智能体协作",
  "account": "账号管理",
  "artifact": "项目产物",
  "auth": "登录与账号",
  "billing": "账单管理",
  "board": "可视化白板",
  "cloud": "云同步",
  "code-board": "代码地图",
  "context": "项目上下文",
  "dashboard": "数据概览",
  "decision": "项目决策",
  "handoff": "智能体交接",
  "home": "首页",
  "legacy": "旧版迁移",
  "message": "协作消息",
  "product-map": "产品地图",
  "project": "项目管理",
  "selection": "聚焦上下文",
  "settings": "设置",
  "task": "任务管理",
  "workspace": "工作区",
});

const PRODUCT_GROUPS = Object.freeze([
  { id: "group-workspace-map", name: "工作区与地图", description: "用户进入、浏览和理解项目的主要工作面。" },
  { id: "group-project-knowledge", name: "项目知识", description: "支撑项目理解与决策的上下文、产物和知识记录。" },
  { id: "group-project-delivery", name: "项目推进", description: "把项目目标转化为可跟踪工作的项目与任务能力。" },
  { id: "group-ai-collaboration", name: "AI 协作", description: "智能体身份、交接、消息和聚焦上下文等协作能力。" },
  { id: "group-sync-extensions", name: "同步与扩展", description: "跨环境同步和可选扩展能力。" },
  { id: "group-compatibility-maintenance", name: "兼容与维护", description: "旧格式迁移和维护性能力，不作为核心一级体验。" },
  { id: "group-other", name: "其他能力", description: "尚未有稳定产品分组的能力，等待人工确认。" },
]);

const FEATURE_GROUPS = Object.freeze({
  "feature-agent": "group-ai-collaboration",
  "feature-artifact": "group-project-knowledge",
  "feature-board": "group-workspace-map",
  "feature-cloud": "group-sync-extensions",
  "feature-code-board": "group-workspace-map",
  "feature-context": "group-project-knowledge",
  "feature-decision": "group-project-knowledge",
  "feature-handoff": "group-ai-collaboration",
  "feature-legacy": "group-compatibility-maintenance",
  "feature-message": "group-ai-collaboration",
  "feature-product-map": "group-workspace-map",
  "feature-project": "group-project-delivery",
  "feature-selection": "group-ai-collaboration",
  "feature-task": "group-project-delivery",
  "feature-workspace": "group-workspace-map",
});

function productModelPath(projectRoot) {
  return path.join(path.resolve(projectRoot), ".my-whiteboard", "product-model.json");
}

function shortHash(value, length = 16) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function humanize(value) {
  const normalized = String(value || "feature").replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  return CONCEPT_LABELS[value] || normalized;
}

function normalizedConcept(value) {
  const token = slug(value, "feature").replace(/^(api|pages?)-/, "");
  if (token === "accounts") return "account";
  if (token === "tasks") return "task";
  if (token === "decisions") return "decision";
  if (token === "artifacts") return "artifact";
  if (token === "messages") return "message";
  if (token === "contexts") return "context";
  if (token === "agents") return "agent";
  if (token === "handoffs") return "handoff";
  return token;
}

function routeConcept(route) {
  const parts = String(route || "/").split("/").filter(Boolean).filter((part) => part !== "api");
  const first = parts.find((part) => !part.startsWith(":") && !part.startsWith("[") && !part.startsWith("("));
  return normalizedConcept(first || "home");
}

function operationConcept(operation) {
  if (operation.startsWith("code_board_")) return "code-board";
  if (operation.startsWith("product_grounding_") || operation.startsWith("product_feature_")) return "product-map";
  return normalizedConcept(operation.split("_")[0]);
}

function defaultGroupId(featureId) {
  return FEATURE_GROUPS[featureId] || "group-other";
}

function evidenceId(type, source, target, line = null) {
  return `evidence-${shortHash(`${type}|${source}|${target}|${line ?? ""}`)}`;
}

function addEvidence(evidence, input) {
  const certainty = CERTAINTIES.has(input.certainty) ? input.certainty : "confirmed";
  const id = input.id || evidenceId(input.type, input.source, input.target, input.details?.line);
  evidence.set(id, { id, ...input, certainty });
  return id;
}

async function repositoryRevision(projectRoot, files) {
  const fingerprint = shortHash(files.map((file) => `${file.relative}:${file.sourceHash}`).join("\n"), 24);
  try {
    const { stdout } = await execFileAsync("git", ["-C", path.resolve(projectRoot), "rev-parse", "HEAD"], { windowsHide: true });
    const revision = stdout.trim();
    if (revision) return `${revision}+source-${fingerprint}`;
  } catch {}
  return `content-${fingerprint}`;
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function normalizeRouteParts(parts) {
  const routeParts = parts
    .filter((part) => !part.startsWith("(") && !part.startsWith("@"))
    .map((part) => part.replace(/^\[\.\.\.(.+)\]$/, ":$1*").replace(/^\[(.+)\]$/, ":$1"));
  return `/${routeParts.filter(Boolean).join("/")}`.replace(/\/$/, "") || "/";
}

function filesystemRoute(relative) {
  const parts = relative.split("/");
  const file = parts.at(-1) || "";
  const stem = file.replace(/\.[^.]+$/, "");
  const appIndex = parts.lastIndexOf("app");
  if (appIndex >= 0 && ["page", "route"].includes(stem)) {
    const route = normalizeRouteParts(parts.slice(appIndex + 1, -1));
    return { type: stem === "route" ? "api" : "page", route };
  }
  const pagesIndex = parts.lastIndexOf("pages");
  if (pagesIndex >= 0 && !stem.startsWith("_")) {
    const routeParts = [...parts.slice(pagesIndex + 1, -1), ...(stem === "index" ? [] : [stem])];
    const api = routeParts[0] === "api";
    return { type: api ? "api" : "page", route: normalizeRouteParts(routeParts) };
  }
  return null;
}

function extractSymbols(file, base) {
  const results = [];
  const pattern = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of file.source.matchAll(pattern)) {
    results.push({
      type: "symbol",
      source: file.relative,
      target: match[1],
      ...base,
      details: { observationKind: "exported_symbol", line: lineAt(file.source, match.index || 0) },
    });
  }
  return results;
}

function extractRuntimeRoutes(file, base) {
  const results = [];
  const reactRoute = /<Route\b[^>]*\bpath\s*=\s*["']([^"']+)["']/g;
  for (const match of file.source.matchAll(reactRoute)) {
    results.push({
      type: "route",
      source: file.relative,
      target: match[1],
      ...base,
      details: { observationKind: "react_router", line: lineAt(file.source, match.index || 0), featureToken: routeConcept(match[1]) },
    });
  }
  const serverRoute = /\b(?:app|router|server)\.(get|post|put|patch|delete|options|head)\s*\(\s*["']([^"']+)["']/g;
  for (const match of file.source.matchAll(serverRoute)) {
    results.push({
      type: "api",
      source: file.relative,
      target: `${match[1].toUpperCase()} ${match[2]}`,
      ...base,
      details: { observationKind: "http_route", method: match[1].toUpperCase(), route: match[2], line: lineAt(file.source, match.index || 0), featureToken: routeConcept(match[2]) },
    });
  }
  return results;
}

function extractMcpTools(file, base) {
  if (!/(?:^|\/)mcp\.[cm]?[jt]s$/.test(file.relative) && !/(?:export\s+)?const\s+[\w$]*tools[\w$]*\s*=\s*\[/i.test(file.source)) return [];
  const results = [];
  const pattern = /\bname\s*:\s*["']([a-z][a-z0-9_-]+)["']/g;
  for (const match of file.source.matchAll(pattern)) {
    if (!match[1].includes("_")) continue;
    results.push({
      type: "api",
      source: file.relative,
      target: `mcp:${match[1]}`,
      ...base,
      details: { observationKind: "mcp_tool", protocol: "mcp", line: lineAt(file.source, match.index || 0), featureToken: operationConcept(match[1]) },
    });
  }
  return results;
}

function extractTests(file, base) {
  if (!/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file.relative)) return [];
  const results = [{
    type: "test",
    source: file.relative,
    target: file.relative,
    ...base,
    details: { observationKind: "test_file", line: 1 },
  }];
  const pattern = /\b(?:test|it|describe)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  for (const match of file.source.matchAll(pattern)) {
    results.push({
      type: "test",
      source: file.relative,
      target: match[1],
      ...base,
      details: { observationKind: "test_case", line: lineAt(file.source, match.index || 0) },
    });
  }
  return results;
}

function extractDatabase(file, base) {
  const results = [];
  if (file.relative.endsWith(".prisma")) {
    for (const match of file.source.matchAll(/\bmodel\s+([A-Za-z_][\w]*)\s*\{/g)) {
      results.push({ type: "database", source: file.relative, target: match[1], ...base, details: { observationKind: "prisma_model", line: lineAt(file.source, match.index || 0) } });
    }
  }
  if (file.relative.endsWith(".sql")) {
    for (const match of file.source.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([\w.]+)["`]?/gi)) {
      results.push({ type: "database", source: file.relative, target: match[1], ...base, details: { observationKind: "sql_table", line: lineAt(file.source, match.index || 0) } });
    }
  }
  return results;
}

async function projectIdentity(projectRoot) {
  try {
    const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
    return { id: slug(packageJson.name || path.basename(projectRoot)), name: packageJson.name || path.basename(projectRoot), frameworkHints: Object.keys({ ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) }).filter((name) => ["react", "next", "vite", "express", "fastify"].includes(name)) };
  } catch {
    return { id: slug(path.basename(projectRoot)), name: path.basename(projectRoot), frameworkHints: [] };
  }
}

function applyHumanIntent(features, evidence, humanIntent, previousModel, base) {
  for (const [featureId, correction] of Object.entries(humanIntent.featureCorrections || {})) {
    const previous = previousModel?.features?.[featureId];
    const current = features[featureId] || (previous ? { ...previous, productState: "unobserved", groundingRefs: [] } : null);
    if (!current) continue;
    const confirmationId = addEvidence(evidence, {
      type: "human_confirmation",
      source: correction.actor?.id || "human",
      target: featureId,
      ...base,
      certainty: "confirmed",
      details: { observationKind: "human_correction", reason: correction.reason, correctionVersion: correction.version },
    });
    features[featureId] = {
      ...current,
      ...correction.patch,
      id: featureId,
      version: 1 + correction.version,
      groundingRefs: [...new Set([...(current.groundingRefs || []), confirmationId])],
      humanIntent: { corrected: true, reason: correction.reason, actor: correction.actor, version: correction.version },
    };
  }
}

function inferFeatures(evidence, base) {
  const byConcept = new Map();
  for (const item of evidence.values()) {
    const concept = item.details?.featureToken;
    if (!concept || ["api", "route", "unknown", "feature"].includes(concept)) continue;
    if (!byConcept.has(concept)) byConcept.set(concept, []);
    byConcept.get(concept).push(item);
  }
  const features = {};
  for (const [concept, directEvidence] of [...byConcept.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sourceFiles = new Set(directEvidence.map((item) => item.source));
    const technicalRefs = [...evidence.values()]
      .filter((item) => {
        if (!sourceFiles.has(item.source)) return false;
        if (item.type === "file") return true;
        if (!["symbol", "reference", "test", "database"].includes(item.type)) return false;
        return `${item.source} ${item.target} ${item.details?.specifier || ""}`.toLowerCase().includes(concept.replaceAll("-", ""))
          || `${item.source} ${item.target} ${item.details?.specifier || ""}`.toLowerCase().includes(concept.replaceAll("-", "_"));
      })
      .map((item) => item.id);
    const directRefs = directEvidence.map((item) => item.id);
    const featureId = `feature-${normalizedConcept(concept)}`;
    const inferenceId = addEvidence(evidence, {
      type: "semantic_inference",
      source: "product-grounding-v1",
      target: featureId,
      ...base,
      certainty: "possible",
      details: { observationKind: "feature_inference", basedOnEvidenceIds: [...new Set([...directRefs, ...technicalRefs])] },
    });
    features[featureId] = {
      id: featureId,
      entityType: "feature",
      version: 1,
      name: humanize(concept),
      description: `由 ${directEvidence.length} 个可追溯产品信号支撑的能力。`,
      parentFeatureId: null,
      childFeatureIds: [],
      groupId: defaultGroupId(featureId),
      productState: "observed",
      groundingRefs: [...new Set([...directRefs, ...technicalRefs, inferenceId])],
      humanIntent: null,
      actionability: "grounded",
      hidden: false,
      updatedAt: base.observedAt,
    };
  }
  return features;
}

function buildProductHierarchy(features, evidence, previousHierarchy, base) {
  const groups = {};
  for (const definition of PRODUCT_GROUPS) {
    const previous = previousHierarchy?.groups?.[definition.id];
    groups[definition.id] = {
      id: definition.id,
      entityType: "product-group",
      level: 1,
      parentGroupId: null,
      version: previous?.version || 1,
      name: previous?.name || definition.name,
      description: previous?.description || definition.description,
      featureIds: [],
      inferenceRefs: [],
      humanIntent: previous?.humanIntent || null,
    };
  }
  for (const feature of Object.values(features)) {
    const groupId = feature.groupId || defaultGroupId(feature.id);
    if (!groups[groupId]) {
      groups[groupId] = {
        id: groupId,
        entityType: "product-group",
        level: 1,
        parentGroupId: null,
        version: previousHierarchy?.groups?.[groupId]?.version || 1,
        name: previousHierarchy?.groups?.[groupId]?.name || "自定义产品分组",
        description: previousHierarchy?.groups?.[groupId]?.description || "由人工意图创建的产品分组。",
        featureIds: [],
        inferenceRefs: [],
        humanIntent: previousHierarchy?.groups?.[groupId]?.humanIntent || null,
      };
    }
    feature.groupId = groupId;
    feature.level = 2;
    groups[groupId].featureIds.push(feature.id);
  }
  for (const feature of Object.values(features)) feature.childFeatureIds = [];
  for (const feature of Object.values(features)) {
    if (feature.parentFeatureId && features[feature.parentFeatureId]) features[feature.parentFeatureId].childFeatureIds.push(feature.id);
  }
  for (const group of Object.values(groups)) {
    group.featureIds.sort();
    if (!group.featureIds.length) continue;
    const inferenceId = addEvidence(evidence, {
      type: "semantic_inference",
      source: "product-hierarchy-v1",
      target: `group:${group.id}`,
      ...base,
      certainty: "possible",
      details: { observationKind: "product_grouping", basedOnFeatureIds: [...group.featureIds] },
    });
    group.inferenceRefs = [inferenceId];
  }
  return {
    version: Number(previousHierarchy?.version || 0) + 1,
    levels: 2,
    roots: Object.values(groups).filter((group) => group.featureIds.length).map((group) => group.id),
    groups,
  };
}

export async function observeProductGrounding(projectRoot, options = {}) {
  const observedAt = options.now || new Date().toISOString();
  const scanned = await scanProjectSources(projectRoot, { maxFiles: options.maxFiles || 1_000, extensions: OBSERVATION_EXTENSIONS });
  const repoSnapshot = await captureRepoSnapshot(projectRoot, scanned.files, observedAt);
  const base = { repoRevision: repoSnapshot.headRevision, repoSnapshotId: repoSnapshot.workingTreeFingerprint, observedAt };
  const evidence = new Map();

  for (const file of scanned.files) {
    addEvidence(evidence, { type: "file", source: file.relative, target: file.relative, ...base, certainty: "confirmed", details: { observationKind: "source_file", sourceHash: file.sourceHash, line: 1 } });
    for (const dependency of file.imports) {
      if (!dependency.target) continue;
      addEvidence(evidence, { type: "reference", source: file.relative, target: dependency.target, ...base, certainty: "confirmed", details: { observationKind: "import", specifier: dependency.specifier, line: dependency.line } });
    }
    const route = filesystemRoute(file.relative);
    if (route) addEvidence(evidence, { type: route.type, source: file.relative, target: route.route, ...base, certainty: "confirmed", details: { observationKind: "filesystem_route", route: route.route, line: 1, featureToken: routeConcept(route.route) } });
    for (const item of [...extractSymbols(file, base), ...extractRuntimeRoutes(file, base), ...extractMcpTools(file, base), ...extractTests(file, base), ...extractDatabase(file, base)]) addEvidence(evidence, item);
  }

  return { scanned, repoSnapshot, repoRevision: repoSnapshot.headRevision, observedAt, evidence };
}

export async function readProductGrounding(projectRoot, options = {}) {
  try {
    const model = JSON.parse(await readFile(productModelPath(projectRoot), "utf8"));
    if (model.schemaVersion !== MODEL_SCHEMA_VERSION) throw new ValidationError(`Unsupported ProductModel schema: ${model.schemaVersion}`);
    const evidenceFiles = Object.values(model.evidence || {})
      .filter((item) => item.type === "file" && item.source)
      .map((item) => ({ relative: item.source, sourceHash: item.details?.sourceHash || "" }));
    const snapshot = options.refreshSnapshot === false
      ? normalizeRepoSnapshot(model)
      : await captureRepoSnapshot(projectRoot, evidenceFiles, new Date().toISOString());
    return formalizeProjectModel(model, snapshot);
  } catch (error) {
    if (error?.code === "ENOENT" && options.optional) return null;
    if (error?.code === "ENOENT") throw new NotFoundError("Product grounding has not been scanned yet.", { projectRoot: path.resolve(projectRoot) });
    throw error;
  }
}

async function writeProductGrounding(projectRoot, model) {
  const target = productModelPath(projectRoot);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(model, null, 2)}\n`, "utf8");
  await rename(temporary, target);
  return target;
}

export async function scanProductGrounding(projectRoot, options = {}) {
  const previous = await readProductGrounding(projectRoot, { optional: true });
  const observation = await observeProductGrounding(projectRoot, options);
  const identity = await projectIdentity(projectRoot);
  const base = { repoRevision: observation.repoRevision, repoSnapshotId: observation.repoSnapshot.workingTreeFingerprint, observedAt: observation.observedAt };
  const evidence = new Map(observation.evidence);
  const features = inferFeatures(evidence, base);
  const humanIntent = previous?.humanIntent || { featureCorrections: {} };
  applyHumanIntent(features, evidence, humanIntent, previous, base);
  const productHierarchy = buildProductHierarchy(features, evidence, previous?.productHierarchy, base);
  const rawModel = {
    schemaVersion: MODEL_SCHEMA_VERSION,
    modelType: "ProjectModel",
    projectModelVersion: 1,
    version: Number(previous?.version || 0) + 1,
    project: { ...identity, root: "." },
    repoRevision: observation.repoRevision,
    repoSnapshot: observation.repoSnapshot,
    observedAt: observation.observedAt,
    createdAt: previous?.createdAt || observation.observedAt,
    updatedAt: observation.observedAt,
    stats: {
      scannedFiles: observation.scanned.files.length,
      resolvedReferences: [...evidence.values()].filter((item) => item.type === "reference").length,
      features: Object.keys(features).length,
      evidence: evidence.size,
      confirmedEvidence: [...evidence.values()].filter((item) => item.certainty === "confirmed").length,
      possibleEvidence: [...evidence.values()].filter((item) => item.certainty === "possible").length,
    },
    features,
    evidence: Object.fromEntries([...evidence.entries()].sort(([a], [b]) => a.localeCompare(b))),
    humanIntent,
    productHierarchy,
    visualLayout: previous?.visualLayout || {},
  };
  const model = formalizeProjectModel(rawModel, observation.repoSnapshot);
  const file = options.persist === false ? null : await writeProductGrounding(projectRoot, model);
  return { model, path: file };
}

export async function correctProductFeature(projectRoot, input = {}) {
  const model = await readProductGrounding(projectRoot);
  const featureId = String(input.featureId || input.feature_id || "");
  const feature = model.features[featureId];
  if (!feature) throw new NotFoundError(`Feature not found: ${featureId}`, { featureId });
  const expectedVersion = Number(input.expectedVersion ?? input.expected_version);
  if (expectedVersion !== feature.version) throw new ConflictError("Feature version is stale.", { featureId, expectedVersion, actualVersion: feature.version });
  const patch = Object.fromEntries(Object.entries(input.patch || {}).filter(([key]) => ALLOWED_CORRECTION_FIELDS.has(key)));
  if (patch.actionability) patch.actionability = normalizeFeatureActionability(patch.actionability);
  if (!Object.keys(patch).length) throw new ValidationError("At least one supported Feature correction is required.", { featureId });
  if (patch.parentFeatureId && !model.features[patch.parentFeatureId]) throw new ValidationError("Parent Feature does not exist.", { featureId, parentFeatureId: patch.parentFeatureId });
  if (patch.groupId && !model.productHierarchy?.groups?.[patch.groupId]) throw new ValidationError("Product group does not exist.", { featureId, groupId: patch.groupId });
  const now = input.now || new Date().toISOString();
  const current = model.humanIntent?.featureCorrections?.[featureId];
  const correction = {
    version: Number(current?.version || 0) + 1,
    patch: { ...(current?.patch || {}), ...patch },
    reason: String(input.reason || current?.reason || "Human correction"),
    actor: input.actor && typeof input.actor === "object" ? input.actor : { id: "human", displayName: "用户", client: "human" },
    correctedAt: now,
  };
  model.humanIntent ||= { featureCorrections: {} };
  model.humanIntent.featureCorrections ||= {};
  model.humanIntent.featureCorrections[featureId] = correction;
  const confirmationId = addEvidence(new Map(Object.entries(model.evidence)), {
    type: "human_confirmation",
    source: correction.actor.id || "human",
    target: featureId,
    repoRevision: model.repoRevision,
    observedAt: now,
    certainty: "confirmed",
    details: { observationKind: "human_correction", reason: correction.reason, correctionVersion: correction.version },
  });
  const confirmation = {
    id: confirmationId,
    type: "human_confirmation",
    source: correction.actor.id || "human",
    target: featureId,
    repoRevision: model.repoSnapshot?.headRevision || model.repoRevision,
    repoSnapshotId: model.repoSnapshot?.workingTreeFingerprint || null,
    observedAt: now,
    certainty: "confirmed",
    details: { observationKind: "human_correction", reason: correction.reason, correctionVersion: correction.version },
  };
  model.evidence[confirmationId] = confirmation;
  model.features[featureId] = {
    ...feature,
    ...correction.patch,
    id: featureId,
    version: feature.version + 1,
    groundingRefs: [...new Set([...(feature.groundingRefs || []), confirmationId])],
    humanIntent: { corrected: true, reason: correction.reason, actor: correction.actor, version: correction.version },
    updatedAt: now,
  };
  const evidence = new Map(Object.entries(model.evidence));
  model.productHierarchy = buildProductHierarchy(model.features, evidence, model.productHierarchy, { repoRevision: model.repoRevision, observedAt: now });
  model.evidence = Object.fromEntries([...evidence.entries()].map(([id, item]) => [id, normalizeEvidenceRecord(item, model.repoSnapshot)]).sort(([a], [b]) => a.localeCompare(b)));
  model.version += 1;
  model.updatedAt = now;
  model.stats.evidence = Object.keys(model.evidence).length;
  model.stats.confirmedEvidence = Object.values(model.evidence).filter((item) => item.certainty === "confirmed").length;
  const formalized = formalizeProjectModel(model, model.repoSnapshot);
  const file = await writeProductGrounding(projectRoot, formalized);
  return { model: formalized, feature: formalized.features[featureId], correction, path: file };
}

export function summarizeProductMap(model) {
  if (model.productMapProjection) return model.productMapProjection;
  return {
    project: model.project,
    repoRevision: model.repoRevision,
    modelVersion: model.version,
    features: Object.values(model.features).filter((feature) => !feature.hidden).map((feature) => ({
      id: feature.id,
      name: feature.name,
      description: feature.description,
      level: feature.level || 2,
      groupId: feature.groupId || null,
      parentFeatureId: feature.parentFeatureId || null,
      childFeatureIds: feature.childFeatureIds || [],
      productState: feature.productState,
      actionability: feature.actionability,
      certainty: feature.groundingRefs.some((id) => model.evidence[id]?.type === "human_confirmation") ? "confirmed" : "possible",
      groundingRefs: feature.groundingRefs,
    })),
    hierarchy: {
      levels: model.productHierarchy?.levels || 2,
      roots: (model.productHierarchy?.roots || []).filter((id) => model.productHierarchy?.groups?.[id]?.featureIds?.length),
      groups: Object.values(model.productHierarchy?.groups || {})
        .filter((group) => group.featureIds?.length)
        .map((group) => ({
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
    stats: model.stats,
  };
}
