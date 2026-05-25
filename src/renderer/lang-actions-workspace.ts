import type {
  ActionMod,
  LangWorkflowConfig,
  Segment,
  WorkspaceContextInfo,
  WorkspaceTranslation,
} from "./lang-actions-shared.js";

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
