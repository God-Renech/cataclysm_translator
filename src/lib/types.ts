export type Rule = {
  format: 'json' | 'text';
  includeKeys?: string[];
  excludeKeys?: string[];
  includeKeyRegex?: string;
  excludeKeyRegex?: string;
  includePathRegex?: string;
  excludePathRegex?: string;
  skipEmpty?: boolean;
  regex?: string;
};

export type Segment = {
  id: string;
  file: string;
  path: string[];
  source: string;
  placeholders: string[];
};

export type TranslationResult = {
  id: string;
  target: string;
  valid: boolean;
};

export type ScanError = {
  file: string;
  message: string;
};

export type ScanResult = {
  segments: Segment[];
  errors: ScanError[];
};

export type ApiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userPromptPrefix: string;
  provider: 'openai_compatible' | 'gemini' | 'deepseek' | 'siliconflow' | 'mimo' | 'custom';
  timeoutMs?: number;
};
