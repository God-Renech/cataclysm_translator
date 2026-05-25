export type PoTab = {
  key: string;
  modPath: string;
  language: string;
  name: string;
  content: string;
  dirty: boolean;
};

export function makeContextKey(modPath: string, language: string) {
  return `${modPath}@@${language}`;
}

export function persistActivePoTabContent(
  tabs: PoTab[],
  activeKey: string,
  content: string
) {
  if (!activeKey) return tabs;
  return tabs.map((tab) => (
    tab.key === activeKey
      ? { ...tab, content, dirty: true }
      : tab
  ));
}

export function resolvePoTabForLanguage(
  tabs: PoTab[],
  activeKey: string,
  language: string
) {
  if (!language) {
    return { activeKey: "", activeTab: undefined as PoTab | undefined };
  }

  const activeTab = tabs.find((tab) => tab.key === activeKey);
  if (activeTab && activeTab.language === language) {
    return { activeKey, activeTab };
  }

  const sameModTarget = activeTab?.modPath
    ? tabs.find((tab) => tab.modPath === activeTab.modPath && tab.language === language)
    : undefined;
  const target = sameModTarget || tabs.find((tab) => tab.language === language);
  if (!target) {
    return { activeKey: "", activeTab: undefined as PoTab | undefined };
  }
  return { activeKey: target.key, activeTab: target };
}

export function switchPoTabState(tabs: PoTab[], key: string) {
  const activeTab = tabs.find((tab) => tab.key === key);
  return { activeKey: key, activeTab };
}

export function closePoTabState(
  tabs: PoTab[],
  activeKey: string,
  key: string,
  currentLanguage: string
) {
  const nextTabs = tabs.filter((tab) => tab.key !== key);
  if (activeKey !== key) {
    return {
      tabs: nextTabs,
      activeKey,
      activeTab: nextTabs.find((tab) => tab.key === activeKey),
    };
  }

  const sameLanguageTab = nextTabs.find((tab) => tab.language === currentLanguage);
  if (sameLanguageTab) {
    return {
      tabs: nextTabs,
      activeKey: sameLanguageTab.key,
      activeTab: sameLanguageTab,
    };
  }

  return {
    tabs: nextTabs,
    activeKey: "",
    activeTab: undefined as PoTab | undefined,
  };
}

export function upsertPoTabState(
  tabs: PoTab[],
  activeKey: string,
  modPath: string,
  language: string,
  name: string,
  content: string,
  dirty = false
) {
  const key = makeContextKey(modPath, language);
  const existingIndex = tabs.findIndex((tab) => tab.key === key);
  const nextTab: PoTab = {
    key,
    modPath,
    language,
    name: name || modPath,
    content,
    dirty,
  };

  const nextTabs = tabs.slice();
  if (existingIndex >= 0) {
    nextTabs[existingIndex] = {
      ...nextTabs[existingIndex],
      content,
      name: name || nextTabs[existingIndex].name,
      language: language || nextTabs[existingIndex].language,
      dirty,
    };
  } else {
    nextTabs.push(nextTab);
  }

  const nextActiveKey = activeKey || key;
  const activeTab = nextTabs.find((tab) => tab.key === nextActiveKey);
  return {
    tabs: nextTabs,
    activeKey: nextActiveKey,
    activeTab,
    affectedKey: key,
  };
}
