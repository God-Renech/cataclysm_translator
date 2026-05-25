import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  buildSitePackageEntries,
  collectRuntimePlanFromContext,
  normalizeRelativePath,
} from "./prepare-runtime-python.mjs";

test("normalizeRelativePath normalizes path separators and casing", () => {
  assert.equal(normalizeRelativePath("Lib\\site-packages\\polib.py"), "Lib/site-packages/polib.py");
  assert.equal(normalizeRelativePath("LIB/site-packages/../site-packages/polib.py"), "LIB/site-packages/polib.py");
});

test("collectRuntimePlan keeps only required python distributions and prunes junk", () => {
  const root = mkdtempSync(join(tmpdir(), "python-runtime-test-"));
  const baseRoot = join(root, "base");
  const venvRoot = join(root, "venv");
  const purelib = join(venvRoot, "Lib", "site-packages");
  const stdlib = join(baseRoot, "Lib");
  const dlls = join(baseRoot, "DLLs");

  mkdirSync(purelib, { recursive: true });
  mkdirSync(stdlib, { recursive: true });
  mkdirSync(dlls, { recursive: true });
  mkdirSync(join(venvRoot, "Scripts"), { recursive: true });
  mkdirSync(join(stdlib, "json"), { recursive: true });
  mkdirSync(join(purelib, "polib-1.2.0.dist-info"), { recursive: true });
  mkdirSync(join(purelib, "luaparser"), { recursive: true });
  mkdirSync(join(purelib, "luaparser", "__pycache__"), { recursive: true });
  mkdirSync(join(purelib, "luaparser", "tests"), { recursive: true });
  mkdirSync(join(purelib, "luaparser-4.0.0.dist-info"), { recursive: true });
  mkdirSync(join(purelib, "antlr4"), { recursive: true });
  mkdirSync(join(purelib, "antlr4-python3-runtime-4.13.2.dist-info"), { recursive: true });
  mkdirSync(join(purelib, "multimethod"), { recursive: true });
  mkdirSync(join(purelib, "multimethod-2.0.2.dist-info"), { recursive: true });
  mkdirSync(join(purelib, "pip"), { recursive: true });
  mkdirSync(join(purelib, "setuptools"), { recursive: true });
  writeFileSync(join(baseRoot, "python.exe"), "");
  writeFileSync(join(baseRoot, "python312.dll"), "");
  writeFileSync(join(baseRoot, "python3.dll"), "");
  writeFileSync(join(baseRoot, "vcruntime140.dll"), "");
  writeFileSync(join(baseRoot, "vcruntime140_1.dll"), "");
  writeFileSync(join(stdlib, "abc.py"), "");
  writeFileSync(join(stdlib, "json", "__init__.py"), "");
  writeFileSync(join(dlls, "_socket.pyd"), "");

  writeFileSync(join(purelib, "polib.py"), "");
  writeFileSync(join(purelib, "polib-1.2.0.dist-info", "METADATA"), "");
  writeFileSync(join(purelib, "luaparser", "__init__.py"), "");
  writeFileSync(join(purelib, "luaparser", "builder.py"), "");
  writeFileSync(join(purelib, "luaparser", "__pycache__", "builder.cpython-312.pyc"), "");
  writeFileSync(join(purelib, "luaparser", "tests", "test_parser.py"), "");
  writeFileSync(join(purelib, "luaparser-4.0.0.dist-info", "METADATA"), "");
  writeFileSync(join(purelib, "antlr4", "Parser.py"), "");
  writeFileSync(join(purelib, "antlr4-python3-runtime-4.13.2.dist-info", "METADATA"), "");
  writeFileSync(join(purelib, "multimethod", "__init__.py"), "");
  writeFileSync(join(purelib, "multimethod-2.0.2.dist-info", "METADATA"), "");
  writeFileSync(join(purelib, "pip", "__init__.py"), "");
  writeFileSync(join(purelib, "setuptools", "__init__.py"), "");

  const context = {
    executable: join(venvRoot, "Scripts", "python.exe"),
    base_executable: join(baseRoot, "python.exe"),
    purelib,
    stdlib,
  };
  const distributions = [
    {
      name: "polib",
      files: ["polib.py", "polib-1.2.0.dist-info/METADATA"],
      requires: [],
    },
    {
      name: "luaparser",
      files: [
        "luaparser/__init__.py",
        "luaparser/builder.py",
        "luaparser/__pycache__/builder.cpython-312.pyc",
        "luaparser/tests/test_parser.py",
        "luaparser-4.0.0.dist-info/METADATA",
      ],
      requires: ["antlr4-python3-runtime==4.13.2", "multimethod"],
    },
    {
      name: "antlr4-python3-runtime",
      files: ["antlr4/Parser.py", "antlr4-python3-runtime-4.13.2.dist-info/METADATA"],
      requires: [],
    },
    {
      name: "multimethod",
      files: ["multimethod/__init__.py", "multimethod-2.0.2.dist-info/METADATA"],
      requires: [],
    },
  ];
  const plan = collectRuntimePlanFromContext(context, distributions);

  assert.ok(
    plan.coreFiles.some((file) => file.relativeTargetPath === "python.exe"),
    "python.exe should be included in the runtime plan"
  );

  const includedDistributions = new Set(plan.sitePackagesEntries.map((entry) => entry.distributionName));
  assert.deepEqual(
    [...includedDistributions].sort(),
    ["antlr4-python3-runtime", "luaparser", "multimethod", "polib"]
  );

  const normalizedTargets = plan.sitePackagesEntries.map((entry) => normalizeRelativePath(entry.relativeTargetPath));
  assert.ok(normalizedTargets.some((path) => path === "Lib/site-packages/polib.py"));
  assert.ok(normalizedTargets.some((path) => path.startsWith("Lib/site-packages/luaparser/")));
  assert.ok(normalizedTargets.some((path) => path.startsWith("Lib/site-packages/antlr4/")));
  assert.ok(normalizedTargets.some((path) => path.startsWith("Lib/site-packages/multimethod/")));

  assert.ok(
    normalizedTargets.every((path) => !path.includes("/tests/")),
    "test directories should be excluded from the bundled runtime"
  );
  assert.ok(
    normalizedTargets.every((path) => !path.includes("/__pycache__/") && !path.endsWith(".pyc")),
    "bytecode caches should be excluded from the bundled runtime"
  );
  assert.ok(
    normalizedTargets.every(
      (path) =>
        !path.startsWith("Lib/site-packages/pip/") &&
        !path.startsWith("Lib/site-packages/setuptools/") &&
        !path.startsWith("Lib/site-packages/wheel/")
    ),
    "packaging tools should not be bundled"
  );
});
