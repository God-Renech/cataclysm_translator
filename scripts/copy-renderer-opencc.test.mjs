import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("copy-renderer declares local opencc runtime bundling", () => {
  const scriptPath = join(process.cwd(), "scripts", "copy-renderer.mjs");
  const source = readFileSync(scriptPath, "utf8");

  assert.match(source, /node_modules', 'opencc-js', 'dist', 'umd', 'full\.js'/);
  assert.match(source, /opencc-full\.js/);

  const dependencyPath = join(
    process.cwd(),
    "node_modules",
    "opencc-js",
    "dist",
    "umd",
    "full.js"
  );
  assert.equal(existsSync(dependencyPath), true);
});
