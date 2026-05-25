import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join, dirname, relative } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { scanFiles } from './lib/scan.js';
import { extractFromJson, extractFromText } from './lib/extract.js';
import { writeBackJson, writeBackText } from './lib/writeback.js';
import { createProvider } from './lib/providers/index.js';
let win = null;
function createWindow() {
    win = new BrowserWindow({
        width: 1100,
        height: 800,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true
        }
    });
    const htmlPath = join(app.getAppPath(), 'app', 'renderer', 'index.html');
    win.loadFile(htmlPath);
}
app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        app.quit();
});
ipcMain.handle('select-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (r.canceled || r.filePaths.length === 0)
        return null;
    return r.filePaths[0];
});
ipcMain.handle('scan-segments', async (_e, dir, rule) => {
    const files = scanFiles(dir);
    const segs = [];
    const errors = [];
    for (const f of files) {
        try {
            if (f.kind === 'json')
                segs.push(...extractFromJson(f.content, f.path, rule));
            else
                segs.push(...extractFromText(f.content, f.path, rule));
        }
        catch (e) {
            errors.push({ file: f.path, message: e?.message || String(e) });
        }
    }
    const result = { segments: segs, errors };
    return result;
});
ipcMain.handle('translate-batch', async (_e, segments, config) => {
    const provider = createProvider(config);
    return await provider.translateBatch(segments, config);
});
ipcMain.handle('export', async (_e, dir, translations, outDir, rule) => {
    const files = scanFiles(dir);
    const map = new Map();
    translations.forEach(t => map.set(t.id, t.target));
    mkdirSync(outDir, { recursive: true });
    for (const f of files) {
        const rel = relative(dir, f.path);
        const outPath = join(outDir, rel);
        const outDirPath = dirname(outPath);
        mkdirSync(outDirPath, { recursive: true });
        if (f.kind === 'json') {
            const out = writeBackJson(f.content, map, f.path);
            writeFileSync(outPath, out, 'utf-8');
        }
        else {
            const out = writeBackText(f.content, map, f.path, rule.regex);
            writeFileSync(outPath, out, 'utf-8');
        }
    }
    return true;
});
