import { computeVirtualWindow, normalizeSourceKey } from "./virtual-workspace.js";
import {
  applyProviderDefaultsToSnapshot,
  buildRendererConfigSnapshot,
  CONFIG_STORAGE_KEY,
  hydrateLoadedConfigState,
  PRESET_STORAGE_KEY,
  UI_LANG_STORAGE_KEY,
  type UiLang,
  getProviderDefaults,
  normalizeUiLang,
} from "./config-store.js";
import * as rulePresetStore from "./rule-presets.js";
import {
  buildWorkspaceIndexes,
  filterWorkspaceSegments,
  formatWorkspaceStatsText,
  invertWorkspaceSelection,
  selectAllWorkspaceSegments,
  selectEmptyWorkspaceSegments,
} from "./workspace-data.js";
import {
  applyCheckedStateToCheckboxes,
  clearModPathSelection,
  selectAllModPaths,
} from "./mod-selection.js";
import { convertPoContent, getTargetPoLanguageCode } from "./po-convert.js";

export {};

declare const OpenCC: any;

type Rule = {
  format: 'json' | 'text';
  includeKeys?: string[];
  excludeKeys?: string[];
  includeKeyRegex?: string;
  excludeKeyRegex?: string;
  includePathRegex?: string;
  excludePathRegex?: string;
  skipEmpty?: boolean;
  regex?: string;
};

type Segment = {
  id: string;
  file: string;
  path: string[];
  source: string;
  placeholders: string[];
};

type ScanError = {
  file: string;
  message: string;
};

type ScanResult = {
  segments: Segment[];
  errors: ScanError[];
};

type ApiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userPromptPrefix: string;
  provider: 'openai_compatible' | 'gemini' | 'deepseek' | 'siliconflow' | 'mimo' | 'custom';
  timeoutMs?: number;
};

type TranslationResult = {
  id: string;
  target: string;
  valid: boolean;
};

type LangWorkflowConfig = {
  langDir: string;
  langMode?: 'cbn' | 'cdda';
  modDir: string;
  language: string;
  noStrPlNoS?: boolean;
  pythonPath?: string;
  gettextPath?: string;
};

type BridgeInlineToLangReport = {
  poPath: string;
  moPath: string;
  logPath: string;
  conflictStrategy: string;
  totalPairs: number;
  conflictCount: number;
  conflictResolvedCount: number;
  conflictSkippedCount: number;
  filledCount: number;
  filledMsgstrCount: number;
  filledPluralCount: number;
  skippedCount: number;
};

type BridgeInlineOptions = {
  conflictStrategy: 'skip' | 'frequency' | 'frequency2';
  arrayMatchById: boolean;
};

type BridgePoToCodeReport = {
  outputDir: string;
  poPath: string;
  replacedTextCount: number;
  touchedFileCount: number;
  renamedPathCount: number;
  replacedLangCodeCount: number;
};

type ModItem = {
  id: string;
  name: string;
  path: string;
};

declare global {
  interface Window {
    translator: {
      selectFolder: () => Promise<string | null>;
      scanSegments: (dir: string, rule: Rule) => Promise<ScanResult>;
      translateBatch: (segments: Segment[], config: ApiConfig) => Promise<TranslationResult[]>;
      export: (dir: string, translations: { id: string; target: string }[], outDir: string, rule: Rule) => Promise<boolean>;
      loadUserConfig: () => Promise<string | null>;
      saveUserConfig: (content: string) => Promise<string>;
      getUserConfigPath: () => Promise<string>;
      savePresetJson: (dir: string, fileName: string, content: string) => Promise<string>;
      langGeneratePot: (config: LangWorkflowConfig) => Promise<string>;
      langGeneratePo: (config: LangWorkflowConfig) => Promise<string>;
      langRegeneratePo: (config: LangWorkflowConfig) => Promise<string>;
      langReadPo: (config: LangWorkflowConfig) => Promise<string>;
      langWritePo: (config: LangWorkflowConfig, content: string) => Promise<string>;
      langExtractPoSegments: (config: LangWorkflowConfig) => Promise<Segment[]>;
      langApplyPoTranslations: (config: LangWorkflowConfig, translations: { id: string; target: string }[]) => Promise<number>;
      langCompileMo: (config: LangWorkflowConfig) => Promise<string>;
      langCleanupPoPlural: (config: LangWorkflowConfig) => Promise<number>;
      langScanMods: (rootDir: string) => Promise<ModItem[]>;
      langBridgeInlineToLang: (
        config: LangWorkflowConfig,
        translatedModDir: string,
        options: BridgeInlineOptions
      ) => Promise<BridgeInlineToLangReport>;
      langBridgePoToCode: (
        config: LangWorkflowConfig,
        sourceLanguageCode: string,
        targetLanguageCode: string,
        outputDir: string
      ) => Promise<BridgePoToCodeReport>;
    };
  }
}

const importDirInput = document.getElementById('importDir') as HTMLInputElement;
const exportDirInput = document.getElementById('exportDir') as HTMLInputElement;
const includeKeysInput = document.getElementById('includeKeys') as HTMLInputElement;
const excludeKeysInput = document.getElementById('excludeKeys') as HTMLInputElement;
const regexInput = document.getElementById('regex') as HTMLInputElement;
const includeKeyRegexInput = document.getElementById('includeKeyRegex') as HTMLInputElement;
const excludeKeyRegexInput = document.getElementById('excludeKeyRegex') as HTMLInputElement;
const includePathRegexInput = document.getElementById('includePathRegex') as HTMLInputElement;
const excludePathRegexInput = document.getElementById('excludePathRegex') as HTMLInputElement;
const skipEmptyInput = document.getElementById('skipEmpty') as HTMLInputElement;
const rulePresetSelect = document.getElementById('rulePreset') as HTMLSelectElement;
const uiLangSelect = document.getElementById('uiLang') as HTMLSelectElement;
const workModeSelect = document.getElementById('workMode') as HTMLSelectElement;
const savePresetBtn = document.getElementById('savePresetBtn') as HTMLButtonElement;
const importPresetBtn = document.getElementById('importPresetBtn') as HTMLButtonElement;
const newPresetBtn = document.getElementById('newPresetBtn') as HTMLButtonElement;
const deletePresetBtn = document.getElementById('deletePresetBtn') as HTMLButtonElement;
const exportPresetBtn = document.getElementById('exportPresetBtn') as HTMLButtonElement;
const importPresetFile = document.getElementById('importPresetFile') as HTMLInputElement;
const baseUrlInput = document.getElementById('baseUrl') as HTMLInputElement;
const modelInput = document.getElementById('model') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const rememberKeyInput = document.getElementById('rememberKey') as HTMLInputElement;
const systemPromptInput = document.getElementById('systemPrompt') as HTMLTextAreaElement;
const userPrefixInput = document.getElementById('userPrefix') as HTMLTextAreaElement;
const providerSelect = document.getElementById('provider') as HTMLSelectElement;
const targetLangInput = document.getElementById('targetLang') as HTMLSelectElement;
const batchSizeInput = document.getElementById('batchSize') as HTMLInputElement;
const batchTokenLimitInput = document.getElementById('batchTokenLimit') as HTMLInputElement;
const concurrencyInput = document.getElementById('concurrency') as HTMLInputElement;
const rpmLimitInput = document.getElementById('rpmLimit') as HTMLInputElement;
const tpmLimitInput = document.getElementById('tpmLimit') as HTMLInputElement;
const langDirInput = document.getElementById('langDir') as HTMLInputElement;
const langModeSelect = document.getElementById('langMode') as HTMLSelectElement;
const modRootDirInput = document.getElementById('modRootDir') as HTMLInputElement;
const poLanguageInput = document.getElementById('poLanguage') as HTMLSelectElement;
const poLanguageCustomWrap = document.getElementById('poLanguageCustomWrap') as HTMLDivElement;
const poLanguageCustomInput = document.getElementById('poLanguageCustom') as HTMLInputElement;
const convertModeSelect = document.getElementById('convertMode') as HTMLSelectElement;
const convertPoBtn = document.getElementById('convertPoBtn') as HTMLButtonElement;
const saveAllPoBtn = document.getElementById('saveAllPoBtn') as HTMLButtonElement;
const codeBridgeField = document.getElementById('codeBridgeField') as HTMLDivElement;
const bridgeTranslatedModDirInput = document.getElementById('bridgeTranslatedModDir') as HTMLInputElement;
const bridgeOutputDirInput = document.getElementById('bridgeOutputDir') as HTMLInputElement;
const bridgeSourceLangCodeInput = document.getElementById('bridgeSourceLangCode') as HTMLInputElement;
const bridgeTargetLangCodeInput = document.getElementById('bridgeTargetLangCode') as HTMLInputElement;
const bridgeOperationModeSelect = document.getElementById('bridgeOperationMode') as HTMLSelectElement;
const bridgeInlineFields = document.getElementById('bridgeInlineFields') as HTMLDivElement;
const bridgeReverseFields = document.getElementById('bridgeReverseFields') as HTMLDivElement;
const bridgeUsageHintInline = document.getElementById('bridgeUsageHintInline') as HTMLDivElement;
const bridgeUsageHintReverse = document.getElementById('bridgeUsageHintReverse') as HTMLDivElement;
const bridgeConflictStrategySelect = document.getElementById('bridgeConflictStrategy') as HTMLSelectElement;
const bridgeArrayMatchByIdInput = document.getElementById('bridgeArrayMatchById') as HTMLInputElement;
const bridgeInlineToLangBtn = document.getElementById('bridgeInlineToLangBtn') as HTMLButtonElement;
const bridgePoToCodeBtn = document.getElementById('bridgePoToCodeBtn') as HTMLButtonElement;
const bridgeCompileMoBtn = document.getElementById('bridgeCompileMoBtn') as HTMLButtonElement;
const cleanupPluralBtn = document.getElementById('cleanupPluralBtn') as HTMLButtonElement;
const selectAllModsBtn = document.getElementById('selectAllModsBtn') as HTMLButtonElement;
const clearModSelectionBtn = document.getElementById('clearModSelectionBtn') as HTMLButtonElement;
const pythonPathInput = document.getElementById('pythonPath') as HTMLInputElement;
const gettextPathInput = document.getElementById('gettextPath') as HTMLInputElement;
const noStrPlNoSInput = document.getElementById('noStrPlNoS') as HTMLInputElement;
const modListDiv = document.getElementById('modList') as HTMLDivElement;
const poTabsDiv = document.getElementById('poTabs') as HTMLDivElement;
const poEditorInput = document.getElementById('poEditor') as HTMLTextAreaElement;
const workspaceListDiv = document.getElementById('workspaceList') as HTMLDivElement;
const workspaceStatsDiv = document.getElementById('workspaceStats') as HTMLDivElement;
const workspaceSearchInput = document.getElementById('workspaceSearch') as HTMLInputElement;
const workspaceShowSelectedOnlyInput = document.getElementById('workspaceShowSelectedOnly') as HTMLInputElement;
const workspaceShowEmptyOnlyInput = document.getElementById('workspaceShowEmptyOnly') as HTMLInputElement;
const workspaceSyncSameSourceInput = document.getElementById('workspaceSyncSameSource') as HTMLInputElement;
const workspaceSyncScopeSelect = document.getElementById('workspaceSyncScope') as HTMLSelectElement;
const workspaceSelectAllBtn = document.getElementById('workspaceSelectAllBtn') as HTMLButtonElement;
const workspaceInvertBtn = document.getElementById('workspaceInvertBtn') as HTMLButtonElement;
const workspaceSelectEmptyBtn = document.getElementById('workspaceSelectEmptyBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const modeGuideHint = document.getElementById('modeGuideHint') as HTMLDivElement;
const metaAuthorSpan = document.getElementById('metaAuthor') as HTMLSpanElement;
const metaContactSpan = document.getElementById('metaContact') as HTMLSpanElement;
const metaVersionSpan = document.getElementById('metaVersion') as HTMLSpanElement;

const APP_META = {
  author: '',
  contact: '',
  version: '0.4.0'
};

let segments: Segment[] = [];
let translations: { id: string; target: string; valid: boolean }[] = [];
const translationMap = new Map<string, { id: string; target: string; valid: boolean }>();
let selectedIds: Set<string> = new Set();
let stopRequested = false;
let uiBusy = false;
const statusHistory: string[] = [];
let renderedStatusCount = 0;
let statusRenderTimer: ReturnType<typeof setTimeout> | null = null;
let scannedMods: ModItem[] = [];
const workspaceContextMap = new Map<string, string>();
const workspaceContextInfo = new Map<string, { modPath: string; language: string; name: string }>();
let poTabs: { key: string; modPath: string; language: string; name: string; content: string; dirty: boolean }[] = [];
let activePoTabKey = '';
const requestTimeline: number[] = [];
const tokenTimeline: { ts: number; tokens: number }[] = [];
let workspaceSearchText = '';
let workspaceSearchTimer: number | null = null;
let lastWorkModeValue = workModeSelect.value || 'mod';
let lastPoLanguageSelectValue = poLanguageInput.value;
let lastPoLanguageCustomValue = poLanguageCustomInput.value;
const visibleTargetTextareaMap = new Map<string, HTMLTextAreaElement>();
const segmentById = new Map<string, Segment>();
const sourceToSegmentIds = new Map<string, string[]>();
const contextToSegmentIds = new Map<string, string[]>();
let dedupMemberIdsByRepresentativeId = new Map<string, string[]>();
let selectedSegmentTotalForProgress = 0;
let uniqueSegmentTotalForProgress = 0;
const WORKSPACE_ROW_HEIGHT = 156;
const WORKSPACE_OVERSCAN = 4;
let workspaceRowsCache: Segment[] = [];
let workspaceVirtualSpacer: HTMLDivElement | null = null;
let workspaceVirtualContent: HTMLDivElement | null = null;
let workspaceVirtualRenderFrame: number | null = null;
let workspaceRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let workspacePendingResetScroll = false;

const translator = window.translator ?? null;

function resolvePromptLocale(targetLang: string): 'zh-CN' | 'zh-TW' | 'en' {
  const lang = (targetLang || '').toLowerCase();
  if (lang.includes('繁') || lang.includes('tw') || lang.includes('traditional')) return 'zh-TW';
  if (lang.includes('中文') || lang.includes('简') || lang.includes('cn') || lang.includes('chinese')) return 'zh-CN';
  return 'en';
}

const SYSTEM_PROMPT_TEMPLATE = (targetLang: string) => {
  const locale = resolvePromptLocale(targetLang);
  if (locale === 'zh-TW') {
    return `你是遊戲 mod 文本翻譯助手。保持佔位符、標籤與格式不變，不翻譯識別符與 ID。將可翻譯文本翻譯為${targetLang}，輸出 JSON 陣列 [{id,target}]，target 為譯文。`;
  }
  if (locale === 'zh-CN') {
    return `你是游戏 mod 文本翻译助手。保持占位符、标签与格式不变，不翻译标识符与 ID。将可翻译文本翻译为${targetLang}，输出 JSON 数组 [{id,target}]，target 为译文。`;
  }
  return `You are a game mod translation assistant. Preserve placeholders, tags, and formatting exactly. Do not translate identifiers or IDs. Translate translatable text into ${targetLang}. Output a JSON array [{id,target}], where target is the translated text.`;
};

const USER_PREFIX_TEMPLATE = (targetLang: string) => {
  const locale = resolvePromptLocale(targetLang);
  if (locale === 'zh-TW') {
    return `將以下文本翻譯為${targetLang}，保持佔位符與符號不變，不添加解釋或額外文本。`;
  }
  if (locale === 'zh-CN') {
    return `将以下文本翻译为${targetLang}，保持占位符与符号不变，不添加解释或额外文本。`;
  }
  return `Translate the following text into ${targetLang}. Keep placeholders and symbols unchanged. Do not add explanations or extra text.`;
};

let lastSavedUserConfigPath = '';
let loadedFromUserConfigFile = false;

function applyAppMeta() {
  metaAuthorSpan.textContent = APP_META.author;
  metaContactSpan.textContent = APP_META.contact;
  metaVersionSpan.textContent = APP_META.version;
}

async function hydrateFromUserConfigFile(): Promise<boolean> {
  if (!translator) return false;
  try {
    const [content, path] = await Promise.all([
      translator.loadUserConfig(),
      translator.getUserConfigPath().catch(() => '')
    ]);
    if (path) lastSavedUserConfigPath = path;
    if (!content) return false;
    const data = JSON.parse(content);
    if (data && typeof data === 'object') {
      if (data.config && typeof data.config === 'object') {
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(data.config));
      }
      if (data.presets && typeof data.presets === 'object') {
        localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(data.presets));
      }
      if (typeof data.uiLang === 'string') {
        localStorage.setItem(UI_LANG_STORAGE_KEY, data.uiLang);
      }
    }
    loadedFromUserConfigFile = true;
    return true;
  } catch {
    return false;
  }
}

function clearClientStoredConfig() {
  const keys = [
    CONFIG_STORAGE_KEY,
    PRESET_STORAGE_KEY,
    UI_LANG_STORAGE_KEY,
    'timeoutSec',
    'maxRetries',
    'batchSize',
    'batchTokenLimit',
    'concurrency'
  ];
  keys.forEach((k) => localStorage.removeItem(k));
}

async function persistUserConfigToFile() {
  if (!translator) return;
  try {
    const payload = JSON.stringify({
      config: JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || '{}'),
      presets: JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || '{}'),
      uiLang: localStorage.getItem(UI_LANG_STORAGE_KEY) || 'zh-CN'
    });
    const path = await translator.saveUserConfig(payload);
    if (path) lastSavedUserConfigPath = path;
  } catch {}
}

type RulePresetData = {
  includeKeys: string;
  excludeKeys: string;
  includeKeyRegex: string;
  excludeKeyRegex: string;
  includePathRegex: string;
  excludePathRegex: string;
  skipEmpty: boolean;
  regex: string;
};

const DEFAULT_RULE_PRESETS: Record<string, RulePresetData> = {
  cdda: {
    includeKeys: 'name,description,text,message,snippet,prompt,title,note,effect_str,tooltip,info,sound,line,dialogue,success,failure,true,false',
    excludeKeys: 'id,type,copy-from,flags,material,category,skill,qualities,obsolete,debug',
    includeKeyRegex: '',
    excludeKeyRegex: '',
    includePathRegex: '',
    excludePathRegex: '',
    skipEmpty: true,
    regex: ''
  },
  cbn: {
    includeKeys: 'name,description,text,message,snippet,prompt,title,note,effect_str,tooltip,info,sound,line,dialogue,success,failure,true,false',
    excludeKeys: 'id,type,copy-from,flags,material,category,skill,qualities,obsolete,debug',
    includeKeyRegex: '',
    excludeKeyRegex: '',
    includePathRegex: '',
    excludePathRegex: '',
    skipEmpty: true,
    regex: ''
  }
};

let rulePresets: Record<string, RulePresetData> = { ...DEFAULT_RULE_PRESETS };
let currentUiLang: UiLang = 'zh-CN';
const BUILTIN_PRESET_NAMES = new Set(Object.keys(DEFAULT_RULE_PRESETS));

