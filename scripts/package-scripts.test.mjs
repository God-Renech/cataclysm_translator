import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readPackageJson() {
  return JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
}

test("package.json exposes stable test and verify entrypoints", () => {
  const packageJson = readPackageJson();

  assert.equal(typeof packageJson.scripts?.test, "string");
  assert.equal(typeof packageJson.scripts?.verify, "string");
  assert.match(packageJson.scripts.verify, /cargo test/);
});
