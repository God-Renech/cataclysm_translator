import type { LangWorkflowConfig } from "./lang-workflow.js";

export type ActionMod = {
  path: string;
  name: string;
};

export type ActionPoTab = {
  key: string;
  modPath: string;
  language: string;
  name: string;
  content: string;
  dirty: boolean;
};

export type BridgeInlineOptions = {
  conflictStrategy: "skip" | "frequency" | "frequency2";
  arrayMatchById: boolean;
};

export type Segment = {
  id: string;
  file: string;
  path: string[];
  source: string;
  placeholders: string[];
};

export type WorkspaceTranslation = {
  id: string;
  target: string;
  valid: boolean;
};

export type WorkspaceContextInfo = {
  modPath: string;
  language: string;
  name: string;
};

export async function runBridgeInlineAction(options: {
  baseCfg: LangWorkflowConfig;
  translatedRoot: string;
  bridgeOptions: BridgeInlineOptions;
  runMods: ActionMod[];
  translator: any;
  resolveCfgForMod: (baseCfg: LangWorkflowConfig, modPath: string) => Promise<LangWorkflowConfig> | LangWorkflowConfig;
  pathBaseName: (path: string) => string;
  upsertPoTab: (modPath: string, language: string, name: string, content: string, dirty?: boolean) => void;
  renderPoTabs: () => void;
  setBusy: (busy: boolean) => void;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    options.setBusy(true);
    options.setStatus(options.rt("bridgeStartInline"));
    let successCount = 0;
    let failedCount = 0;

    for (const mod of options.runMods) {
      options.setStatus(options.rt("usingModRun", { name: mod.name }));
      try {
        const cfg = await options.resolveCfgForMod(options.baseCfg, mod.path);
        const translatedModDir = options.runMods.length > 1
          ? `${options.translatedRoot}\\${options.pathBaseName(mod.path)}`
          : options.translatedRoot;
        const report = await options.translator.langBridgeInlineToLang(cfg, translatedModDir, options.bridgeOptions);
        const content = await options.translator.langReadPo(cfg);
        options.upsertPoTab(mod.path, cfg.language, mod.name, content, false);
        const filledCount = Number.isFinite(Number(report.filledCount))
          ? Number(report.filledCount)
          : Number(report.filledMsgstrCount || 0) + Number(report.filledPluralCount || 0);
        options.setStatus(options.rt("bridgeInlineDone", {
          poPath: report.poPath,
          moPath: report.moPath,
          strategy: report.conflictStrategy || options.bridgeOptions.conflictStrategy,
          filled: filledCount,
          conflicts: report.conflictCount,
          conflictsResolved: Number(report.conflictResolvedCount || 0),
          conflictsSkipped: Number(report.conflictSkippedCount || 0),
          logPath: report.logPath || "-",
        }));
        successCount += 1;
      } catch (error: any) {
        failedCount += 1;
        options.setStatus(options.rt("bridgeInlineModFailed", { name: mod.name, error: error?.message || error }));
      }
    }

    options.renderPoTabs();
    options.setStatus(options.rt("bridgeInlineBatchSummary", {
      total: options.runMods.length,
      success: successCount,
      failed: failedCount,
    }));
    options.setStatus(options.rt("nextStepAfterSavePo"));
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  } finally {
    options.setBusy(false);
  }
}

export async function runBridgePoToCodeAction(options: {
  baseCfg: LangWorkflowConfig;
  outputRoot: string;
  sourceLangCode: string;
  targetLangCode: string;
  runMods: ActionMod[];
  translator: any;
  resolveCfgForMod: (baseCfg: LangWorkflowConfig, modPath: string) => Promise<LangWorkflowConfig> | LangWorkflowConfig;
  pathBaseName: (path: string) => string;
  setBusy: (busy: boolean) => void;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    options.setBusy(true);
    options.setStatus(options.rt("bridgeStartPoToCode"));
    let successCount = 0;
    let failedCount = 0;

    for (const mod of options.runMods) {
      options.setStatus(options.rt("usingModRun", { name: mod.name }));
      try {
        const cfg = await options.resolveCfgForMod(options.baseCfg, mod.path);
        const outputDir = options.runMods.length > 1
          ? `${options.outputRoot}\\${options.pathBaseName(mod.path)}`
          : options.outputRoot;
        const report = await options.translator.langBridgePoToCode(
          cfg,
          options.sourceLangCode,
          options.targetLangCode,
          outputDir,
        );
        options.setStatus(options.rt("bridgePoToCodeDone", {
          outDir: report.outputDir,
          replaced: report.replacedTextCount,
          renamed: report.renamedPathCount,
        }));
        successCount += 1;
      } catch (error: any) {
        failedCount += 1;
        options.setStatus(options.rt("bridgePoToCodeModFailed", { name: mod.name, error: error?.message || error }));
      }
    }

    options.setStatus(options.rt("bridgePoToCodeBatchSummary", {
      total: options.runMods.length,
      success: successCount,
      failed: failedCount,
    }));
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  } finally {
    options.setBusy(false);
  }
}

