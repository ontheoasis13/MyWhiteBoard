import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  correctProductFeature,
  revertProductFeatureCorrection,
  scanProductGrounding,
  updateProductLayout,
} from "../core/index.mjs";

const fixture = path.join(import.meta.dirname, "fixtures", "product-grounding-alias-app");

test("Product Map layout is visual-only and Human correction can be explicitly reverted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-whiteboard-layout-"));
  await cp(fixture, root, { recursive: true });
  const scanned = await scanProductGrounding(root, { now: "2026-08-20T05:00:00.000Z" });
  const feature = scanned.model.features["feature-billing"];
  const originalName = feature.name;
  const corrected = await correctProductFeature(root, {
    featureId: feature.id,
    expectedVersion: feature.version,
    patch: { name: "Billing & Accounts" },
    reason: "Product owner wording",
    actor: { id: "human", client: "test" },
    now: "2026-08-20T05:01:00.000Z",
  });

  const laidOut = await updateProductLayout(root, {
    featureId: feature.id,
    layout: { x: 640, y: 180 },
    now: "2026-08-20T05:02:00.000Z",
  });
  assert.deepEqual(laidOut.model.visualLayout[feature.id], { x: 640, y: 180 });
  assert.equal(laidOut.feature.version, corrected.feature.version);

  const reverted = await revertProductFeatureCorrection(root, {
    featureId: feature.id,
    expectedVersion: corrected.feature.version,
    now: "2026-08-20T05:03:00.000Z",
  });
  assert.equal(reverted.feature.name, originalName);
  assert.equal(reverted.model.humanIntent.featureCorrections[feature.id], undefined);
  assert.deepEqual(reverted.model.visualLayout[feature.id], { x: 640, y: 180 });
});
