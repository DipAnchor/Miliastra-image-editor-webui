export const MIN_CANVAS_ZOOM = 0.25;
export const MAX_CANVAS_ZOOM = 4;

/** Normalize wheel units and use reciprocal, continuous zoom steps. */
export function wheelZoom(current: number, deltaY: number, deltaMode: number, pageHeight: number): number {
  if (!Number.isFinite(current) || current <= 0) return 1;
  if (!Number.isFinite(deltaY) || deltaY === 0 || ![0, 1, 2].includes(deltaMode)) return current;
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, pageHeight) : 1;
  if (!Number.isFinite(unit)) return current;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, current * Math.exp(-deltaY * unit * 0.002)));
}

type Point = { x: number; y: number };
type Origin = { left: number; top: number };
/** Add this delta to scrollLeft/Top after layout, retaining the same local point under the cursor. */
export function zoomAnchorScroll(before: Origin, after: Origin, cursor: Point, ratio: number): Point {
  return {
    x: after.left + (cursor.x - before.left) * ratio - cursor.x,
    y: after.top + (cursor.y - before.top) * ratio - cursor.y
  };
}
