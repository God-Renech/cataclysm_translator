import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRulePresets,
  DEFAULT_RULE_PRESETS,
} from "../tmp_renderer_support/rule-presets.js";
import {
  applyProviderDefaultsToSnapshot,
  buildRendererConfigSnapshot,
  getProviderDefaults,
  hydrateLoadedConfigState,
  loadStoredConfig,
  normalizeUiLang,
  resolvePromptLocale,
  saveStoredConfig,
} from "../tmp_renderer_support/config-store.js";

test("parseRulePresets merges builtins with stored presets", () => {
  const parsed = parseRulePresets(
    JSON.stringify({
      customA: {
        includeKeys: "foo",
        excludeKeys: "",
        includeKeyRegex: "",
        excludeKeyRegex: "",
        includePathRegex: "",
        excludePathRegex: "",
        skipEmpty: true,
        regex: "",
      },
    })
  );

  assert.equal(parsed.cdda.includeKeys, DEFAULT_RULE_PRESETS.cdda.includeKeys);
  assert.equal(parsed.customA.includeKeys, "foo");
});

test("parseRulePresets falls back to builtins on invalid JSON", () => {
  const parsed = parseRulePresets("{oops");
  assert.deepEqual(parsed, DEFAULT_RULE_PRESETS);
});

test("provider defaults and ui language helpers keep expected behavior", () => {
  assert.deepEqual(getProviderDefaults("gemini"), {
    baseUrl: "https://generativelanguage.googleapis.com",
    model: "gemini-2.5-flash-lite",
    targetTokens: 16000,
  });
  assert.equal(normalizeUiLang("zh-TW"), "zh-TW");
  assert.equal(normalizeUiLang("unknown", "en-US"), "en");
  assert.equal(resolvePromptLocale("Chinese Traditional"), "zh-TW");
  assert.equal(resolvePromptLocale("English"), "en");
});

test("config-store applies provider defaults and round-trips snapshots", () => {
  const applied = applyProviderDefaultsToSnapshot(
    { baseUrl: "", model: "" },
    "deepseek",
    getProviderDefaults("custom"),
    true
  );

  assert.deepEqual(applied.snapshot, {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  });

  const raw = saveStoredConfig({
    provider: "deepseek",
    baseUrl: applied.snapshot.baseUrl,
    model: applied.snapshot.model,
    apiKey: "",
    rememberKey: false,
    systemPrompt: "",
    userPrefix: "",
    targetLang: "English",
    timeoutSec: "120",
    maxRetries: "2",
    batchSize: "20",
    batchTokenLimit: "8000",
    concurrency: "2",
    rpmLimit: "0",
    tpmLimit: "0",
    includeKeys: "",
    excludeKeys: "",
    includeKeyRegex: "",
    excludeKeyRegex: "",
    includePathRegex: "",
    excludePathRegex: "",
    skipEmpty: true,
    rulePreset: "custom",
    regex: "",
    uiLang: "en",
    workMode: "mod",
    langDir: "",
    langMode: "cbn",
    noStrPlNoS: false,
    modRootDir: "",
    poLanguage: "en",
    poLanguageCustom: "",
    bridgeTranslatedModDir: "",
    bridgeOutputDir: "",
    bridgeSourceLangCode: "en",
    bridgeTargetLangCode: "zh_CN",
    bridgeOperationMode: "inline",
    bridgeConflictStrategy: "skip",
    bridgeArrayMatchById: false,
    pythonPath: "",
    gettextPath: "",
  });

  assert.equal(loadStoredConfig(raw)?.provider, "deepseek");
  assert.equal(loadStoredConfig("{oops"), null);

  const snapshot = buildRendererConfigSnapshot({
    provider: "deepseek",
    baseUrl: applied.snapshot.baseUrl,
    model: applied.snapshot.model,
    apiKey: "",
    rememberKey: false,
    systemPrompt: "",
    userPrefix: "",
    targetLang: "English",
    timeoutSec: "120",
    maxRetries: "2",
    batchSize: "20",
    batchTokenLimit: "8000",
    concurrency: "2",
    rpmLimit: "0",
    tpmLimit: "0",
    includeKeys: "",
    excludeKeys: "",
    includeKeyRegex: "",
    excludeKeyRegex: "",
    includePathRegex: "",
    excludePathRegex: "",
    skipEmpty: true,
    rulePreset: "custom",
    regex: "",
    uiLang: "en",
    workMode: "mod",
    langDir: "",
    langMode: "cbn",
    noStrPlNoS: false,
    modRootDir: "",
    poLanguage: "en",
    poLanguageCustom: "",
    bridgeTranslatedModDir: "",
    bridgeOutputDir: "",
    bridgeSourceLangCode: "en",
    bridgeTargetLangCode: "zh_CN",
    bridgeOperationMode: "inline",
    bridgeConflictStrategy: "skip",
    bridgeArrayMatchById: false,
    pythonPath: "",
    gettextPath: "",
  });
  assert.equal(snapshot.provider, "deepseek");
});

test("hydrateLoadedConfigState applies provider defaults and ui language fallback", () => {
  const state = hydrateLoadedConfigState({
    raw: JSON.stringify({
      provider: "gemini",
      baseUrl: "",
      model: "",
      uiLang: "zh-TW",
    }),
    currentProvider: "custom",
    storedUiLang: "en",
    navigatorLanguage: "en-US",
    lastDefaults: getProviderDefaults("custom"),
  });

  assert.equal(state.hasStoredConfig, true);
  assert.equal(state.provider, "gemini");
  assert.equal(state.baseUrl, "https://generativelanguage.googleapis.com");
  assert.equal(state.model, "gemini-2.5-flash-lite");
  assert.equal(state.uiLang, "zh-TW");

  const fallback = hydrateLoadedConfigState({
    raw: null,
    currentProvider: "custom",
    storedUiLang: null,
    navigatorLanguage: "ja-JP",
    lastDefaults: getProviderDefaults("custom"),
  });

  assert.equal(fallback.hasStoredConfig, false);
  assert.equal(fallback.provider, "custom");
  assert.equal(fallback.uiLang, "ja");
});
