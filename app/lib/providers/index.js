import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
export * from './base.js';
export * from './openai.js';
export * from './gemini.js';
export function createProvider(config) {
    if (config.provider === 'gemini') {
        return new GeminiProvider();
    }
    else {
        // deepseek, siliconflow, mimo, openai_compatible, custom all use OpenAI interface
        return new OpenAIProvider();
    }
}
