import test from "node:test";
import assert from "node:assert/strict";

import {
  runApplyWorkspaceToPoAction,
  runBridgePoToCodeAction,
  runCompileMoAction,
  runCleanupPluralAction,
  runGeneratePoAction,
  runGeneratePotAction,
  runLoadPoAction,
  runRegeneratePoAction,
  runSaveAllPoAction,
  runSavePoAction,
  runBridgeInlineAction,
  runExtractPoToWorkspaceAction,
  runPreparePoAction,
} from "../app/renderer/lang-actions.js";

test("runPreparePoAction generates pot and po for each mod and updates tabs", async () => {
  const calls = [];
  const tabs = [];
  const statuses = [];

  await runPreparePoAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    runMods: [{ path: "mod-a", name: "A" }],
    translator: {
      langGeneratePot: async (cfg) => { calls.push(["pot", cfg.modDir]); },
      langGeneratePo: async (cfg) => { calls.push(["po", cfg.modDir]); },
      langReadPo: async (cfg) => `content:${cfg.modDir}`,
    },
    resolveCfgForMod: (cfg, modPath) => ({ ...cfg, modDir: modPath }),
    upsertPoTab: (...args) => tabs.push(args),
    renderPoTabs: () => calls.push(["render"]),
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.name ?? ""}`,
  });

  assert.deepEqual(calls, [["pot", "mod-a"], ["po", "mod-a"], ["render"]]);
  assert.deepEqual(tabs, [["mod-a", "zh_CN", "A", "content:mod-a", false]]);
  assert.equal(statuses.at(-1), "langReadyDone:");
});

test("runBridgeInlineAction reports per-mod failures and summary", async () => {
  const statuses = [];
  const tabs = [];
  let busy = false;

  await runBridgeInlineAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    translatedRoot: "E:\\translated",
    bridgeOptions: { conflictStrategy: "skip", arrayMatchById: false },
    runMods: [{ path: "mod-a", name: "A" }, { path: "mod-b", name: "B" }],
    translator: {
      langBridgeInlineToLang: async (cfg) => {
        if (cfg.modDir === "mod-b") throw new Error("boom");
        return {
          poPath: "a.po",
          moPath: "a.mo",
          logPath: "log.txt",
          conflictStrategy: "skip",
          totalPairs: 1,
          conflictCount: 0,
          conflictResolvedCount: 0,
          conflictSkippedCount: 0,
          filledCount: 2,
          filledMsgstrCount: 1,
          filledPluralCount: 1,
          skippedCount: 0,
        };
      },
      langReadPo: async () => "po content",
    },
    resolveCfgForMod: (cfg, modPath) => ({ ...cfg, modDir: modPath }),
    pathBaseName: (path) => path,
    upsertPoTab: (...args) => tabs.push(args),
    renderPoTabs: () => statuses.push("renderPoTabs"),
    setBusy: (value) => { busy = value; },
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.name ?? vars?.success ?? vars?.failed ?? ""}`,
  });

  assert.equal(busy, false);
  assert.equal(tabs.length, 1);
  assert.ok(statuses.some((item) => item.startsWith("bridgeInlineModFailed:B")));
  assert.ok(statuses.some((item) => item.startsWith("bridgeInlineBatchSummary:1")));
});

test("runExtractPoToWorkspaceAction clears and rebuilds workspace from po segments", async () => {
  const events = [];
  const rows = [];

  await runExtractPoToWorkspaceAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    runMods: [{ path: "mod-a", name: "A" }],
    translator: {
      langExtractPoSegments: async () => [
        { id: "s:0", file: "po", path: ["po"], source: "hello", placeholders: [] },
      ],
    },
    resolveCfgForMod: (cfg, modPath) => ({ ...cfg, modDir: modPath }),
    makeContextKey: (modPath, language) => `${modPath}@@${language}`,
    clearWorkspace: () => events.push("clear"),
    onSegment: (segment, contextKey, mod, language, index) => {
      rows.push({ segment, contextKey, mod, language, index });
    },
    rebuildWorkspaceIndexes: () => events.push("rebuild"),
    renderSegments: (resetScroll) => events.push(`render:${resetScroll}`),
    setStatus: (message) => events.push(message),
    rt: (key, vars) => `${key}:${vars?.name ?? vars?.count ?? ""}`,
    getSegmentCount: () => rows.length,
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(events.slice(0, 4), ["clear", "usingModRun:A", "rebuild", "render:true"]);
  assert.equal(events.at(-1), "poAiStart:1");
});