const I18N = {
  'zh-CN': {
    appTitle: 'CDDA/CBN Mod 翻译工具',
    labelUiLanguage: '界面语言',
    labelWorkMode: '工作模式',
    workModeMod: 'MOD 语言工具',
    workModeKeyword: '关键字提取翻译',
    workModePoConvert: 'PO 简繁转换',
    workModeCodeBridge: '代码与 Lang 桥接',
    titleLangTools: 'MOD 语言工具',
    titlePoConvert: 'PO 简繁转换',
    labelLangDir: '外置 lang 目录',
    labelLangMode: 'Lang 模式',
    optLangModeCbn: 'CBN',
    optLangModeCdda: 'CDDA',
    labelPoLanguage: 'PO 语言代码',
    labelPoLanguageCustom: '自定义语言代码',
    labelPythonPath: 'Python 路径（可选）',
    labelGettextPath: 'Gettext 路径（可选）',
    labelModRootDir: 'MOD 所在目录（自动扫描）',
    labelModList: 'MOD 清单（可多选）',
    labelPoEditor: 'PO 文本编辑',
    labelCodeBridge: '代码与 Lang 桥接',
    labelBridgeTranslatedModDir: '翻译版 MOD 目录',
    labelBridgeOutputDir: '反向转换输出目录',
    labelBridgeSourceLangCode: '源语言代码标记',
    labelBridgeTargetLangCode: '目标语言代码标记',
    labelBridgeOperationMode: '桥接操作',
    optBridgeOperationInline: '迁移内嵌译文到 Lang',
    optBridgeOperationReverse: 'PO 反向写回代码',
    labelBridgeConflictStrategy: '冲突处理策略',
    labelBridgeArrayMatchById: '数组按 id 对齐',
    optBridgeConflictSkip: '冲突跳过',
    optBridgeConflictFrequency: '频次优先',
    optBridgeConflictFrequency2: '频次优先2（平票选第一个）',
    bridgeUsageHintInline: '迁移模式：选择翻译版 MOD 目录与目标语言代码，冲突策略可选。',
    bridgeUsageHintReverse: '反向模式：填写输出目录与源/目标语言代码，将 PO 写回代码目录副本。',
    bridgeUsageHint: '用法：先选原 MOD，再填翻译版 MOD 目录执行迁移；可选冲突策略与数组按 id 对齐。反向写回需填写输出目录与源/目标语言代码',
    labelAuthor: '作者',
    labelContact: '联系方式',
    labelVersion: '版本号',
    labelImportDir: '导入目录',
    labelExportDir: '导出目录',
    labelIncludeKeys: '允许键',
    labelExcludeKeys: '排除键',
    labelRegex: '文本正则',
    labelRulePreset: '规则预设',
    labelIncludeKeyRegex: '包含键正则',
    labelExcludeKeyRegex: '排除键正则',
    labelIncludePathRegex: '包含路径正则',
    labelExcludePathRegex: '排除路径正则',
    labelSkipEmpty: '跳过空白文本',
    titleAiConfig: 'AI 配置',
    labelProvider: '服务商',
    labelModel: '模型',
    labelApiKey: 'API Key',
    labelRememberKey: '记住 API Key',
    labelTargetLang: '目标语言',
    labelTimeoutSec: 'API 超时（秒）',
    labelBatchSize: '批次条数',
    labelBatchTokenLimit: '批次 Token 上限',
    labelConcurrency: '并发批次数',
    labelRpmLimit: 'RPM 上限（每分钟请求）',
    labelTpmLimit: 'TPM 上限（每分钟 Token）',
    labelMaxRetries: '失败重试次数',
    labelSystemPrompt: '系统提示词',
    labelUserPrefix: '用户提示前缀',
    titleStatus: '状态',
    titleWorkspace: '翻译工作区',
    labelWorkspaceShowSelectedOnly: '仅显示已勾选',
    labelWorkspaceShowEmptyOnly: '仅显示空译文',
    labelWorkspaceSyncSameSource: '同源文本联动',
    optCustom: '自定义',
    btnChoose: '选择',
    btnSavePreset: '保存当前预设',
    btnImportPreset: '导入预设 JSON',
    btnNewPreset: '另存为新预设',
    btnDeletePreset: '删除自定义预设',
    btnExportPreset: '导出当前预设 JSON',
    btnScan: '扫描',
    btnTestApi: '测试 API',
    btnTranslate: '翻译选中',
    btnStop: '中止',
    btnResume: '继续翻译',
    btnExport: '导出',
    btnWorkspaceSelectAll: '全部勾选',
    btnWorkspaceInvert: '反向勾选',
    btnWorkspaceSelectEmpty: '勾选空译文',
    optWorkspaceSyncVisible: '联动当前可见',
    optWorkspaceSyncContext: '联动当前上下文',
    optWorkspaceSyncAll: '联动全部条目',
    uiLangZhCN: '简体中文',
    uiLangEn: 'English',
    uiLangZhTW: '繁體中文',
    uiLangKo: '한국어',
    uiLangJa: '日本語',
    uiLangRu: 'Русский',
    providerOpenAICompatible: 'OpenAI 兼容',
    providerDeepSeek: 'DeepSeek',
    providerSiliconFlow: '硅基流动',
    providerMiMo: 'MiMo',
    providerCustom: '自定义',
    providerGemini: 'Gemini',
    btnGenPot: '生成 POT',
    btnPreparePo: '生成 POT + PO',
    btnExtractPoToWorkspace: '提取 PO 待翻译文本',
    btnApplyWorkspaceToPo: '应用工作区到 PO',
    btnScanMods: '扫描 MOD',
    btnSelectAllMods: '全选',
    btnClearModSelection: '清空选择',
    btnUseSelectedMod: '使用首个选中 MOD',
    btnGenPoAppend: '添加新内容到 PO',
    btnGenPoRewrite: '重写生成 PO',
    btnLoadPo: '加载 PO',
    btnSavePo: '保存 PO',
    btnSaveAllPo: '保存全部已修改 PO',
    btnCompileMo: '导出 MO',
    btnConvertPo: '执行转换',
    btnCleanupPlural: '清理空复数字段',
    btnBridgeInlineToLang: '迁移内嵌译文到 Lang',
    btnBridgePoToCode: 'PO 反向写回代码',
    phImportDir: '选择或输入导入目录',
    phExportDir: '选择或输入导出目录',
    phRegex: '为空则整段匹配文本文件',
    phIncludeKeyRegex: '例如 ^(name|description|text)$',
    phExcludeKeyRegex: '例如 ^(id|type)$',
    phIncludePathRegex: '例如 ^items\\.\\d+\\.name',
    phExcludePathRegex: '例如 .*\\.obsolete\\..*',
    phLangDir: '选择游戏版本对应的 lang 目录',
    phPythonPath: '留空则优先用程序目录 runtime/python/python.exe',
    phGettextPath: '填写 msgfmt/msginit 所在目录',
    phWorkspaceSearch: '搜索源文或译文'
  },
  en: {
    appTitle: 'CDDA/CBN Mod Translator',
    labelUiLanguage: 'UI Language',
    labelWorkMode: 'Work Mode',
    workModeMod: 'MOD Language Tools',
    workModeKeyword: 'Keyword Extraction',
    workModePoConvert: 'PO Simplified/Traditional Conversion',
    workModeCodeBridge: 'Code/Lang Bridge',
    titleLangTools: 'MOD Language Tools',
    titlePoConvert: 'PO Simplified/Traditional Conversion',
    labelLangDir: 'External lang Directory',
    labelLangMode: 'Lang Mode',
    optLangModeCbn: 'CBN',
    optLangModeCdda: 'CDDA',
    labelPoLanguage: 'PO Language Code',
    labelPoLanguageCustom: 'Custom Language Code',
    labelPythonPath: 'Python Path (Optional)',
    labelGettextPath: 'Gettext Path (Optional)',
    labelModRootDir: 'MOD Parent Directory (Auto Scan)',
    labelModList: 'MOD List (Multi-select)',
    labelPoEditor: 'PO Text Editor',
    labelCodeBridge: 'Code/Lang Bridge',
    labelBridgeTranslatedModDir: 'Translated MOD Directory',
    labelBridgeOutputDir: 'Reverse Output Directory',
    labelBridgeSourceLangCode: 'Source Language Code Token',
    labelBridgeTargetLangCode: 'Target Language Code Token',
    labelBridgeOperationMode: 'Bridge Operation',
    optBridgeOperationInline: 'Migrate Inline Translation to Lang',
    optBridgeOperationReverse: 'Apply PO Back To Code',
    labelBridgeConflictStrategy: 'Conflict Strategy',
    labelBridgeArrayMatchById: 'Match Array Items By id',
    optBridgeConflictSkip: 'Skip Conflicts',
    optBridgeConflictFrequency: 'Prefer Most Frequent',
    optBridgeConflictFrequency2: 'Prefer Most Frequent 2 (pick first on tie)',
    bridgeUsageHintInline: 'Inline migration mode: set translated MOD directory and target language, then optionally choose conflict strategy.',
    bridgeUsageHintReverse: 'Reverse mode: set output directory and source/target language codes to apply PO back into a copied code directory.',
    bridgeUsageHint: 'Usage: choose original MOD first, set translated MOD dir to migrate; you can set conflict strategy and array id matching. Reverse apply needs output dir and source/target language codes',
    labelAuthor: 'Author',
    labelContact: 'Contact',
    labelVersion: 'Version',
    labelImportDir: 'Import Directory',
    labelExportDir: 'Export Directory',
    labelIncludeKeys: 'Include Keys',
    labelExcludeKeys: 'Exclude Keys',
    labelRegex: 'Text Regex',
    labelRulePreset: 'Rule Preset',
    labelIncludeKeyRegex: 'Include Key Regex',
    labelExcludeKeyRegex: 'Exclude Key Regex',
    labelIncludePathRegex: 'Include Path Regex',
    labelExcludePathRegex: 'Exclude Path Regex',
    labelSkipEmpty: 'Skip Empty Text',
    titleAiConfig: 'AI Settings',
    labelProvider: 'Provider',
    labelModel: 'Model',
    labelApiKey: 'API Key',
    labelRememberKey: 'Remember API Key',
    labelTargetLang: 'Target Language',
    labelTimeoutSec: 'API Timeout (sec)',
    labelBatchSize: 'Batch Size',
    labelBatchTokenLimit: 'Batch Token Limit',
    labelConcurrency: 'Batch Concurrency',
    labelRpmLimit: 'RPM Limit (requests/min)',
    labelTpmLimit: 'TPM Limit (tokens/min)',
    labelMaxRetries: 'Retry Count',
    labelSystemPrompt: 'System Prompt',
    labelUserPrefix: 'User Prompt Prefix',
    titleStatus: 'Status',
    titleWorkspace: 'Translation Workspace',
    labelWorkspaceShowSelectedOnly: 'Show Selected Only',
    labelWorkspaceShowEmptyOnly: 'Show Empty Only',
    labelWorkspaceSyncSameSource: 'Sync Same Source',
    optCustom: 'Custom',
    btnChoose: 'Choose',
    btnSavePreset: 'Save Current Preset',
    btnImportPreset: 'Import Preset JSON',
    btnNewPreset: 'Save As New Preset',
    btnDeletePreset: 'Delete Custom Preset',
    btnExportPreset: 'Export Current Preset JSON',
    btnScan: 'Scan',
    btnTestApi: 'Test API',
    btnTranslate: 'Translate Selected',
    btnStop: 'Stop',
    btnResume: 'Resume',
    btnExport: 'Export',
    btnWorkspaceSelectAll: 'Select All',
    btnWorkspaceInvert: 'Invert Selection',
    btnWorkspaceSelectEmpty: 'Select Empty Targets',
    optWorkspaceSyncVisible: 'Sync Visible',
    optWorkspaceSyncContext: 'Sync Context',
    optWorkspaceSyncAll: 'Sync All',
    uiLangZhCN: 'Simplified Chinese',
    uiLangEn: 'English',
    uiLangZhTW: 'Traditional Chinese',
    uiLangKo: 'Korean',
    uiLangJa: 'Japanese',
    uiLangRu: 'Russian',
    providerOpenAICompatible: 'OpenAI Compatible',
    providerDeepSeek: 'DeepSeek',
    providerSiliconFlow: 'SiliconFlow',
    providerMiMo: 'MiMo',
    providerCustom: 'Custom',
    providerGemini: 'Gemini',
    btnGenPot: 'Generate POT',
    btnPreparePo: 'Generate POT + PO',
    btnExtractPoToWorkspace: 'Extract PO Entries',
    btnApplyWorkspaceToPo: 'Apply Workspace to PO',
    btnScanMods: 'Scan MODs',
    btnSelectAllMods: 'Select All',
    btnClearModSelection: 'Clear Selection',
    btnUseSelectedMod: 'Use First Selected MOD',
    btnGenPoAppend: 'Append New Entries to PO',
    btnGenPoRewrite: 'Regenerate PO (Overwrite)',
    btnLoadPo: 'Load PO',
    btnSavePo: 'Save PO',
    btnSaveAllPo: 'Save All Modified POs',
    btnCompileMo: 'Export MO',
    btnConvertPo: 'Run Conversion',
    btnCleanupPlural: 'Cleanup Empty Plural Field',
    btnBridgeInlineToLang: 'Migrate Inline Translation to Lang',
    btnBridgePoToCode: 'Apply PO Back To Code',
    phImportDir: 'Choose or input import directory',
    phExportDir: 'Choose or input export directory',
    phRegex: 'Empty means whole-line matching in text files',
    phIncludeKeyRegex: 'e.g. ^(name|description|text)$',
    phExcludeKeyRegex: 'e.g. ^(id|type)$',
    phIncludePathRegex: 'e.g. ^items\\.\\d+\\.name',
    phExcludePathRegex: 'e.g. .*\\.obsolete\\..*',
    phLangDir: 'Choose the lang directory of your game version',
    phPythonPath: 'Empty means prefer runtime/python/python.exe',
    phGettextPath: 'Directory containing msgfmt/msginit',
    phWorkspaceSearch: 'Search source or translation'
  },
  'zh-TW': {
    appTitle: 'CDDA/CBN Mod 翻譯工具',
    labelUiLanguage: '介面語言',
    labelWorkMode: '工作模式',
    workModeMod: 'MOD 語言工具',
    workModeKeyword: '關鍵字提取翻譯',
    workModePoConvert: 'PO 簡繁轉換',
    workModeCodeBridge: '代碼與 Lang 橋接',
    titleLangTools: 'MOD 語言工具',
    titlePoConvert: 'PO 簡繁轉換',
    labelLangDir: '外置 lang 目錄',
    labelLangMode: 'Lang 模式',
    optLangModeCbn: 'CBN',
    optLangModeCdda: 'CDDA',
    labelPoLanguage: 'PO 語言代碼',
    labelPoLanguageCustom: '自訂語言代碼',
    labelPythonPath: 'Python 路徑（可選）',
    labelGettextPath: 'Gettext 路徑（可選）',
    labelModRootDir: 'MOD 所在目錄（自動掃描）',
    labelModList: 'MOD 清單（可多選）',
    labelPoEditor: 'PO 文字編輯',
    labelCodeBridge: '代碼與 Lang 橋接',
    labelBridgeTranslatedModDir: '翻譯版 MOD 目錄',
    labelBridgeOutputDir: '反向轉換輸出目錄',
    labelBridgeSourceLangCode: '源語言代碼標記',
    labelBridgeTargetLangCode: '目標語言代碼標記',
    labelBridgeOperationMode: '橋接操作',
    optBridgeOperationInline: '遷移內嵌譯文到 Lang',
    optBridgeOperationReverse: 'PO 反向寫回代碼',
    labelBridgeConflictStrategy: '衝突處理策略',
    labelBridgeArrayMatchById: '陣列按 id 對齊',
    optBridgeConflictSkip: '衝突跳過',
    optBridgeConflictFrequency: '頻次優先',
    optBridgeConflictFrequency2: '頻次優先2（平票選第一個）',
    bridgeUsageHintInline: '遷移模式：選擇翻譯版 MOD 目錄與目標語言代碼，衝突策略可選。',
    bridgeUsageHintReverse: '反向模式：填寫輸出目錄與源/目標語言代碼，將 PO 寫回代碼目錄副本。',
    bridgeUsageHint: '用法：先選原 MOD，再填翻譯版 MOD 目錄執行遷移；可選衝突策略與陣列按 id 對齊。反向寫回需填寫輸出目錄與源/目標語言代碼',
    labelAuthor: '作者',
    labelContact: '聯絡方式',
    labelVersion: '版本號',
    labelImportDir: '匯入目錄',
    labelExportDir: '匯出目錄',
    labelIncludeKeys: '允許鍵',
    labelExcludeKeys: '排除鍵',
    labelRegex: '文字正則',
    labelRulePreset: '規則預設',
    labelIncludeKeyRegex: '包含鍵正則',
    labelExcludeKeyRegex: '排除鍵正則',
    labelIncludePathRegex: '包含路徑正則',
    labelExcludePathRegex: '排除路徑正則',
    labelSkipEmpty: '略過空白文字',
    titleAiConfig: 'AI 設定',
    labelProvider: '服務商',
    labelModel: '模型',
    labelApiKey: 'API Key',
    labelRememberKey: '記住 API Key',
    labelTargetLang: '目標語言',
    labelTimeoutSec: 'API 逾時（秒）',
    labelBatchSize: '批次條數',
    labelBatchTokenLimit: '批次 Token 上限',
    labelConcurrency: '並發批次數',
    labelRpmLimit: 'RPM 上限（每分鐘請求）',
    labelTpmLimit: 'TPM 上限（每分鐘 Token）',
    labelMaxRetries: '失敗重試次數',
    labelSystemPrompt: '系統提示詞',
    labelUserPrefix: '使用者提示前綴',
    titleStatus: '狀態',
    titleWorkspace: '翻譯工作區',
    labelWorkspaceShowSelectedOnly: '僅顯示已勾選',
    labelWorkspaceShowEmptyOnly: '僅顯示空譯文',
    labelWorkspaceSyncSameSource: '同源文本聯動',
    optCustom: '自訂',
    btnChoose: '選擇',
    btnSavePreset: '儲存目前預設',
    btnImportPreset: '匯入預設 JSON',
    btnNewPreset: '另存為新預設',
    btnDeletePreset: '刪除自訂預設',
    btnExportPreset: '匯出目前預設 JSON',
    btnScan: '掃描',
    btnTestApi: '測試 API',
    btnTranslate: '翻譯選中',
    btnStop: '中止',
    btnResume: '繼續翻譯',
    btnExport: '匯出',
    btnWorkspaceSelectAll: '全部勾選',
    btnWorkspaceInvert: '反向勾選',
    btnWorkspaceSelectEmpty: '勾選空譯文',
    optWorkspaceSyncVisible: '聯動當前可見',
    optWorkspaceSyncContext: '聯動當前上下文',
    optWorkspaceSyncAll: '聯動全部條目',
    uiLangZhCN: '簡體中文',
    uiLangEn: 'English',
    uiLangZhTW: '繁體中文',
    uiLangKo: '韓文',
    uiLangJa: '日文',
    uiLangRu: '俄文',
    providerOpenAICompatible: 'OpenAI 相容',
    providerDeepSeek: 'DeepSeek',
    providerSiliconFlow: '矽基流動',
    providerMiMo: 'MiMo',
    providerCustom: '自訂',
    providerGemini: 'Gemini',
    btnGenPot: '生成 POT',
    btnPreparePo: '生成 POT + PO',
    btnExtractPoToWorkspace: '提取 PO 待翻譯文本',
    btnApplyWorkspaceToPo: '應用工作區到 PO',
    btnScanMods: '掃描 MOD',
    btnSelectAllMods: '全選',
    btnClearModSelection: '清空選擇',
    btnUseSelectedMod: '使用首個選中 MOD',
    btnGenPoAppend: '新增內容到 PO',
    btnGenPoRewrite: '重寫生成 PO',
    btnLoadPo: '載入 PO',
    btnSavePo: '儲存 PO',
    btnSaveAllPo: '儲存全部已修改 PO',
    btnCompileMo: '匯出 MO',
    btnConvertPo: '執行轉換',
    btnCleanupPlural: '清理空複數欄位',
    btnBridgeInlineToLang: '遷移內嵌譯文到 Lang',
    btnBridgePoToCode: 'PO 反向寫回代碼',
    phImportDir: '選擇或輸入匯入目錄',
    phExportDir: '選擇或輸入匯出目錄',
    phRegex: '留空則整段匹配文字檔',
    phIncludeKeyRegex: '例如 ^(name|description|text)$',
    phExcludeKeyRegex: '例如 ^(id|type)$',
    phIncludePathRegex: '例如 ^items\\.\\d+\\.name',
    phExcludePathRegex: '例如 .*\\.obsolete\\..*',
    phLangDir: '選擇遊戲版本對應的 lang 目錄',
    phPythonPath: '留空則優先用程式目錄 runtime/python/python.exe',
    phGettextPath: '填寫 msgfmt/msginit 所在目錄',
    phWorkspaceSearch: '搜尋源文或譯文'
  }
} as const;

type I18nKey = keyof (typeof I18N)['zh-CN'];
type I18nPack = Record<I18nKey, string>;

