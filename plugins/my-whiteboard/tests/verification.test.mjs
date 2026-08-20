import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { compareDesiredObserved, observeProjectState } from "../core/index.mjs";

const execFileAsync = promisify(execFile);

async function fixtureProject(currentSource, currentTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-proof-c-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "proof-c-fixture", type: "module", scripts: { test: "node --test test/server.test.js", typecheck: "node --check src/server.js" } }, null, 2));
  await writeFile(path.join(root, "src/server.js"), currentSource);
  await writeFile(path.join(root, "test/server.test.js"), currentTest);
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "baseline"], { cwd: root });
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
  return { root, baseRevision: stdout.trim() };
}

const baseline = `import { createServer as createHttpServer } from "node:http";
export function createServer() { return createHttpServer((request, response) => {
  if (request.url === "/api/status" && request.method === "GET") { response.end(JSON.stringify({ service: "fixture", status: "ok" })); return; }
}); }
`;

const completeSource = `${baseline.replace('status: "ok"', 'status: "ok"')}\nif (false) { /* fixture */ }\n`;
const healthSource = `import { createServer as createHttpServer } from "node:http";
export function createServer() { return createHttpServer((request, response) => {
  if (request.url === "/api/status" && request.method === "GET") { response.end(JSON.stringify({ service: "fixture", status: "ok" })); return; }
  if (request.url === "/api/health" && request.method === "GET") { response.end(JSON.stringify({ service: "fixture", status: "healthy" })); return; }
}); }
`;
const healthTest = `import test from "node:test";
test("health endpoint", async () => { const response = await fetch("/api/health"); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { service: "fixture", status: "healthy" }); });
`;
const statusOnlyTest = `import test from "node:test";
test("status endpoint", async () => { const response = await fetch("/api/status"); assert.equal(response.status, 200); });
`;

test("Proof C Case B marks a missing acceptance condition incomplete", async () => {
  const fixture = await fixtureProject(healthSource, statusOnlyTest);
  const observed = await observeProjectState(fixture.root, { baseRevision: fixture.baseRevision });
  const result = await compareDesiredObserved(fixture.root, {
    id: "case-b-incomplete",
    contract: { files: ["src/server.js", "test/server.test.js"], route: "GET /api/health", response: { service: "fixture", status: "healthy" } },
    acceptanceCriteria: ["GET /api/health returns HTTP 200", "A corresponding health test asserts the response JSON"],
  }, observed, { baseRevision: fixture.baseRevision });
  assert.equal(result.status, "incomplete");
  assert.equal(result.completion, "incomplete");
  assert.ok(result.semanticDiff.some((item) => item.id.endsWith(":test") && item.status === "missing"));
  assert.equal(result.authority.executionReportUsed, false);
});

test("Proof C Case C reports an unexpected protected product change", async () => {
  const fixture = await fixtureProject(baseline, healthTest);
  await writeFile(path.join(fixture.root, "src/server.js"), healthSource.replace('status: "ok"', 'status: "degraded"'));
  const observed = await observeProjectState(fixture.root, { baseRevision: fixture.baseRevision });
  const result = await compareDesiredObserved(fixture.root, {
    id: "case-c-unexpected",
    contract: { files: ["src/server.js", "test/server.test.js"], route: "GET /api/health", response: { service: "fixture", status: "healthy" } },
    acceptanceCriteria: ["GET /api/health returns HTTP 200", "Existing GET /api/status remains unchanged"],
  }, observed, { baseRevision: fixture.baseRevision });
  assert.equal(result.status, "unexpected");
  assert.ok(result.semanticDiff.some((item) => item.category === "protected" && item.status === "unexpected"));
});

test("Proof C Case A observes the real Proof B repository independently", async () => {
  const root = path.resolve(process.cwd(), "..", "..", "..", "proof-b-validation");
  const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"]);
  const baseRevision = stdout.trim();
  const observed = await observeProjectState(root, { baseRevision });
  const result = await compareDesiredObserved(root, {
    id: "change-proof-b-health-endpoint",
    contract: { files: ["src/server.js", "test/server.test.js"], route: "GET /api/health", response: { service: "proof-b-validation", status: "healthy" } },
    acceptanceCriteria: ["GET /api/health returns HTTP 200", "Existing GET /api/status remains unchanged", "npm test passes", "No new runtime dependency is added"],
  }, observed, { baseRevision, verificationEvidence: [{ command: "npm test", status: "passed", source: "independent-test-run" }] });
  assert.equal(result.status, "pass");
  assert.equal(result.authority.observed, "fresh-repo-observation");
  assert.ok(result.semanticDiff.some((item) => item.id === "endpoint:GET /api/health" && item.status === "added"));
  assert.ok(result.semanticDiff.some((item) => item.id === "protected:GET /api/status" && item.status === "unchanged"));
});
