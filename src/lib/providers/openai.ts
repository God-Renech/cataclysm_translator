import { LLMProvider } from './base.js';
import { ApiConfig, Segment, TranslationResult } from '../types.js';
import { fetch } from 'undici';
import { parseTranslationResponse } from './utils.js';

export class OpenAIProvider implements LLMProvider {
  async translateBatch(segments: Segment[], config: ApiConfig): Promise<TranslationResult[]> {
    const payload = segments.map(s => ({ id: s.id, source: s.source }));
    const systemPrompt = config.systemPrompt || 'You are a professional translator.';
    const userPromptPrefix = config.userPromptPrefix || 'Translate the following JSON array. Return ONLY a valid JSON array with the same structure, but with "source" replaced by "target". Maintain "id" unchanged.';

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${userPromptPrefix}\n\n${JSON.stringify(payload)}` }
    ];

    const base = this.getBaseUrl(config);
    const url = `${base}/chat/completions`;
    const model = this.getModel(config);

    const body: any = {
      model,
      messages,
      temperature: 0.1,
      stream: false
    };

    if (config.provider === 'mimo') {
      body.thinking = { type: 'disabled' };
    }

    // Try to enforce JSON mode for supported models
    if (model.includes('gpt-4') || model.includes('gpt-3.5') || model.includes('json')) {
       // Check if prompt contains "json" (it does)
       // Some providers support response_format: { type: "json_object" } but that requires returning an object { ... }
       // Since we want an array, we rely on prompt engineering or use { type: "json_object" } and prompt "return { translations: [...] }"
       // For simplicity and compatibility across many providers (DeepSeek, etc.), let's stick to prompt engineering + parsing for now.
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API Error ${response.status}: ${text}`);
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    return parseTranslationResponse(content, segments);
  }

  private getBaseUrl(config: ApiConfig): string {
    let base = config.baseUrl;
    if (!base) {
       if (config.provider === 'deepseek') base = 'https://api.deepseek.com';
       else if (config.provider === 'siliconflow') base = 'https://api.siliconflow.cn/v1';
       else if (config.provider === 'mimo') base = 'https://api.xiaomimimo.com';
       else base = 'https://api.openai.com';
    }
    // Remove trailing slash
    base = base.replace(/\/$/, '');
    if (!base.endsWith('/v1')) base = `${base}/v1`;
    return base;
  }

  private getModel(config: ApiConfig): string {
    if (config.model) return config.model;
    if (config.provider === 'deepseek') return 'deepseek-chat';
    if (config.provider === 'siliconflow') return 'deepseek-ai/DeepSeek-V3';
    if (config.provider === 'mimo') return 'mimo-v2-flash';
    return 'gpt-4o-mini';
  }
}