const I18N_PACKS: Record<UiLang, I18nPack> = {
  'zh-CN': I18N['zh-CN'] as I18nPack,
  en: I18N.en as I18nPack,
  'zh-TW': I18N['zh-TW'] as I18nPack,
  ko: {
    ...(I18N.en as I18nPack),
    appTitle: 'CDDA/CBN 모드 번역 도구',
    labelUiLanguage: '인터페이스 언어',
    labelWorkMode: '작업 모드',
    workModeMod: 'MOD 언어 도구',
    workModeKeyword: '키워드 추출 번역',
    workModePoConvert: 'PO 간체/번체 변환',
    workModeCodeBridge: '코드/Lang 브리지',
    titleLangTools: 'MOD 언어 도구',
    titlePoConvert: 'PO 간체/번체 변환',
    labelLangDir: '외부 lang 디렉터리',
    labelLangMode: 'Lang 모드',
    optLangModeCbn: 'CBN',
    optLangModeCdda: 'CDDA',
    labelPoLanguage: 'PO 언어 코드',
    labelPoLanguageCustom: '사용자 정의 언어 코드',
    labelPythonPath: 'Python 경로 (선택 사항)',
    labelGettextPath: 'Gettext 경로 (선택 사항)',
    labelModRootDir: 'MOD 상위 디렉터리 (자동 스캔)',
    labelModList: 'MOD 목록 (다중 선택)',
    labelPoEditor: 'PO 텍스트 편집기',
    labelCodeBridge: '코드/Lang 브리지',
    labelBridgeTranslatedModDir: '번역된 MOD 디렉터리',
    labelBridgeOutputDir: '역변환 출력 디렉터리',
    labelBridgeSourceLangCode: '원본 언어 코드 토큰',
    labelBridgeTargetLangCode: '대상 언어 코드 토큰',
    labelBridgeOperationMode: '브리지 작업',
    optBridgeOperationInline: '인라인 번역을 Lang으로 이동',
    optBridgeOperationReverse: 'PO를 코드로 역적용',
    labelBridgeConflictStrategy: '충돌 처리 전략',
    labelBridgeArrayMatchById: '배열 항목을 id로 정렬',
    optBridgeConflictSkip: '충돌 건너뛰기',
    optBridgeConflictFrequency: '출현 빈도 우선',
    optBridgeConflictFrequency2: '출현 빈도 우선2 (동률 시 첫 항목)',
    bridgeUsageHintInline: '이동 모드: 번역된 MOD 디렉터리와 대상 언어를 지정하고 필요 시 충돌 전략을 선택하세요.',
    bridgeUsageHintReverse: '역적용 모드: 출력 디렉터리와 원본/대상 언어 코드를 지정해 PO를 코드 복사본에 반영합니다.',
    bridgeUsageHint: '사용법: 먼저 원본 MOD를 선택하고 번역된 MOD 경로를 지정해 이동하세요. 역적용은 출력 경로와 원본/대상 언어 코드가 필요합니다.',
    labelAuthor: '작성자',
    labelContact: '연락처',
    labelVersion: '버전',
    labelImportDir: '가져오기 디렉터리',
    labelExportDir: '내보내기 디렉터리',
    labelIncludeKeys: '포함 키',
    labelExcludeKeys: '제외 키',
    labelRegex: '텍스트 정규식',
    labelRulePreset: '규칙 프리셋',
    labelIncludeKeyRegex: '포함 키 정규식',
    labelExcludeKeyRegex: '제외 키 정규식',
    labelIncludePathRegex: '포함 경로 정규식',
    labelExcludePathRegex: '제외 경로 정규식',
    labelSkipEmpty: '빈 텍스트 건너뛰기',
    titleAiConfig: 'AI 설정',
    labelProvider: '제공자',
    labelModel: '모델',
    labelApiKey: 'API Key',
    labelRememberKey: 'API Key 기억',
    labelTargetLang: '대상 언어',
    labelTimeoutSec: 'API 타임아웃 (초)',
    labelBatchSize: '배치 크기',
    labelBatchTokenLimit: '배치 Token 상한',
    labelConcurrency: '배치 동시성',
    labelRpmLimit: 'RPM 상한 (분당 요청)',
    labelTpmLimit: 'TPM 상한 (분당 Token)',
    labelMaxRetries: '재시도 횟수',
    labelSystemPrompt: '시스템 프롬프트',
    labelUserPrefix: '사용자 프롬프트 접두사',
    titleStatus: '상태',
    titleWorkspace: '번역 작업 공간',
    labelWorkspaceShowSelectedOnly: '선택 항목만 표시',
    labelWorkspaceShowEmptyOnly: '빈 번역만 표시',
    labelWorkspaceSyncSameSource: '동일 원문 동기화',
    optCustom: '사용자 정의',
    optWorkspaceSyncVisible: '현재 표시 범위 동기화',
    optWorkspaceSyncContext: '현재 문맥 동기화',
    optWorkspaceSyncAll: '전체 항목 동기화',
    providerOpenAICompatible: 'OpenAI 호환',
    providerDeepSeek: 'DeepSeek',
    providerSiliconFlow: 'SiliconFlow',
    providerMiMo: 'MiMo',
    providerCustom: '사용자 정의',
    providerGemini: 'Gemini',
    phImportDir: '가져오기 디렉터리를 선택하거나 입력하세요',
    phExportDir: '내보내기 디렉터리를 선택하거나 입력하세요',
    phRegex: '비워두면 텍스트 파일의 전체 라인을 매칭합니다',
    phIncludeKeyRegex: '예: ^(name|description|text)$',
    phExcludeKeyRegex: '예: ^(id|type)$',
    phIncludePathRegex: '예: ^items\\.\\d+\\.name',
    phExcludePathRegex: '예: .*\\.obsolete\\..*',
    phLangDir: '게임 버전에 맞는 lang 디렉터리를 선택하세요',
    phPythonPath: '비우면 runtime/python/python.exe를 우선 사용합니다',
    phGettextPath: 'msgfmt/msginit가 있는 디렉터리',
    phWorkspaceSearch: '원문 또는 번역문 검색',
    btnChoose: '선택',
    btnSavePreset: '현재 프리셋 저장',
    btnImportPreset: '프리셋 JSON 가져오기',
    btnNewPreset: '새 프리셋으로 저장',
    btnDeletePreset: '사용자 프리셋 삭제',
    btnExportPreset: '현재 프리셋 JSON 내보내기',
    btnScan: '스캔',
    btnTestApi: 'API 테스트',
    btnTranslate: '선택 항목 번역',
    btnStop: '중지',
    btnResume: '번역 계속',
    btnExport: '내보내기',
    btnWorkspaceSelectAll: '전체 선택',
    btnWorkspaceInvert: '선택 반전',
    btnWorkspaceSelectEmpty: '빈 번역 선택',
    btnGenPot: 'POT 생성',
    btnPreparePo: 'POT + PO 생성',
    btnExtractPoToWorkspace: 'PO 번역 항목 추출',
    btnApplyWorkspaceToPo: '작업공간 내용을 PO에 적용',
    btnScanMods: 'MOD 스캔',
    btnSelectAllMods: '전체 선택',
    btnClearModSelection: '선택 해제',
    btnUseSelectedMod: '첫 번째 선택 MOD 사용',
    btnGenPoAppend: 'PO에 새 항목 추가',
    btnGenPoRewrite: 'PO 다시 생성(덮어쓰기)',
    btnLoadPo: 'PO 불러오기',
    btnSavePo: 'PO 저장',
    btnSaveAllPo: '수정된 모든 PO 저장',
    btnCompileMo: 'MO 내보내기',
    btnConvertPo: '변환 실행',
    btnCleanupPlural: '빈 복수형 필드 정리',
    btnBridgeInlineToLang: '인라인 번역을 Lang으로 이동',
    btnBridgePoToCode: 'PO를 코드에 역적용',
    uiLangZhCN: '중국어 간체',
    uiLangEn: 'English',
    uiLangZhTW: '중국어 번체',
    uiLangKo: '한국어',
    uiLangJa: '일본어',
    uiLangRu: '러시아어'
  },
  ja: {
    ...(I18N.en as I18nPack),
    appTitle: 'CDDA/CBN Mod 翻訳ツール',
    labelUiLanguage: '表示言語',
    labelWorkMode: '作業モード',
    workModeMod: 'MOD 言語ツール',
    workModeKeyword: 'キーワード抽出翻訳',
    workModePoConvert: 'PO 簡体/繁体変換',
    workModeCodeBridge: 'コード/Lang ブリッジ',
    titleLangTools: 'MOD 言語ツール',
    titlePoConvert: 'PO 簡体/繁体変換',
    labelLangDir: '外部 lang ディレクトリ',
    labelLangMode: 'Lang モード',
    optLangModeCbn: 'CBN',
    optLangModeCdda: 'CDDA',
    labelPoLanguage: 'PO 言語コード',
    labelPoLanguageCustom: 'カスタム言語コード',
    labelPythonPath: 'Python パス（任意）',
    labelGettextPath: 'Gettext パス（任意）',
    labelModRootDir: 'MOD 親ディレクトリ（自動スキャン）',
    labelModList: 'MOD 一覧（複数選択）',
    labelPoEditor: 'PO テキストエディタ',
    labelCodeBridge: 'コード/Lang ブリッジ',
    labelBridgeTranslatedModDir: '翻訳済み MOD ディレクトリ',
    labelBridgeOutputDir: '逆変換出力ディレクトリ',
    labelBridgeSourceLangCode: '元言語コードトークン',
    labelBridgeTargetLangCode: '対象言語コードトークン',
    labelBridgeOperationMode: 'ブリッジ操作',
    optBridgeOperationInline: '埋め込み翻訳を Lang へ移行',
    optBridgeOperationReverse: 'PO をコードへ逆適用',
    labelBridgeConflictStrategy: '競合処理',
    labelBridgeArrayMatchById: '配列項目を id で整列',
    optBridgeConflictSkip: '競合をスキップ',
    optBridgeConflictFrequency: '出現頻度を優先',
    optBridgeConflictFrequency2: '出現頻度優先2（同率時は先頭）',
    bridgeUsageHintInline: '移行モード: 翻訳済み MOD ディレクトリと対象言語を指定し、必要なら競合処理を選択します。',
    bridgeUsageHintReverse: '逆適用モード: 出力先と元/対象言語コードを指定し、PO をコードのコピーに反映します。',
    bridgeUsageHint: '使い方: 先に元 MOD を選択し、翻訳済み MOD を指定して移行します。逆適用は出力先と元/対象言語コードが必要です。',
    labelAuthor: '作者',
    labelContact: '連絡先',
    labelVersion: 'バージョン',
    labelImportDir: '入力ディレクトリ',
    labelExportDir: '出力ディレクトリ',
    labelIncludeKeys: '対象キー',
    labelExcludeKeys: '除外キー',
    labelRegex: 'テキスト正規表現',
    labelRulePreset: 'ルールプリセット',
    labelIncludeKeyRegex: '対象キー正規表現',
    labelExcludeKeyRegex: '除外キー正規表現',
    labelIncludePathRegex: '対象パス正規表現',
    labelExcludePathRegex: '除外パス正規表現',
    labelSkipEmpty: '空テキストをスキップ',
    titleAiConfig: 'AI 設定',
    labelProvider: 'プロバイダー',
    labelModel: 'モデル',
    labelApiKey: 'API Key',
    labelRememberKey: 'API Key を記憶',
    labelTargetLang: '対象言語',
    labelTimeoutSec: 'API タイムアウト（秒）',
    labelBatchSize: 'バッチ件数',
    labelBatchTokenLimit: 'バッチ Token 上限',
    labelConcurrency: 'バッチ並列数',
    labelRpmLimit: 'RPM 上限（分あたり）',
    labelTpmLimit: 'TPM 上限（分あたり）',
    labelMaxRetries: '再試行回数',
    labelSystemPrompt: 'システムプロンプト',
    labelUserPrefix: 'ユーザープロンプト接頭辞',
    titleStatus: 'ステータス',
    titleWorkspace: '翻訳ワークスペース',
    labelWorkspaceShowSelectedOnly: '選択項目のみ表示',
    labelWorkspaceShowEmptyOnly: '未翻訳のみ表示',
    labelWorkspaceSyncSameSource: '同一原文を同期',
    optCustom: 'カスタム',
    optWorkspaceSyncVisible: '表示範囲を同期',
    optWorkspaceSyncContext: '現在の文脈を同期',
    optWorkspaceSyncAll: 'すべて同期',
    providerOpenAICompatible: 'OpenAI 互換',
    providerDeepSeek: 'DeepSeek',
    providerSiliconFlow: 'SiliconFlow',
    providerMiMo: 'MiMo',
    providerCustom: 'カスタム',
    providerGemini: 'Gemini',
    phImportDir: '入力ディレクトリを選択または入力',
    phExportDir: '出力ディレクトリを選択または入力',
    phRegex: '空欄の場合はテキストファイルの全行を対象',
    phIncludeKeyRegex: '例: ^(name|description|text)$',
    phExcludeKeyRegex: '例: ^(id|type)$',
    phIncludePathRegex: '例: ^items\\.\\d+\\.name',
    phExcludePathRegex: '例: .*\\.obsolete\\..*',
    phLangDir: 'ゲームバージョンに対応する lang ディレクトリを選択',
    phPythonPath: '空欄の場合は runtime/python/python.exe を優先',
    phGettextPath: 'msgfmt/msginit があるディレクトリ',
    phWorkspaceSearch: '原文または訳文を検索',
    btnChoose: '選択',
    btnSavePreset: '現在のプリセットを保存',
    btnImportPreset: 'プリセット JSON をインポート',
    btnNewPreset: '新しいプリセットとして保存',
    btnDeletePreset: 'カスタムプリセットを削除',
    btnExportPreset: '現在のプリセット JSON をエクスポート',
    btnScan: 'スキャン',
    btnTestApi: 'API テスト',
    btnTranslate: '選択項目を翻訳',
    btnStop: '停止',
    btnResume: '翻訳を再開',
    btnExport: 'エクスポート',
    btnWorkspaceSelectAll: 'すべて選択',
    btnWorkspaceInvert: '選択を反転',
    btnWorkspaceSelectEmpty: '未翻訳を選択',
    btnGenPot: 'POT を生成',
    btnPreparePo: 'POT + PO を生成',
    btnExtractPoToWorkspace: 'PO 翻訳項目を抽出',
    btnApplyWorkspaceToPo: 'ワークスペース内容を PO に適用',
    btnScanMods: 'MOD をスキャン',
    btnSelectAllMods: 'すべて選択',
    btnClearModSelection: '選択解除',
    btnUseSelectedMod: '最初の選択 MOD を使用',
    btnGenPoAppend: 'PO に新規項目を追加',
    btnGenPoRewrite: 'PO を再生成（上書き）',
    btnLoadPo: 'PO を読み込む',
    btnSavePo: 'PO を保存',
    btnSaveAllPo: '変更済み PO をすべて保存',
    btnCompileMo: 'MO をエクスポート',
    btnConvertPo: '変換を実行',
    btnCleanupPlural: '空の複数形フィールドを整理',
    btnBridgeInlineToLang: 'インライン翻訳を Lang へ移行',
    btnBridgePoToCode: 'PO をコードへ逆書き戻し',
    uiLangZhCN: '簡体字中国語',
    uiLangEn: 'English',
    uiLangZhTW: '繁体字中国語',
    uiLangKo: '韓国語',
    uiLangJa: '日本語',
    uiLangRu: 'ロシア語'
  },
  ru: {
    ...(I18N.en as I18nPack),
    appTitle: 'Инструмент перевода модов CDDA/CBN',
    labelUiLanguage: 'Язык интерфейса',
    labelWorkMode: 'Режим работы',
    workModeMod: 'Языковые инструменты MOD',
    workModeKeyword: 'Перевод по извлечению ключей',
    workModePoConvert: 'Преобразование PO упрощ./традиц.',
    workModeCodeBridge: 'Мост Code/Lang',
    titleLangTools: 'Языковые инструменты MOD',
    titlePoConvert: 'Преобразование PO упрощ./традиц.',
    labelLangDir: 'Внешний каталог lang',
    labelLangMode: 'Режим Lang',
    optLangModeCbn: 'CBN',
    optLangModeCdda: 'CDDA',
    labelPoLanguage: 'Код языка PO',
    labelPoLanguageCustom: 'Пользовательский код языка',
    labelPythonPath: 'Путь Python (необязательно)',
    labelGettextPath: 'Путь Gettext (необязательно)',
    labelModRootDir: 'Каталог MOD (автосканирование)',
    labelModList: 'Список MOD (множественный выбор)',
    labelPoEditor: 'Текстовый редактор PO',
    labelCodeBridge: 'Мост Code/Lang',
    labelBridgeTranslatedModDir: 'Каталог переведённого MOD',
    labelBridgeOutputDir: 'Каталог вывода обратного преобразования',
    labelBridgeSourceLangCode: 'Токен кода исходного языка',
    labelBridgeTargetLangCode: 'Токен кода целевого языка',
    labelBridgeOperationMode: 'Операция моста',
    optBridgeOperationInline: 'Перенести встроенный перевод в Lang',
    optBridgeOperationReverse: 'Обратно применить PO к коду',
    labelBridgeConflictStrategy: 'Стратегия конфликтов',
    labelBridgeArrayMatchById: 'Сопоставлять элементы массива по id',
    optBridgeConflictSkip: 'Пропускать конфликты',
    optBridgeConflictFrequency: 'Приоритет частоты',
    optBridgeConflictFrequency2: 'Приоритет частоты 2 (при равенстве первый)',
    bridgeUsageHintInline: 'Режим переноса: укажите каталог переведённого MOD и язык, при необходимости выберите стратегию конфликтов.',
    bridgeUsageHintReverse: 'Обратный режим: задайте каталог вывода и коды исходного/целевого языков для записи PO в копию кода.',
    bridgeUsageHint: 'Использование: сначала выберите исходный MOD, затем каталог переведённого MOD для переноса. Для обратной записи нужен каталог вывода и коды языков.',
    labelAuthor: 'Автор',
    labelContact: 'Контакт',
    labelVersion: 'Версия',
    labelImportDir: 'Каталог импорта',
    labelExportDir: 'Каталог экспорта',
    labelIncludeKeys: 'Включаемые ключи',
    labelExcludeKeys: 'Исключаемые ключи',
    labelRegex: 'Регулярное выражение текста',
    labelRulePreset: 'Пресет правил',
    labelIncludeKeyRegex: 'Regex включаемых ключей',
    labelExcludeKeyRegex: 'Regex исключаемых ключей',
    labelIncludePathRegex: 'Regex включаемых путей',
    labelExcludePathRegex: 'Regex исключаемых путей',
    labelSkipEmpty: 'Пропускать пустой текст',
    titleAiConfig: 'Настройки AI',
    labelProvider: 'Провайдер',
    labelModel: 'Модель',
    labelApiKey: 'API Key',
    labelRememberKey: 'Запомнить API Key',
    labelTargetLang: 'Целевой язык',
    labelTimeoutSec: 'Таймаут API (сек)',
    labelBatchSize: 'Размер пакета',
    labelBatchTokenLimit: 'Лимит Token в пакете',
    labelConcurrency: 'Параллельность пакетов',
    labelRpmLimit: 'Лимит RPM (запросов/мин)',
    labelTpmLimit: 'Лимит TPM (token/мин)',
    labelMaxRetries: 'Количество повторов',
    labelSystemPrompt: 'Системный промпт',
    labelUserPrefix: 'Префикс пользовательского промпта',
    titleStatus: 'Статус',
    titleWorkspace: 'Рабочая область перевода',
    labelWorkspaceShowSelectedOnly: 'Показывать только выбранные',
    labelWorkspaceShowEmptyOnly: 'Показывать только пустые',
    labelWorkspaceSyncSameSource: 'Синхронизировать одинаковый исходник',
    optCustom: 'Пользовательский',
    optWorkspaceSyncVisible: 'Синхронизировать видимые',
    optWorkspaceSyncContext: 'Синхронизировать текущий контекст',
    optWorkspaceSyncAll: 'Синхронизировать все',
    providerOpenAICompatible: 'OpenAI совместимый',
    providerDeepSeek: 'DeepSeek',
    providerSiliconFlow: 'SiliconFlow',
    providerMiMo: 'MiMo',
    providerCustom: 'Пользовательский',
    providerGemini: 'Gemini',
    phImportDir: 'Выберите или введите каталог импорта',
    phExportDir: 'Выберите или введите каталог экспорта',
    phRegex: 'Пусто — сопоставление всей строки в текстовых файлах',
    phIncludeKeyRegex: 'например ^(name|description|text)$',
    phExcludeKeyRegex: 'например ^(id|type)$',
    phIncludePathRegex: 'например ^items\\.\\d+\\.name',
    phExcludePathRegex: 'например .*\\.obsolete\\..*',
    phLangDir: 'Выберите каталог lang для вашей версии игры',
    phPythonPath: 'Пусто — использовать runtime/python/python.exe',
    phGettextPath: 'Каталог, содержащий msgfmt/msginit',
    phWorkspaceSearch: 'Поиск по исходному и переводу',
    btnChoose: 'Выбрать',
    btnSavePreset: 'Сохранить текущий пресет',
    btnImportPreset: 'Импортировать пресет JSON',
    btnNewPreset: 'Сохранить как новый пресет',
    btnDeletePreset: 'Удалить пользовательский пресет',
    btnExportPreset: 'Экспортировать текущий пресет JSON',
    btnScan: 'Сканировать',
    btnTestApi: 'Проверить API',
    btnTranslate: 'Перевести выбранное',
    btnStop: 'Остановить',
    btnResume: 'Продолжить перевод',
    btnExport: 'Экспорт',
    btnWorkspaceSelectAll: 'Выбрать все',
    btnWorkspaceInvert: 'Инвертировать выбор',
    btnWorkspaceSelectEmpty: 'Выбрать пустые переводы',
    btnGenPot: 'Сгенерировать POT',
    btnPreparePo: 'Сгенерировать POT + PO',
    btnExtractPoToWorkspace: 'Извлечь строки PO для перевода',
    btnApplyWorkspaceToPo: 'Применить рабочую область к PO',
    btnScanMods: 'Сканировать MOD',
    btnSelectAllMods: 'Выбрать все',
    btnClearModSelection: 'Снять выбор',
    btnUseSelectedMod: 'Использовать первый выбранный MOD',
    btnGenPoAppend: 'Добавить новые строки в PO',
    btnGenPoRewrite: 'Пересоздать PO (с перезаписью)',
    btnLoadPo: 'Загрузить PO',
    btnSavePo: 'Сохранить PO',
    btnSaveAllPo: 'Сохранить все изменённые PO',
    btnCompileMo: 'Экспортировать MO',
    btnConvertPo: 'Запустить преобразование',
    btnCleanupPlural: 'Очистить пустые поля множественного числа',
    btnBridgeInlineToLang: 'Перенести встроенный перевод в Lang',
    btnBridgePoToCode: 'Записать PO обратно в код',
    uiLangZhCN: 'Китайский (упрощ.)',
    uiLangEn: 'English',
    uiLangZhTW: 'Китайский (традиц.)',
    uiLangKo: 'Корейский',
    uiLangJa: 'Японский',
    uiLangRu: 'Русский'
  }
};

