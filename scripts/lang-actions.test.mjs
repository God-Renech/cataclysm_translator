import test from "node:test";
import assert from "node:assert/strict";

import {
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
