// Planar geometry helper; not yet a public scene-field contract.
// Scene Z angles are counterclockwise; screen Y grows downwards.
export function maskLocalPoint(x: number, y: number, centerX: number, centerY: number, degrees: number) {
  if (![x, y, centerX, centerY, degrees].every(Number.isFinite)) {
    throw new Error("Expected finite mask coordinates and angle");
  }
  const radians = (degrees % 360) * Math.PI / 180;
  const c = Math.cos(radians), s = Math.sin(radians);
  const dx = x - centerX, dy = y - centerY;
  return { x: c * dx - s * dy, y: s * dx + c * dy };
}
