export function computeVirtualWindow(input) {
    const totalCount = Math.max(0, Math.floor(input.totalCount));
    const rowHeight = Math.max(1, Math.floor(input.rowHeight));
    const overscan = Math.max(0, Math.floor(input.overscan));
    const scrollTop = Math.max(0, input.scrollTop);
    const viewportHeight = Math.max(0, input.viewportHeight);
    if (totalCount === 0) {
        return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
    }
    const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
    const rawStart = Math.floor(scrollTop / rowHeight) - overscan;
    const start = Math.max(0, rawStart);
    const end = Math.min(totalCount, start + visibleCount + overscan * 2);
    const paddingTop = start * rowHeight;
    const paddingBottom = Math.max(0, (totalCount - end) * rowHeight);
    return { start, end, paddingTop, paddingBottom };
}
export function normalizeSourceKey(text) {
    return text.trim();
}
