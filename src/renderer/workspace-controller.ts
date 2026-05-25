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

export type WorkspaceControllerState = {
  workspaceRowsCache: WorkspaceSegment[];
  workspaceVirtualSpacer: HTMLDivElement | null;
  workspaceVirtualContent: HTMLDivElement | null;
  workspaceVirtualRenderFrame: number | null;
  workspaceRefreshTimer: ReturnType<typeof setTimeout> | null;
  workspacePendingResetScroll: boolean;
  visibleTargetTextareaMap: Map<string, HTMLTextAreaElement>;
  segmentById: Map<string, WorkspaceSegment>;
  sourceToSegmentIds: Map<string, string[]>;
  contextToSegmentIds: Map<string, string[]>;
};

export function createWorkspaceControllerState(): WorkspaceControllerState {
  return {
    workspaceRowsCache: [],
    workspaceVirtualSpacer: null,
    workspaceVirtualContent: null,
    workspaceVirtualRenderFrame: null,
    workspaceRefreshTimer: null,
    workspacePendingResetScroll: false,
    visibleTargetTextareaMap: new Map(),
    segmentById: new Map(),
    sourceToSegmentIds: new Map(),
    contextToSegmentIds: new Map(),
  };
}

export function buildWorkspaceStats(
  visibleRows: WorkspaceSegment[],
  totalCount: number,
  selectedIds: Set<string>,
  translationMap: Map<string, WorkspaceTranslation>
) {
  const selectedVisible = visibleRows.filter((segment) => selectedIds.has(segment.id)).length;
  const emptyVisible = visibleRows.filter((segment) => !(translationMap.get(segment.id)?.target || "").trim()).length;
  return {
    total: totalCount,
    visible: visibleRows.length,
    selectedVisible,
    emptyVisible,
  };
}

export function planSyncedSourceUpdates(options: {
  baseId: string;
  sourceText: string;
  value: string;
  visibleRows: WorkspaceSegment[];
  scope: string;
  sourceToSegmentIds: Map<string, string[]>;
  segmentById: Map<string, WorkspaceSegment>;
  resolveContextKey: (segment: WorkspaceSegment) => string;
}) {
  const normalized = normalizeSourceKey(options.sourceText);
  if (!normalized) return [];

  const visibleIdSet = new Set(options.visibleRows.map((row) => row.id));
  const baseSegment = options.segmentById.get(options.baseId);
  const baseContext = baseSegment ? options.resolveContextKey(baseSegment) : "";
  const syncedIds: string[] = [];
  const candidateIds = options.sourceToSegmentIds.get(normalized) || [];

  candidateIds.forEach((candidateId) => {
    const segment = options.segmentById.get(candidateId);
    if (!segment) return;
    if (options.scope === "visible" && !visibleIdSet.has(segment.id)) return;
    if (options.scope === "context" && options.resolveContextKey(segment) !== baseContext) return;
    syncedIds.push(segment.id);
  });

  return syncedIds;
}
