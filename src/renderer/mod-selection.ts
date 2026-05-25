export type ModPathItem = {
  path: string;
};

export function selectAllModPaths(mods: ModPathItem[]) {
  return new Set(mods.map((mod) => mod.path));
}

export function clearModPathSelection() {
  return new Set<string>();
}

export function applyCheckedStateToCheckboxes<T extends { checked: boolean }>(
  checkboxes: T[],
  checked: boolean
) {
  checkboxes.forEach((checkbox) => {
    checkbox.checked = checked;
  });
  return checked ? checkboxes.length : 0;
}
