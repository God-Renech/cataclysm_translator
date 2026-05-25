import { readdirSync, statSync, readFileSync } from 'fs';
import { join, extname } from 'path';

export function scanFiles(dir: string): { path: string; content: string; kind: 'json' | 'text' }[] {
  const result: { path: string; content: string; kind: 'json' | 'text' }[] = [];
  function walk(d: string) {
    const entries = readdirSync(d);
    for (const e of entries) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        const ext = extname(e).toLowerCase();
        if (ext === '.json' || ext === '.txt' || ext === '.cfg' || ext === '.ini' || ext === '.lang' || ext === '.yml' || ext === '.yaml') {
          const content = readFileSync(p, 'utf-8');
          const kind = ext === '.json' ? 'json' : 'text';
          result.push({ path: p, content, kind });
        }
      }
    }
  }
  walk(dir);
  return result;
}