export async function runPreparePoAction(options: {
  baseCfg: LangWorkflowConfig;
  runMods: ActionMod[];
  translator: any;
  resolveCfgForMod: (baseCfg: LangWorkflowConfig, modPath: string) => Promise<LangWorkflowConfig> | LangWorkflowConfig;
  upsertPoTab: (modPath: string, language: string, name: string, content: string, dirty?: boolean) => void;
  renderPoTabs: () => void;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    for (const mod of options.runMods) {
      options.setStatus(options.rt("usingModRun", { name: mod.name }));
      const cfg = await options.resolveCfgForMod(options.baseCfg, mod.path);
      await options.translator.langGeneratePot(cfg);
      await options.translator.langGeneratePo(cfg);
      const content = await options.translator.langReadPo(cfg);
      options.upsertPoTab(mod.path, cfg.language, mod.name, content, false);
    }
    options.renderPoTabs();
    options.setStatus(options.rt("langReadyDone"));
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  }
}

export async function runExtractPoToWorkspaceAction(options: {
  baseCfg: LangWorkflowConfig;
  runMods: ActionMod[];
  translator: any;
  resolveCfgForMod: (baseCfg: LangWorkflowConfig, modPath: string) => Promise<LangWorkflowConfig> | LangWorkflowConfig;
  makeContextKey: (modPath: string, language: string) => string;
  clearWorkspace: () => void;
  onSegment: (segment: Segment, contextKey: string, mod: ActionMod, language: string, index: number) => void;
  rebuildWorkspaceIndexes: () => void;
  renderSegments: (resetScroll?: boolean) => void;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
  getSegmentCount: () => number;
}) {
  try {
    options.clearWorkspace();
    for (const mod of options.runMods) {
      options.setStatus(options.rt("usingModRun", { name: mod.name }));
      const cfg = await options.resolveCfgForMod(options.baseCfg, mod.path);
      const poSegments: Segment[] = await options.translator.langExtractPoSegments(cfg);
      const contextKey = options.makeContextKey(mod.path, cfg.language);
      poSegments.forEach((segment, index) => {
        options.onSegment(segment, contextKey, mod, cfg.language, index);
      });
    }
    options.rebuildWorkspaceIndexes();
    options.renderSegments(true);
    const count = options.getSegmentCount();
    if (!count) {
      options.setStatus(options.rt("poAiNoItems"));
    } else {
      options.setStatus(options.rt("poAiStart", { count }));
    }
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  }
}

export async function runApplyWorkspaceToPoAction(options: {
  baseCfg: LangWorkflowConfig;
  contexts: Array<[string, WorkspaceContextInfo]>;
  translations: WorkspaceTranslation[];
  getContextSegmentIds: (contextKey: string) => string[];
  translator: any;
  upsertPoTab: (modPath: string, language: string, name: string, content: string, dirty?: boolean) => void;
  renderPoTabs: () => void;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    for (const [contextKey, context] of options.contexts) {
      const cfg = { ...options.baseCfg, modDir: context.modPath, language: context.language };
      const contextIds = new Set(options.getContextSegmentIds(contextKey) || []);
      const modItems = options.translations.filter((translation) => contextIds.has(translation.id));
      const validItems = modItems.filter((translation) => translation.valid && translation.target.trim());
      const applyItems = validItems.map((translation) => {
        const parts = translation.id.split("::");
        const rawId = parts.length >= 3 ? parts[1] : "";
        return { id: rawId, target: translation.target };
      });

      options.setStatus(options.rt("poApplyStats", {
        name: context.name,
        language: context.language,
        workspace: modItems.length,
        valid: validItems.length,
        apply: applyItems.length,
      }));

      if (!applyItems.length) {
        options.setStatus(options.rt("poAiNoApplied"));
        continue;
      }

      const applied = await options.translator.langApplyPoTranslations(cfg, applyItems);
      const newContent = await options.translator.langReadPo(cfg);
      options.upsertPoTab(context.modPath, context.language, context.name, newContent, false);
      options.renderPoTabs();
      if (applied > 0) {
        options.setStatus(options.rt("poAiApplied", { count: applied }));
      } else {
        options.setStatus(options.rt("poAiNoApplied"));
      }
    }
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  }
}

