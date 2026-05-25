import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkspaceStats,
  createWorkspaceControllerState,
  planSyncedSourceUpdates,
} from "../app/renderer/workspace-controller.js";

test("buildWorkspaceStats counts visible, selected and empty rows", () => {
  const rows = [
    { id: "a", file: "f1", path: [], source: "one", placeholders: [] },
    { id: "b", file: "f1", path: [], source: "two", placeholders: [] },
  ];
  const selectedIds = new Set(["a"]);
  const translationMap = new Map([
    ["a", { id: "a", target: "done", valid: true }],
    ["b", { id: "b", target: "", valid: false }],
  ]);

  const stats = buildWorkspaceStats(rows, 5, selectedIds, translationMap);

  assert.deepEqual(stats, {
    total: 5,
    visible: 2,
    selectedVisible: 1,
    emptyVisible: 1,
  });
});

test("planSyncedSourceUpdates limits updates by context scope", () => {
  const sourceToSegmentIds = new Map([["Hello", ["a", "b", "c"]]]);
  const segmentById = new Map([
    ["a", { id: "a", file: "f1", path: [], source: "Hello", placeholders: [] }],
    ["b", { id: "b", file: "f2", path: [], source: "Hello", placeholders: [] }],
    ["c", { id: "c", file: "f3", path: [], source: "Hello", placeholders: [] }],
  ]);

  const updates = planSyncedSourceUpdates({
    baseId: "a",
    sourceText: "Hello",
    value: "你好",
    visibleRows: [
      { id: "a", file: "f1", path: [], source: "Hello", placeholders: [] },
      { id: "b", file: "f2", path: [], source: "Hello", placeholders: [] },
      { id: "c", file: "f3", path: [], source: "Hello", placeholders: [] },
    ],
    scope: "context",
    sourceToSegmentIds,
    segmentById,
    resolveContextKey: (segment) => (segment.id === "c" ? "ctx-2" : "ctx-1"),
  });

  assert.deepEqual(updates, ["a", "b"]);
});

test("createWorkspaceControllerState initializes empty mutable state", () => {
  const state = createWorkspaceControllerState();

  assert.equal(state.workspaceRowsCache.length, 0);
  assert.equal(state.workspaceVirtualSpacer, null);
  assert.equal(state.workspaceVirtualContent, null);
  assert.equal(state.workspaceVirtualRenderFrame, null);
  assert.equal(state.workspaceRefreshTimer, null);
  assert.equal(state.workspacePendingResetScroll, false);
  assert.equal(state.visibleTargetTextareaMap.size, 0);
  assert.equal(state.segmentById.size, 0);
  assert.equal(state.sourceToSegmentIds.size, 0);
  assert.equal(state.contextToSegmentIds.size, 0);
});