const RUNTIME_TEXT = {
  'zh-CN': {
    runtimeUnavailable: '运行环境异常。',
    runtimeUnavailableScan: '运行环境异常，无法扫描',
    runtimeUnavailableTest: '运行环境异常，无法测试',
    runtimeUnavailableExport: '运行环境异常，无法导出',
    runtimeUnavailableDialog: '运行环境异常，无法调用系统对话框',
    choosePresetFirst: '请先选择一个预设，或使用“另存为新预设”。',
    chooseCustomPresetFirst: '请先选择一个自定义预设。',
    builtinPresetNotDeletable: '内置预设不可删除。',
    currentPresetEmpty: '当前预设数据为空。',
    importFailed: '导入失败：{error}',
    exportFailed: '导出失败：{error}',
    exportPresetFailed: '预设导出失败：{error}',
    exportPresetDone: '预设已导出到：{path}',
    presetSaved: '预设已保存：{preset}',
    presetAdded: '已新增预设：{preset}',
    presetImported: '预设导入成功：{preset}',
    presetDeleted: '预设已删除：{preset}',
    deletePresetConfirm: '确定删除预设“{preset}”吗？',
    presetNamePrompt: '输入预设名称',
    presetNameFallback: '自定义预设',
    userConfigPath: '用户配置路径：{path}',
    apiKeyEmpty: 'API Key 为空',
    modelEmpty: '模型为空',
    baseUrlEmpty: 'Base URL 为空',
    apiConfigError: 'API 配置错误：{error}',
    scanStart: '正在扫描...',
    scanDone: '扫描完成：{count} 条文本',
    scanFailedCount: '有 {count} 个文件解析失败（已跳过）：',
    scanMoreErrors: '… 还有 {count} 个文件',
    scanFailed: '扫描失败：{error}',
    testApiStart: '正在测试 API：{baseUrl} / {model}',
    testApiSuccess: 'API 测试成功: {result}',
    testApiNoResult: 'API 测试失败：无有效返回',
    testApiFailed: 'API 测试失败：{error}',
    stopRequested: '已请求中止，等待当前批次结束...',
    selectImportFirst: '请先选择导入目录',
    scanFirst: '请先扫描',
    selectItemsFirst: '请先选择要翻译的条目',
    translateBatchStart: '正在翻译第 {index}/{total} 批 ({count} 条)...',
    translateBatchValidateFailed: '第 {index} 批校验失败（ID 不匹配或缺失），重试 {attempt}/{maxRetries}',
    progress: '进度: {processed}/{total} ({percent}%)',
    translateBatchFailed: '第 {index} 批翻译失败 (尝试 {attempt}/{maxAttempts}): {error}',
    translateBatchSkipped: '第 {index} 批彻底失败，跳过。',
    moderationSplitStart: '第 {index} 批触发风控，已自动降级为逐条翻译',
    moderationItemSkipped: '第 {index} 批条目 {item} 因风控被跳过',
    translateDone: '翻译任务结束',
    translateFlowError: '翻译流程出错：{error}',
    resumeMissingTask: '没有可恢复的任务，请先开始一次翻译',
    resumeValidateFailed: '恢复：第 {index}/{total} 批校验失败，重试 {attempt}/{maxRetries}',
    resumeProgress: '恢复进度: {processed}/{total} ({percent}%)',
    resumeBatchFailed: '恢复：第 {index} 批失败 (尝试 {attempt}/{maxAttempts}): {error}',
    resumeBatchSkipped: '恢复：第 {index} 批彻底失败，跳过。',
    resumeModerationSplitStart: '恢复：第 {index} 批触发风控，已自动降级为逐条翻译',
    resumeModerationItemSkipped: '恢复：第 {index} 批条目 {item} 因风控被跳过',
    resumeDone: '恢复任务结束',
    resumeNothingPending: '没有待恢复批次',
    resumeFlowError: '恢复流程出错：{error}',
    fillImportExport: '请填写导入和导出目录',
    exportStart: '正在导出...',
    exportDone: '导出完成',
    langConfigMissing: '请填写外置 lang 目录、MOD 所在目录和 PO 语言代码',
    langPotDone: 'POT 已生成：{path}',
    langPoDone: 'PO 已生成/更新：{path}',
    langPoLoaded: 'PO 已加载',
    langPoSaved: 'PO 已保存：{path}',
    saveAllPoDone: '已保存 {count} 个已修改 PO',
    saveAllPoNone: '没有需要保存的已修改 PO',
    guideModeMod: '模式引导：先扫描 MOD，再生成/加载 PO，按需翻译后保存并导出 MO',
    guideModeKeyword: '模式引导：先扫描文本，再测试 API，翻译后导出',
    guideModePoConvert: '模式引导：先加载或生成 PO，执行简繁转换，最后保存并导出 MO',
    guideModeCodeBridge: '模式引导：先迁移内嵌译文到 Lang，再按需执行 PO 反向写回代码',
    bridgeNeedTranslatedModDir: '请先填写翻译版 MOD 目录',
    bridgeNeedOutputDir: '请先填写反向转换输出目录',
    bridgeStartInline: '开始迁移内嵌译文到 Lang...',
    bridgeStartPoToCode: '开始执行 PO 反向写回代码...',
    bridgeInlineDone: '迁移完成：PO{poPath}，MO{moPath}，策略{strategy}，填充{filled}条，冲突{conflicts}条（已处理{conflictsResolved}条，跳过{conflictsSkipped}条），日志{logPath}',
    bridgeInlineModFailed: '迁移失败：MOD {name}，错误：{error}',
    bridgeInlineBatchSummary: '迁移汇总：共{total}个 MOD，成功{success}，失败{failed}',
    bridgePoToCodeDone: '反向完成：目录{outDir}，替换文本{replaced}，改名{renamed}',
    bridgePoToCodeModFailed: '反向失败：MOD {name}，错误：{error}',
    bridgePoToCodeBatchSummary: '反向汇总：共{total}个 MOD，成功{success}，失败{failed}',
    cleanupPluralDone: '已清理空复数字段：{count} 条',
    cleanupPluralNone: '没有可清理的空复数字段',
    nextStepAfterLoadPo: '建议下一步：执行简繁转换或编辑后保存',
    nextStepAfterConvertPo: '建议下一步：检查目标语言 PO，保存后导出 MO',
    nextStepAfterTranslate: '建议下一步：检查工作区译文后执行导出',
    nextStepAfterSavePo: '建议下一步：如需游戏内生效，请导出 MO',
    unsavedPoSwitchConfirm: '存在未保存的 PO 修改，继续切换可能遗忘保存，是否继续？',
    unsavedPoLeaveConfirm: '存在未保存的 PO 修改，确认离开页面吗？',
    unsavedPoCloseConfirm: '该 PO 标签存在未保存修改，确认关闭吗？',
    translateDedupStats: '同源去重后请求 {unique}/{total} 条，预计节省 {saved} 条',
    langMoDone: 'MO 已导出：{path}',
    langActionFailed: '操作失败：{error}',
    langRewriteConfirm: '将重写生成 {name} 的 {language}.po，并先备份为 .bak，是否继续？',
    langReadyDone: '已完成：POT + PO + 加载编辑器',
    poAiNoItems: 'PO 中没有需要 AI 翻译的空条目',
    poAiStart: '开始 AI 翻译 PO：共 {count} 条',
    poAiApplied: 'PO AI 翻译已回填：{count} 条',
    poAiNoApplied: 'AI 翻译完成，但没有可回填条目',
    poApplyStats: '回填统计 {name} · {language}: 工作区{workspace} 有效{valid} 可回填{apply}',
    modsScanned: '已扫描到 {count} 个 MOD',
    noModsFound: '未找到包含 modinfo.json 的 MOD',
    useSelectedModDone: '已使用选中 MOD：{name}',
    usingModRun: '正在处理 MOD：{name}',
    languageMismatchConfirm: 'PO 语言代码与目标语言可能不匹配（{poLanguage} ↔ {targetLang}），是否继续翻译？',
    noPoForLanguage: '当前语言 {language} 没有已加载的 PO 标签页'
  },
  en: {
    runtimeUnavailable: 'Runtime unavailable.',
    runtimeUnavailableScan: 'Runtime unavailable, cannot scan.',
    runtimeUnavailableTest: 'Runtime unavailable, cannot test.',
    runtimeUnavailableExport: 'Runtime unavailable, cannot export.',
    runtimeUnavailableDialog: 'Runtime unavailable, cannot open system dialog.',
    choosePresetFirst: 'Please choose a preset first, or use "Save As New Preset".',
    chooseCustomPresetFirst: 'Please select a custom preset first.',
    builtinPresetNotDeletable: 'Built-in presets cannot be deleted.',
    currentPresetEmpty: 'Current preset data is empty.',
    importFailed: 'Import failed: {error}',
    exportFailed: 'Export failed: {error}',
    exportPresetFailed: 'Preset export failed: {error}',
    exportPresetDone: 'Preset exported to: {path}',
    presetSaved: 'Preset saved: {preset}',
    presetAdded: 'New preset added: {preset}',
    presetImported: 'Preset imported: {preset}',
    presetDeleted: 'Preset deleted: {preset}',
    deletePresetConfirm: 'Delete preset "{preset}"?',
    presetNamePrompt: 'Enter preset name',
    presetNameFallback: 'custom-preset',
    userConfigPath: 'User config path: {path}',
    apiKeyEmpty: 'API Key is empty',
    modelEmpty: 'Model is empty',
    baseUrlEmpty: 'Base URL is empty',
    apiConfigError: 'API config error: {error}',
    scanStart: 'Scanning...',
    scanDone: 'Scan complete: {count} segments',
    scanFailedCount: '{count} files failed to parse (skipped):',
    scanMoreErrors: '... and {count} more files',
    scanFailed: 'Scan failed: {error}',
    testApiStart: 'Testing API: {baseUrl} / {model}',
    testApiSuccess: 'API test succeeded: {result}',
    testApiNoResult: 'API test failed: no valid result',
    testApiFailed: 'API test failed: {error}',
    stopRequested: 'Stop requested, waiting for current batch to finish...',
    selectImportFirst: 'Please choose an import directory first',
    scanFirst: 'Please scan first',
    selectItemsFirst: 'Please select items to translate first',
    translateBatchStart: 'Translating batch {index}/{total} ({count} items)...',
    translateBatchValidateFailed: 'Batch {index} validation failed (ID mismatch or missing), retry {attempt}/{maxRetries}',
    progress: 'Progress: {processed}/{total} ({percent}%)',
    translateBatchFailed: 'Batch {index} failed (attempt {attempt}/{maxAttempts}): {error}',
    translateBatchSkipped: 'Batch {index} failed permanently and was skipped.',
    moderationSplitStart: 'Batch {index} triggered moderation, auto fallback to single-item translation',
    moderationItemSkipped: 'Batch {index} item {item} skipped due to moderation',
    translateDone: 'Translation finished',
    translateFlowError: 'Translation flow error: {error}',
    resumeMissingTask: 'No resumable task. Start translation first.',
    resumeValidateFailed: 'Resume: batch {index}/{total} validation failed, retry {attempt}/{maxRetries}',
    resumeProgress: 'Resume progress: {processed}/{total} ({percent}%)',
    resumeBatchFailed: 'Resume: batch {index} failed (attempt {attempt}/{maxAttempts}): {error}',
    resumeBatchSkipped: 'Resume: batch {index} failed permanently and was skipped.',
    resumeModerationSplitStart: 'Resume: batch {index} triggered moderation, auto fallback to single-item translation',
    resumeModerationItemSkipped: 'Resume: batch {index} item {item} skipped due to moderation',
    resumeDone: 'Resume finished',
    resumeNothingPending: 'No pending batches to resume',
    resumeFlowError: 'Resume flow error: {error}',
    fillImportExport: 'Please fill in both import and export directories',
    exportStart: 'Exporting...',
    exportDone: 'Export completed',
    langConfigMissing: 'Please fill lang directory, MOD parent directory and PO language code',
    langPotDone: 'POT generated: {path}',
    langPoDone: 'PO generated/updated: {path}',
    langPoLoaded: 'PO loaded',
    langPoSaved: 'PO saved: {path}',
    saveAllPoDone: 'Saved {count} modified PO files',
    saveAllPoNone: 'No modified PO files to save',
    guideModeMod: 'Flow guide: scan MODs, generate/load PO, translate if needed, then save and export MO',
    guideModeKeyword: 'Flow guide: scan texts, test API, translate, then export',
    guideModePoConvert: 'Flow guide: load or generate PO, run conversion, then save and export MO',
    guideModeCodeBridge: 'Flow guide: migrate inline translations to Lang first, then apply PO back to code when needed',
    bridgeNeedTranslatedModDir: 'Please fill translated MOD directory first',
    bridgeNeedOutputDir: 'Please fill reverse output directory first',
    bridgeStartInline: 'Migrating inline translations to Lang...',
    bridgeStartPoToCode: 'Applying PO back to code...',
    bridgeInlineDone: 'Migration done: PO {poPath}, MO {moPath}, strategy {strategy}, filled {filled}, conflicts {conflicts} (resolved {conflictsResolved}, skipped {conflictsSkipped}), log {logPath}',
    bridgeInlineModFailed: 'Migration failed: MOD {name}, error: {error}',
    bridgeInlineBatchSummary: 'Migration summary: total {total} MODs, success {success}, failed {failed}',
    bridgePoToCodeDone: 'Reverse apply done: dir {outDir}, replaced {replaced}, renamed {renamed}',
    bridgePoToCodeModFailed: 'Reverse apply failed: MOD {name}, error: {error}',
    bridgePoToCodeBatchSummary: 'Reverse summary: total {total} MODs, success {success}, failed {failed}',
    cleanupPluralDone: 'Cleaned empty plural fields: {count}',
    cleanupPluralNone: 'No empty plural fields to clean',
    nextStepAfterLoadPo: 'Suggested next step: run conversion or edit and save',
    nextStepAfterConvertPo: 'Suggested next step: verify target PO, save it, then export MO',
    nextStepAfterTranslate: 'Suggested next step: review workspace translations, then export',
    nextStepAfterSavePo: 'Suggested next step: export MO to apply in game',
    unsavedPoSwitchConfirm: 'There are unsaved PO changes. Continue switching?',
    unsavedPoLeaveConfirm: 'There are unsaved PO changes. Leave this page?',
    unsavedPoCloseConfirm: 'This PO tab has unsaved changes. Close it?',
    translateDedupStats: 'Deduplicated requests: {unique}/{total}, saved {saved}',
    langMoDone: 'MO exported: {path}',
    langActionFailed: 'Action failed: {error}',
    langRewriteConfirm: 'This will regenerate {language}.po for {name} and create a .bak backup first. Continue?',
    langReadyDone: 'Completed: POT + PO + loaded editor',
    poAiNoItems: 'No empty PO entries to translate',
    poAiStart: 'Start PO AI translation: {count} entries',
    poAiApplied: 'PO AI translations applied: {count} entries',
    poAiNoApplied: 'AI translation finished but nothing was applied',
    poApplyStats: 'Apply stats {name} · {language}: workspace {workspace}, valid {valid}, apply {apply}',
    modsScanned: 'Scanned {count} MODs',
    noModsFound: 'No MOD with modinfo.json found',
    useSelectedModDone: 'Using selected MOD: {name}',
    usingModRun: 'Processing MOD: {name}',
    languageMismatchConfirm: 'PO language code may not match target language ({poLanguage} ↔ {targetLang}). Continue?',
    noPoForLanguage: 'No loaded PO tab for language {language}'
  },
  'zh-TW': {
    runtimeUnavailable: '執行環境異常。',
    runtimeUnavailableScan: '執行環境異常，無法掃描',
    runtimeUnavailableTest: '執行環境異常，無法測試',
    runtimeUnavailableExport: '執行環境異常，無法匯出',
    runtimeUnavailableDialog: '執行環境異常，無法呼叫系統對話框',
    choosePresetFirst: '請先選擇一個預設，或使用「另存為新預設」。',
    chooseCustomPresetFirst: '請先選擇一個自訂預設。',
    builtinPresetNotDeletable: '內建預設不可刪除。',
    currentPresetEmpty: '目前預設資料為空。',
    importFailed: '匯入失敗：{error}',
    exportFailed: '匯出失敗：{error}',
    exportPresetFailed: '預設匯出失敗：{error}',
    exportPresetDone: '預設已匯出至：{path}',
    presetSaved: '預設已儲存：{preset}',
    presetAdded: '已新增預設：{preset}',
    presetImported: '預設匯入成功：{preset}',
    presetDeleted: '預設已刪除：{preset}',
    deletePresetConfirm: '確定刪除預設「{preset}」嗎？',
    presetNamePrompt: '輸入預設名稱',
    presetNameFallback: '自訂預設',
    userConfigPath: '使用者設定路徑：{path}',
    apiKeyEmpty: 'API Key 為空',
    modelEmpty: '模型為空',
    baseUrlEmpty: 'Base URL 為空',
    apiConfigError: 'API 設定錯誤：{error}',
    scanStart: '正在掃描...',
    scanDone: '掃描完成：{count} 條文本',
    scanFailedCount: '有 {count} 個檔案解析失敗（已跳過）：',
    scanMoreErrors: '… 還有 {count} 個檔案',
    scanFailed: '掃描失敗：{error}',
    testApiStart: '正在測試 API：{baseUrl} / {model}',
    testApiSuccess: 'API 測試成功: {result}',
    testApiNoResult: 'API 測試失敗：無有效返回',
    testApiFailed: 'API 測試失敗：{error}',
    stopRequested: '已請求中止，等待當前批次結束...',
    selectImportFirst: '請先選擇匯入目錄',
    scanFirst: '請先掃描',
    selectItemsFirst: '請先選擇要翻譯的條目',
    translateBatchStart: '正在翻譯第 {index}/{total} 批 ({count} 條)...',
    translateBatchValidateFailed: '第 {index} 批校驗失敗（ID 不匹配或缺失），重試 {attempt}/{maxRetries}',
    progress: '進度: {processed}/{total} ({percent}%)',
    translateBatchFailed: '第 {index} 批翻譯失敗 (嘗試 {attempt}/{maxAttempts}): {error}',
    translateBatchSkipped: '第 {index} 批徹底失敗，已跳過。',
    moderationSplitStart: '第 {index} 批觸發風控，已自動降級為逐條翻譯',
    moderationItemSkipped: '第 {index} 批條目 {item} 因風控被跳過',
    translateDone: '翻譯任務結束',
    translateFlowError: '翻譯流程出錯：{error}',
    resumeMissingTask: '沒有可恢復的任務，請先開始一次翻譯',
    resumeValidateFailed: '恢復：第 {index}/{total} 批校驗失敗，重試 {attempt}/{maxRetries}',
    resumeProgress: '恢復進度: {processed}/{total} ({percent}%)',
    resumeBatchFailed: '恢復：第 {index} 批失敗 (嘗試 {attempt}/{maxAttempts}): {error}',
    resumeBatchSkipped: '恢復：第 {index} 批徹底失敗，已跳過。',
    resumeModerationSplitStart: '恢復：第 {index} 批觸發風控，已自動降級為逐條翻譯',
    resumeModerationItemSkipped: '恢復：第 {index} 批條目 {item} 因風控被跳過',
    resumeDone: '恢復任務結束',
    resumeNothingPending: '沒有待恢復批次',
    resumeFlowError: '恢復流程出錯：{error}',
    fillImportExport: '請填寫匯入和匯出目錄',
    exportStart: '正在匯出...',
    exportDone: '匯出完成',
    langConfigMissing: '請填寫外置 lang 目錄、MOD 所在目錄與 PO 語言代碼',
    langPotDone: 'POT 已生成：{path}',
    langPoDone: 'PO 已生成/更新：{path}',
    langPoLoaded: 'PO 已載入',
    langPoSaved: 'PO 已儲存：{path}',
    saveAllPoDone: '已儲存 {count} 個已修改 PO',
    saveAllPoNone: '沒有需要儲存的已修改 PO',
    guideModeMod: '模式引導：先掃描 MOD，再生成/載入 PO，按需翻譯後儲存並匯出 MO',
    guideModeKeyword: '模式引導：先掃描文本，再測試 API，翻譯後匯出',
    guideModePoConvert: '模式引導：先載入或生成 PO，執行簡繁轉換，最後儲存並匯出 MO',
    guideModeCodeBridge: '模式引導：先遷移內嵌譯文到 Lang，再按需執行 PO 反向寫回代碼',
    bridgeNeedTranslatedModDir: '請先填寫翻譯版 MOD 目錄',
    bridgeNeedOutputDir: '請先填寫反向轉換輸出目錄',
    bridgeStartInline: '開始遷移內嵌譯文到 Lang...',
    bridgeStartPoToCode: '開始執行 PO 反向寫回代碼...',
    bridgeInlineDone: '遷移完成：PO{poPath}，MO{moPath}，策略{strategy}，填充{filled}條，衝突{conflicts}條（已處理{conflictsResolved}條，跳過{conflictsSkipped}條），日誌{logPath}',
    bridgeInlineModFailed: '遷移失敗：MOD {name}，錯誤：{error}',
    bridgeInlineBatchSummary: '遷移彙總：共{total}個 MOD，成功{success}，失敗{failed}',
    bridgePoToCodeDone: '反向完成：目錄{outDir}，替換文本{replaced}，改名{renamed}',
    bridgePoToCodeModFailed: '反向失敗：MOD {name}，錯誤：{error}',
    bridgePoToCodeBatchSummary: '反向彙總：共{total}個 MOD，成功{success}，失敗{failed}',
    cleanupPluralDone: '已清理空複數欄位：{count} 條',
    cleanupPluralNone: '沒有可清理的空複數欄位',
    nextStepAfterLoadPo: '建議下一步：執行簡繁轉換或編輯後儲存',
    nextStepAfterConvertPo: '建議下一步：檢查目標語言 PO，儲存後匯出 MO',
    nextStepAfterTranslate: '建議下一步：檢查工作區譯文後執行匯出',
    nextStepAfterSavePo: '建議下一步：如需遊戲內生效，請匯出 MO',
    unsavedPoSwitchConfirm: '存在未儲存的 PO 修改，繼續切換可能遺漏儲存，是否繼續？',
    unsavedPoLeaveConfirm: '存在未儲存的 PO 修改，確認離開頁面嗎？',
    unsavedPoCloseConfirm: '此 PO 標籤有未儲存修改，確認關閉嗎？',
    translateDedupStats: '同源去重後請求 {unique}/{total} 條，預計節省 {saved} 條',
    langMoDone: 'MO 已匯出：{path}',
    langActionFailed: '操作失敗：{error}',
    langRewriteConfirm: '將重寫生成 {name} 的 {language}.po，並先備份為 .bak，是否繼續？',
    langReadyDone: '已完成：POT + PO + 載入編輯器',
    poAiNoItems: 'PO 中沒有需要 AI 翻譯的空條目',
    poAiStart: '開始 AI 翻譯 PO：共 {count} 條',
    poAiApplied: 'PO AI 翻譯已回填：{count} 條',
    poAiNoApplied: 'AI 翻譯完成，但沒有可回填條目',
    poApplyStats: '回填統計 {name} · {language}: 工作區{workspace} 有效{valid} 可回填{apply}',
    modsScanned: '已掃描到 {count} 個 MOD',
    noModsFound: '未找到包含 modinfo.json 的 MOD',
    useSelectedModDone: '已使用選中 MOD：{name}',
    usingModRun: '正在處理 MOD：{name}',
    languageMismatchConfirm: 'PO 語言代碼與目標語言可能不匹配（{poLanguage} ↔ {targetLang}），是否繼續翻譯？',
    noPoForLanguage: '目前語言 {language} 沒有已載入的 PO 標籤頁'
  }
} as const;

type RuntimeKey = keyof (typeof RUNTIME_TEXT)['zh-CN'];
type RuntimePack = Record<RuntimeKey, string>;

const RUNTIME_PACKS: Record<UiLang, RuntimePack> = {
  'zh-CN': RUNTIME_TEXT['zh-CN'] as RuntimePack,
  en: RUNTIME_TEXT.en as RuntimePack,
  'zh-TW': RUNTIME_TEXT['zh-TW'] as RuntimePack,
  ko: {
    ...(RUNTIME_TEXT.en as RuntimePack),
    runtimeUnavailable: '런타임 환경이 비정상입니다.',
    runtimeUnavailableScan: '런타임 환경이 비정상이라 스캔할 수 없습니다',
    runtimeUnavailableTest: '런타임 환경이 비정상이라 테스트할 수 없습니다',
    runtimeUnavailableExport: '런타임 환경이 비정상이라 내보낼 수 없습니다',
    runtimeUnavailableDialog: '런타임 환경이 비정상이라 시스템 대화상자를 열 수 없습니다',
    choosePresetFirst: '먼저 프리셋을 선택하거나 “새 프리셋으로 저장”을 사용하세요.',
    chooseCustomPresetFirst: '먼저 사용자 프리셋을 선택하세요.',
    builtinPresetNotDeletable: '내장 프리셋은 삭제할 수 없습니다.',
    currentPresetEmpty: '현재 프리셋 데이터가 비어 있습니다.',
    importFailed: '가져오기 실패: {error}',
    exportFailed: '내보내기 실패: {error}',
    apiConfigError: 'API 설정 오류: {error}',
    scanStart: '스캔 중...',
    scanDone: '스캔 완료: {count}개 텍스트',
    scanFailed: '스캔 실패: {error}',
    testApiStart: 'API 테스트 중: {baseUrl} / {model}',
    testApiSuccess: 'API 테스트 성공: {result}',
    testApiFailed: 'API 테스트 실패: {error}',
    stopRequested: '중지 요청됨, 현재 배치가 끝나길 기다리는 중...',
    scanFirst: '먼저 스캔을 실행하세요',
    selectItemsFirst: '번역할 항목을 먼저 선택하세요',
    progress: '진행률: {processed}/{total} ({percent}%)',
    translateDone: '번역 작업이 완료되었습니다',
    translateFlowError: '번역 흐름 오류: {error}',
    fillImportExport: '가져오기/내보내기 디렉터리를 입력하세요',
    exportStart: '내보내는 중...',
    exportDone: '내보내기 완료',
    langConfigMissing: '외부 lang 디렉터리, MOD 디렉터리, PO 언어 코드를 입력하세요',
    langPotDone: 'POT 생성 완료: {path}',
    langPoDone: 'PO 생성/업데이트 완료: {path}',
    langPoLoaded: 'PO를 불러왔습니다',
    langPoSaved: 'PO 저장 완료: {path}',
    saveAllPoDone: '{count}개의 수정된 PO를 저장했습니다',
    saveAllPoNone: '저장할 수정된 PO가 없습니다',
    guideModeMod: '모드 안내: MOD 스캔 후 PO 생성/로드, 필요 시 번역하고 MO를 내보내세요',
    guideModeKeyword: '모드 안내: 텍스트를 스캔하고 API 테스트 후 번역하여 내보내세요',
    guideModePoConvert: '모드 안내: PO를 로드/생성하고 변환 후 저장 및 MO 내보내기를 진행하세요',
    guideModeCodeBridge: '모드 안내: 인라인 번역을 Lang으로 이동한 뒤 필요 시 PO 역적용을 실행하세요',
    langMoDone: 'MO 내보내기 완료: {path}',
    langActionFailed: '작업 실패: {error}'
  },
  ja: {
    ...(RUNTIME_TEXT.en as RuntimePack),
    runtimeUnavailable: '実行環境が異常です。',
    runtimeUnavailableScan: '実行環境が異常のためスキャンできません',
    runtimeUnavailableTest: '実行環境が異常のためテストできません',
    runtimeUnavailableExport: '実行環境が異常のためエクスポートできません',
    runtimeUnavailableDialog: '実行環境が異常のためシステムダイアログを開けません',
    choosePresetFirst: '先にプリセットを選択するか、「新しいプリセットとして保存」を使用してください。',
    chooseCustomPresetFirst: '先にカスタムプリセットを選択してください。',
    builtinPresetNotDeletable: '組み込みプリセットは削除できません。',
    currentPresetEmpty: '現在のプリセットデータが空です。',
    importFailed: 'インポート失敗: {error}',
    exportFailed: 'エクスポート失敗: {error}',
    apiConfigError: 'API 設定エラー: {error}',
    scanStart: 'スキャン中...',
    scanDone: 'スキャン完了: {count} 件',
    scanFailed: 'スキャン失敗: {error}',
    testApiStart: 'API テスト中: {baseUrl} / {model}',
    testApiSuccess: 'API テスト成功: {result}',
    testApiFailed: 'API テスト失敗: {error}',
    stopRequested: '停止を要求しました。現在のバッチ完了を待機中...',
    scanFirst: '先にスキャンを実行してください',
    selectItemsFirst: '翻訳する項目を先に選択してください',
    progress: '進捗: {processed}/{total} ({percent}%)',
    translateDone: '翻訳処理が完了しました',
    translateFlowError: '翻訳フローエラー: {error}',
    fillImportExport: '入力と出力ディレクトリを入力してください',
    exportStart: 'エクスポート中...',
    exportDone: 'エクスポート完了',
    langConfigMissing: '外部 lang ディレクトリ、MOD ディレクトリ、PO 言語コードを入力してください',
    langPotDone: 'POT 生成完了: {path}',
    langPoDone: 'PO 生成/更新完了: {path}',
    langPoLoaded: 'PO を読み込みました',
    langPoSaved: 'PO 保存完了: {path}',
    saveAllPoDone: '変更済み PO を {count} 件保存しました',
    saveAllPoNone: '保存が必要な変更済み PO はありません',
    guideModeMod: 'モード案内: MOD をスキャンし、PO を生成/読み込み、必要に応じて翻訳後 MO を出力します',
    guideModeKeyword: 'モード案内: テキストをスキャンし API をテスト、翻訳してエクスポートします',
    guideModePoConvert: 'モード案内: PO を読み込み/生成し、変換後に保存して MO を出力します',
    guideModeCodeBridge: 'モード案内: 先に埋め込み翻訳を Lang へ移行し、必要なら PO 逆適用を実行します',
    langMoDone: 'MO 出力完了: {path}',
    langActionFailed: '操作失敗: {error}'
  },
  ru: {
    ...(RUNTIME_TEXT.en as RuntimePack),
    runtimeUnavailable: 'Среда выполнения недоступна.',
    runtimeUnavailableScan: 'Среда выполнения недоступна, сканирование невозможно',
    runtimeUnavailableTest: 'Среда выполнения недоступна, тестирование невозможно',
    runtimeUnavailableExport: 'Среда выполнения недоступна, экспорт невозможен',
    runtimeUnavailableDialog: 'Среда выполнения недоступна, открыть системный диалог нельзя',
    choosePresetFirst: 'Сначала выберите пресет или используйте «Сохранить как новый пресет».',
    chooseCustomPresetFirst: 'Сначала выберите пользовательский пресет.',
    builtinPresetNotDeletable: 'Встроенный пресет нельзя удалить.',
    currentPresetEmpty: 'Текущий пресет пуст.',
    importFailed: 'Ошибка импорта: {error}',
    exportFailed: 'Ошибка экспорта: {error}',
    apiConfigError: 'Ошибка конфигурации API: {error}',
    scanStart: 'Сканирование...',
    scanDone: 'Сканирование завершено: {count}',
    scanFailed: 'Ошибка сканирования: {error}',
    testApiStart: 'Тест API: {baseUrl} / {model}',
    testApiSuccess: 'Тест API успешен: {result}',
    testApiFailed: 'Тест API неуспешен: {error}',
    stopRequested: 'Запрошена остановка, ожидается завершение текущего пакета...',
    scanFirst: 'Сначала выполните сканирование',
    selectItemsFirst: 'Сначала выберите элементы для перевода',
    progress: 'Прогресс: {processed}/{total} ({percent}%)',
    translateDone: 'Перевод завершён',
    translateFlowError: 'Ошибка процесса перевода: {error}',
    fillImportExport: 'Укажите каталоги импорта и экспорта',
    exportStart: 'Экспорт...',
    exportDone: 'Экспорт завершён',
    langConfigMissing: 'Укажите внешний каталог lang, каталог MOD и код языка PO',
    langPotDone: 'POT создан: {path}',
    langPoDone: 'PO создан/обновлён: {path}',
    langPoLoaded: 'PO загружен',
    langPoSaved: 'PO сохранён: {path}',
    saveAllPoDone: 'Сохранено изменённых PO: {count}',
    saveAllPoNone: 'Нет изменённых PO для сохранения',
    guideModeMod: 'Подсказка: сканируйте MOD, создайте/загрузите PO, при необходимости переведите и экспортируйте MO',
    guideModeKeyword: 'Подсказка: сканируйте текст, проверьте API, переведите и экспортируйте',
    guideModePoConvert: 'Подсказка: загрузите/создайте PO, выполните преобразование, затем сохраните и экспортируйте MO',
    guideModeCodeBridge: 'Подсказка: сначала перенесите встроенный перевод в Lang, затем при необходимости выполните обратную запись PO',
    langMoDone: 'MO экспортирован: {path}',
    langActionFailed: 'Ошибка операции: {error}'
  }
};

