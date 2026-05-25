import { Segment, TranslationResult, ApiConfig } from '../types.js';

export interface LLMProvider {
  translateBatch(segments: Segment[], config: ApiConfig): Promise<TranslationResult[]>;
}
