import type {
  ActionMod,
  ActionPoTab,
  LangWorkflowConfig,
} from "./lang-actions-shared.js";

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