export async function runGeneratePotAction(options: {
  cfg: LangWorkflowConfig;
  translator: any;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    const path = await options.translator.langGeneratePot(options.cfg);
    options.setStatus(options.rt("langPotDone", { path }));
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  }
}

export async function runGeneratePoAction(options: {
  baseCfg: LangWorkflowConfig;
  runMods: ActionMod[];
  translator: any;
  resolveCfgForMod: (baseCfg: LangWorkflowConfig, modPath: string) => Promise<LangWorkflowConfig> | LangWorkflowConfig;
  upsertPoTab: (modPath: string, language: string, name: string, content: string, dirty?: boolean) => void;
  renderPoTabs: () => void;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    for (const mod of options.runMods) {
      const cfg = await options.resolveCfgForMod(options.baseCfg, mod.path);
      const path = await options.translator.langGeneratePo(cfg);
      const content = await options.translator.langReadPo(cfg);
      options.upsertPoTab(mod.path, cfg.language, mod.name, content, false);
      options.setStatus(options.rt("langPoDone", { path }));
    }
    options.renderPoTabs();
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  }
}

export async function runRegeneratePoAction(options: {
  baseCfg: LangWorkflowConfig;
  runMods: ActionMod[];
  translator: any;
  resolveCfgForMod: (baseCfg: LangWorkflowConfig, modPath: string) => Promise<LangWorkflowConfig> | LangWorkflowConfig;
  confirmRewrite: (message: string) => boolean;
  upsertPoTab: (modPath: string, language: string, name: string, content: string, dirty?: boolean) => void;
  renderPoTabs: () => void;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    for (const mod of options.runMods) {
      const cfg = await options.resolveCfgForMod(options.baseCfg, mod.path);
      const confirmed = options.confirmRewrite(
        options.rt("langRewriteConfirm", { name: mod.name, language: cfg.language }),
      );
      if (!confirmed) continue;
      const path = await options.translator.langRegeneratePo(cfg);
      const content = await options.translator.langReadPo(cfg);
      options.upsertPoTab(mod.path, cfg.language, mod.name, content, false);
      options.setStatus(options.rt("langPoDone", { path }));
    }
    options.renderPoTabs();
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  }
}

export async function runLoadPoAction(options: {
  baseCfg: LangWorkflowConfig;
  runMods: ActionMod[];
  translator: any;
  resolveCfgForMod: (baseCfg: LangWorkflowConfig, modPath: string) => Promise<LangWorkflowConfig> | LangWorkflowConfig;
  upsertPoTab: (modPath: string, language: string, name: string, content: string, dirty?: boolean) => void;
  renderPoTabs: () => void;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    for (const mod of options.runMods) {
      const cfg = await options.resolveCfgForMod(options.baseCfg, mod.path);
      const content = await options.translator.langReadPo(cfg);
      options.upsertPoTab(mod.path, cfg.language, mod.name, content, false);
    }
    options.renderPoTabs();
    options.setStatus(options.rt("langPoLoaded"));
    options.setStatus(options.rt("nextStepAfterLoadPo"));
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  }
}

export async function runSavePoAction(options: {
  baseCfg: LangWorkflowConfig;
  activePoTabKey: string;
  poTabs: ActionPoTab[];
  editorContent: string;
  persistActivePoTabContent: () => void;
  translator: any;
  renderPoTabs: () => void;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    if (options.activePoTabKey) {
      options.persistActivePoTabContent();
      const tab = options.poTabs.find((item) => item.key === options.activePoTabKey);
      const cfg = tab
        ? { ...options.baseCfg, modDir: tab.modPath, language: tab.language }
        : options.baseCfg;
      const path = await options.translator.langWritePo(cfg, tab?.content || options.editorContent);
      if (tab) tab.dirty = false;
      options.renderPoTabs();
      options.setStatus(options.rt("langPoSaved", { path }));
      options.setStatus(options.rt("nextStepAfterSavePo"));
      return;
    }

    const path = await options.translator.langWritePo(options.baseCfg, options.editorContent);
    options.setStatus(options.rt("langPoSaved", { path }));
    options.setStatus(options.rt("nextStepAfterSavePo"));
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  }
}

export async function runSaveAllPoAction(options: {
  baseCfg: LangWorkflowConfig;
  poTabs: ActionPoTab[];
  persistActivePoTabContent: () => void;
  translator: any;
  renderPoTabs: () => void;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    options.persistActivePoTabContent();
    const dirtyTabs = options.poTabs.filter((tab) => tab.dirty);
    if (!dirtyTabs.length) {
      options.setStatus(options.rt("saveAllPoNone"));
      return;
    }

    for (const tab of dirtyTabs) {
      const cfg = { ...options.baseCfg, modDir: tab.modPath, language: tab.language };
      await options.translator.langWritePo(cfg, tab.content);
      tab.dirty = false;
    }

    options.renderPoTabs();
    options.setStatus(options.rt("saveAllPoDone", { count: dirtyTabs.length }));
    options.setStatus(options.rt("nextStepAfterSavePo"));
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  }
}

