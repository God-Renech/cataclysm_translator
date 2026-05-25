import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLangWorkflowConfig,
  getModDirsForRun,
  pathBaseName,
  resolveCfgForMod,
} from "../app/renderer/lang-workflow.js";

test("getModDirsForRun prefers selected mods", () => {
  const result = getModDirsForRun(
    [{ path: "E:\\mods\\demo", name: "Demo" }],
    "",
    "E:\\mods",
    "E:\\import"
  );

  assert.deepEqual(result, [{ path: "E:\\mods\\demo", name: "Demo" }]);
});

test("getModDirsForRun falls back through configured directories", () => {
  const result = getModDirsForRun([], "", "E:\\mods", "E:\\import");

  assert.deepEqual(result, [{ path: "E:\\mods", name: "E:\\mods" }]);
});

test("buildLangWorkflowConfig enforces required lang dir by default", () => {
  const result = buildLangWorkflowConfig({
    langDir: "",
    langModeValue: "cbn",
    selectedModPath: "E:\\mods\\demo",
    modRootDir: "",
    importDir: "",
    language: "zh_CN",
    noStrPlNoS: true,
    pythonPath: "",
    gettextPath: "",
  });

  assert.equal(result, null);
});

test("buildLangWorkflowConfig assembles normalized workflow config", () => {
  const result = buildLangWorkflowConfig({
    requireLangDir: false,
    langDir: "",
    langModeValue: "cdda",
    selectedModPath: "E:\\mods\\demo",
    modRootDir: "",
    importDir: "",
    language: "zh_CN",
    noStrPlNoS: true,
    pythonPath: " python ",
    gettextPath: " gettext ",
  });

  assert.deepEqual(result, {
    langDir: "",
    langMode: "cdda",
    modDir: "E:\\mods\\demo",
    language: "zh_CN",
    noStrPlNoS: true,
    pythonPath: "python",
    gettextPath: "gettext",
  });
});

test("resolveCfgForMod replaces only modDir", () => {
  const base = {
    langDir: "E:\\lang",
    langMode: "cbn",
    modDir: "E:\\mods\\old",
    language: "zh_CN",
    noStrPlNoS: true,
  };

  const result = resolveCfgForMod(base, "E:\\mods\\new");

  assert.equal(result.modDir, "E:\\mods\\new");
  assert.equal(result.language, "zh_CN");
  assert.equal(result.langDir, "E:\\lang");
});

test("pathBaseName trims trailing separators", () => {
  assert.equal(pathBaseName("E:\\mods\\demo\\"), "demo");
  assert.equal(pathBaseName("E:/mods/demo/"), "demo");
});