test("runGeneratePotAction generates pot and reports output path", async () => {
  const statuses = [];

  await runGeneratePotAction({
    cfg: { langDir: "L", langMode: "cbn", modDir: "mod-a", language: "zh_CN" },
    translator: {
      langGeneratePot: async () => "mod-a/lang/extracted_strings.pot",
    },
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.path ?? ""}`,
  });

  assert.deepEqual(statuses, ["langPotDone:mod-a/lang/extracted_strings.pot"]);
});

test("runGeneratePoAction generates po for each mod and refreshes tabs", async () => {
  const calls = [];
  const tabs = [];
  const statuses = [];

  await runGeneratePoAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    runMods: [{ path: "mod-a", name: "A" }, { path: "mod-b", name: "B" }],
    translator: {
      langGeneratePo: async (cfg) => {
        calls.push(["po", cfg.modDir]);
        return `${cfg.modDir}/lang.po`;
      },
      langReadPo: async (cfg) => `content:${cfg.modDir}`,
    },
    resolveCfgForMod: (cfg, modPath) => ({ ...cfg, modDir: modPath }),
    upsertPoTab: (...args) => tabs.push(args),
    renderPoTabs: () => calls.push(["render"]),
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.path ?? ""}`,
  });

  assert.deepEqual(calls, [["po", "mod-a"], ["po", "mod-b"], ["render"]]);
  assert.deepEqual(tabs, [
    ["mod-a", "zh_CN", "A", "content:mod-a", false],
    ["mod-b", "zh_CN", "B", "content:mod-b", false],
  ]);
  assert.deepEqual(statuses, ["langPoDone:mod-a/lang.po", "langPoDone:mod-b/lang.po"]);
});

test("runRegeneratePoAction only rewrites confirmed mods", async () => {
  const calls = [];
  const tabs = [];
  const statuses = [];

  await runRegeneratePoAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    runMods: [{ path: "mod-a", name: "A" }, { path: "mod-b", name: "B" }],
    translator: {
      langRegeneratePo: async (cfg) => {
        calls.push(["rewrite", cfg.modDir]);
        return `${cfg.modDir}/rewrite.po`;
      },
      langReadPo: async (cfg) => `content:${cfg.modDir}`,
    },
    resolveCfgForMod: (cfg, modPath) => ({ ...cfg, modDir: modPath }),
    confirmRewrite: (message) => {
      calls.push(["confirm", message]);
      return message.includes("A");
    },
    upsertPoTab: (...args) => tabs.push(args),
    renderPoTabs: () => calls.push(["render"]),
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.name ?? vars?.path ?? vars?.language ?? ""}`,
  });

  assert.deepEqual(calls, [
    ["confirm", "langRewriteConfirm:A"],
    ["rewrite", "mod-a"],
    ["confirm", "langRewriteConfirm:B"],
    ["render"],
  ]);
  assert.deepEqual(tabs, [["mod-a", "zh_CN", "A", "content:mod-a", false]]);
  assert.deepEqual(statuses, ["langPoDone:mod-a/rewrite.po"]);
});

test("runLoadPoAction loads po content for each mod and reports follow-up steps", async () => {
  const tabs = [];
  const statuses = [];
  const events = [];

  await runLoadPoAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    runMods: [{ path: "mod-a", name: "A" }],
    translator: {
      langReadPo: async (cfg) => `content:${cfg.modDir}`,
    },
    resolveCfgForMod: (cfg, modPath) => ({ ...cfg, modDir: modPath }),
    upsertPoTab: (...args) => tabs.push(args),
    renderPoTabs: () => events.push("render"),
    setStatus: (message) => statuses.push(message),
    rt: (key) => key,
  });

  assert.deepEqual(tabs, [["mod-a", "zh_CN", "A", "content:mod-a", false]]);
  assert.deepEqual(events, ["render"]);
  assert.deepEqual(statuses, ["langPoLoaded", "nextStepAfterLoadPo"]);
});

test("runSavePoAction persists the active tab content and clears its dirty flag", async () => {
  const statuses = [];
  const tabs = [{
    key: "mod-a@@zh_CN",
    modPath: "mod-a",
    language: "zh_CN",
    name: "A",
    content: "updated-content",
    dirty: true,
  }];

  await runSavePoAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    activePoTabKey: "mod-a@@zh_CN",
    poTabs: tabs,
    editorContent: "editor-value",
    persistActivePoTabContent: () => {
      tabs[0].content = "updated-content";
    },
    translator: {
      langWritePo: async (cfg, content) => `${cfg.modDir}:${cfg.language}:${content}`,
    },
    renderPoTabs: () => statuses.push("render"),
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.path ?? ""}`,
  });

  assert.equal(tabs[0].dirty, false);
  assert.deepEqual(statuses, [
    "render",
    "langPoSaved:mod-a:zh_CN:updated-content",
    "nextStepAfterSavePo:",
  ]);
});

