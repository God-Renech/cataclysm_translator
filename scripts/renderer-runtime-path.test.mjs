import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";

test("renderer entry only imports sibling modules inside frontendDist", () => {
  const rendererSource = readFileSync(
    join(process.cwd(), "src", "renderer", "renderer.ts"),
    "utf8"
  );

  assert.ok(
    !rendererSource.includes('../lib/virtual-workspace.js'),
    "renderer.ts should not import runtime helpers from outside src/renderer"
  );
});
