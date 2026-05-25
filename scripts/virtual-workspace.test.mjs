import test from "node:test";
import assert from "node:assert/strict";

import { computeVirtualWindow } from "../app/renderer/virtual-workspace.js";

test("computeVirtualWindow returns a bounded initial range with overscan", () => {
  const result = computeVirtualWindow({
    totalCount: 1000,
    scrollTop: 0,
    viewportHeight: 600,
    rowHeight: 100,
    overscan: 2,
  });

  assert.deepEqual(result, {
    start: 0,
    end: 10,
    paddingTop: 0,
    paddingBottom: 99000,
  });
});

test("computeVirtualWindow clamps at the end of a large list", () => {
  const result = computeVirtualWindow({
    totalCount: 1000,
    scrollTop: 99500,
    viewportHeight: 600,
    rowHeight: 100,
    overscan: 2,
  });

  assert.deepEqual(result, {
    start: 993,
    end: 1000,
    paddingTop: 99300,
    paddingBottom: 0,
  });
});

test("computeVirtualWindow handles empty lists", () => {
  const result = computeVirtualWindow({
    totalCount: 0,
    scrollTop: 0,
    viewportHeight: 600,
    rowHeight: 100,
    overscan: 2,
  });

  assert.deepEqual(result, {
    start: 0,
    end: 0,
    paddingTop: 0,
    paddingBottom: 0,
  });
});