test("runSavePoAction falls back to base config when no tab is active", async () => {
  const statuses = [];

  await runSavePoAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    activePoTabKey: "",
    poTabs: [],
    editorContent: "editor-value",
    persistActivePoTabContent: () => {
      throw new Error("should not persist");
    },
    translator: {
      langWritePo: async (cfg, content) => `${cfg.modDir}:${cfg.language}:${content}`,
    },
    renderPoTabs: () => statuses.push("render"),
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.path ?? ""}`,
  });

  assert.deepEqual(statuses, [
    "langPoSaved:base:zh_CN:editor-value",
    "nextStepAfterSavePo:",
  ]);
});

test("runSaveAllPoAction writes every dirty tab and reports the saved count", async () => {
  const statuses = [];
  const writes = [];
  const tabs = [
    {
      key: "mod-a@@zh_CN",
      modPath: "mod-a",
      language: "zh_CN",
      name: "A",
      content: "a-content",
      dirty: true,
    },
    {
      key: "mod-b@@zh_TW",
      modPath: "mod-b",
      language: "zh_TW",
      name: "B",
      content: "b-content",
      dirty: false,
    },
    {
      key: "mod-c@@ja",
      modPath: "mod-c",
      language: "ja",
      name: "C",
      content: "c-content",
      dirty: true,
    },
  ];

  await runSaveAllPoAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    poTabs: tabs,
    persistActivePoTabContent: () => {},
    translator: {
      langWritePo: async (cfg, content) => {
        writes.push([cfg.modDir, cfg.language, content]);
      },
    },
    renderPoTabs: () => statuses.push("render"),
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.count ?? ""}`,
  });

  assert.deepEqual(writes, [
    ["mod-a", "zh_CN", "a-content"],
    ["mod-c", "ja", "c-content"],
  ]);
  assert.equal(tabs[0].dirty, false);
  assert.equal(tabs[2].dirty, false);
  assert.deepEqual(statuses, [
    "render",
    "saveAllPoDone:2",
    "nextStepAfterSavePo:",
  ]);
});

test("runSaveAllPoAction reports when there is nothing to save", async () => {
  const statuses = [];

  await runSaveAllPoAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    poTabs: [{
      key: "mod-a@@zh_CN",
      modPath: "mod-a",
      language: "zh_CN",
      name: "A",
      content: "a-content",
      dirty: false,
    }],
    persistActivePoTabContent: () => {},
    translator: {
      langWritePo: async () => {
        throw new Error("should not write");
      },
    },
    renderPoTabs: () => statuses.push("render"),
    setStatus: (message) => statuses.push(message),
    rt: (key) => key,
  });

  assert.deepEqual(statuses, ["saveAllPoNone"]);
});

