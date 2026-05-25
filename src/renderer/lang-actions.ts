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
