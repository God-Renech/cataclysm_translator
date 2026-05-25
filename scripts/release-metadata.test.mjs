import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readUtf8(relativePath) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

test("renderer metadata version stays aligned with package and tauri versions", () => {
  const packageJson = JSON.parse(readUtf8("package.json"));
  const tauriConfig = JSON.parse(readUtf8("src-tauri/tauri.conf.json"));
  const rendererSource = readUtf8("src/renderer/renderer.ts");
  const versionMatch = rendererSource.match(/version:\s*'([^']+)'/);

  assert.ok(versionMatch, "renderer APP_META.version should be present");
  assert.equal(packageJson.version, tauriConfig.version);
  assert.equal(versionMatch[1], packageJson.version);
});

test("README publishing guidance prefers the EXE release asset", () => {
  const readme = readUtf8("README.md");

  assert.match(readme, /Publish `\.exe`/);
  assert.doesNotMatch(readme, /Publish `\.msi`/);
});
