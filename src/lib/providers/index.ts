import { LLMProvider } from './base.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { ApiConfig } from '../types.js';

export * from './base.js';
export * from './openai.js';
export * from './gemini.js';

export function createProvider(config: ApiConfig): LLMProvider {
  if (config.provider === 'gemini') {
    return new GeminiProvider();
  } else {
    // deepseek, siliconflow, mimo, openai_compatible, custom all use OpenAI interface
    return new OpenAIProvider();
  }
}
