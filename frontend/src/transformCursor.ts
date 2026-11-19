import type { Point } from "./transformGeometry";

const cursors = new Map<number, string>();

/** A double-headed quarter arc whose opening faces the current transform pivot. */
export function rotationCursor(pointer: Point, pivot: Point): string {
  const dx = pivot.x - pointer.x, dy = pivot.y - pointer.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return "crosshair";
  // Five-degree steps keep at most 72 native cursor images in the cache.
  const angle = ((Math.round((Math.atan2(dy, dx) * 180 / Math.PI - 135) / 5) * 5) % 360 + 360) % 360;
  const cached = cursors.get(angle);
  if (cached) return cached;
  const arc = "M-6-8A14 14 0 0 1 8 6", heads = "M-11-8L-5-13V-3Z M8 11L3 5H13Z";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g transform="translate(16 16) rotate(${angle})"><g stroke="white" stroke-linejoin="round" stroke-linecap="round"><path d="${arc}" fill="none" stroke-width="4.5"/><path d="${heads}" fill="white" stroke-width="2"/></g><path d="${arc}" fill="none" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/><path d="${heads}" fill="#111827"/></g></svg>`;
  const cursor = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") 16 16, crosshair';
  cursors.set(angle, cursor);
  return cursor;
}