export async function runCleanupPluralAction(options: {
  baseCfg: LangWorkflowConfig;
  runMods: ActionMod[];
  translator: any;
  resolveCfgForMod: (baseCfg: LangWorkflowConfig, modPath: string) => Promise<LangWorkflowConfig> | LangWorkflowConfig;
  upsertPoTab: (modPath: string, language: string, name: string, content: string, dirty?: boolean) => void;
  renderPoTabs: () => void;
  setBusy: (busy: boolean) => void;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    options.setBusy(true);
    let totalRemoved = 0;
    for (const mod of options.runMods) {
      options.setStatus(options.rt("usingModRun", { name: mod.name }));
      const cfg = await options.resolveCfgForMod(options.baseCfg, mod.path);
      const removed = await options.translator.langCleanupPoPlural(cfg);
      totalRemoved += removed;
      if (removed > 0) {
        const content = await options.translator.langReadPo(cfg);
        options.upsertPoTab(mod.path, cfg.language, mod.name, content, false);
      }
    }

    options.renderPoTabs();
    if (totalRemoved > 0) {
      options.setStatus(options.rt("cleanupPluralDone", { count: totalRemoved }));
    } else {
      options.setStatus(options.rt("cleanupPluralNone"));
    }
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  } finally {
    options.setBusy(false);
  }
}

export async function runCompileMoAction(options: {
  baseCfg: LangWorkflowConfig;
  runMods: ActionMod[];
  translator: any;
  resolveCfgForMod: (baseCfg: LangWorkflowConfig, modPath: string) => Promise<LangWorkflowConfig> | LangWorkflowConfig;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    for (const mod of options.runMods) {
      options.setStatus(options.rt("usingModRun", { name: mod.name }));
      const cfg = await options.resolveCfgForMod(options.baseCfg, mod.path);
      const path = await options.translator.langCompileMo(cfg);
      options.setStatus(options.rt("langMoDone", { path }));
    }
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  }
}

export async function runConvertPoAction(options: {
  baseCfg: LangWorkflowConfig;
  targetLangCode: string;
  runMods: ActionMod[];
  translator: any;
  resolveCfgForMod: (baseCfg: LangWorkflowConfig, modPath: string) => Promise<LangWorkflowConfig> | LangWorkflowConfig;
  convertContent: (content: string, targetLangCode: string) => string;
  upsertPoTab: (modPath: string, language: string, name: string, content: string, dirty?: boolean) => void;
  makeContextKey: (modPath: string, language: string) => string;
  setPoLanguageSelection: (language: string) => void;
  findPoTabByKey: (key: string) => { key: string } | null | undefined;
  switchPoTab: (key: string) => void;
  switchToPoLanguageContext: () => void;
  renderPoTabs: () => void;
  setBusy: (busy: boolean) => void;
  setStatus: (message: string, append?: boolean) => void;
  rt: (key: any, vars?: Record<string, string | number>) => string;
}) {
  try {
    options.setBusy(true);
    let lastContextKey = "";

    for (const mod of options.runMods) {
      options.setStatus(options.rt("usingModRun", { name: mod.name }));
      const sourceCfg = await options.resolveCfgForMod(options.baseCfg, mod.path);
      const content = await options.translator.langReadPo(sourceCfg);
      if (!content) continue;

      const newContent = options.convertContent(content, options.targetLangCode);
      const targetCfg = { ...sourceCfg, language: options.targetLangCode };
      const path = await options.translator.langWritePo(targetCfg, newContent);
      options.upsertPoTab(mod.path, options.targetLangCode, mod.name, newContent, false);
      lastContextKey = options.makeContextKey(mod.path, options.targetLangCode);
      options.setStatus(options.rt("langPoSaved", { path }));
    }

    if (lastContextKey) {
      options.setPoLanguageSelection(options.targetLangCode);
      const targetTab = options.findPoTabByKey(lastContextKey);
      if (targetTab) {
        options.switchPoTab(targetTab.key);
      } else {
        options.switchToPoLanguageContext();
      }
    } else {
      options.renderPoTabs();
    }

    options.setStatus(options.rt("nextStepAfterConvertPo"));
  } catch (error: any) {
    options.setStatus(options.rt("langActionFailed", { error: error?.message || error }));
  } finally {
    options.setBusy(false);
  }
}
