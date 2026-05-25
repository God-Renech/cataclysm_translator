export function writeBackJson(content, translations, filePath) {
    const root = JSON.parse(content);
    function apply(obj, path) {
        if (Array.isArray(obj)) {
            obj.forEach((v, i) => apply(v, [...path, String(i)]));
            return;
        }
        if (obj && typeof obj === 'object') {
            for (const k of Object.keys(obj)) {
                const p2 = [...path, k];
                const id = `${filePath}:${p2.join('.')}`;
                if (typeof obj[k] === 'string' && translations.has(id))
                    obj[k] = translations.get(id);
                else
                    apply(obj[k], p2);
            }
        }
    }
    apply(root, []);
    return JSON.stringify(root, null, 2);
}
export function writeBackText(content, translations, filePath, regexSource) {
    const regex = regexSource ? new RegExp(regexSource, 'g') : /[^\r\n]+/g;
    let out = '';
    let lastIndex = 0;
    let i = 0;
    for (const m of content.matchAll(regex)) {
        if (m.index === undefined)
            continue;
        const start = m.index;
        const end = start + m[0].length;
        out += content.slice(lastIndex, start);
        const id = `${filePath}:content.${i}`;
        out += translations.get(id) ?? m[0];
        lastIndex = end;
        i += 1;
    }
    out += content.slice(lastIndex);
    return out;
}
