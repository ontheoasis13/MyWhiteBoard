import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appPath = path.resolve("apps/workspace/src/App.tsx");
const stylesPath = path.resolve("apps/workspace/src/styles.css");

test("pending proposal uses the Product Main grid column contract", async () => {
  const [app, styles] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);
  assert.match(app, /proposal-card global-proposal/);
  assert.match(styles, /\.global-proposal\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;[^}]*min-width:\s*0;/);
  assert.match(styles, /\.proposal-card > div:first-child\s*\{[^}]*flex:\s*1 1 320px;/);
  assert.match(styles, /\.proposal-actions\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/);
  assert.doesNotMatch(styles, /\.global-proposal\s*\{[^}]*margin:[^;]*270px/);
});
