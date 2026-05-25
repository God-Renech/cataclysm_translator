import { fetch } from 'undici';
import { parseTranslationResponse } from './utils.js';
export class GeminiProvider {
    async translateBatch(segments, config) {
        const payload = segments.map(s => ({ id: s.id, source: s.source }));
        const systemPrompt = config.systemPrompt || 'You are a professional translator.';
        const userPromptPrefix = config.userPromptPrefix || 'Translate the following JSON array. Return ONLY a valid JSON array with the same structure, but with "source" replaced by "target". Maintain "id" unchanged.';
        const base = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
        const model = config.model || 'gemini-1.5-flash';
        const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
        const body = {
            contents: [
                {
                    role: 'user',
                    parts: [{ text: `${systemPrompt}\n${userPromptPrefix}\n${JSON.stringify(payload)}` }]
                }
            ],
            generationConfig: {
                response_mime_type: 'application/json'
            }
        };
        const controller = new AbortController();
        const timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : 120000;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timeout);
            const rawText = await res.text();
            if (!res.ok)
                throw new Error(`Gemini HTTP ${res.status} ${rawText}`);
            const data = JSON.parse(rawText);
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return parseTranslationResponse(content, segments);
        }
        catch (e) {
            clearTimeout(timeout);
            throw e;
        }
    }
}
