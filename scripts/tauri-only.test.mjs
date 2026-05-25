import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("repository no longer keeps Electron entrypoints or dependencies", () => {
  const packageJsonPath = join(process.cwd(), "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  assert.equal("main" in packageJson, false);
  assert.equal("electron" in (packageJson.devDependencies ?? {}), false);
  assert.equal("electron-builder" in (packageJson.devDependencies ?? {}), false);

  assert.equal(existsSync(join(process.cwd(), "src", "main.ts")), false);
  assert.equal(existsSync(join(process.cwd(), "src", "preload.ts")), false);
  assert.equal(existsSync(join(process.cwd(), "app", "main.js")), false);
  assert.equal(existsSync(join(process.cwd(), "app", "preload.js")), false);
});

test("renderer bridge no longer emulates Electron require", () => {
  const bridgePath = join(process.cwd(), "src", "renderer", "tauri-bridge.js");
  const bridgeSource = readFileSync(bridgePath, "utf8");

  assert.doesNotMatch(bridgeSource, /window\.require\s*=/);
  assert.doesNotMatch(bridgeSource, /name === ['"]electron['"]/);
  assert.match(bridgeSource, /window\.translator\s*=/);
});
