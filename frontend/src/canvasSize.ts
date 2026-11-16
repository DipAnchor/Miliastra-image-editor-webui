export type CanvasSize = { width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function aspectRatio(canvas: CanvasSize): number {
  return canvas.width / Math.max(1, canvas.height);
}

/**
 * Compute the next canvas size when the user edits width or height.
 *
 * With `lockAspectRatio` on, the other side follows a fixed ratio. Callers pass
 * the ratio captured when the lock was engaged (`lockedRatio`) so that typing
 * digits one by one cannot corrupt it: an intermediate clamped value (e.g. 1x1)
 * must not redefine the ratio. When omitted, the current canvas ratio is used.
 */
export function resolveCanvasSize(
  canvas: CanvasSize,
  field: "width" | "height",
  value: number,
  lockAspectRatio: boolean,
  lockedRatio?: number,
): CanvasSize {
  const nextValue = clamp(value || 1, 1, 2048);
  if (!lockAspectRatio) {
    return field === "width"
      ? { width: nextValue, height: canvas.height }
      : { width: canvas.width, height: nextValue };
  }
  const ratio = lockedRatio && lockedRatio > 0 ? lockedRatio : aspectRatio(canvas);
  return field === "width"
    ? { width: nextValue, height: clamp(nextValue / ratio, 1, 2048) }
    : { width: clamp(nextValue * ratio, 1, 2048), height: nextValue };
}
