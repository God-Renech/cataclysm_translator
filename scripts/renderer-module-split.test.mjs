import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const rendererPath = path.join(root, "src", "renderer", "renderer.ts");
const bridgeActionsPath = path.join(root, "src", "renderer", "lang-actions-bridge.ts");
const poActionsPath = path.join(root, "src", "renderer", "lang-actions-po.ts");
const workspaceActionsPath = path.join(root, "src", "renderer", "lang-actions-workspace.ts");

test("renderer imports themed lang action modules instead of a monolithic lang-actions module", () => {
  const renderer = fs.readFileSync(rendererPath, "utf8");
  assert.match(renderer, /from "\.\/lang-actions-bridge\.js"/);
  assert.match(renderer, /from "\.\/lang-actions-po\.js"/);
  assert.match(renderer, /from "\.\/lang-actions-workspace\.js"/);
  assert.doesNotMatch(renderer, /from "\.\/lang-actions\.js"/);
});

test("themed lang action modules exist", () => {
  assert.equal(fs.existsSync(bridgeActionsPath), true);
  assert.equal(fs.existsSync(poActionsPath), true);
  assert.equal(fs.existsSync(workspaceActionsPath), true);
});
