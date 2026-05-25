import type {
  ActionMod,
  BridgeInlineOptions,
  LangWorkflowConfig,
} from "./lang-actions-shared.js";

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