test("runCleanupPluralAction refreshes tabs only for changed mods and reports total removed", async () => {
  const statuses = [];
  const tabs = [];
  const events = [];
  let busy = false;

  await runCleanupPluralAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    runMods: [{ path: "mod-a", name: "A" }, { path: "mod-b", name: "B" }],
    translator: {
      langCleanupPoPlural: async (cfg) => cfg.modDir === "mod-a" ? 2 : 0,
      langReadPo: async (cfg) => `content:${cfg.modDir}`,
    },
    resolveCfgForMod: (cfg, modPath) => ({ ...cfg, modDir: modPath }),
    upsertPoTab: (...args) => tabs.push(args),
    renderPoTabs: () => events.push("render"),
    setBusy: (value) => { busy = value; },
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.name ?? vars?.count ?? ""}`,
  });

  assert.equal(busy, false);
  assert.deepEqual(tabs, [["mod-a", "zh_CN", "A", "content:mod-a", false]]);
  assert.deepEqual(events, ["render"]);
  assert.deepEqual(statuses, [
    "usingModRun:A",
    "usingModRun:B",
    "cleanupPluralDone:2",
  ]);
});

test("runCleanupPluralAction reports when nothing was removed", async () => {
  const statuses = [];
  let busy = false;

  await runCleanupPluralAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    runMods: [{ path: "mod-a", name: "A" }],
    translator: {
      langCleanupPoPlural: async () => 0,
      langReadPo: async () => {
        throw new Error("should not read");
      },
    },
    resolveCfgForMod: (cfg, modPath) => ({ ...cfg, modDir: modPath }),
    upsertPoTab: () => {
      throw new Error("should not upsert");
    },
    renderPoTabs: () => {},
    setBusy: (value) => { busy = value; },
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.name ?? vars?.count ?? ""}`,
  });

  assert.equal(busy, false);
  assert.deepEqual(statuses, ["usingModRun:A", "cleanupPluralNone:"]);
});

test("runCompileMoAction compiles mo for each mod and reports paths", async () => {
  const statuses = [];

  await runCompileMoAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    runMods: [{ path: "mod-a", name: "A" }, { path: "mod-b", name: "B" }],
    translator: {
      langCompileMo: async (cfg) => `${cfg.modDir}/lang.mo`,
    },
    resolveCfgForMod: (cfg, modPath) => ({ ...cfg, modDir: modPath }),
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.name ?? vars?.path ?? ""}`,
  });

  assert.deepEqual(statuses, [
    "usingModRun:A",
    "langMoDone:mod-a/lang.mo",
    "usingModRun:B",
    "langMoDone:mod-b/lang.mo",
  ]);
});

test("runBridgePoToCodeAction reports per-mod failures and batch summary", async () => {
  const statuses = [];
  let busy = false;

  await runBridgePoToCodeAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    outputRoot: "E:\\output",
    sourceLangCode: "en",
    targetLangCode: "zh_CN",
    runMods: [{ path: "mod-a", name: "A" }, { path: "mod-b", name: "B" }],
    translator: {
      langBridgePoToCode: async (cfg, sourceLang, targetLang, outputDir) => {
        if (cfg.modDir === "mod-b") throw new Error("boom");
        return {
          outputDir,
          replacedTextCount: sourceLang === "en" ? 3 : 0,
          renamedPathCount: targetLang === "zh_CN" ? 1 : 0,
        };
      },
    },
    resolveCfgForMod: (cfg, modPath) => ({ ...cfg, modDir: modPath }),
    pathBaseName: (path) => path,
    setBusy: (value) => { busy = value; },
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.name ?? vars?.success ?? vars?.failed ?? vars?.outDir ?? ""}`,
  });

  assert.equal(busy, false);
  assert.ok(statuses.includes("bridgeStartPoToCode:"));
  assert.ok(statuses.includes("bridgePoToCodeDone:E:\\output\\mod-a"));
  assert.ok(statuses.some((item) => item.startsWith("bridgePoToCodeModFailed:B")));
  assert.ok(statuses.some((item) => item.startsWith("bridgePoToCodeBatchSummary:1")));
});

