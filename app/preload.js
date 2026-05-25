import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('translator', {
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    scanSegments: (dir, rule) => ipcRenderer.invoke('scan-segments', dir, rule),
    translateBatch: (segments, config) => ipcRenderer.invoke('translate-batch', segments, config),
    export: (dir, translations, outDir, rule) => ipcRenderer.invoke('export', dir, translations, outDir, rule)
});
