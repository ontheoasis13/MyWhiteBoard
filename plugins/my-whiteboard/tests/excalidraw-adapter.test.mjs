import test from "node:test";
import assert from "node:assert/strict";
import { excalidrawSceneToSemanticChanges, excalidrawSceneToSemanticChangesSince, semanticBoardToExcalidrawSkeletons } from "../adapters/excalidraw-adapter.mjs";

function board() {
  return {
    id: "architecture",
    title: "Architecture",
    version: 1,
    order: ["api", "db", "api-db"],
    elements: {
      api: { id: "api", kind: "node", semanticType: "service", label: "API", version: 1, properties: {}, layout: { x: 80, y: 80, width: 220, height: 110 } },
      db: { id: "db", kind: "node", semanticType: "database", label: "Database", version: 1, properties: {}, layout: { x: 420, y: 80, width: 220, height: 110 } },
      "api-db": { id: "api-db", kind: "edge", semanticType: "dependency", label: "reads", version: 1, properties: { sourceId: "api", targetId: "db", points: [[0, 0], [120, 0]] }, layout: { x: 300, y: 130, width: 120, height: 1 } },
    },
  };
}

test("projects Semantic Board State into Excalidraw skeletons", () => {
  const skeletons = semanticBoardToExcalidrawSkeletons(board());
  assert.equal(skeletons.length, 3);
  assert.equal(skeletons[0].id, "api");
  assert.equal(skeletons[0].customData.myWhiteboard.version, 1);
  assert.equal(skeletons[1].type, "ellipse");
  assert.deepEqual(skeletons[2].start, { id: "api" });
  assert.deepEqual(skeletons[2].end, { id: "db" });
});

test("converts user geometry and labels into versioned semantic changes", () => {
  const current = board();
  const scene = [
    { id: "api", type: "rectangle", x: 100, y: 90, width: 220, height: 110, angle: 0, locked: false, strokeColor: "#475569", backgroundColor: "#ffffff", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], customData: { myWhiteboard: { elementId: "api" } } },
    { id: "api-label", type: "text", containerId: "api", text: "Gateway" },
    { id: "db", type: "ellipse", x: 420, y: 80, width: 220, height: 110, angle: 0, locked: false, strokeColor: "#475569", backgroundColor: "#ffffff", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], customData: { myWhiteboard: { elementId: "db" } } },
    { id: "api-db", type: "arrow", x: 300, y: 130, width: 120, height: 1, angle: 0, locked: false, points: [[0, 0], [120, 0]], startBinding: { elementId: "api" }, endBinding: { elementId: "db" }, strokeColor: "#475569", backgroundColor: "#ffffff", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], customData: { myWhiteboard: { elementId: "api-db" } } },
    { id: "new-note", type: "rectangle", x: 100, y: 300, width: 200, height: 90, angle: 0, locked: false, strokeColor: "#475569", backgroundColor: "#fff7cc", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [] },
    { id: "new-note-label", type: "text", containerId: "new-note", text: "Review" },
  ];
  const result = excalidrawSceneToSemanticChanges(current, scene);
  const api = result.changes.find((change) => change.id === "api");
  const created = result.changes.find((change) => change.op === "create");
  assert.equal(api.op, "update");
  assert.equal(api.expectedVersion, 1);
  assert.equal(api.patch.label, "Gateway");
  assert.equal(api.patch.layout.x, 100);
  assert.equal(created.element.id, "new-note");
  assert.equal(created.element.label, "Review");
});

test("unsupported Excalidraw features remain session-only", () => {
  const result = excalidrawSceneToSemanticChanges({ ...board(), elements: {}, order: [] }, [{ id: "free", type: "freedraw", isDeleted: false }]);
  assert.equal(result.changes.length, 0);
  assert.equal(result.ignored[0].reason, "unsupported-semantic-kind");
});

test("filters hydration normalization and persists only intentional semantic changes", () => {
  const current = board();
  const hydrated = [
    { id: "api", type: "rectangle", x: 80, y: 80, width: 220, height: 118, angle: 0, locked: false, strokeColor: "#475569", backgroundColor: "#ffffff", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], customData: { myWhiteboard: { elementId: "api" } } },
    { id: "api-label", type: "text", containerId: "api", text: "A\nPI", originalText: "API" },
    { id: "db", type: "ellipse", x: 420, y: 80, width: 220, height: 110, angle: 0, locked: false, strokeColor: "#475569", backgroundColor: "#ffffff", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], customData: { myWhiteboard: { elementId: "db" } } },
    { id: "db-label", type: "text", containerId: "db", text: "Data\nbase", originalText: "Database" },
    { id: "api-db", type: "arrow", x: 300, y: 130, width: 120, height: 1, angle: 0, locked: false, points: [[0, 0], [120, 0]], startBinding: { elementId: "api" }, endBinding: { elementId: "db" }, strokeColor: "#475569", backgroundColor: "#ffffff", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], customData: { myWhiteboard: { elementId: "api-db" } } },
  ];
  const unchanged = excalidrawSceneToSemanticChangesSince(current, hydrated, structuredClone(hydrated));
  assert.deepEqual(unchanged.changedIds, []);
  assert.deepEqual(unchanged.changes, []);

  const moved = structuredClone(hydrated);
  moved[0].x = 112;
  const changed = excalidrawSceneToSemanticChangesSince(current, hydrated, moved);
  assert.deepEqual(changed.changedIds, ["api"]);
  assert.equal(changed.changes.length, 1);
  assert.equal(changed.changes[0].id, "api");
  assert.equal(changed.changes[0].patch.layout.x, 112);
  assert.equal(changed.changes[0].patch.label, "API");
});
