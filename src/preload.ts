import { contextBridge, ipcRenderer } from 'electron';
import { Rule, Segment, ApiConfig } from './lib/types.js';

contextBridge.exposeInMainWorld('translator', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanSegments: (dir: string, rule: Rule) => ipcRenderer.invoke('scan-segments', dir, rule),
  translateBatch: (segments: Segment[], config: ApiConfig) => ipcRenderer.invoke('translate-batch', segments, config),
  export: (dir: string, translations: { id: string; target: string }[], outDir: string, rule: Rule) =>
    ipcRenderer.invoke('export', dir, translations, outDir, rule)
});
