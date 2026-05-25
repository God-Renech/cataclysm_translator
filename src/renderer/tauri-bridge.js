(() => {
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') return;
  const invoke = tauri.core.invoke;
  const openDialog = tauri.dialog && typeof tauri.dialog.open === 'function' ? tauri.dialog.open : null;

  window.translator = {
    selectFolder() {
      if (openDialog) {
        return openDialog({ directory: true, multiple: false }).then((picked) => {
          if (Array.isArray(picked)) return picked[0] ?? null;
          return picked ?? null;
        });
      }
      return invoke('select_folder');
    },
    scanSegments(dir, rule) {
      return invoke('scan_segments', { dir, rule });
    },
    translateBatch(segments, config) {
      return invoke('translate_batch', { segments, config });
    },
    export(dir, translations, outDir, rule) {
      return invoke('export_files', { dir, translations, outDir, rule });
    },
    loadUserConfig() {
      return invoke('load_user_config');
    },
    saveUserConfig(content) {
      return invoke('save_user_config', { content });
    },
    getUserConfigPath() {
      return invoke('get_user_config_path');
    },
    savePresetJson(dir, fileName, content) {
      return invoke('save_preset_json', { dir, fileName, content });
    },
    langGeneratePot(config) {
      return invoke('lang_generate_pot', { config });
    },
    langGeneratePo(config) {
      return invoke('lang_generate_po', { config });
    },
    langRegeneratePo(config) {
      return invoke('lang_regenerate_po', { config });
    },
    langReadPo(config) {
      return invoke('lang_read_po', { config });
    },
    langWritePo(config, content) {
      return invoke('lang_write_po', { config, content });
    },
    langExtractPoSegments(config) {
      return invoke('lang_extract_po_segments', { config });
    },
    langApplyPoTranslations(config, translations) {
      return invoke('lang_apply_po_translations', { config, translations });
    },
    langCompileMo(config) {
      return invoke('lang_compile_mo', { config });
    },
    langCleanupPoPlural(config) {
      return invoke('lang_cleanup_po_plural', { config });
    },
    langBridgeInlineToLang(config, translatedModDir, options) {
      return invoke('lang_bridge_inline_to_lang', { config, translatedModDir, options });
    },
    langBridgePoToCode(config, sourceLanguageCode, targetLanguageCode, outputDir) {
      return invoke('lang_bridge_po_to_code', {
        config,
        sourceLanguageCode,
        targetLanguageCode,
        outputDir
      });
    },
    langSuggestDomain(modDir) {
      return invoke('lang_suggest_domain', { modDir });
    },
    langScanMods(rootDir) {
      return invoke('lang_scan_mods', { rootDir });
    }
  };
})();