test("runApplyWorkspaceToPoAction groups workspace items by context and writes back valid targets", async () => {
  const statuses = [];
  const tabs = [];
  const events = [];
  const applyCalls = [];

  await runApplyWorkspaceToPoAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    contexts: [
      ["mod-a@@zh_CN", { modPath: "mod-a", language: "zh_CN", name: "A" }],
      ["mod-b@@ja", { modPath: "mod-b", language: "ja", name: "B" }],
    ],
    translations: [
      { id: "mod-a@@zh_CN::entry-1::0", target: "目标一", valid: true },
      { id: "mod-a@@zh_CN::entry-2::1", target: "   ", valid: true },
      { id: "mod-a@@zh_CN::entry-3::2", target: "忽略", valid: false },
      { id: "mod-b@@ja::entry-9::0", target: "訳文", valid: true },
    ],
    getContextSegmentIds: (contextKey) => {
      if (contextKey === "mod-a@@zh_CN") return ["mod-a@@zh_CN::entry-1::0", "mod-a@@zh_CN::entry-2::1", "mod-a@@zh_CN::entry-3::2"];
      if (contextKey === "mod-b@@ja") return ["mod-b@@ja::entry-9::0"];
      return [];
    },
    translator: {
      langApplyPoTranslations: async (cfg, items) => {
        applyCalls.push([cfg.modDir, cfg.language, items]);
        return items.length;
      },
      langReadPo: async (cfg) => `content:${cfg.modDir}:${cfg.language}`,
    },
    upsertPoTab: (...args) => tabs.push(args),
    renderPoTabs: () => events.push("render"),
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.name ?? vars?.count ?? vars?.apply ?? ""}`,
  });

  assert.deepEqual(applyCalls, [
    ["mod-a", "zh_CN", [{ id: "entry-1", target: "目标一" }]],
    ["mod-b", "ja", [{ id: "entry-9", target: "訳文" }]],
  ]);
  assert.deepEqual(tabs, [
    ["mod-a", "zh_CN", "A", "content:mod-a:zh_CN", false],
    ["mod-b", "ja", "B", "content:mod-b:ja", false],
  ]);
  assert.deepEqual(events, ["render", "render"]);
  assert.ok(statuses.includes("poApplyStats:A"));
  assert.ok(statuses.includes("poApplyStats:B"));
  assert.deepEqual(
    statuses.filter((item) => item.startsWith("poAiApplied:")),
    ["poAiApplied:1", "poAiApplied:1"],
  );
});

test("runApplyWorkspaceToPoAction reports no-applied when a context has no valid targets", async () => {
  const statuses = [];

  await runApplyWorkspaceToPoAction({
    baseCfg: { langDir: "L", langMode: "cbn", modDir: "base", language: "zh_CN" },
    contexts: [["mod-a@@zh_CN", { modPath: "mod-a", language: "zh_CN", name: "A" }]],
    translations: [
      { id: "mod-a@@zh_CN::entry-1::0", target: "", valid: true },
      { id: "mod-a@@zh_CN::entry-2::1", target: "忽略", valid: false },
    ],
    getContextSegmentIds: () => ["mod-a@@zh_CN::entry-1::0", "mod-a@@zh_CN::entry-2::1"],
    translator: {
      langApplyPoTranslations: async () => {
        throw new Error("should not apply");
      },
      langReadPo: async () => {
        throw new Error("should not read");
      },
    },
    upsertPoTab: () => {
      throw new Error("should not upsert");
    },
    renderPoTabs: () => {},
    setStatus: (message) => statuses.push(message),
    rt: (key, vars) => `${key}:${vars?.name ?? vars?.count ?? vars?.apply ?? ""}`,
  });

  assert.deepEqual(statuses, ["poApplyStats:A", "poAiNoApplied:"]);
});