function rt(key: RuntimeKey, vars?: Record<string, string | number>): string {
  let text: string = RUNTIME_PACKS[currentUiLang][key] || RUNTIME_PACKS['zh-CN'][key];
  if (!vars) return text;
  Object.entries(vars).forEach(([k, v]) => {
    text = text.split(`{${k}}`).join(String(v));
  });
  return text;
}

function t(key: keyof (typeof I18N)['zh-CN']): string {
  return I18N_PACKS[currentUiLang][key] || I18N_PACKS['zh-CN'][key];
}

function reportLocaleCoverage() {
  const locales: UiLang[] = ['ko', 'ja', 'ru'];
  const ignoreI18nKeys = new Set<I18nKey>([
    'uiLangEn',
    'providerOpenAICompatible',
    'providerDeepSeek',
    'providerSiliconFlow',
    'providerMiMo',
    'providerCustom',
    'providerGemini',
    'optLangModeCbn',
    'optLangModeCdda',
    'labelApiKey'
  ]);
  const ignoreRuntimeKeys = new Set<RuntimeKey>([
    'testApiStart',
    'testApiSuccess',
    'testApiNoResult',
    'testApiFailed'
  ]);
  locales.forEach((locale) => {
    const untranslatedI18n = (Object.keys(I18N_PACKS.en) as I18nKey[]).filter(
      (key) => !ignoreI18nKeys.has(key) && I18N_PACKS[locale][key] === I18N_PACKS.en[key]
    );
    const untranslatedRuntime = (Object.keys(RUNTIME_PACKS.en) as RuntimeKey[]).filter(
      (key) => !ignoreRuntimeKeys.has(key) && RUNTIME_PACKS[locale][key] === RUNTIME_PACKS.en[key]
    );
    if (untranslatedI18n.length || untranslatedRuntime.length) {
      console.info(`[i18n:${locale}] untranslated ui=${untranslatedI18n.length}, runtime=${untranslatedRuntime.length}`);
    } else {
      console.info(`[i18n:${locale}] fully localized`);
    }
  });
}

function resolveWorkMode() {
  if (workModeSelect.value === 'keyword') return 'keyword';
  if (workModeSelect.value === 'po_convert') return 'po_convert';
  if (workModeSelect.value === 'code_bridge') return 'code_bridge';
  return 'mod';
}

function hasDirtyPoTabs() {
  return poTabs.some((x) => x.dirty);
}

function updateModeGuideHint() {
  if (!modeGuideHint) return;
  const mode = resolveWorkMode();
  if (mode === 'keyword') {
    modeGuideHint.textContent = rt('guideModeKeyword');
    return;
  }
  if (mode === 'po_convert') {
    modeGuideHint.textContent = rt('guideModePoConvert');
    return;
  }
  if (mode === 'code_bridge') {
    modeGuideHint.textContent = rt('guideModeCodeBridge');
    return;
  }
  modeGuideHint.textContent = rt('guideModeMod');
}

function pushSoftError(message: string) {
  setStatus(message, true);
}

function applyUiLanguage(lang: UiLang) {
  currentUiLang = lang;
  uiLangSelect.value = lang;
  const ids = [
    'appTitle','labelUiLanguage','labelWorkMode','labelImportDir','labelExportDir','labelIncludeKeys','labelExcludeKeys',
    'labelRegex','labelRulePreset','labelIncludeKeyRegex','labelExcludeKeyRegex','labelIncludePathRegex',
    'labelExcludePathRegex','labelSkipEmpty','titleAiConfig','labelProvider','labelModel','labelApiKey',
    'labelRememberKey','labelTargetLang','labelTimeoutSec','labelBatchSize','labelBatchTokenLimit',
    'labelConcurrency','labelRpmLimit','labelTpmLimit','labelMaxRetries','labelSystemPrompt','labelUserPrefix','titleStatus',
    'titleWorkspace','labelWorkspaceShowSelectedOnly','labelWorkspaceShowEmptyOnly','labelWorkspaceSyncSameSource','titleLangTools','labelLangDir',
    'labelLangMode','labelPoLanguage','labelPoLanguageCustom','labelPythonPath','labelGettextPath','labelPoEditor','labelModRootDir','labelModList',
    'labelCodeBridge','labelBridgeTranslatedModDir','labelBridgeOutputDir','labelBridgeSourceLangCode','labelBridgeTargetLangCode',
    'labelBridgeConflictStrategy','labelBridgeArrayMatchById'
  ] as const;
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = t(id as keyof (typeof I18N)['zh-CN']);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n as keyof (typeof I18N)['zh-CN'] | undefined;
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset.i18nPlaceholder as keyof (typeof I18N)['zh-CN'] | undefined;
    if (key) el.placeholder = t(key);
  });
  updateModeGuideHint();
  updateWorkspaceStats();
  localStorage.setItem(UI_LANG_STORAGE_KEY, lang);
  void persistUserConfigToFile();
}

function getPoLanguageValue() {
  const base = poLanguageInput.value.trim();
  if (base === 'custom') {
    return poLanguageCustomInput.value.trim();
  }
  return base;
}

function ensureBridgeLangCodeDefaults() {
  if (!bridgeSourceLangCodeInput.value.trim()) {
    bridgeSourceLangCodeInput.value = 'en';
  }
  if (!bridgeTargetLangCodeInput.value.trim()) {
    bridgeTargetLangCodeInput.value = getPoLanguageValue() || 'zh_CN';
  }
  if (!bridgeConflictStrategySelect.value) {
    bridgeConflictStrategySelect.value = 'skip';
  }
  if (!bridgeOperationModeSelect.value || !['inline', 'reverse'].includes(bridgeOperationModeSelect.value)) {
    bridgeOperationModeSelect.value = 'inline';
  }
}

function updateBridgeOperationUi() {
  const reverseMode = bridgeOperationModeSelect.value === 'reverse';
  bridgeInlineFields.classList.toggle('hidden', reverseMode);
  bridgeReverseFields.classList.toggle('hidden', !reverseMode);
  bridgeUsageHintInline.classList.toggle('hidden', reverseMode);
  bridgeUsageHintReverse.classList.toggle('hidden', !reverseMode);
}

function updatePoLanguageCustomVisibility() {
  poLanguageCustomWrap.classList.toggle('hidden', poLanguageInput.value !== 'custom');
}

function applyWorkMode() {
  const mode = resolveWorkMode();
  const generalPanel = document.getElementById('generalExtractPanel') as HTMLDivElement;
  const langPanel = document.getElementById('titleLangTools')?.closest('.panel') as HTMLDivElement;
  const langMainActions = document.getElementById('langMainActions') as HTMLDivElement;
  const poConvertField = document.getElementById('poConvertField') as HTMLDivElement;
  const bridgeField = codeBridgeField;
  const titleLangTools = document.getElementById('titleLangTools') as HTMLHeadingElement;
  const preparePoBtn = document.getElementById('preparePoBtn') as HTMLButtonElement;
  const extractPoToWorkspaceBtn = document.getElementById('extractPoToWorkspaceBtn') as HTMLButtonElement;
  const applyWorkspaceToPoBtn = document.getElementById('applyWorkspaceToPoBtn') as HTMLButtonElement;
  const genPotBtn = document.getElementById('genPotBtn') as HTMLButtonElement;
  const genPoBtn = document.getElementById('genPoBtn') as HTMLButtonElement;
  const genPoRewriteBtn = document.getElementById('genPoRewriteBtn') as HTMLButtonElement;
  const loadPoBtn = document.getElementById('loadPoBtn') as HTMLButtonElement;
  const savePoBtn = document.getElementById('savePoBtn') as HTMLButtonElement;
  const saveAllPoBtn = document.getElementById('saveAllPoBtn') as HTMLButtonElement;
  const compileMoBtn = document.getElementById('compileMoBtn') as HTMLButtonElement;
  const poConvertMode = mode === 'po_convert';
  const bridgeMode = mode === 'code_bridge';
  const toggleHidden = (el: HTMLElement | null, hidden: boolean) => {
    if (!el) return;
    el.classList.toggle('hidden', hidden);
  };

  if (generalPanel) generalPanel.classList.toggle('hidden', mode !== 'keyword');
  if (langPanel) langPanel.classList.toggle('hidden', mode === 'keyword');
  if (langMainActions) langMainActions.classList.toggle('hidden', mode === 'keyword' || bridgeMode);
  if (poConvertField) poConvertField.classList.toggle('hidden', mode !== 'po_convert');
  if (bridgeField) bridgeField.classList.toggle('hidden', !bridgeMode);
  if (titleLangTools) {
    titleLangTools.textContent = mode === 'po_convert'
      ? t('titlePoConvert')
      : mode === 'code_bridge'
        ? t('labelCodeBridge')
        : t('titleLangTools');
  }
  toggleHidden(preparePoBtn, bridgeMode ? true : false);
  toggleHidden(extractPoToWorkspaceBtn, poConvertMode);
  toggleHidden(applyWorkspaceToPoBtn, poConvertMode);
  toggleHidden(genPotBtn, poConvertMode || bridgeMode);
  toggleHidden(genPoBtn, bridgeMode);
  toggleHidden(genPoRewriteBtn, bridgeMode);
  toggleHidden(loadPoBtn, bridgeMode);
  toggleHidden(savePoBtn, bridgeMode);
  toggleHidden(saveAllPoBtn, bridgeMode);
  toggleHidden(compileMoBtn, bridgeMode);
  updateBridgeOperationUi();
  updateModeGuideHint();
  updateModeActionButtons();
}

function isModMode() {
  return workModeSelect.value === 'mod';
}

function isKeywordMode() {
  return workModeSelect.value === 'keyword';
}

function updateModeActionButtons() {
  const scanBtn = document.getElementById('scanBtn') as HTMLButtonElement;
  const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
  if (!isKeywordMode()) {
    scanBtn.disabled = true;
    exportBtn.disabled = true;
  } else {
    scanBtn.disabled = uiBusy;
    exportBtn.disabled = uiBusy;
  }
}

function ensureTargetLanguageOption(language: string) {
  if (!language) return;
  const exists = Array.from(targetLangInput.options).some(opt => opt.value === language);
  if (!exists) {
    const option = document.createElement('option');
    option.value = language;
    option.textContent = language;
    targetLangInput.appendChild(option);
  }
}

function applyLanguagePromptDefaults(force = false) {
  const targetLang = targetLangInput.value || '中文';
  if (force || !systemPromptInput.value.trim()) {
    systemPromptInput.value = SYSTEM_PROMPT_TEMPLATE(targetLang);
  }
  if (force || !userPrefixInput.value.trim()) {
    userPrefixInput.value = USER_PREFIX_TEMPLATE(targetLang);
  }
}

function targetLanguageInstruction(targetLang: string): string {
  const locale = resolvePromptLocale(targetLang);
  if (locale === 'zh-TW') return `目標語言: ${targetLang}`;
  if (locale === 'zh-CN') return `目标语言: ${targetLang}`;
  return `Target language: ${targetLang}`;
}

function getExpectedTargetsByPoLanguage(poLanguage: string) {
  const lang = poLanguage.trim();
  const map: Record<string, string[]> = {
    zh_CN: ['中文'],
    zh_TW: ['中文（繁体）'],
    en: ['English'],
    ja: ['日本語'],
    ko: ['한국어'],
    ru: ['Русский'],
    fr: ['Français'],
    de: ['Deutsch'],
    es: ['Español'],
    it: ['Italiano'],
    pt_BR: ['Português'],
    pt_PT: ['Português'],
    pl: ['Polski'],
    tr: ['Türkçe'],
    uk: ['Українська'],
    cs: ['Čeština'],
    nl: ['Nederlands'],
    sv: ['Svenska'],
    fi: ['Suomi'],
    hu: ['Magyar'],
    ro: ['Română']
  };
  return map[lang] || [];
}

function ensureLanguageMatchInModMode() {
  if (!isModMode()) return true;
  const poLanguage = getPoLanguageValue();
  if (!poLanguage || poLanguageInput.value === 'custom') return true;
  const expected = getExpectedTargetsByPoLanguage(poLanguage);
  if (!expected.length) return true;
  const target = targetLangInput.value.trim();
  if (expected.includes(target)) return true;
  return confirm(rt('languageMismatchConfirm', { poLanguage, targetLang: target || '-' }));
}

let lastDefaults = getProviderDefaults(providerSelect.value);

function applyProviderDefaults(provider: string, force = false) {
  const applied = applyProviderDefaultsToSnapshot(
    { baseUrl: baseUrlInput.value, model: modelInput.value },
    provider,
    lastDefaults,
    force
  );
  baseUrlInput.value = applied.snapshot.baseUrl;
  modelInput.value = applied.snapshot.model;
  lastDefaults = applied.defaults;
}

function getRule(): Rule {
  return {
    format: 'json',
    includeKeys: includeKeysInput.value.split(',').map(s => s.trim()).filter(Boolean),
    excludeKeys: excludeKeysInput.value.split(',').map(s => s.trim()).filter(Boolean),
    includeKeyRegex: includeKeyRegexInput.value.trim() || undefined,
    excludeKeyRegex: excludeKeyRegexInput.value.trim() || undefined,
    includePathRegex: includePathRegexInput.value.trim() || undefined,
    excludePathRegex: excludePathRegexInput.value.trim() || undefined,
    skipEmpty: skipEmptyInput.checked,
    regex: regexInput.value || undefined
  };
}

function getRuleFromInputs(): RulePresetData {
  return {
    includeKeys: includeKeysInput.value,
    excludeKeys: excludeKeysInput.value,
    includeKeyRegex: includeKeyRegexInput.value,
    excludeKeyRegex: excludeKeyRegexInput.value,
    includePathRegex: includePathRegexInput.value,
    excludePathRegex: excludePathRegexInput.value,
    skipEmpty: skipEmptyInput.checked,
    regex: regexInput.value
  };
}

function applyRuleToInputs(rule: RulePresetData) {
  includeKeysInput.value = rule.includeKeys || '';
  excludeKeysInput.value = rule.excludeKeys || '';
  includeKeyRegexInput.value = rule.includeKeyRegex || '';
  excludeKeyRegexInput.value = rule.excludeKeyRegex || '';
  includePathRegexInput.value = rule.includePathRegex || '';
  excludePathRegexInput.value = rule.excludePathRegex || '';
  skipEmptyInput.checked = Boolean(rule.skipEmpty);
  regexInput.value = rule.regex || '';
}

function loadRulePresets() {
  rulePresets = rulePresetStore.parseRulePresets(localStorage.getItem(PRESET_STORAGE_KEY));
}

function saveRulePresets() {
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(rulePresets));
  void persistUserConfigToFile();
}

function refreshPresetOptions() {
  const current = rulePresetSelect.value || 'custom';
  rulePresetSelect.innerHTML = '';
  const customOpt = document.createElement('option');
  customOpt.value = 'custom';
  customOpt.textContent = t('optCustom');
  customOpt.dataset.i18n = 'optCustom';
  rulePresetSelect.appendChild(customOpt);
  Object.keys(rulePresets).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name.toUpperCase();
    rulePresetSelect.appendChild(opt);
  });
  rulePresetSelect.value = current in rulePresets || current === 'custom' ? current : 'custom';
}

function getConfig(): ApiConfig {
  const providerValue = providerSelect.value;
  const provider =
    providerValue === 'gemini' ||
    providerValue === 'deepseek' ||
    providerValue === 'siliconflow' ||
    providerValue === 'mimo' ||
    providerValue === 'custom'
      ? providerValue
      : 'openai_compatible';
  const timeoutSec = Number(localStorage.getItem('timeoutSec') || '120');
  const timeoutMs = Number.isFinite(timeoutSec) && timeoutSec > 0 ? Math.floor(timeoutSec * 1000) : 120000;
  const defaults = getProviderDefaults(provider);
  return {
    apiKey: apiKeyInput.value,
    baseUrl: baseUrlInput.value || defaults.baseUrl,
    model: modelInput.value || defaults.model,
    systemPrompt: systemPromptInput.value,
    userPromptPrefix: `${userPrefixInput.value}\n${targetLanguageInstruction(targetLangInput.value)}`,
    provider,
    timeoutMs
  };
}

