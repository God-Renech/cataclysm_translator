import test from "node:test";
import assert from "node:assert/strict";

import {
  closePoTabState,
  makeContextKey,
  persistActivePoTabContent,
  resolvePoTabForLanguage,
  switchPoTabState,
  upsertPoTabState,
} from "../app/renderer/po-tabs.js";

test("makeContextKey combines mod path and language", () => {
  assert.equal(makeContextKey("E:\\mods\\demo", "zh_CN"), "E:\\mods\\demo@@zh_CN");
});

test("persistActivePoTabContent marks only the active tab dirty", () => {
  const tabs = [
    { key: "a", modPath: "m1", language: "zh_CN", name: "A", content: "old", dirty: false },
    { key: "b", modPath: "m2", language: "en", name: "B", content: "keep", dirty: false },
  ];

  const next = persistActivePoTabContent(tabs, "a", "new");

  assert.equal(next[0].content, "new");
  assert.equal(next[0].dirty, true);
  assert.equal(next[1].content, "keep");
  assert.equal(next[1].dirty, false);
});

test("resolvePoTabForLanguage prefers same mod path before language fallback", () => {
  const tabs = [
    { key: "a", modPath: "mod-1", language: "zh_CN", name: "A", content: "one", dirty: false },
    { key: "b", modPath: "mod-1", language: "ja", name: "B", content: "two", dirty: false },
    { key: "c", modPath: "mod-2", language: "ja", name: "C", content: "three", dirty: false },
  ];

  const resolved = resolvePoTabForLanguage(tabs, "a", "ja");

  assert.equal(resolved.activeKey, "b");
  assert.equal(resolved.activeTab?.content, "two");
});

test("switchPoTabState returns the matching tab", () => {
  const tabs = [
    { key: "a", modPath: "m1", language: "zh_CN", name: "A", content: "one", dirty: false },
  ];

  const next = switchPoTabState(tabs, "a");

  assert.equal(next.activeKey, "a");
  assert.equal(next.activeTab?.name, "A");
});

test("closePoTabState falls back to same language tab when closing active tab", () => {
  const tabs = [
    { key: "a", modPath: "m1", language: "zh_CN", name: "A", content: "one", dirty: false },
    { key: "b", modPath: "m2", language: "zh_CN", name: "B", content: "two", dirty: false },
    { key: "c", modPath: "m3", language: "ja", name: "C", content: "three", dirty: false },
  ];

  const next = closePoTabState(tabs, "a", "a", "zh_CN");

  assert.equal(next.tabs.length, 2);
  assert.equal(next.activeKey, "b");
  assert.equal(next.activeTab?.name, "B");
});

test("upsertPoTabState updates existing tab and keeps active key", () => {
  const tabs = [
    { key: "m1@@zh_CN", modPath: "m1", language: "zh_CN", name: "Old", content: "one", dirty: false },
  ];

  const next = upsertPoTabState(tabs, "m1@@zh_CN", "m1", "zh_CN", "New", "two", true);

  assert.equal(next.tabs.length, 1);
  assert.equal(next.activeKey, "m1@@zh_CN");
  assert.equal(next.tabs[0].name, "New");
  assert.equal(next.tabs[0].content, "two");
  assert.equal(next.tabs[0].dirty, true);
});
