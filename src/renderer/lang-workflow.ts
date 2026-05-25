export type LangWorkflowConfig = {
  langDir: string;
  langMode?: "cbn" | "cdda";
  modDir: string;
  language: string;
  noStrPlNoS?: boolean;
  pythonPath?: string;
  gettextPath?: string;
};

export type RunMod = {
  path: string;
  name: string;
};

export function getModDirsForRun(
  selectedMods: RunMod[],
  fallbackDir: string,
  modRootDir: string,
  importDir: string
) {
  if (selectedMods.length) {
    return selectedMods.map((item) => ({ path: item.path, name: item.name }));
  }

  const fallback = fallbackDir.trim() || modRootDir.trim() || importDir.trim();
  if (fallback) {
    return [{ path: fallback, name: fallback }];
  }
  return [];
}

export function buildLangWorkflowConfig(options: {
  requireLangDir?: boolean;
  langDir: string;
  langModeValue: string;
  selectedModPath?: string;
  modRootDir: string;
  importDir: string;
  language: string;
  noStrPlNoS: boolean;
  pythonPath: string;
  gettextPath: string;
}): LangWorkflowConfig | null {
  const requireLangDir = options.requireLangDir ?? true;
  const langDir = options.langDir.trim();
  const modDir = options.selectedModPath?.trim()
    || options.modRootDir.trim()
    || options.importDir.trim();
  const language = options.language.trim();

  if (!modDir || !language) return null;
  if (requireLangDir && !langDir) return null;

  return {
    langDir: langDir || "",
    langMode: options.langModeValue === "cdda" ? "cdda" : "cbn",
    modDir,
    language,
    noStrPlNoS: options.noStrPlNoS,
    pythonPath: options.pythonPath.trim() || undefined,
    gettextPath: options.gettextPath.trim() || undefined,
  };
}

export function resolveCfgForMod(
  baseCfg: LangWorkflowConfig,
  modPath: string
): LangWorkflowConfig {
  return { ...baseCfg, modDir: modPath };
}

export function pathBaseName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}