function getBatching() {
  const maxRetries = Number(localStorage.getItem('maxRetries') || '2');
  return {
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? Math.floor(maxRetries) : 2,
    batchSize: Math.max(1, Number(localStorage.getItem('batchSize') || batchSizeInput?.value || '20')),
    tokenLimit: Math.max(1000, Number(localStorage.getItem('batchTokenLimit') || batchTokenLimitInput?.value || '8000')),
    concurrency: Math.max(1, Number(localStorage.getItem('concurrency') || concurrencyInput?.value || '2'))
  };
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

function estimateTokensForSegments(segments: Segment[], overhead: number): number {
  const textLen = segments.reduce((sum, s) => sum + (s.source?.length || 0), 0);
  const approxTokens = Math.ceil((textLen + overhead) / 4);
  return approxTokens;
}

function makeBatches(segs: Segment[], batchSize: number, tokenLimit: number, overhead: number): Segment[][] {
  const batches: Segment[][] = [];
  let i = 0;
  while (i < segs.length) {
    let size = Math.min(batchSize, segs.length - i);
    let batch = segs.slice(i, i + size);
    let tokens = estimateTokensForSegments(batch, overhead);
    while (tokens > tokenLimit && size > 1) {
      size = Math.max(1, Math.floor(size / 2));
      batch = segs.slice(i, i + size);
      tokens = estimateTokensForSegments(batch, overhead);
    }
    batches.push(batch);
    i += size;
  }
  return batches;
}

function normalizeSourceForDedup(text: string) {
  return text.trim();
}

function buildDeduplicatedSegments(selectedSegs: Segment[]) {
  const groups = new Map<string, { representative: Segment; memberIds: string[] }>();
  selectedSegs.forEach((seg) => {
    const key = normalizeSourceForDedup(seg.source);
    const existing = groups.get(key);
    if (existing) {
      existing.memberIds.push(seg.id);
      return;
    }
    groups.set(key, { representative: seg, memberIds: [seg.id] });
  });
  const uniqueSegments: Segment[] = [];
  const memberMap = new Map<string, string[]>();
  groups.forEach((group) => {
    uniqueSegments.push(group.representative);
    memberMap.set(group.representative.id, group.memberIds);
  });
  return {
    uniqueSegments,
    memberMap,
    totalCount: selectedSegs.length,
    uniqueCount: uniqueSegments.length
  };
}

function getRateLimitConfig() {
  const rpm = Math.max(0, Number(rpmLimitInput.value || '0'));
  const tpm = Math.max(0, Number(tpmLimitInput.value || '0'));
  return { rpm, tpm };
}

async function waitForRateLimit(batch: Segment[]) {
  const { rpm, tpm } = getRateLimitConfig();
  if (rpm <= 0 && tpm <= 0) return;
  const windowMs = 60_000;
  while (true) {
    const current = Date.now();
    while (requestTimeline.length && current - requestTimeline[0] >= windowMs) requestTimeline.shift();
    while (tokenTimeline.length && current - tokenTimeline[0].ts >= windowMs) tokenTimeline.shift();
    const tokensForBatch = estimateTokensForSegments(batch, 600);
    let waitMs = 0;
    if (rpm > 0 && requestTimeline.length >= rpm) {
      waitMs = Math.max(waitMs, windowMs - (current - requestTimeline[0]));
    }
    if (tpm > 0) {
      const used = tokenTimeline.reduce((sum, x) => sum + x.tokens, 0);
      if (used + tokensForBatch > tpm && tokenTimeline.length) {
        waitMs = Math.max(waitMs, windowMs - (current - tokenTimeline[0].ts));
      }
    }
    if (waitMs <= 0) {
      requestTimeline.push(Date.now());
      tokenTimeline.push({ ts: Date.now(), tokens: tokensForBatch });
      return;
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

type BatchState = 'pending' | 'running' | 'completed' | 'failed';
type BatchRunResult = 'pending' | 'completed' | 'failed';

async function processBatchIndexesWithConcurrency(
  indexes: number[],
  concurrency: number,
  handler: (batch: Segment[], idx: number, total: number) => Promise<BatchRunResult>
) {
  if (!indexes.length) return;
  let next = 0;
  const total = indexes.length;
  const runOne = async () => {
    while (next < total && !stopRequested) {
      const idx = indexes[next];
      next += 1;
      batchStates[idx] = 'running';
      const result = await handler(savedBatches[idx], idx, total);
      if (result === 'completed') {
        batchStates[idx] = 'completed';
      } else if (result === 'failed') {
        batchStates[idx] = 'failed';
      } else {
        batchStates[idx] = 'pending';
      }
    }
  };
  const workerCount = Math.max(1, Math.min(concurrency, total));
  const workers = Array.from({ length: workerCount }, () => runOne());
  await Promise.all(workers);
  batchStates = batchStates.map((state) => (state === 'running' ? 'pending' : state));
}

function initBatchStates(total: number) {
  batchStates = Array.from({ length: total }, () => 'pending' as BatchState);
}

function getPendingBatchIndexes() {
  return savedBatches
    .map((_, index) => index)
    .filter((index) => batchStates[index] !== 'completed');
}

function getCompletedSegmentCount() {
  return savedBatches.reduce((sum, batch, index) => {
    if (batchStates[index] === 'completed') {
      const batchCount = batch.reduce((batchSum, seg) => {
        const memberIds = dedupMemberIdsByRepresentativeId.get(seg.id);
        return batchSum + (memberIds ? memberIds.length : 1);
      }, 0);
      return sum + batchCount;
    }
    return sum;
  }, 0);
}

let savedBatches: Segment[][] = [];
let batchStates: BatchState[] = [];
let processedCountGlobal = 0;

function applyBatchTranslations(batch: Segment[], results: TranslationResult[]) {
  const map = new Map<string, TranslationResult>();
  results.forEach((r) => map.set(r.id, r));
  let validCount = 0;
  batch.forEach((seg) => {
    const r = map.get(seg.id);
    const ok = r && typeof r.target === 'string';
    const memberIds = dedupMemberIdsByRepresentativeId.get(seg.id) || [seg.id];
    memberIds.forEach((memberId) => {
      const existing = getOrCreateTranslation(memberId);
      existing.target = ok ? r!.target : existing.target;
      existing.valid = !!ok;
    });
    if (ok) validCount += 1;
  });
  return validCount;
}

function isModerationBlockedError(error: any) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('moderation block')
    || message.includes('content_filter')
    || (message.includes('"code":"421"') && message.includes('high risk'));
}

async function requestBatchWithModerationFallback(
  batch: Segment[],
  config: ApiConfig,
  batchIndex: number,
  statusKeys: { splitStart: RuntimeKey; itemSkipped: RuntimeKey }
) {
  await waitForRateLimit(batch);
  try {
    const results = await translator!.translateBatch(batch, config);
    const validCount = applyBatchTranslations(batch, results);
    return { validCount, skippedCount: 0 };
  } catch (e: any) {
    if (!isModerationBlockedError(e) || batch.length <= 1) {
      throw e;
    }
    setStatus(rt(statusKeys.splitStart, { index: batchIndex }));
    let validCount = 0;
    let skippedCount = 0;
    for (let i = 0; i < batch.length; i++) {
      const seg = batch[i];
      try {
        await waitForRateLimit([seg]);
        const singleResults = await translator!.translateBatch([seg], config);
        validCount += applyBatchTranslations([seg], singleResults);
      } catch (singleErr: any) {
        if (isModerationBlockedError(singleErr)) {
          skippedCount += 1;
          setStatus(rt(statusKeys.itemSkipped, { index: batchIndex, item: i + 1 }), true);
          continue;
        }
        throw singleErr;
      }
    }
    return { validCount, skippedCount };
  }
}

function getOrCreateTranslation(id: string) {
  let existing = translationMap.get(id);
  if (!existing) {
    existing = { id, target: '', valid: false };
    translations.push(existing);
    translationMap.set(id, existing);
  }
  return existing;
}

function clearTranslations() {
  translations = [];
  translationMap.clear();
}

function getFilteredSegments() {
  return filterWorkspaceSegments({
    segments,
    selectedIds,
    showSelectedOnly: workspaceShowSelectedOnlyInput.checked,
    showEmptyOnly: workspaceShowEmptyOnlyInput.checked,
    searchText: workspaceSearchText,
    translationMap,
  });
}

function formatWorkspaceStats(total: number, visible: number, selectedVisible: number, emptyVisible: number) {
  if (currentUiLang === 'ko') {
    return `전체 ${total} · 표시 ${visible} · 선택 ${selectedVisible} · 빈 번역 ${emptyVisible}`;
  }
  if (currentUiLang === 'ja') {
    return `合計 ${total} · 表示 ${visible} · 選択 ${selectedVisible} · 未翻訳 ${emptyVisible}`;
  }
  if (currentUiLang === 'ru') {
    return `Всего ${total} · Видимо ${visible} · Выбрано ${selectedVisible} · Пусто ${emptyVisible}`;
  }
  if (currentUiLang === 'en') {
    return `Total ${total} · Visible ${visible} · Selected ${selectedVisible} · Empty ${emptyVisible}`;
  }
  if (currentUiLang === 'zh-TW') {
    return `總計 ${total} · 可見 ${visible} · 已勾選 ${selectedVisible} · 空譯文 ${emptyVisible}`;
  }
  return `总计 ${total} · 可见 ${visible} · 已勾选 ${selectedVisible} · 空译文 ${emptyVisible}`;
}

function formatWorkspaceStatsView(total: number, visible: number, selectedVisible: number, emptyVisible: number) {
  return formatWorkspaceStatsText(currentUiLang, total, visible, selectedVisible, emptyVisible);
}

function updateWorkspaceStats(visibleRows?: Segment[]) {
  const visible = visibleRows || getFilteredSegments();
  const selectedVisible = visible.filter((s) => selectedIds.has(s.id)).length;
  const emptyVisible = visible.filter((s) => !(translationMap.get(s.id)?.target || '').trim()).length;
  workspaceStatsDiv.textContent = formatWorkspaceStatsView(segments.length, visible.length, selectedVisible, emptyVisible);
}

function resolveContextKey(segment: Segment) {
  return workspaceContextMap.get(segment.id) || segment.file;
}

function rebuildWorkspaceIndexes() {
  const indexes = buildWorkspaceIndexes(segments, resolveContextKey);
  segmentById.clear();
  sourceToSegmentIds.clear();
  contextToSegmentIds.clear();
  indexes.segmentById.forEach((value, key) => segmentById.set(key, value));
  indexes.sourceToSegmentIds.forEach((value, key) => sourceToSegmentIds.set(key, value));
  indexes.contextToSegmentIds.forEach((value, key) => contextToSegmentIds.set(key, value));
}

function syncSameSourceTargets(baseId: string, sourceText: string, value: string, visibleRows: Segment[]) {
  const normalized = normalizeSourceKey(sourceText);
  if (!normalized) return [];
  const scope = workspaceSyncScopeSelect.value;
  const visibleIdSet = new Set(visibleRows.map((x) => x.id));
  const baseSegment = segmentById.get(baseId);
  const baseContext = baseSegment ? resolveContextKey(baseSegment) : '';
  const syncedIds: string[] = [];
  const candidateIds = sourceToSegmentIds.get(normalized) || [];
  candidateIds.forEach((candidateId) => {
    const s = segmentById.get(candidateId);
    if (!s) return;
    if (scope === 'visible' && !visibleIdSet.has(s.id)) return;
    if (scope === 'context' && resolveContextKey(s) !== baseContext) return;
    const tr = getOrCreateTranslation(s.id);
    tr.target = value;
    tr.valid = Boolean(value.trim());
    syncedIds.push(s.id);
  });
  return syncedIds;
}

function ensureWorkspaceVirtualDom() {
  if (workspaceVirtualSpacer && workspaceVirtualContent) return;
  workspaceListDiv.innerHTML = '';
  workspaceListDiv.style.position = 'relative';
  const spacer = document.createElement('div');
  spacer.className = 'workspace-virtual-spacer';
  const content = document.createElement('div');
  content.className = 'workspace-virtual-content';
  spacer.appendChild(content);
  workspaceListDiv.appendChild(spacer);
  workspaceVirtualSpacer = spacer;
  workspaceVirtualContent = content;
  workspaceListDiv.addEventListener('scroll', () => {
    if (workspaceVirtualRenderFrame !== null) return;
    workspaceVirtualRenderFrame = requestAnimationFrame(() => {
      workspaceVirtualRenderFrame = null;
      renderWorkspaceWindow();
    });
  });
}

function renderWorkspaceWindow() {
  ensureWorkspaceVirtualDom();
  if (!workspaceVirtualSpacer || !workspaceVirtualContent) return;
  visibleTargetTextareaMap.clear();
  const rows = workspaceRowsCache;
  const { start, end, paddingTop } = computeVirtualWindow({
    totalCount: rows.length,
    scrollTop: workspaceListDiv.scrollTop,
    viewportHeight: workspaceListDiv.clientHeight,
    rowHeight: WORKSPACE_ROW_HEIGHT,
    overscan: WORKSPACE_OVERSCAN,
  });
  workspaceVirtualSpacer.style.height = `${rows.length * WORKSPACE_ROW_HEIGHT}px`;
  workspaceVirtualContent.style.transform = `translateY(${paddingTop}px)`;
  workspaceVirtualContent.innerHTML = '';
  const fragment = document.createDocumentFragment();
  rows.slice(start, end).forEach((s) => {
    const existing = translationMap.get(s.id);
    const div = document.createElement('div');
    div.className = 'entry-row';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = selectedIds.has(s.id);
    chk.onchange = () => {
      if (chk.checked) selectedIds.add(s.id);
      else selectedIds.delete(s.id);
      updateWorkspaceStats(rows);
    };
    const source = document.createElement('textarea');
    source.value = s.source;
    source.readOnly = true;
    const target = document.createElement('textarea');
    target.dataset.segmentId = s.id;
    target.value = existing?.target || '';
    target.addEventListener('input', () => {
      const val = target.value;
      const tr = getOrCreateTranslation(s.id);
      tr.target = val;
      tr.valid = Boolean(val.trim());
      if (workspaceSyncSameSourceInput.checked) {
        const syncedIds = syncSameSourceTargets(s.id, s.source, val, rows);
        syncedIds.forEach((id) => {
          if (id === s.id) return;
          const targetInput = visibleTargetTextareaMap.get(id);
          if (!targetInput) return;
          targetInput.value = val;
        });
        updateWorkspaceStats(rows);
      } else {
        updateWorkspaceStats(rows);
      }
    });
    div.addEventListener('focusin', () => div.classList.add('active'));
    div.addEventListener('focusout', () => div.classList.remove('active'));
    div.appendChild(chk);
    div.appendChild(source);
    div.appendChild(target);
    visibleTargetTextareaMap.set(s.id, target);
    fragment.appendChild(div);
  });
  workspaceVirtualContent.appendChild(fragment);
}

function refreshWorkspaceRows(resetScroll = false) {
  workspaceRowsCache = getFilteredSegments();
  if (resetScroll) {
    workspaceListDiv.scrollTop = 0;
  }
  renderWorkspaceWindow();
  updateWorkspaceStats(workspaceRowsCache);
}

function scheduleWorkspaceRefresh(resetScroll = false) {
  if (resetScroll) workspacePendingResetScroll = true;
  if (workspaceRefreshTimer) return;
  workspaceRefreshTimer = setTimeout(() => {
    workspaceRefreshTimer = null;
    const shouldResetScroll = workspacePendingResetScroll;
    workspacePendingResetScroll = false;
    refreshWorkspaceRows(shouldResetScroll);
  }, 80);
}

function renderSegments(resetScroll = false) {
  refreshWorkspaceRows(resetScroll);
}

function renderTranslations() {
  scheduleWorkspaceRefresh(false);
}

function flushStatusRender() {
  statusRenderTimer = null;
  if (renderedStatusCount > statusHistory.length) {
    statusDiv.textContent = '';
    renderedStatusCount = 0;
  }
  if (renderedStatusCount >= statusHistory.length) return;
  const fragment = document.createDocumentFragment();
  for (let i = renderedStatusCount; i < statusHistory.length; i++) {
    const line = document.createElement('div');
    line.textContent = statusHistory[i];
    fragment.appendChild(line);
  }
  statusDiv.appendChild(fragment);
  renderedStatusCount = statusHistory.length;
  statusDiv.scrollTop = statusDiv.scrollHeight;
}

function scheduleStatusRender() {
  if (statusRenderTimer) return;
  statusRenderTimer = setTimeout(flushStatusRender, 80);
}

function setStatus(message: string, append = true) {
  if (!message) return;
  if (!append) {
    statusHistory.length = 0;
    statusDiv.textContent = '';
    renderedStatusCount = 0;
  }
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  statusHistory.push(`[${ts}] ${message}`);
  if (statusHistory.length > 500) {
    statusHistory.shift();
    if (statusDiv.firstChild) {
      statusDiv.removeChild(statusDiv.firstChild);
    }
    if (renderedStatusCount > 0) {
      renderedStatusCount -= 1;
    }
  }
  scheduleStatusRender();
}

function setBusy(busy: boolean) {
  uiBusy = busy;
  (document.getElementById('translateBtn') as HTMLButtonElement).disabled = busy;
  (document.getElementById('testApiBtn') as HTMLButtonElement).disabled = busy;
  (document.getElementById('preparePoBtn') as HTMLButtonElement).disabled = busy;
  (document.getElementById('extractPoToWorkspaceBtn') as HTMLButtonElement).disabled = busy;
  (document.getElementById('applyWorkspaceToPoBtn') as HTMLButtonElement).disabled = busy;
  (document.getElementById('genPotBtn') as HTMLButtonElement).disabled = busy;
  (document.getElementById('genPoBtn') as HTMLButtonElement).disabled = busy;
  (document.getElementById('genPoRewriteBtn') as HTMLButtonElement).disabled = busy;
  (document.getElementById('loadPoBtn') as HTMLButtonElement).disabled = busy;
  (document.getElementById('savePoBtn') as HTMLButtonElement).disabled = busy;
  saveAllPoBtn.disabled = busy;
  (document.getElementById('compileMoBtn') as HTMLButtonElement).disabled = busy;
  convertPoBtn.disabled = busy;
  bridgeInlineToLangBtn.disabled = busy;
  bridgePoToCodeBtn.disabled = busy;
  bridgeCompileMoBtn.disabled = busy;
  cleanupPluralBtn.disabled = busy;
  (document.getElementById('scanModsBtn') as HTMLButtonElement).disabled = busy;
  selectAllModsBtn.disabled = busy;
  clearModSelectionBtn.disabled = busy;
  workspaceSelectAllBtn.disabled = busy;
  workspaceInvertBtn.disabled = busy;
  workspaceSelectEmptyBtn.disabled = busy;
  workspaceShowSelectedOnlyInput.disabled = busy;
  workspaceShowEmptyOnlyInput.disabled = busy;
  workspaceSyncSameSourceInput.disabled = busy;
  workspaceSyncScopeSelect.disabled = busy;
  workspaceSearchInput.disabled = busy;
  (document.getElementById('stopBtn') as HTMLButtonElement).disabled = !busy;
  updateModeActionButtons();
}

document.getElementById('chooseImport')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailableDialog'));
    return;
  }
  const d = await translator.selectFolder();
  if (d) importDirInput.value = d;
});
document.getElementById('chooseExport')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailableDialog'));
    return;
  }
  const d = await translator.selectFolder();
  if (d) exportDirInput.value = d;
});

document.getElementById('chooseBridgeTranslatedModDir')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailableDialog'));
    return;
  }
  const dir = await translator.selectFolder();
  if (dir) {
    bridgeTranslatedModDirInput.value = dir;
    saveConfig();
  }
});

document.getElementById('chooseBridgeOutputDir')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailableDialog'));
    return;
  }
  const dir = await translator.selectFolder();
  if (dir) {
    bridgeOutputDirInput.value = dir;
    saveConfig();
  }
});

providerSelect.addEventListener('change', () => {
  applyProviderDefaults(providerSelect.value);
  saveConfig();
});

targetLangInput.addEventListener('change', () => {
  applyLanguagePromptDefaults(true);
  saveConfig();
});
uiLangSelect.addEventListener('change', () => {
  applyUiLanguage(normalizeUiLang(uiLangSelect.value));
  refreshPresetOptions();
  saveConfig();
});
workModeSelect.addEventListener('change', () => {
  if (hasDirtyPoTabs()) {
    const confirmed = confirm(rt('unsavedPoSwitchConfirm'));
    if (!confirmed) {
      workModeSelect.value = lastWorkModeValue;
      return;
    }
  }
  applyWorkMode();
  lastWorkModeValue = workModeSelect.value;
  saveConfig();
});
bridgeOperationModeSelect.addEventListener('change', () => {
  updateBridgeOperationUi();
  saveConfig();
});
poLanguageInput.addEventListener('change', () => {
  if (hasDirtyPoTabs()) {
    const confirmed = confirm(rt('unsavedPoSwitchConfirm'));
    if (!confirmed) {
      poLanguageInput.value = lastPoLanguageSelectValue;
      poLanguageCustomInput.value = lastPoLanguageCustomValue;
      updatePoLanguageCustomVisibility();
      return;
    }
  }
  updatePoLanguageCustomVisibility();
  switchToPoLanguageContext();
  if (!bridgeTargetLangCodeInput.value.trim()) {
    bridgeTargetLangCodeInput.value = getPoLanguageValue();
  }
  lastPoLanguageSelectValue = poLanguageInput.value;
  lastPoLanguageCustomValue = poLanguageCustomInput.value;
  saveConfig();
});
poLanguageCustomInput.addEventListener('change', () => {
  if (hasDirtyPoTabs()) {
    const confirmed = confirm(rt('unsavedPoSwitchConfirm'));
    if (!confirmed) {
      poLanguageInput.value = lastPoLanguageSelectValue;
      poLanguageCustomInput.value = lastPoLanguageCustomValue;
      updatePoLanguageCustomVisibility();
      return;
    }
  }
  switchToPoLanguageContext();
  if (!bridgeTargetLangCodeInput.value.trim()) {
    bridgeTargetLangCodeInput.value = getPoLanguageValue();
  }
  lastPoLanguageSelectValue = poLanguageInput.value;
  lastPoLanguageCustomValue = poLanguageCustomInput.value;
  saveConfig();
});
workspaceSearchInput.addEventListener('input', () => {
  workspaceSearchText = workspaceSearchInput.value;
  if (workspaceSearchTimer !== null) {
    window.clearTimeout(workspaceSearchTimer);
  }
  workspaceSearchTimer = window.setTimeout(() => {
    workspaceSearchTimer = null;
    renderSegments();
  }, 120);
});
workspaceShowSelectedOnlyInput.addEventListener('change', () => {
  renderSegments();
});
workspaceShowEmptyOnlyInput.addEventListener('change', () => {
  renderSegments();
});
workspaceSyncScopeSelect.addEventListener('change', () => {
  renderSegments();
});
workspaceSelectAllBtn.addEventListener('click', () => {
  selectedIds = selectAllWorkspaceSegments(selectedIds, getFilteredSegments().map((s) => s.id));
  renderSegments();
});
workspaceInvertBtn.addEventListener('click', () => {
  selectedIds = invertWorkspaceSelection(selectedIds, getFilteredSegments().map((s) => s.id));
  renderSegments();
});
workspaceSelectEmptyBtn.addEventListener('click', () => {
  selectedIds = selectEmptyWorkspaceSegments(selectedIds, getFilteredSegments(), translationMap);
  renderSegments();
});

function applyPreset(preset: string) {
  const rule = rulePresets[preset];
  if (rule) {
    applyRuleToInputs(rule);
    saveConfig();
  }
}

rulePresetSelect.addEventListener('change', () => {
  applyPreset(rulePresetSelect.value);
});

savePresetBtn.addEventListener('click', () => {
  const preset = rulePresetSelect.value;
  if (preset === 'custom') {
    alert(rt('choosePresetFirst'));
    return;
  }
  rulePresets[preset] = getRuleFromInputs();
  saveRulePresets();
  setStatus(rt('presetSaved', { preset }));
});

newPresetBtn.addEventListener('click', () => {
  const fallback = rt('presetNameFallback');
  const name = prompt(rt('presetNamePrompt'), fallback)?.trim();
  if (!name) return;
  rulePresets[name] = getRuleFromInputs();
  saveRulePresets();
  refreshPresetOptions();
  rulePresetSelect.value = name;
  saveConfig();
  setStatus(rt('presetAdded', { preset: name }));
});

importPresetBtn.addEventListener('click', () => importPresetFile.click());
importPresetFile.addEventListener('change', async () => {
  const file = importPresetFile.files?.[0];
  importPresetFile.value = '';
  if (!file) return;
  try {
    const content = await file.text();
    const parsed = JSON.parse(content);
    const presetName = String(parsed.name || parsed.presetName || '').trim() || file.name.replace(/\.json$/i, '');
    const sourceRule = parsed.rule ? parsed.rule : parsed;
    const rule: RulePresetData = {
      includeKeys: String(sourceRule.includeKeys || ''),
      excludeKeys: String(sourceRule.excludeKeys || ''),
      includeKeyRegex: String(sourceRule.includeKeyRegex || ''),
      excludeKeyRegex: String(sourceRule.excludeKeyRegex || ''),
      includePathRegex: String(sourceRule.includePathRegex || ''),
      excludePathRegex: String(sourceRule.excludePathRegex || ''),
      skipEmpty: Boolean(sourceRule.skipEmpty ?? true),
      regex: String(sourceRule.regex || '')
    };
    if (!presetName) throw new Error('Preset name is empty');
    rulePresets[presetName] = rule;
    saveRulePresets();
    refreshPresetOptions();
    rulePresetSelect.value = presetName;
    applyPreset(presetName);
    saveConfig();
    setStatus(rt('presetImported', { preset: presetName }));
  } catch (e: any) {
    alert(rt('importFailed', { error: e?.message || e }));
  }
});

