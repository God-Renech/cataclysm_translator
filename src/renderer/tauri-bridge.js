(() => {
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') return;
  const invoke = tauri.core.invoke;
  const openDialog = tauri.dialog && typeof tauri.dialog.open === 'function' ? tauri.dialog.open : null;

  const ipcRenderer = {
    invoke(channel, ...args) {
      if (channel === 'select-folder') {
        if (openDialog) {
          return openDialog({ directory: true, multiple: false }).then((picked) => {
            if (Array.isArray(picked)) return picked[0] ?? null;
            return picked ?? null;
          });
        }
        return invoke('select_folder');
      }
      if (channel === 'scan-segments') return invoke('scan_segments', { dir: args[0], rule: args[1] });
      if (channel === 'translate-batch') return invoke('translate_batch', { segments: args[0], config: args[1] });
      if (channel === 'export') return invoke('export_files', { dir: args[0], translations: args[1], outDir: args[2], rule: args[3] });
      if (channel === 'load-user-config') return invoke('load_user_config');
      if (channel === 'save-user-config') return invoke('save_user_config', { content: args[0] });
      if (channel === 'get-user-config-path') return invoke('get_user_config_path');
      if (channel === 'save-preset-json') return invoke('save_preset_json', { dir: args[0], fileName: args[1], content: args[2] });
      if (channel === 'lang-generate-pot') return invoke('lang_generate_pot', { config: args[0] });
      if (channel === 'lang-generate-po') return invoke('lang_generate_po', { config: args[0] });
      if (channel === 'lang-regenerate-po') return invoke('lang_regenerate_po', { config: args[0] });
      if (channel === 'lang-read-po') return invoke('lang_read_po', { config: args[0] });
      if (channel === 'lang-write-po') return invoke('lang_write_po', { config: args[0], content: args[1] });
      if (channel === 'lang-extract-po-segments') return invoke('lang_extract_po_segments', { config: args[0] });
      if (channel === 'lang-apply-po-translations') return invoke('lang_apply_po_translations', { config: args[0], translations: args[1] });
      if (channel === 'lang-compile-mo') return invoke('lang_compile_mo', { config: args[0] });
      if (channel === 'lang-cleanup-po-plural') return invoke('lang_cleanup_po_plural', { config: args[0] });
      if (channel === 'lang-bridge-inline-to-lang') return invoke('lang_bridge_inline_to_lang', { config: args[0], translatedModDir: args[1], options: args[2] });
      if (channel === 'lang-bridge-po-to-code') return invoke('lang_bridge_po_to_code', {
        config: args[0],
        sourceLanguageCode: args[1],
        targetLanguageCode: args[2],
        outputDir: args[3]
      });
      if (channel === 'lang-suggest-domain') return invoke('lang_suggest_domain', { modDir: args[0] });
      if (channel === 'lang-scan-mods') return invoke('lang_scan_mods', { rootDir: args[0] });
      throw new Error(`Unsupported IPC channel: ${channel}`);
    },
    on() {
      return () => {};
    }
  };

  window.require = (name) => {
    if (name === 'electron') return { ipcRenderer };
    return null;
  };
})();
