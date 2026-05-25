export type RulePresetData = {
  includeKeys: string;
  excludeKeys: string;
  includeKeyRegex: string;
  excludeKeyRegex: string;
  includePathRegex: string;
  excludePathRegex: string;
  skipEmpty: boolean;
  regex: string;
};

export const DEFAULT_RULE_PRESETS: Record<string, RulePresetData> = {
  cdda: {
    includeKeys: 'name,description,text,message,snippet,prompt,title,note,effect_str,tooltip,info,sound,line,dialogue,success,failure,true,false',
    excludeKeys: 'id,type,copy-from,flags,material,category,skill,qualities,obsolete,debug',
    includeKeyRegex: '',
    excludeKeyRegex: '',
    includePathRegex: '',
    excludePathRegex: '',
    skipEmpty: true,
    regex: ''
  },
  cbn: {
    includeKeys: 'name,description,text,message,snippet,prompt,title,note,effect_str,tooltip,info,sound,line,dialogue,success,failure,true,false',
    excludeKeys: 'id,type,copy-from,flags,material,category,skill,qualities,obsolete,debug',
    includeKeyRegex: '',
    excludeKeyRegex: '',
    includePathRegex: '',
    excludePathRegex: '',
    skipEmpty: true,
    regex: ''
  }
};

export const BUILTIN_PRESET_NAMES = new Set(Object.keys(DEFAULT_RULE_PRESETS));

export function createDefaultRulePresets(): Record<string, RulePresetData> {
  return { ...DEFAULT_RULE_PRESETS };
}

export function parseRulePresets(raw: string | null | undefined): Record<string, RulePresetData> {
  if (!raw) return createDefaultRulePresets();
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_RULE_PRESETS, ...parsed };
  } catch {
    return createDefaultRulePresets();
  }
}
