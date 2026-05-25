export function parseTranslationResponse(content, originalSegments) {
    let jsonStr = content.trim();
    // Remove markdown code blocks
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
    const match = jsonStr.match(codeBlockRegex);
    if (match) {
        jsonStr = match[1];
    }
    // Find array brackets
    const jsonStart = jsonStr.indexOf('[');
    const jsonEnd = jsonStr.lastIndexOf(']');
    if (jsonStart !== -1 && jsonEnd !== -1) {
        jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);
    }
    try {
        const parsed = JSON.parse(jsonStr);
        let items = parsed;
        // Handle cases where LLM wraps array in an object key like "translations"
        if (!Array.isArray(parsed) && typeof parsed === 'object') {
            const values = Object.values(parsed);
            const foundArray = values.find(v => Array.isArray(v));
            if (foundArray)
                items = foundArray;
        }
        if (!Array.isArray(items))
            throw new Error('Response is not an array');
        const map = new Map();
        items.forEach((item) => {
            // Allow 'target' or common variants
            const target = item.target || item.translation || item.translated || item.text;
            if (item.id && typeof target === 'string') {
                map.set(item.id, target);
            }
        });
        return originalSegments.map(seg => ({
            id: seg.id,
            target: map.get(seg.id) || '',
            valid: map.has(seg.id)
        }));
    }
    catch (e) {
        console.error('Failed to parse LLM response:', content);
        throw new Error(`Failed to parse JSON response: ${e.message}`);
    }
}
