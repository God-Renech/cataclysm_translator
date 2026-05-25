import { copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const src = join(process.cwd(), 'src', 'renderer', 'index.html');
const bridgeSrc = join(process.cwd(), 'src', 'renderer', 'tauri-bridge.js');
const openccSrc = join(process.cwd(), 'node_modules', 'opencc-js', 'dist', 'umd', 'full.js');
const outDir = join(process.cwd(), 'app', 'renderer');
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, 'index.html'));
copyFileSync(bridgeSrc, join(outDir, 'tauri-bridge.js'));
copyFileSync(openccSrc, join(outDir, 'opencc-full.js'));
