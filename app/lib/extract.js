function detectPlaceholders(s) {
    const patterns = [/\{\w[^}]*\}/g, /\$\{\w[^}]*\}/g, /%[sd]/g, /<[^>]+>/g];
    const set = new Set();
    for (const p of patterns)
        (s.match(p) || []).forEach(x => set.add(x));
    return Array.from(set);
}
function traverse(obj, path, visit) {
    if (Array.isArray(obj)) {
        obj.forEach((v, i) => traverse(v, [...path, String(i)], visit));
        return;
    }
    if (obj && typeof obj === 'object') {
        for (const k of Object.keys(obj)) {
            visit(k, obj[k], [...path, k]);
            traverse(obj[k], [...path, k], visit);
        }
    }
}
export function extractFromJson(content, filePath, rule) {
    const root = JSON.parse(content);
    const segs = [];
    const includeKeyRe = rule.includeKeyRegex ? new RegExp(rule.includeKeyRegex) : null;
    const excludeKeyRe = rule.excludeKeyRegex ? new RegExp(rule.excludeKeyRegex) : null;
    const includePathRe = rule.includePathRegex ? new RegExp(rule.includePathRegex) : null;
    const excludePathRe = rule.excludePathRegex ? new RegExp(rule.excludePathRegex) : null;
    const nameFields = new Set(['str', 'str_sp', 'str_pl']);
    function shouldIncludeKey(k) {
        if (rule.excludeKeys && rule.excludeKeys.includes(k))
            return false;
        if (excludeKeyRe && excludeKeyRe.test(k))
            return false;
        const hasInclude = (rule.includeKeys && rule.includeKeys.length > 0) || includeKeyRe;
        if (!hasInclude)
            return true;
        if (rule.includeKeys && rule.includeKeys.includes(k))
            return true;
        if (includeKeyRe && includeKeyRe.test(k))
            return true;
        return false;
    }
    function shouldIncludePath(path) {
        const pathStr = path.join('.');
        if (excludePathRe && excludePathRe.test(pathStr))
            return false;
        if (includePathRe)
            return includePathRe.test(pathStr);
        return true;
    }
    function pushSegment(path, value) {
        if (rule.skipEmpty && value.trim() === '')
            return;
        if (!shouldIncludePath(path))
            return;
        segs.push({
            id: `${filePath}:${path.join('.')}`,
            file: filePath,
            path,
            source: value,
            placeholders: detectPlaceholders(value)
        });
    }
    traverse(root, [], (k, v, p) => {
        if (!shouldIncludeKey(k))
            return;
        if (typeof v === 'string') {
            pushSegment(p, v);
        }
        else if (Array.isArray(v)) {
            v.forEach((item, idx) => {
                if (typeof item === 'string') {
                    pushSegment([...p, String(idx)], item);
                }
                else if (item && typeof item === 'object') {
                    for (const nk of Object.keys(item)) {
                        if (!nameFields.has(nk))
                            continue;
                        const nv = item[nk];
                        if (typeof nv === 'string')
                            pushSegment([...p, String(idx), nk], nv);
                    }
                }
            });
        }
        else if (v && typeof v === 'object') {
            for (const nk of Object.keys(v)) {
                if (!nameFields.has(nk))
                    continue;
                const nv = v[nk];
                if (typeof nv === 'string')
                    pushSegment([...p, nk], nv);
            }
        }
    });
    return segs;
}
export function extractFromText(content, filePath, rule) {
    const segs = [];
    const regex = rule.regex ? new RegExp(rule.regex, 'g') : /[^\r\n]+/g;
    const matches = content.match(regex) || [];
    matches.forEach((m, i) => {
        if (rule.skipEmpty && m.trim() === '')
            return;
        segs.push({
            id: `${filePath}:content.${i}`,
            file: filePath,
            path: ['content', String(i)],
            source: m,
            placeholders: detectPlaceholders(m)
        });
    });
    return segs;
}
export function detectPlaceholdersPublic(s) {
    return detectPlaceholders(s);
}