deletePresetBtn.addEventListener('click', () => {
  const preset = rulePresetSelect.value;
  if (preset === 'custom') {
    alert(rt('chooseCustomPresetFirst'));
    return;
  }
  if (BUILTIN_PRESET_NAMES.has(preset)) {
    alert(rt('builtinPresetNotDeletable'));
    return;
  }
  const confirmed = confirm(rt('deletePresetConfirm', { preset }));
  if (!confirmed) return;
  delete rulePresets[preset];
  saveRulePresets();
  refreshPresetOptions();
  rulePresetSelect.value = 'custom';
  saveConfig();
  setStatus(rt('presetDeleted', { preset }));
});

exportPresetBtn.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const selected = rulePresetSelect.value;
  const presetName = selected === 'custom' ? 'custom-current' : selected;
  const rule = selected === 'custom' ? getRuleFromInputs() : rulePresets[selected];
  if (!rule) {
    alert(rt('currentPresetEmpty'));
    return;
  }
  try {
    const dir = await translator.selectFolder();
    if (!dir) return;
    const payload = JSON.stringify({ name: presetName, rule }, null, 2);
    const savedPath = await translator.savePresetJson(dir, `${presetName}.json`, payload);
    setStatus(rt('exportPresetDone', { path: savedPath }));
  } catch (e: any) {
    alert(rt('exportPresetFailed', { error: e?.message || e }));
  }
});

function validateConfig(cfg: ApiConfig) {
  const errors: string[] = [];
  if (!cfg.apiKey) errors.push(rt('apiKeyEmpty'));
  if (!cfg.model) errors.push(rt('modelEmpty'));
  if (!cfg.baseUrl) errors.push(rt('baseUrlEmpty'));
  return errors;
}

function saveConfig() {
  const data = buildRendererConfigSnapshot({
    provider: providerSelect.value,
    baseUrl: baseUrlInput.value,
    model: modelInput.value,
    apiKey: rememberKeyInput.checked ? apiKeyInput.value : '',
    rememberKey: rememberKeyInput.checked,
    systemPrompt: systemPromptInput.value,
    userPrefix: userPrefixInput.value,
    targetLang: targetLangInput.value,
    timeoutSec: localStorage.getItem('timeoutSec') || '120',
    maxRetries: localStorage.getItem('maxRetries') || '2',
    batchSize: batchSizeInput?.value || '20',
    batchTokenLimit: batchTokenLimitInput?.value || '8000',
    concurrency: concurrencyInput?.value || '2',
    rpmLimit: rpmLimitInput?.value || '0',
    tpmLimit: tpmLimitInput?.value || '0',
    includeKeys: includeKeysInput.value,
    excludeKeys: excludeKeysInput.value,
    includeKeyRegex: includeKeyRegexInput.value,
    excludeKeyRegex: excludeKeyRegexInput.value,
    includePathRegex: includePathRegexInput.value,
    excludePathRegex: excludePathRegexInput.value,
    skipEmpty: skipEmptyInput.checked,
    rulePreset: rulePresetSelect.value,
    regex: regexInput.value,
    uiLang: uiLangSelect.value,
    workMode: workModeSelect.value,
    langDir: langDirInput.value,
    langMode: langModeSelect.value,
    noStrPlNoS: noStrPlNoSInput.checked,
    modRootDir: modRootDirInput.value,
    poLanguage: poLanguageInput.value,
    poLanguageCustom: poLanguageCustomInput.value,
    bridgeTranslatedModDir: bridgeTranslatedModDirInput.value,
    bridgeOutputDir: bridgeOutputDirInput.value,
    bridgeSourceLangCode: bridgeSourceLangCodeInput.value,
    bridgeTargetLangCode: bridgeTargetLangCodeInput.value,
    bridgeOperationMode: bridgeOperationModeSelect.value,
    bridgeConflictStrategy: bridgeConflictStrategySelect.value,
    bridgeArrayMatchById: bridgeArrayMatchByIdInput.checked,
    pythonPath: pythonPathInput.value,
    gettextPath: gettextPathInput.value
  });
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(data));
  void persistUserConfigToFile();
}

function loadConfig() {
  const hydrated = hydrateLoadedConfigState({
    raw: localStorage.getItem(CONFIG_STORAGE_KEY),
    currentProvider: providerSelect.value,
    storedUiLang: localStorage.getItem(UI_LANG_STORAGE_KEY),
    lastDefaults,
  });
  providerSelect.value = hydrated.provider;
  baseUrlInput.value = hydrated.baseUrl;
  modelInput.value = hydrated.model;
  lastDefaults = hydrated.providerDefaults;
  if (!hydrated.hasStoredConfig || !hydrated.snapshot) {
    applyUiLanguage(hydrated.uiLang);
    refreshPresetOptions();
    applyLanguagePromptDefaults(true);
    return;
  }
  try {
    const data = hydrated.snapshot;
    if (data.baseUrl) baseUrlInput.value = data.baseUrl;
    if (data.model) modelInput.value = data.model;
    if (data.rememberKey) apiKeyInput.value = data.apiKey || '';
    rememberKeyInput.checked = Boolean(data.rememberKey);
    if (data.targetLang) {
      ensureTargetLanguageOption(data.targetLang);
      targetLangInput.value = data.targetLang;
    }
    if (data.systemPrompt) systemPromptInput.value = data.systemPrompt;
    if (data.userPrefix) userPrefixInput.value = data.userPrefix;
    if (data.timeoutSec) localStorage.setItem('timeoutSec', data.timeoutSec);
    if (data.maxRetries) localStorage.setItem('maxRetries', data.maxRetries);
    if (data.batchSize) batchSizeInput.value = String(data.batchSize);
    if (data.batchTokenLimit) batchTokenLimitInput.value = String(data.batchTokenLimit);
    if (data.concurrency) concurrencyInput.value = String(data.concurrency);
    if (data.rpmLimit !== undefined) rpmLimitInput.value = String(data.rpmLimit);
    if (data.tpmLimit !== undefined) tpmLimitInput.value = String(data.tpmLimit);
    if (data.includeKeys) includeKeysInput.value = data.includeKeys;
    if (data.excludeKeys) excludeKeysInput.value = data.excludeKeys;
    if (data.includeKeyRegex) includeKeyRegexInput.value = data.includeKeyRegex;
    if (data.excludeKeyRegex) excludeKeyRegexInput.value = data.excludeKeyRegex;
    if (data.includePathRegex) includePathRegexInput.value = data.includePathRegex;
    if (data.excludePathRegex) excludePathRegexInput.value = data.excludePathRegex;
    if (typeof data.skipEmpty === 'boolean') skipEmptyInput.checked = data.skipEmpty;
    if (data.rulePreset) rulePresetSelect.value = data.rulePreset;
    if (data.regex) regexInput.value = data.regex;
    if (data.langDir) langDirInput.value = data.langDir;
    if (data.langMode) langModeSelect.value = data.langMode;
    if (typeof data.noStrPlNoS === 'boolean') noStrPlNoSInput.checked = data.noStrPlNoS;
    else if (typeof (data as any).monsterNoStrPlNoS === 'boolean') noStrPlNoSInput.checked = Boolean((data as any).monsterNoStrPlNoS);
    if (data.modRootDir) modRootDirInput.value = data.modRootDir;
    if (data.poLanguage) poLanguageInput.value = data.poLanguage;
    if (data.poLanguageCustom) poLanguageCustomInput.value = data.poLanguageCustom;
    if (data.bridgeTranslatedModDir) bridgeTranslatedModDirInput.value = data.bridgeTranslatedModDir;
    if (data.bridgeOutputDir) bridgeOutputDirInput.value = data.bridgeOutputDir;
    if (data.bridgeSourceLangCode) bridgeSourceLangCodeInput.value = data.bridgeSourceLangCode;
    if (data.bridgeTargetLangCode) bridgeTargetLangCodeInput.value = data.bridgeTargetLangCode;
    if (data.bridgeOperationMode) bridgeOperationModeSelect.value = data.bridgeOperationMode;
    if (data.bridgeConflictStrategy) bridgeConflictStrategySelect.value = data.bridgeConflictStrategy;
    if (typeof data.bridgeArrayMatchById === 'boolean') bridgeArrayMatchByIdInput.checked = data.bridgeArrayMatchById;
    updateBridgeOperationUi();
    updatePoLanguageCustomVisibility();
    if (data.pythonPath) pythonPathInput.value = data.pythonPath;
    if (data.gettextPath) gettextPathInput.value = data.gettextPath;
    if (data.workMode) workModeSelect.value = data.workMode;
    applyWorkMode();
    applyUiLanguage(hydrated.uiLang);
    refreshPresetOptions();
    applyLanguagePromptDefaults(false);
  } catch {
    const fallback = hydrateLoadedConfigState({
      raw: null,
      currentProvider: providerSelect.value,
      storedUiLang: localStorage.getItem(UI_LANG_STORAGE_KEY),
      lastDefaults,
    });
    providerSelect.value = fallback.provider;
    baseUrlInput.value = fallback.baseUrl;
    modelInput.value = fallback.model;
    lastDefaults = fallback.providerDefaults;
    applyUiLanguage(fallback.uiLang);
    refreshPresetOptions();
    applyLanguagePromptDefaults(true);
  }
}

[
  providerSelect,
  baseUrlInput,
  modelInput,
  apiKeyInput,
  rememberKeyInput,
  systemPromptInput,
  userPrefixInput,
  targetLangInput,
  batchSizeInput,
  batchTokenLimitInput,
  concurrencyInput,
  rpmLimitInput,
  tpmLimitInput,
  includeKeysInput,
  excludeKeysInput,
  includeKeyRegexInput,
  excludeKeyRegexInput,
  includePathRegexInput,
  excludePathRegexInput,
  skipEmptyInput,
  rulePresetSelect,
  regexInput,
  langDirInput,
  langModeSelect,
  modRootDirInput,
  poLanguageInput,
  poLanguageCustomInput,
  bridgeTranslatedModDirInput,
  bridgeOutputDirInput,
  bridgeSourceLangCodeInput,
  bridgeTargetLangCodeInput,
  bridgeOperationModeSelect,
  bridgeConflictStrategySelect,
  bridgeArrayMatchByIdInput,
  pythonPathInput,
  gettextPathInput
].forEach(el => {
  el.addEventListener('change', saveConfig);
});

document.getElementById('timeoutSec')!.addEventListener('change', (e) => {
  localStorage.setItem('timeoutSec', (e.target as HTMLInputElement).value);
  saveConfig();
});
document.getElementById('maxRetries')!.addEventListener('change', (e) => {
  localStorage.setItem('maxRetries', (e.target as HTMLInputElement).value);
  saveConfig();
});

document.getElementById('batchSize')!.addEventListener('change', (e) => {
  localStorage.setItem('batchSize', (e.target as HTMLInputElement).value);
  saveConfig();
});
document.getElementById('batchTokenLimit')!.addEventListener('change', (e) => {
  localStorage.setItem('batchTokenLimit', (e.target as HTMLInputElement).value);
  saveConfig();
});
document.getElementById('concurrency')!.addEventListener('change', (e) => {
  localStorage.setItem('concurrency', (e.target as HTMLInputElement).value);
  saveConfig();
});

async function initializeApp() {
  applyAppMeta();
  reportLocaleCoverage();
  const loaded = await hydrateFromUserConfigFile();
  if (!loaded) {
    clearClientStoredConfig();
    loadedFromUserConfigFile = false;
  }
  loadRulePresets();
  const initialLang = normalizeUiLang(localStorage.getItem(UI_LANG_STORAGE_KEY));
  applyUiLanguage(initialLang);
  refreshPresetOptions();
  loadConfig();
  updatePoLanguageCustomVisibility();
  ensureBridgeLangCodeDefaults();
  applyWorkMode();
  lastWorkModeValue = workModeSelect.value;
  lastPoLanguageSelectValue = poLanguageInput.value;
  lastPoLanguageCustomValue = poLanguageCustomInput.value;
  if (!loadedFromUserConfigFile) {
    await persistUserConfigToFile();
  }
  if (lastSavedUserConfigPath) {
    setStatus(rt('userConfigPath', { path: lastSavedUserConfigPath }));
  }
}

window.addEventListener('beforeunload', (event) => {
  if (!hasDirtyPoTabs()) return;
  event.preventDefault();
  event.returnValue = rt('unsavedPoLeaveConfirm');
});

void initializeApp();

function getSelectedModItems() {
  const selected = new Set<string>();
  modListDiv.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((el) => {
    if (el.checked) selected.add(el.value);
  });
  return scannedMods.filter((m) => selected.has(m.path));
}

function stripModColorTag(text: string) {
  return text.replace(/<\/?color[^>]*>/gi, '').trim();
}

function renderModList() {
  modListDiv.innerHTML = '';
  if (!scannedMods.length) {
    modListDiv.innerHTML = '<div>—</div>';
    return;
  }
  scannedMods.forEach((m) => {
    const label = document.createElement('label');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.value = m.path;
    const name = document.createElement('span');
    name.className = 'mod-name';
    name.title = m.name;
    name.textContent = stripModColorTag(m.name) || m.name;
    const id = document.createElement('span');
    id.className = 'mod-id';
    id.title = m.id;
    id.textContent = m.id;
    const p = document.createElement('span');
    p.className = 'mod-path';
    p.title = m.path;
    p.textContent = m.path;
    label.appendChild(chk);
    label.appendChild(name);
    label.appendChild(id);
    label.appendChild(p);
    modListDiv.appendChild(label);
  });
}

function setModSelectionState(checked: boolean) {
  const targetPaths = checked ? selectAllModPaths(scannedMods) : clearModPathSelection();
  const checkboxes = Array.from(modListDiv.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  applyCheckedStateToCheckboxes(checkboxes, checked);
  checkboxes.forEach((checkbox) => {
    checkbox.checked = targetPaths.has(checkbox.value);
  });
}

function makeContextKey(modPath: string, language: string) {
  return `${modPath}@@${language}`;
}

function setPoLanguageSelection(language: string) {
  const optionValues = Array.from(poLanguageInput.options).map((x) => x.value);
  if (optionValues.includes(language)) {
    poLanguageInput.value = language;
    updatePoLanguageCustomVisibility();
    return;
  }
  poLanguageInput.value = 'custom';
  poLanguageCustomInput.value = language;
  updatePoLanguageCustomVisibility();
}

function switchToPoLanguageContext() {
  persistActivePoTabContent();
  const language = getPoLanguageValue();
  if (!language) {
    activePoTabKey = '';
    poEditorInput.value = '';
    renderPoTabs();
    return;
  }
  const active = poTabs.find((x) => x.key === activePoTabKey);
  if (active && active.language === language) {
    renderPoTabs();
    return;
  }
  const target = (active?.modPath
    ? poTabs.find((x) => x.modPath === active.modPath && x.language === language)
    : undefined) || poTabs.find((x) => x.language === language);
  if (target) {
    activePoTabKey = target.key;
    poEditorInput.value = target.content;
  } else {
    activePoTabKey = '';
    poEditorInput.value = '';
    if (isModMode()) {
      setStatus(rt('noPoForLanguage', { language }));
    }
  }
  renderPoTabs();
}

function persistActivePoTabContent() {
  if (!activePoTabKey) return;
  const tab = poTabs.find((x) => x.key === activePoTabKey);
  if (!tab) return;
  tab.content = poEditorInput.value;
  tab.dirty = true;
}

function switchPoTab(key: string) {
  persistActivePoTabContent();
  activePoTabKey = key;
  const tab = poTabs.find((x) => x.key === key);
  poEditorInput.value = tab?.content || '';
  if (tab) setPoLanguageSelection(tab.language);
  renderPoTabs();
}

function closePoTab(key: string) {
  const idx = poTabs.findIndex((x) => x.key === key);
  if (idx < 0) return;
  const tab = poTabs[idx];
  if (tab.dirty) {
    const confirmed = confirm(rt('unsavedPoCloseConfirm'));
    if (!confirmed) return;
  }
  const wasActive = activePoTabKey === key;
  poTabs.splice(idx, 1);
  if (!wasActive) {
    renderPoTabs();
    return;
  }
  const currentLanguage = getPoLanguageValue();
  const sameLanguageTabs = poTabs.filter((x) => x.language === currentLanguage);
  if (sameLanguageTabs.length) {
    switchPoTab(sameLanguageTabs[0].key);
    return;
  }
  activePoTabKey = '';
  poEditorInput.value = '';
  renderPoTabs();
}

function upsertPoTab(modPath: string, language: string, name: string, content: string, dirty = false) {
  const key = makeContextKey(modPath, language);
  const tab = poTabs.find((x) => x.key === key);
  if (tab) {
    tab.content = content;
    tab.name = name || tab.name;
    tab.language = language || tab.language;
    tab.dirty = dirty;
  } else {
    poTabs.push({ key, modPath, language, name: name || modPath, content, dirty });
  }
  if (!activePoTabKey) activePoTabKey = key;
  if (activePoTabKey === key) {
    poEditorInput.value = content;
    setPoLanguageSelection(language);
  }
}

function renderPoTabs() {
  poTabsDiv.innerHTML = '';
  const currentLanguage = getPoLanguageValue();
  poTabs.filter((x) => x.language === currentLanguage).forEach((tab) => {
    const wrap = document.createElement('div');
    wrap.className = 'po-tab-item';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `po-tab${tab.key === activePoTabKey ? ' active' : ''}`;
    btn.textContent = `${tab.name} · ${tab.language}${tab.dirty ? '*' : ''}`;
    btn.addEventListener('click', () => switchPoTab(tab.key));
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'po-tab-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      closePoTab(tab.key);
    });
    wrap.appendChild(btn);
    wrap.appendChild(closeBtn);
    poTabsDiv.appendChild(wrap);
  });
}

poEditorInput.addEventListener('input', () => {
  persistActivePoTabContent();
  renderPoTabs();
});

function getModDirsForRun(fallbackDir: string) {
  const selected = getSelectedModItems();
  if (selected.length) return selected.map((x) => ({ path: x.path, name: x.name }));
  const fallback = fallbackDir.trim() || modRootDirInput.value.trim() || importDirInput.value.trim();
  if (fallback) return [{ path: fallback, name: fallback }];
  return [];
}

function getLangWorkflowConfig(options?: { requireLangDir?: boolean }): LangWorkflowConfig | null {
  const requireLangDir = options?.requireLangDir ?? true;
  const langDir = langDirInput.value.trim();
  const firstSelected = getSelectedModItems()[0];
  const modDir = firstSelected?.path || modRootDirInput.value.trim() || importDirInput.value.trim();
  const language = getPoLanguageValue();
  if (!modDir || !language) return null;
  if (requireLangDir && !langDir) return null;
  return {
    langDir: langDir || '',
    langMode: langModeSelect.value === 'cdda' ? 'cdda' : 'cbn',
    modDir,
    language,
    noStrPlNoS: noStrPlNoSInput.checked,
    pythonPath: pythonPathInput.value.trim() || undefined,
    gettextPath: gettextPathInput.value.trim() || undefined
  };
}

async function resolveCfgForMod(baseCfg: LangWorkflowConfig, modPath: string): Promise<LangWorkflowConfig> {
  return { ...baseCfg, modDir: modPath };
}

function pathBaseName(path: string) {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

document.getElementById('chooseModRootDir')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailableDialog'));
    return;
  }
  const dir = await translator.selectFolder();
  if (dir) {
    modRootDirInput.value = dir;
    saveConfig();
  }
});

document.getElementById('scanModsBtn')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const root = modRootDirInput.value.trim() || importDirInput.value.trim();
  if (!root) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    scannedMods = await translator.langScanMods(root);
    renderModList();
    if (!scannedMods.length) {
      setStatus(rt('noModsFound'));
    } else {
      setStatus(rt('modsScanned', { count: scannedMods.length }));
    }
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  }
});

selectAllModsBtn.addEventListener('click', () => {
  setModSelectionState(true);
});

clearModSelectionBtn.addEventListener('click', () => {
  setModSelectionState(false);
});

document.getElementById('useSelectedModBtn')!.addEventListener('click', async () => {
  const first = getSelectedModItems()[0];
  if (!first) return;
  if (!importDirInput.value.trim()) importDirInput.value = first.path;
  const language = getPoLanguageValue();
  const key = makeContextKey(first.path, language);
  if (poTabs.find((x) => x.key === key)) {
    switchPoTab(key);
  }
  setStatus(rt('useSelectedModDone', { name: first.name }));
  saveConfig();
});

document.getElementById('chooseLangDir')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailableDialog'));
    return;
  }
  const dir = await translator.selectFolder();
  if (dir) {
    langDirInput.value = dir;
    saveConfig();
  }
});

bridgeInlineToLangBtn.addEventListener('click', async () => {
  bridgeOperationModeSelect.value = 'inline';
  updateBridgeOperationUi();
  saveConfig();
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const translatedRoot = bridgeTranslatedModDirInput.value.trim();
  if (!translatedRoot) {
    pushSoftError(rt('bridgeNeedTranslatedModDir'));
    return;
  }
  const baseCfg = getLangWorkflowConfig();
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  const inlineTargetLangCode = bridgeTargetLangCodeInput.value.trim();
  if (inlineTargetLangCode) {
    baseCfg.language = inlineTargetLangCode;
  }
  const strategyValue = bridgeConflictStrategySelect.value;
  const bridgeOptions: BridgeInlineOptions = {
    conflictStrategy: strategyValue === 'frequency' || strategyValue === 'frequency2' ? strategyValue : 'skip',
    arrayMatchById: bridgeArrayMatchByIdInput.checked
  };
  try {
    setBusy(true);
    setStatus(rt('bridgeStartInline'));
    const runMods = getModDirsForRun(baseCfg.modDir);
    let successCount = 0;
    let failedCount = 0;
    for (const mod of runMods) {
      setStatus(rt('usingModRun', { name: mod.name }));
      try {
        const cfg = await resolveCfgForMod(baseCfg, mod.path);
        const translatedModDir = runMods.length > 1 ? `${translatedRoot}\\${pathBaseName(mod.path)}` : translatedRoot;
        const report = await translator.langBridgeInlineToLang(cfg, translatedModDir, bridgeOptions);
        const content = await translator.langReadPo(cfg);
        upsertPoTab(mod.path, cfg.language, mod.name, content, false);
        const filledCount = Number.isFinite(Number(report.filledCount))
          ? Number(report.filledCount)
          : Number(report.filledMsgstrCount || 0) + Number(report.filledPluralCount || 0);
        setStatus(rt('bridgeInlineDone', {
          poPath: report.poPath,
          moPath: report.moPath,
          strategy: report.conflictStrategy || bridgeOptions.conflictStrategy,
          filled: filledCount,
          conflicts: report.conflictCount,
          conflictsResolved: Number(report.conflictResolvedCount || 0),
          conflictsSkipped: Number(report.conflictSkippedCount || 0),
          logPath: report.logPath || '-'
        }));
        successCount += 1;
      } catch (e: any) {
        failedCount += 1;
        setStatus(rt('bridgeInlineModFailed', { name: mod.name, error: e?.message || e }));
      }
    }
    renderPoTabs();
    setStatus(rt('bridgeInlineBatchSummary', {
      total: runMods.length,
      success: successCount,
      failed: failedCount
    }));
    setStatus(rt('nextStepAfterSavePo'));
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  } finally {
    setBusy(false);
  }
});

