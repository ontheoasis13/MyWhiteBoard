import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { scanProjectSources } from "./source-observation.mjs";

const execFileAsync = promisify(execFile);
const VERIFICATION_SCHEMA_VERSION = 1;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function parseEndpoint(value) {
  const match = String(value || "").trim().match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)$/i);
  return match ? { method: match[1].toUpperCase(), route: match[2] } : null;
}

function parseResponse(source) {
  const response = {};
  const object = source.match(/JSON\.stringify\(\s*\{([\s\S]*?)\}\s*\)/);
  const body = object ? object[1] : source;
  for (const key of ["service", "status", "error", "message"]) {
    const match = body.match(new RegExp(`(?:["']?${key}["']?)\\s*:\\s*["']([^"']+)["']`));
    if (match) response[key] = match[1];
  }
  return Object.keys(response).length ? response : null;
}

function extractEndpointsFromSource(source, sourceFile) {
  const endpoints = [];
  const seen = new Set();
  function addEndpoint(method, route, index) {
    const key = `${method} ${route}`;
    if (seen.has(key)) return;
    seen.add(key);
    const window = source.slice(index, index + 2_000);
    const response = parseResponse(window);
    endpoints.push({
      id: `endpoint:${method} ${route}`,
      kind: "http_endpoint",
      method,
      route,
      response,
      source: sourceFile,
      line: lineAt(source, index),
      signature: hash(stable({ method, route, response })),
    });
  }
  const pattern = /\b(?:app|router|server)\.(get|post|put|patch|delete|options|head)\s*\(\s*["']([^"']+)["']/gi;
  for (const match of source.matchAll(pattern)) {
    addEndpoint(match[1].toUpperCase(), match[2], match.index || 0);
  }
  const conditionalPattern = /\b(?:request|req)\.url\s*===\s*["']([^"']+)["'][\s\S]{0,160}?\b(?:request|req)\.method\s*===\s*["'](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["']/gi;
  for (const match of source.matchAll(conditionalPattern)) {
    addEndpoint(match[2].toUpperCase(), match[1], match.index || 0);
  }
  return endpoints;
}

function extractTestEvidence(source, sourceFile) {
  if (!/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(sourceFile)) return null;
  const routes = [...source.matchAll(/\/api\/[A-Za-z0-9_?=:\-\/]+/g)].map((match) => match[0]);
  const tests = [...source.matchAll(/\b(?:test|it|describe)\s*\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]);
  return {
    source: sourceFile,
    hash: hash(source),
    routes: [...new Set(routes)],
    tests,
    hasHttp200Assertion: /response\.status\s*,\s*200|equal\(response\.status,\s*200/.test(source),
    hasJsonAssertion: /deepEqual\(await\s+response\.json\(\)/.test(source),
  };
}

async function gitRevision(projectRoot) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", path.resolve(projectRoot), "rev-parse", "HEAD"], { windowsHide: true });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function gitChangedFiles(projectRoot, baseRevision) {
  if (!baseRevision) return [];
  try {
    const { stdout } = await execFileAsync("git", ["-C", path.resolve(projectRoot), "diff", "--name-only", baseRevision], { windowsHide: true });
    return stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).sort();
  } catch {
    return [];
  }
}

async function gitShow(projectRoot, revision, relativePath) {
  if (!revision || !relativePath) return null;
  try {
    const { stdout } = await execFileAsync("git", ["-C", path.resolve(projectRoot), "show", `${revision}:${relativePath}`], { windowsHide: true, maxBuffer: 2_000_000 });
    return stdout;
  } catch {
    return null;
  }
}

async function readPackage(projectRoot) {
  try {
    const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
    return {
      scripts: packageJson.scripts || {},
      runtimeDependencies: Object.keys(packageJson.dependencies || {}).sort(),
      developmentDependencies: Object.keys(packageJson.devDependencies || {}).sort(),
    };
  } catch {
    return { scripts: {}, runtimeDependencies: [], developmentDependencies: [] };
  }
}

export async function observeProjectState(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const scanned = await scanProjectSources(root, { maxFiles: options.maxFiles || 300 });
  const files = scanned.files.map((file) => ({ relative: file.relative, sourceHash: file.sourceHash, bytes: Buffer.byteLength(file.source, "utf8") }));
  const endpoints = scanned.files.flatMap((file) => extractEndpointsFromSource(file.source, file.relative));
  const tests = scanned.files.map((file) => extractTestEvidence(file.source, file.relative)).filter(Boolean);
  const revision = await gitRevision(root);
  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    repo: {
      root,
      revision,
      changedFiles: await gitChangedFiles(root, options.baseRevision || revision),
      observedAt: options.observedAt || new Date().toISOString(),
    },
    files,
    endpoints,
    tests,
    package: await readPackage(root),
    source: "fresh-repo-observation",
  };
}

function normalizeBehavior(behavior, index) {
  if (typeof behavior === "string") {
    const endpoint = parseEndpoint(behavior);
    return endpoint ? { id: `requested-${index}`, kind: "http_endpoint", ...endpoint } : { id: `requested-${index}`, kind: "product_behavior", title: behavior };
  }
  if (behavior?.route && !behavior.method) {
    const endpoint = parseEndpoint(behavior.route);
    if (endpoint) return { ...behavior, ...endpoint };
  }
  return { id: behavior?.id || `requested-${index}`, kind: behavior?.kind || "product_behavior", ...clone(behavior) };
}

export function desiredStateFromChange(input = {}) {
  const change = input.change || input;
  const contract = change.contract || {};
  const state = change.desiredState || {};
  const route = state.route || contract.route;
  const endpoint = parseEndpoint(route);
  const behaviors = [
    ...(Array.isArray(state.behaviors) ? state.behaviors : []),
    ...(Array.isArray(change.behaviors) ? change.behaviors : []),
    ...(endpoint ? [{ id: `endpoint:${endpoint.method} ${endpoint.route}`, kind: "http_endpoint", ...endpoint, response: state.response || contract.response }] : []),
  ].map(normalizeBehavior);
  const acceptance = [...(change.acceptanceCriteria || []), ...(change.constraints || [])].map(String);
  const protectedBehaviors = [
    ...(Array.isArray(state.protectedBehaviors) ? state.protectedBehaviors : []),
    ...(Array.isArray(change.protectedBehaviors) ? change.protectedBehaviors : []),
  ].map(normalizeBehavior);
  if (acceptance.some((item) => /GET\s+\/api\/status|\/api\/status.*unchanged|status.*unchanged/i.test(item)) && !protectedBehaviors.some((item) => item.route === "/api/status")) {
    protectedBehaviors.push({ id: "protected:GET /api/status", kind: "http_endpoint", method: "GET", route: "/api/status", baseline: true });
  }
  const files = [...new Set([...(contract.files || []), ...(change.files || [])].map(String))].sort();
  const verification = [
    ...(Array.isArray(change.verification) ? change.verification : []),
    ...(acceptance.filter((item) => /\bnpm\s+(?:run\s+)?(?:test|run|build|typecheck)\b/i.test(item)).map((item) => ({ command: item.match(/npm\s+(?:run\s+)?(?:test|build|typecheck)/i)?.[0] || "npm test", required: true }))),
  ];
  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    changeId: change.id || null,
    title: change.title || change.intent || "Desired product change",
    behaviors: [...new Map(behaviors.map((item) => [item.id, item])).values()],
    protectedBehaviors: [...new Map(protectedBehaviors.map((item) => [item.id, item])).values()],
    files,
    noNewRuntimeDependencies: acceptance.some((item) => /no\s+new\s+runtime\s+dependenc|no\s+runtime\s+dep/i.test(item)),
    verification: [...new Map(verification.map((item, index) => [item.command || `verification-${index}`, { id: item.id || `verification-${index}`, command: item.command, required: item.required !== false }])).values()],
  };
}

