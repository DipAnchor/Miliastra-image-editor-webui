import type { SceneLeaf } from "./App";
import type { LuaMask } from "./luaMask";
import { maskPreviewBounds } from "./maskPreview";
import { HANDLE_POINTS, pointFromBox, resizeTransform, rotateDelta, type HandleDirection, type Point } from "./transformGeometry";

export function maskTransformBox(element: SceneLeaf, mask: LuaMask) {
  const { contentWidth, contentHeight } = maskPreviewBounds(element);
  // Keep handles accessible even for an imported zero-size mask.
  const width = Math.max(1, mask.width ?? contentWidth);
  const height = Math.max(1, mask.height ?? contentHeight);
  return { x: element.x + mask.offsetX - width / 2, y: element.y + mask.offsetY - height / 2,
    width, height, rotation: mask.rotation ?? 0 };
}

export function moveMask(mask: LuaMask, dx: number, dy: number): LuaMask {
  return { ...mask, offsetX: mask.offsetX + dx, offsetY: mask.offsetY + dy };
}

export function resizeMask(element: SceneLeaf, mask: LuaMask, handle: HandleDirection, dx: number, dy: number, keepAspect: boolean): LuaMask {
  const box = maskTransformBox(element, mask);
  const origin = pointFromBox(box, HANDLE_POINTS[handle]);
  const result = resizeTransform(box, handle, { x: origin.x + dx, y: origin.y + dy }, { centerAnchored: false, keepAspect });
  if (!result) return mask;
  return { ...moveMask(mask, result.translateX, result.translateY),
    width: handle === "n" || handle === "s" ? mask.width : result.newBounds.width,
    height: handle === "e" || handle === "w" ? mask.height : result.newBounds.height };
}

export function rotateMask(element: SceneLeaf, mask: LuaMask, start: Point, pointer: Point, step: number): LuaMask {
  const pivot = { x: element.x + mask.offsetX, y: element.y + mask.offsetY };
  const angle = rotateDelta(start, pointer, pivot, mask.rotation);
  if (angle === null) return mask;
  return { ...mask, rotation: step > 0 ? Math.round(angle / step) * step : angle };
}
