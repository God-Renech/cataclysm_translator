import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkspaceIndexes,
  filterWorkspaceSegments,
  formatWorkspaceStatsText,
  invertWorkspaceSelection,
  selectAllWorkspaceSegments,
  selectEmptyWorkspaceSegments,
} from "../tmp_workspace_data/workspace-data.js";

test("buildWorkspaceIndexes groups source and context ids", () => {
  const segments = [
    { id: "a", file: "f1", path: [], source: "hello", placeholders: [] },
    { id: "b", file: "f1", path: [], source: "hello", placeholders: [] },
    { id: "c", file: "f2", path: [], source: "world", placeholders: [] },
  ];

  const indexes = buildWorkspaceIndexes(segments, (segment) => segment.file);
  assert.deepEqual(indexes.sourceToSegmentIds.get("hello"), ["a", "b"]);
  assert.deepEqual(indexes.contextToSegmentIds.get("f1"), ["a", "b"]);
  assert.equal(indexes.segmentById.get("c")?.source, "world");
});

test("filterWorkspaceSegments respects selected, empty and search filters", () => {
  const segments = [
    { id: "a", file: "f1", path: [], source: "hello alpha", placeholders: [] },
    { id: "b", file: "f1", path: [], source: "world beta", placeholders: [] },
  ];
  const translationMap = new Map([
    ["a", { id: "a", target: "bonjour", valid: true }],
    ["b", { id: "b", target: "", valid: false }],
  ]);

  assert.deepEqual(
    filterWorkspaceSegments({
      segments,
      selectedIds: new Set(["a"]),
      showSelectedOnly: true,
      showEmptyOnly: false,
      searchText: "",
      translationMap,
    }).map((segment) => segment.id),
    ["a"]
  );

  assert.deepEqual(
    filterWorkspaceSegments({
      segments,
      selectedIds: new Set(),
      showSelectedOnly: false,
      showEmptyOnly: true,
      searchText: "",
      translationMap,
    }).map((segment) => segment.id),
    ["b"]
  );

  assert.deepEqual(
    filterWorkspaceSegments({
      segments,
      selectedIds: new Set(),
      showSelectedOnly: false,
      showEmptyOnly: false,
      searchText: "bonjour",
      translationMap,
    }).map((segment) => segment.id),
    ["a"]
  );
});

test("formatWorkspaceStatsText returns localized summary", () => {
  assert.equal(
    formatWorkspaceStatsText("en", 10, 5, 3, 2),
    "Total 10 · Visible 5 · Selected 3 · Empty 2"
  );
  assert.equal(
    formatWorkspaceStatsText("zh-CN", 10, 5, 3, 2),
    "总计 10 · 可见 5 · 已勾选 3 · 空译文 2"
  );
  assert.equal(
    formatWorkspaceStatsText("zh-TW", 10, 5, 3, 2),
    "總計 10 · 可見 5 · 已勾選 3 · 空譯文 2"
  );
});

test("workspace selection helpers update selected ids predictably", () => {
  const visibleIds = ["a", "b", "c"];
  const selected = new Set(["b", "x"]);

  const allSelected = selectAllWorkspaceSegments(selected, visibleIds);
  assert.deepEqual([...allSelected].sort(), ["a", "b", "c", "x"]);

  const inverted = invertWorkspaceSelection(selected, visibleIds);
  assert.deepEqual([...inverted].sort(), ["a", "c", "x"]);

  const emptySelected = selectEmptyWorkspaceSegments(
    new Set(),
    [
      { id: "a", file: "f", path: [], source: "one", placeholders: [] },
      { id: "b", file: "f", path: [], source: "two", placeholders: [] },
    ],
    new Map([
      ["a", { id: "a", target: "done", valid: true }],
      ["b", { id: "b", target: "", valid: false }],
    ])
  );
  assert.deepEqual([...emptySelected], ["b"]);
});
