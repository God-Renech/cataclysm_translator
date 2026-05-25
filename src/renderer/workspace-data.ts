import { normalizeSourceKey } from "./virtual-workspace.js";

export type WorkspaceSegment = {
  id: string;
  file: string;
  path: string[];
  source: string;
  placeholders: string[];
};

export type WorkspaceTranslation = {
  id: string;
  target: string;
  valid: boolean;
};

export type WorkspaceIndexes = {
  segmentById: Map<string, WorkspaceSegment>;
  sourceToSegmentIds: Map<string, string[]>;
  contextToSegmentIds: Map<string, string[]>;
};

export function buildWorkspaceIndexes(
  segments: WorkspaceSegment[],
  resolveContextKey: (segment: WorkspaceSegment) => string
): WorkspaceIndexes {
  const segmentById = new Map<string, WorkspaceSegment>();
  const sourceToSegmentIds = new Map<string, string[]>();
  const contextToSegmentIds = new Map<string, string[]>();

  segments.forEach((segment) => {
    segmentById.set(segment.id, segment);

    const sourceKey = normalizeSourceKey(segment.source);
    if (sourceKey) {
      const sourceIds = sourceToSegmentIds.get(sourceKey);
      if (sourceIds) sourceIds.push(segment.id);
      else sourceToSegmentIds.set(sourceKey, [segment.id]);
    }

    const contextKey = resolveContextKey(segment);
    const contextIds = contextToSegmentIds.get(contextKey);
    if (contextIds) contextIds.push(segment.id);
    else contextToSegmentIds.set(contextKey, [segment.id]);
  });

  return { segmentById, sourceToSegmentIds, contextToSegmentIds };
}

export function filterWorkspaceSegments(options: {
  segments: WorkspaceSegment[];
  selectedIds: Set<string>;
  showSelectedOnly: boolean;
  showEmptyOnly: boolean;
  searchText: string;
  translationMap: Map<string, WorkspaceTranslation>;
}) {
  const keyword = options.searchText.trim().toLowerCase();
  return options.segments.filter((segment) => {
    if (options.showSelectedOnly && !options.selectedIds.has(segment.id)) return false;
    if (options.showEmptyOnly && (options.translationMap.get(segment.id)?.target || "").trim()) return false;
    if (!keyword) return true;
    const translation = options.translationMap.get(segment.id);
    const sourceMatch = segment.source.toLowerCase().includes(keyword);
    const targetMatch = (translation?.target || "").toLowerCase().includes(keyword);
    return sourceMatch || targetMatch;
  });
}

export function formatWorkspaceStatsText(
  uiLang: "zh-CN" | "en" | "zh-TW" | "ko" | "ja" | "ru",
  total: number,
  visible: number,
  selectedVisible: number,
  emptyVisible: number
) {
  if (uiLang === "ko") {
    return `전체 ${total} · 표시 ${visible} · 선택 ${selectedVisible} · 빈 번역 ${emptyVisible}`;
  }
  if (uiLang === "ja") {
    return `合計 ${total} · 表示 ${visible} · 選択 ${selectedVisible} · 未翻訳 ${emptyVisible}`;
  }
  if (uiLang === "ru") {
    return `Всего ${total} · Видимо ${visible} · Выбрано ${selectedVisible} · Пусто ${emptyVisible}`;
  }
  if (uiLang === "en") {
    return `Total ${total} · Visible ${visible} · Selected ${selectedVisible} · Empty ${emptyVisible}`;
  }
  if (uiLang === "zh-TW") {
    return `總計 ${total} · 可見 ${visible} · 已勾選 ${selectedVisible} · 空譯文 ${emptyVisible}`;
  }
  return `总计 ${total} · 可见 ${visible} · 已勾选 ${selectedVisible} · 空译文 ${emptyVisible}`;
}

export function selectAllWorkspaceSegments(selectedIds: Set<string>, visibleIds: string[]) {
  const next = new Set(selectedIds);
  visibleIds.forEach((id) => next.add(id));
  return next;
}

export function invertWorkspaceSelection(selectedIds: Set<string>, visibleIds: string[]) {
  const next = new Set(selectedIds);
  visibleIds.forEach((id) => {
    if (next.has(id)) next.delete(id);
    else next.add(id);
  });
  return next;
}

export function selectEmptyWorkspaceSegments(
  selectedIds: Set<string>,
  visibleSegments: WorkspaceSegment[],
  translationMap: Map<string, WorkspaceTranslation>
) {
  const next = new Set(selectedIds);
  visibleSegments.forEach((segment) => {
    const translation = translationMap.get(segment.id);
    if (!(translation?.target || "").trim()) {
      next.add(segment.id);
    }
  });
  return next;
}
