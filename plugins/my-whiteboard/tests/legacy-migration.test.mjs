import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { importLegacyBoards, readWorkspace } from "../core/index.mjs";

test("imports Beta 5 boards without changing the legacy source", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-legacy-"));
  const legacyDirectory = path.join(projectRoot, ".codex", "whiteboards");
  await mkdir(legacyDirectory, { recursive: true });
  const source = path.join(legacyDirectory, "system.whiteboard.json");
  const legacy = {
    schemaVersion: 1,
    id: "system",
    title: "System",
    width: 1200,
    height: 800,
    revision: 7,
    elements: [
      { id: "runtime", type: "rectangle", x: 20, y: 30, width: 220, height: 100, text: "Runtime", code: { file: "src/runtime.ts", symbol: "runAgent", line: 42 }, status: "implementing", riskTags: ["concurrency"], testRefs: ["runtime.test.ts"] },
      { id: "database", type: "ellipse", x: 400, y: 30, width: 180, height: 100, text: "Database" },
      { id: "runtime-db", type: "arrow", sourceId: "runtime", targetId: "database", points: [[0, 0], [160, 0]] },
    ],
  };
  const original = `${JSON.stringify(legacy, null, 2)}\n`;
  await writeFile(source, original, "utf8");
  const first = await importLegacyBoards(projectRoot, { name: "Imported Project" });
  assert.equal(first[0].status, "imported");
  const workspace = await readWorkspace(projectRoot);
  const board = workspace.entities.boards.system;
  assert.equal(board.elements.runtime.semanticType, "code");
  assert.equal(board.elements.runtime.properties.code.symbol, "runAgent");
  assert.equal(board.elements["runtime-db"].kind, "edge");
  assert.equal(await readFile(source, "utf8"), original);
  assert.equal(await readFile(first[0].archivedPath, "utf8"), original);
  const second = await importLegacyBoards(projectRoot);
  assert.equal(second[0].status, "skipped");
  assert.equal((await readWorkspace(projectRoot)).workspaceVersion, workspace.workspaceVersion);
});