function endpointMatches(desired, observed) {
  if (!observed || desired.method?.toUpperCase() !== observed.method?.toUpperCase() || desired.route !== observed.route) return false;
  return desired.response === undefined || stable(desired.response || null) === stable(observed.response || null);
}

function endpointFor(observed, behavior) {
  return observed.endpoints.find((item) => item.method === behavior.method && item.route === behavior.route) || null;
}

async function baselineEndpoints(projectRoot, observed, desired, baseRevision) {
  const files = new Set([
    ...observed.endpoints.map((item) => item.source),
    ...desired.protectedBehaviors.map((item) => item.baselineFile).filter(Boolean),
  ]);
  const result = [];
  for (const relative of files) {
    const source = await gitShow(projectRoot, baseRevision, relative);
    if (source) result.push(...extractEndpointsFromSource(source, relative));
  }
  return result;
}

function verificationResult(evidence, command) {
  const item = (evidence || []).find((candidate) => candidate.command === command || candidate.id === command);
  if (!item) return null;
  return { ...item, status: item.status || (item.exitCode === 0 ? "passed" : "failed") };
}

export async function compareDesiredObserved(projectRoot, desiredInput, observed, options = {}) {
  const desired = desiredStateFromChange(desiredInput);
  const actual = observed || await observeProjectState(projectRoot, { baseRevision: options.baseRevision });
  const baseRevision = options.baseRevision || actual.repo.revision;
  const baseline = await baselineEndpoints(projectRoot, actual, desired, baseRevision);
  const diffs = [];
  for (const behavior of desired.behaviors) {
    if (behavior.kind !== "http_endpoint") {
      diffs.push({ id: behavior.id, level: "product", category: "requested", status: "unverified", desired: behavior, observed: null, evidence: [] });
      continue;
    }
    const current = endpointFor(actual, behavior);
    const matches = endpointMatches(behavior, current);
    const wasPresent = endpointFor({ endpoints: baseline }, behavior);
    diffs.push({
      id: behavior.id,
      level: "product",
      category: "requested",
      status: matches ? (wasPresent ? "unchanged" : "added") : "missing",
      desired: { method: behavior.method, route: behavior.route, response: behavior.response || null },
      observed: current,
      evidence: current ? [{ type: "source", source: current.source, line: current.line }] : [],
    });
    const test = actual.tests.find((item) => item.routes.includes(behavior.route));
    diffs.push({
      id: `${behavior.id}:test`,
      level: "product",
      category: "verification",
      status: matches && test && test.hasHttp200Assertion && test.hasJsonAssertion ? "verified" : "missing",
      desired: { testFor: behavior.route },
      observed: test,
      evidence: test ? [{ type: "test", source: test.source }] : [],
    });
  }
  for (const behavior of desired.protectedBehaviors) {
    const current = endpointFor(actual, behavior);
    const before = endpointFor({ endpoints: baseline }, behavior);
    const unchanged = current && before && current.signature === before.signature;
    diffs.push({
      id: behavior.id,
      level: "product",
      category: "protected",
      status: unchanged ? "unchanged" : "unexpected",
      desired: { method: behavior.method, route: behavior.route, response: before?.response || null },
      observed: current,
      evidence: [before && { type: "baseline", source: before.source, line: before.line }, current && { type: "source", source: current.source, line: current.line }].filter(Boolean),
    });
  }
  const changedFiles = actual.repo.changedFiles;
  const unexpectedFiles = desired.files.length ? changedFiles.filter((file) => !desired.files.includes(file)) : [];
  if (unexpectedFiles.length) diffs.push({ id: "scope", level: "product", category: "scope", status: "unexpected", desired: { files: desired.files }, observed: { changedFiles }, evidence: [] });
  if (desired.noNewRuntimeDependencies) {
    const beforePackageSource = await gitShow(projectRoot, baseRevision, "package.json");
    let beforeDependencies = [];
    try { beforeDependencies = Object.keys(JSON.parse(beforePackageSource || "{}").dependencies || {}).sort(); } catch {}
    const added = actual.package.runtimeDependencies.filter((name) => !beforeDependencies.includes(name));
    diffs.push({ id: "runtime-dependencies", level: "product", category: "scope", status: added.length ? "unexpected" : "unchanged", desired: { noNewRuntimeDependencies: true }, observed: { added }, evidence: [{ type: "package", source: "package.json" }] });
  }
  const verificationEvidence = (options.verificationEvidence || []).map((item) => ({ ...item, status: item.status || (item.exitCode === 0 ? "passed" : "failed") }));
  for (const requirement of desired.verification) {
    const evidence = verificationResult(verificationEvidence, requirement.command);
    diffs.push({ id: requirement.id, level: "product", category: "verification", status: evidence?.status === "passed" ? "verified" : "missing", desired: { command: requirement.command }, observed: evidence, evidence: evidence ? [{ type: "command", command: requirement.command, source: evidence.source || "independent-run" }] : [] });
  }
  const missing = diffs.filter((item) => ["missing", "unverified"].includes(item.status));
  const unexpected = diffs.filter((item) => item.status === "unexpected");
  const status = unexpected.length ? "unexpected" : missing.length ? "incomplete" : "pass";
  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    status,
    completion: status === "pass" ? "completed" : "incomplete",
    desired,
    observed: actual,
    semanticDiff: diffs,
    verificationEvidence,
    summary: { requested: desired.behaviors.length, missing: missing.length, unexpected: unexpected.length, verified: diffs.filter((item) => ["added", "unchanged", "verified"].includes(item.status)).length },
    authority: { desired: "approved-change-contract", observed: "fresh-repo-observation", completion: "semantic-diff", executionReportUsed: false },
  };
}
