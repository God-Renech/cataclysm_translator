import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCheckedStateToCheckboxes,
  clearModPathSelection,
  selectAllModPaths,
} from "../tmp_mod_selection/mod-selection.js";

test("selectAllModPaths returns every mod path", () => {
  const selected = selectAllModPaths([
    { path: "mods/a" },
    { path: "mods/b" },
    { path: "mods/c" },
  ]);

  assert.deepEqual([...selected].sort(), ["mods/a", "mods/b", "mods/c"]);
});

test("clearModPathSelection returns an empty set", () => {
  const selected = clearModPathSelection();
  assert.equal(selected.size, 0);
});

test("applyCheckedStateToCheckboxes toggles all checkbox-like items", () => {
  const checkboxes = [{ checked: false }, { checked: true }, { checked: false }];

  const selectedCount = applyCheckedStateToCheckboxes(checkboxes, true);
  assert.equal(selectedCount, 3);
  assert.deepEqual(checkboxes.map((item) => item.checked), [true, true, true]);

  const clearedCount = applyCheckedStateToCheckboxes(checkboxes, false);
  assert.equal(clearedCount, 0);
  assert.deepEqual(checkboxes.map((item) => item.checked), [false, false, false]);
});
