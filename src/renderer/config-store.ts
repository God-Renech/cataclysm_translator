export type UiLang = 'zh-CN' | 'en' | 'zh-TW' | 'ko' | 'ja' | 'ru';

export const CONFIG_STORAGE_KEY = 'translator_api_config_v2';
export const PRESET_STORAGE_KEY = 'translator_rule_presets_v1';
export const UI_LANG_STORAGE_KEY = 'translator_ui_lang_v1';

export type ProviderDefaults = {
  baseUrl: string;
  model: string;
  targetTokens: number;
};

export type RendererConfigSnapshot = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  rememberKey: boolean;
  systemPrompt: string;
  userPrefix: string;
  targetLang: string;
  timeoutSec: string;
  maxRetries: string;
  batchSize: string;
  batchTokenLimit: string;
  concurrency: string;
  rpmLimit: string;
  tpmLimit: string;
  includeKeys: string;
  excludeKeys: string;
  includeKeyRegex: string;
  excludeKeyRegex: string;
  includePathRegex: string;
  excludePathRegex: string;
  skipEmpty: boolean;
  rulePreset: string;
  regex: string;
  uiLang: string;
  workMode: string;
  langDir: string;
  langMode: string;
  noStrPlNoS: boolean;
  modRootDir: string;
  poLanguage: string;
  poLanguageCustom: string;
  bridgeTranslatedModDir: string;
  bridgeOutputDir: string;
  bridgeSourceLangCode: string;
  bridgeTargetLangCode: string;
  bridgeOperationMode: string;
  bridgeConflictStrategy: string;
  bridgeArrayMatchById: boolean;
  pythonPath: string;
  gettextPath: string;
};

export function resolvePromptLocale(targetLang: string): 'zh-CN' | 'zh-TW' | 'en' {
  const lang = (targetLang || '').toLowerCase();
  if (lang.includes('traditional') || lang.includes('zh-tw') || lang.includes('tw')) return 'zh-TW';
  if (lang.includes('chinese') || lang.includes('zh-cn') || lang.includes('cn')) return 'zh-CN';
  return 'en';
}

export function detectDefaultUiLang(navigatorLanguage?: string): UiLang {
  const fallback =
    navigatorLanguage ??
    ((typeof navigator !== 'undefined' && navigator?.language) ? navigator.language : '');
  const language = fallback.toLowerCase();
  if (language.startsWith('ko')) return 'ko';
  if (language.startsWith('ja')) return 'ja';
  if (language.startsWith('ru')) return 'ru';
  if (language.startsWith('zh-tw') || language.startsWith('zh-hk') || language.startsWith('zh-mo') || language.startsWith('zh-hant')) return 'zh-TW';
  if (language.startsWith('zh')) return 'zh-CN';
  return 'en';
}

export function normalizeUiLang(lang: string | null | undefined, navigatorLanguage?: string): UiLang {
  if (lang === 'zh-CN' || lang === 'en' || lang === 'zh-TW' || lang === 'ko' || lang === 'ja' || lang === 'ru') {
    return lang;
  }
  return detectDefaultUiLang(navigatorLanguage);
}

export function getProviderDefaults(provider: string): ProviderDefaults {
  if (provider === 'gemini') return { baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash-lite', targetTokens: 16000 };
  if (provider === 'deepseek') return { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', targetTokens: 16000 };
  if (provider === 'siliconflow') return { baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3.2', targetTokens: 10000 };
  if (provider === 'mimo') return { baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2-flash', targetTokens: 16000 };
  if (provider === 'custom') return { baseUrl: '', model: '', targetTokens: 16000 };
  return { baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini', targetTokens: 16000 };
}

export function applyProviderDefaultsToSnapshot(
  snapshot: { baseUrl: string; model: string },
  provider: string,
  lastDefaults: ProviderDefaults,
  force = false
) {
  const defaults = getProviderDefaults(provider);
  const next = { ...snapshot };
  if (force || !next.baseUrl || next.baseUrl === lastDefaults.baseUrl) {
    next.baseUrl = defaults.baseUrl;
  }
  if (force || !next.model || next.model === lastDefaults.model) {
    next.model = defaults.model;
  }
  return { snapshot: next, defaults };
}

export function loadStoredConfig(raw: string | null | undefined): RendererConfigSnapshot | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RendererConfigSnapshot;
  } catch {
    return null;
  }
}

export function saveStoredConfig(snapshot: RendererConfigSnapshot) {
  return JSON.stringify(snapshot);
}

export function buildRendererConfigSnapshot(input: RendererConfigSnapshot): RendererConfigSnapshot {
  return { ...input };
}

export type HydratedConfigState = {
  hasStoredConfig: boolean;
  snapshot: RendererConfigSnapshot | null;
  provider: string;
  providerDefaults: ProviderDefaults;
  baseUrl: string;
  model: string;
  uiLang: UiLang;
};

export function hydrateLoadedConfigState(options: {
  raw: string | null | undefined;
  currentProvider: string;
  storedUiLang: string | null | undefined;
  navigatorLanguage?: string;
  lastDefaults?: ProviderDefaults;
}): HydratedConfigState {
  const parsed = loadStoredConfig(options.raw);
  const provider = parsed?.provider || options.currentProvider;
  const baselineDefaults = options.lastDefaults || getProviderDefaults(options.currentProvider);
  const applied = applyProviderDefaultsToSnapshot(
    {
      baseUrl: parsed?.baseUrl || '',
      model: parsed?.model || '',
    },
    provider,
    baselineDefaults,
    true
  );

  return {
    hasStoredConfig: Boolean(parsed),
    snapshot: parsed,
    provider,
    providerDefaults: applied.defaults,
    baseUrl: applied.snapshot.baseUrl,
    model: applied.snapshot.model,
    uiLang: normalizeUiLang(parsed?.uiLang ?? options.storedUiLang, options.navigatorLanguage),
  };
}