bridgePoToCodeBtn.addEventListener('click', async () => {
  bridgeOperationModeSelect.value = 'reverse';
  updateBridgeOperationUi();
  saveConfig();
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const outputRoot = bridgeOutputDirInput.value.trim();
  if (!outputRoot) {
    pushSoftError(rt('bridgeNeedOutputDir'));
    return;
  }
  const baseCfg = getLangWorkflowConfig({ requireLangDir: false });
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  const sourceLangCode = bridgeSourceLangCodeInput.value.trim() || 'en';
  const targetLangCode = bridgeTargetLangCodeInput.value.trim() || baseCfg.language;
  try {
    setBusy(true);
    setStatus(rt('bridgeStartPoToCode'));
    const runMods = getModDirsForRun(baseCfg.modDir);
    let successCount = 0;
    let failedCount = 0;
    for (const mod of runMods) {
      setStatus(rt('usingModRun', { name: mod.name }));
      try {
        const cfg = await resolveCfgForMod(baseCfg, mod.path);
        const outputDir = runMods.length > 1 ? `${outputRoot}\\${pathBaseName(mod.path)}` : outputRoot;
        const report = await translator.langBridgePoToCode(cfg, sourceLangCode, targetLangCode, outputDir);
        setStatus(rt('bridgePoToCodeDone', {
          outDir: report.outputDir,
          replaced: report.replacedTextCount,
          renamed: report.renamedPathCount
        }));
        successCount += 1;
      } catch (e: any) {
        failedCount += 1;
        setStatus(rt('bridgePoToCodeModFailed', { name: mod.name, error: e?.message || e }));
      }
    }
    setStatus(rt('bridgePoToCodeBatchSummary', {
      total: runMods.length,
      success: successCount,
      failed: failedCount
    }));
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  } finally {
    setBusy(false);
  }
});

bridgeCompileMoBtn.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const baseCfg = getLangWorkflowConfig({ requireLangDir: false });
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    setBusy(true);
    const runMods = getModDirsForRun(baseCfg.modDir);
    for (const mod of runMods) {
      setStatus(rt('usingModRun', { name: mod.name }));
      const cfg = await resolveCfgForMod(baseCfg, mod.path);
      const path = await translator.langCompileMo(cfg);
      setStatus(rt('langMoDone', { path }));
    }
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  } finally {
    setBusy(false);
  }
});

document.getElementById('preparePoBtn')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const baseCfg = getLangWorkflowConfig();
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    const runMods = getModDirsForRun(baseCfg.modDir);
    for (const mod of runMods) {
      setStatus(rt('usingModRun', { name: mod.name }));
      const cfg = await resolveCfgForMod(baseCfg, mod.path);
      await translator.langGeneratePot(cfg);
      await translator.langGeneratePo(cfg);
      const content = await translator.langReadPo(cfg);
      upsertPoTab(mod.path, cfg.language, mod.name, content, false);
    }
    renderPoTabs();
    setStatus(rt('langReadyDone'));
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  }
});

document.getElementById('extractPoToWorkspaceBtn')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const baseCfg = getLangWorkflowConfig({ requireLangDir: false });
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    const runMods = getModDirsForRun(baseCfg.modDir);
    segments = [];
    clearTranslations();
    selectedIds = new Set();
    workspaceContextMap.clear();
    workspaceContextInfo.clear();
    for (const mod of runMods) {
      setStatus(rt('usingModRun', { name: mod.name }));
      const cfg = await resolveCfgForMod(baseCfg, mod.path);
      const poSegments: Segment[] = await translator.langExtractPoSegments(cfg);
      const contextKey = makeContextKey(mod.path, cfg.language);
      workspaceContextInfo.set(contextKey, { modPath: mod.path, language: cfg.language, name: mod.name });
      poSegments.forEach((s, idx) => {
        const workspaceId = `${contextKey}::${s.id}::${idx}`;
        segments.push({ ...s, id: workspaceId });
        selectedIds.add(workspaceId);
        getOrCreateTranslation(workspaceId);
        workspaceContextMap.set(workspaceId, contextKey);
      });
    }
    rebuildWorkspaceIndexes();
    renderSegments(true);
    if (!segments.length) {
      setStatus(rt('poAiNoItems'));
    } else {
      setStatus(rt('poAiStart', { count: segments.length }));
    }
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  }
});

document.getElementById('applyWorkspaceToPoBtn')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const baseCfg = getLangWorkflowConfig({ requireLangDir: false });
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    const contexts = Array.from(workspaceContextInfo.entries());
    for (const [contextKey, context] of contexts) {
      const cfg = { ...baseCfg, modDir: context.modPath, language: context.language };
      const contextIds = new Set(contextToSegmentIds.get(contextKey) || []);
      const modItems = translations.filter(t => contextIds.has(t.id));
      const validItems = modItems.filter(t => t.valid && t.target.trim());
      const applyItems = validItems.map(t => {
        const parts = t.id.split('::');
        const rawId = parts.length >= 3 ? parts[1] : '';
        return { id: rawId, target: t.target };
      });
      setStatus(rt('poApplyStats', {
        name: context.name,
        language: context.language,
        workspace: modItems.length,
        valid: validItems.length,
        apply: applyItems.length
      }));
      if (!applyItems.length) {
        setStatus(rt('poAiNoApplied'));
        continue;
      }
      const applied = await translator.langApplyPoTranslations(cfg, applyItems);
      const newContent = await translator.langReadPo(cfg);
      upsertPoTab(context.modPath, context.language, context.name, newContent, false);
      renderPoTabs();
      if (applied > 0) {
        setStatus(rt('poAiApplied', { count: applied }));
      } else {
        setStatus(rt('poAiNoApplied'));
      }
    }
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  }
});

document.getElementById('genPotBtn')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const cfg = getLangWorkflowConfig();
  if (!cfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    const path = await translator.langGeneratePot(cfg);
    setStatus(rt('langPotDone', { path }));
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  }
});

document.getElementById('genPoBtn')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const baseCfg = getLangWorkflowConfig();
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    const runMods = getModDirsForRun(baseCfg.modDir);
    for (const mod of runMods) {
      const cfg = await resolveCfgForMod(baseCfg, mod.path);
      const path = await translator.langGeneratePo(cfg);
      const content = await translator.langReadPo(cfg);
      upsertPoTab(mod.path, cfg.language, mod.name, content, false);
      setStatus(rt('langPoDone', { path }));
    }
    renderPoTabs();
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  }
});

document.getElementById('genPoRewriteBtn')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const baseCfg = getLangWorkflowConfig();
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    const runMods = getModDirsForRun(baseCfg.modDir);
    for (const mod of runMods) {
      const cfg = await resolveCfgForMod(baseCfg, mod.path);
      const confirmed = confirm(rt('langRewriteConfirm', { name: mod.name, language: cfg.language }));
      if (!confirmed) continue;
      const path = await translator.langRegeneratePo(cfg);
      const content = await translator.langReadPo(cfg);
      upsertPoTab(mod.path, cfg.language, mod.name, content, false);
      setStatus(rt('langPoDone', { path }));
    }
    renderPoTabs();
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  }
});

document.getElementById('loadPoBtn')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const baseCfg = getLangWorkflowConfig({ requireLangDir: false });
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    const runMods = getModDirsForRun(baseCfg.modDir);
    for (const mod of runMods) {
      const cfg = await resolveCfgForMod(baseCfg, mod.path);
      const content = await translator.langReadPo(cfg);
      upsertPoTab(mod.path, cfg.language, mod.name, content, false);
    }
    renderPoTabs();
    setStatus(rt('langPoLoaded'));
    setStatus(rt('nextStepAfterLoadPo'));
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  }
});

document.getElementById('savePoBtn')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const baseCfg = getLangWorkflowConfig({ requireLangDir: false });
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    persistActivePoTabContent();
    if (activePoTabKey) {
      const tab = poTabs.find((x) => x.key === activePoTabKey);
      const cfg = tab
        ? { ...baseCfg, modDir: tab.modPath, language: tab.language }
        : baseCfg;
      const path = await translator.langWritePo(cfg, tab?.content || poEditorInput.value);
      if (tab) tab.dirty = false;
      renderPoTabs();
      setStatus(rt('langPoSaved', { path }));
      setStatus(rt('nextStepAfterSavePo'));
      return;
    }
    const path = await translator.langWritePo(baseCfg, poEditorInput.value);
    setStatus(rt('langPoSaved', { path }));
    setStatus(rt('nextStepAfterSavePo'));
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  }
});

saveAllPoBtn.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const baseCfg = getLangWorkflowConfig({ requireLangDir: false });
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    persistActivePoTabContent();
    const dirtyTabs = poTabs.filter((x) => x.dirty);
    if (!dirtyTabs.length) {
      setStatus(rt('saveAllPoNone'));
      return;
    }
    for (const tab of dirtyTabs) {
      const cfg = { ...baseCfg, modDir: tab.modPath, language: tab.language };
      await translator.langWritePo(cfg, tab.content);
      tab.dirty = false;
    }
    renderPoTabs();
    setStatus(rt('saveAllPoDone', { count: dirtyTabs.length }));
    setStatus(rt('nextStepAfterSavePo'));
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  }
});

cleanupPluralBtn.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const baseCfg = getLangWorkflowConfig({ requireLangDir: false });
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    setBusy(true);
    let totalRemoved = 0;
    const runMods = getModDirsForRun(baseCfg.modDir);
    for (const mod of runMods) {
      setStatus(rt('usingModRun', { name: mod.name }));
      const cfg = await resolveCfgForMod(baseCfg, mod.path);
      const removed = await translator.langCleanupPoPlural(cfg);
      totalRemoved += removed;
      if (removed > 0) {
        const content = await translator.langReadPo(cfg);
        upsertPoTab(mod.path, cfg.language, mod.name, content, false);
      }
    }
    renderPoTabs();
    if (totalRemoved > 0) {
      setStatus(rt('cleanupPluralDone', { count: totalRemoved }));
    } else {
      setStatus(rt('cleanupPluralNone'));
    }
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  } finally {
    setBusy(false);
  }
});

document.getElementById('compileMoBtn')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const baseCfg = getLangWorkflowConfig({ requireLangDir: false });
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  try {
    const runMods = getModDirsForRun(baseCfg.modDir);
    for (const mod of runMods) {
      setStatus(rt('usingModRun', { name: mod.name }));
      const cfg = await resolveCfgForMod(baseCfg, mod.path);
      const path = await translator.langCompileMo(cfg);
      setStatus(rt('langMoDone', { path }));
    }
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  }
});

convertPoBtn.addEventListener('click', async () => {
  if (typeof OpenCC === 'undefined') {
    pushSoftError('OpenCC runtime not loaded. Check app/renderer/opencc-full.js and rerun npm run build.');
    return;
  }
  if (!translator) {
    alert(rt('runtimeUnavailable'));
    return;
  }
  const baseCfg = getLangWorkflowConfig({ requireLangDir: false });
  if (!baseCfg) {
    alert(rt('langConfigMissing'));
    return;
  }
  
  const mode = convertModeSelect.value;
  const configMap: Record<string, { from: string; to: string }> = {
    s2t: { from: 'cn', to: 'tw' },
    t2s: { from: 'tw', to: 'cn' }
  };
  const ccCfg = configMap[mode] || { from: 'cn', to: 'tw' };
  const targetLangCode = getTargetPoLanguageCode(mode);
  
  try {
    setBusy(true);
    setStatus('Initializing OpenCC...');
    const converter = OpenCC.Converter(ccCfg);
    const hasChinese = (text: string) => /[\u4e00-\u9fa5]/.test(text);
    let lastContextKey = '';
    
    const runMods = getModDirsForRun(baseCfg.modDir);
    for (const mod of runMods) {
      setStatus(rt('usingModRun', { name: mod.name }));
      const sourceCfg = await resolveCfgForMod(baseCfg, mod.path);
      const content = await translator.langReadPo(sourceCfg);
      if (!content) continue;

      const newContent = convertPoContent(content, targetLangCode, (text) => {
        if (!hasChinese(text)) return text;
        return converter(text) as string;
      });
      const targetCfg = { ...sourceCfg, language: targetLangCode };
      const path = await translator.langWritePo(targetCfg, newContent);
      upsertPoTab(mod.path, targetLangCode, mod.name, newContent, false);
      lastContextKey = makeContextKey(mod.path, targetLangCode);
      setStatus(rt('langPoSaved', { path }));
    }
    if (lastContextKey) {
      setPoLanguageSelection(targetLangCode);
      const targetTab = poTabs.find((x) => x.key === lastContextKey);
      if (targetTab) {
        switchPoTab(targetTab.key);
      } else {
        switchToPoLanguageContext();
      }
    } else {
      renderPoTabs();
    }
    setStatus(rt('nextStepAfterConvertPo'));
  } catch (e: any) {
    setStatus(rt('langActionFailed', { error: e?.message || e }));
  } finally {
    setBusy(false);
  }
});

document.getElementById('scanBtn')!.addEventListener('click', async () => {
  if (!isKeywordMode()) {
    return;
  }
  if (!importDirInput.value.trim()) {
    pushSoftError(rt('selectImportFirst'));
    return;
  }
  const rule = getRule();
  if (!translator) {
    alert(rt('runtimeUnavailableScan'));
    return;
  }
  try {
    setBusy(true);
    setStatus(rt('scanStart'));
    const scanResult = await translator.scanSegments(importDirInput.value, rule);
    segments = scanResult.segments;
    clearTranslations();
    workspaceContextMap.clear();
    workspaceContextInfo.clear();
    rebuildWorkspaceIndexes();
    setStatus(rt('scanDone', { count: segments.length }));
    if (scanResult.errors.length) {
      setStatus(rt('scanFailedCount', { count: scanResult.errors.length }), true);
      scanResult.errors.slice(0, 20).forEach((err: ScanError) => {
        setStatus(`${err.file} - ${err.message}`, true);
      });
      if (scanResult.errors.length > 20) {
        setStatus(rt('scanMoreErrors', { count: scanResult.errors.length - 20 }), true);
      }
    }
  } catch (e: any) {
    setStatus(rt('scanFailed', { error: e?.message || e }));
  } finally {
    setBusy(false);
  }
  selectedIds = new Set(segments.map(s => s.id));
  renderSegments(true);
});

document.getElementById('testApiBtn')!.addEventListener('click', async () => {
  if (!translator) {
    alert(rt('runtimeUnavailableTest'));
    return;
  }
  const config = getConfig();
  const errors = validateConfig(config);
  if (errors.length) {
    setStatus(rt('apiConfigError', { error: errors.join(' / ') }));
    return;
  }
  const probe: Segment = { id: 'probe-1', file: 'probe', path: ['probe'], source: 'Hello world', placeholders: [] };
  try {
    setBusy(true);
    setStatus(rt('testApiStart', { baseUrl: config.baseUrl, model: config.model }));
    await waitForRateLimit([probe]);
    const results = await translator.translateBatch([probe], config);
    const ok = results && results.length > 0 && results[0].target;
    setStatus(ok ? rt('testApiSuccess', { result: results[0].target }) : rt('testApiNoResult'));
  } catch (e: any) {
    setStatus(rt('testApiFailed', { error: e?.message || e }));
  } finally {
    setBusy(false);
  }
});

document.getElementById('stopBtn')!.addEventListener('click', async () => {
  stopRequested = true;
  setStatus(rt('stopRequested'));
});

document.getElementById('translateBtn')!.addEventListener('click', async () => {
  if (!ensureLanguageMatchInModMode()) {
    return;
  }
  if (!segments.length) {
    pushSoftError(rt('scanFirst'));
    return;
  }
  const config = getConfig();
  const errors = validateConfig(config);
  if (errors.length) {
    setStatus(rt('apiConfigError', { error: errors.join(' / ') }));
    return;
  }
  
  const selectedSegs = segments.filter(s => selectedIds.has(s.id));
  if (selectedSegs.length === 0) {
    pushSoftError(rt('selectItemsFirst'));
    return;
  }

  selectedSegs.forEach(s => {
    getOrCreateTranslation(s.id);
  });
  renderTranslations();

  const { maxRetries, batchSize, tokenLimit, concurrency } = getBatching();
  const overhead = (systemPromptInput.value.length + userPrefixInput.value.length) || 1000;
  const dedup = buildDeduplicatedSegments(selectedSegs);
  dedupMemberIdsByRepresentativeId = dedup.memberMap;
  selectedSegmentTotalForProgress = dedup.totalCount;
  uniqueSegmentTotalForProgress = dedup.uniqueCount;
  setStatus(rt('translateDedupStats', {
    unique: uniqueSegmentTotalForProgress,
    total: selectedSegmentTotalForProgress,
    saved: selectedSegmentTotalForProgress - uniqueSegmentTotalForProgress
  }));
  const batches = makeBatches(dedup.uniqueSegments, batchSize, tokenLimit, overhead);
  savedBatches = batches;
  initBatchStates(batches.length);
  processedCountGlobal = 0;

  try {
    setBusy(true);
    stopRequested = false;
    const runningIndexes = getPendingBatchIndexes();
    await processBatchIndexesWithConcurrency(runningIndexes, concurrency, async (batch, i, total) => {
      if (stopRequested) return 'pending';
      setStatus(rt('translateBatchStart', { index: i + 1, total, count: batch.length }));
      let attempt = 0;
      let success = false;
      while (attempt <= maxRetries && !success && !stopRequested) {
        try {
          const { validCount, skippedCount } = await requestBatchWithModerationFallback(batch, config, i + 1, {
            splitStart: 'moderationSplitStart',
            itemSkipped: 'moderationItemSkipped'
          });
          renderTranslations();
          success = (validCount + skippedCount) === batch.length;
          if (!success) {
            setStatus(rt('translateBatchValidateFailed', { index: i + 1, attempt: attempt + 1, maxRetries }));
          } else {
            processedCountGlobal = getCompletedSegmentCount();
            setStatus(rt('progress', {
              processed: processedCountGlobal,
              total: selectedSegmentTotalForProgress,
              percent: Math.round(processedCountGlobal / Math.max(1, selectedSegmentTotalForProgress) * 100)
            }));
          }
        } catch (e: any) {
          console.error(e);
          setStatus(rt('translateBatchFailed', {
            index: i + 1,
            attempt: attempt + 1,
            maxAttempts: maxRetries + 1,
            error: e.message || e
          }), true);
        }
        attempt++;
        if (!success && attempt <= maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
      if (!success) {
        setStatus(rt('translateBatchSkipped', { index: i + 1 }), true);
        return stopRequested ? 'pending' : 'failed';
      }
      return 'completed';
    });
    
    if (!stopRequested) {
      setStatus(rt('translateDone'));
      setStatus(rt('nextStepAfterTranslate'));
    }
  } catch (e: any) {
    setStatus(rt('translateFlowError', { error: e.message || e }));
  } finally {
    setBusy(false);
  }
});

document.getElementById('resumeBtn')!.addEventListener('click', async () => {
  if (!savedBatches.length) {
    pushSoftError(rt('resumeMissingTask'));
    return;
  }
  const config = getConfig();
  const errors = validateConfig(config);
  if (errors.length) {
    setStatus(rt('apiConfigError', { error: errors.join(' / ') }));
    return;
  }
  const { maxRetries, concurrency } = getBatching();
  try {
    setBusy(true);
    stopRequested = false;
    const pendingIndexes = getPendingBatchIndexes();
    if (!pendingIndexes.length) {
      setStatus(rt('resumeNothingPending'));
      return;
    }
    const total = savedBatches.length;
    const totalSegments = selectedSegmentTotalForProgress || savedBatches.reduce((sum, batch) => sum + batch.length, 0);
    processedCountGlobal = getCompletedSegmentCount();
    await processBatchIndexesWithConcurrency(pendingIndexes, concurrency, async (batch, i, _total) => {
      if (stopRequested) return 'pending';
      let attempt = 0;
      let success = false;
      while (attempt <= maxRetries && !success && !stopRequested) {
        try {
          const { validCount, skippedCount } = await requestBatchWithModerationFallback(batch, config, i + 1, {
            splitStart: 'resumeModerationSplitStart',
            itemSkipped: 'resumeModerationItemSkipped'
          });
          renderTranslations();
          success = (validCount + skippedCount) === batch.length;
          if (!success) {
            setStatus(rt('resumeValidateFailed', { index: i + 1, total, attempt: attempt + 1, maxRetries }));
          } else {
            processedCountGlobal = getCompletedSegmentCount();
            const progressTotal = Math.max(1, totalSegments);
            setStatus(rt('resumeProgress', {
              processed: processedCountGlobal,
              total: progressTotal,
              percent: Math.round(processedCountGlobal / progressTotal * 100)
            }));
          }
        } catch (e: any) {
          console.error(e);
          setStatus(rt('resumeBatchFailed', {
            index: i + 1,
            attempt: attempt + 1,
            maxAttempts: maxRetries + 1,
            error: e.message || e
          }), true);
        }
        attempt++;
        if (!success && attempt <= maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
      if (!success) {
        setStatus(rt('resumeBatchSkipped', { index: i + 1 }), true);
        return stopRequested ? 'pending' : 'failed';
      }
      return 'completed';
    });
    if (!stopRequested) setStatus(rt('resumeDone'));
  } catch (e: any) {
    setStatus(rt('resumeFlowError', { error: e.message || e }));
  } finally {
    setBusy(false);
  }
});

document.getElementById('exportBtn')!.addEventListener('click', async () => {
  if (!isKeywordMode()) {
    return;
  }
  if (!importDirInput.value.trim() || !exportDirInput.value.trim()) {
    pushSoftError(rt('fillImportExport'));
    return;
  }
  const trs = translations.map(t => ({ id: t.id, target: t.target }));
  const rule = getRule();
  if (!translator) {
    alert(rt('runtimeUnavailableExport'));
    return;
  }
  try {
    setBusy(true);
    setStatus(rt('exportStart'));
    const ok = await translator.export(importDirInput.value, trs, exportDirInput.value, rule);
    if (ok) setStatus(rt('exportDone'));
  } catch (e: any) {
    setStatus(rt('exportFailed', { error: e?.message || e }));
  } finally {
    setBusy(false);
  }
});
