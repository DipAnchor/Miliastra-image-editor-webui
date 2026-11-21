import { useEffect, useMemo, useState } from "react";
import { loadMaskAsset, subscribeMaskAssets, type MaskAsset } from "./maskAssets";
import { luaMaskOf, type LuaMask } from "./luaMask";
import { createMaskPreview, createMaskSurface, maskPreviewBounds, type PreviewGeometry } from "./maskPreview";
import { isBasicMask } from "./maskShapes";

export function useMaskPreview(element: PreviewGeometry, value?: LuaMask | null, mode: "clip" | "guides" | "coverage" = "clip") {
  const mask = luaMaskOf(value), active = mask.enabled || mask.enableSoftEdge;
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ id: number; asset?: MaskAsset; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!active || isBasicMask(mask.imageId)) return;
    let current = true;
    const unsubscribe = subscribeMaskAssets((id, asset) => { if (current && id === mask.imageId) setLoaded({ id, asset }); });
    setLoaded(null);
    void loadMaskAsset(mask.imageId).then(asset => { if (current) setLoaded({ id: mask.imageId, asset }); })
      .catch(() => { if (current) setLoaded({ id: mask.imageId, failed: true }); });
    return () => { current = false; unsubscribe(); };
  }, [active, mask.imageId, revision]);
  const asset = loaded?.id === mask.imageId ? loaded.asset : undefined;
  const local = mode !== "clip";
  const bounds = local ? maskPreviewBounds(element) : null;
  const width = bounds ? mask.width ?? bounds.contentWidth : element.width;
  const height = bounds ? mask.height ?? bounds.contentHeight : element.height;
  const rotation = local ? 0 : mask.rotation ?? 0;
  const offsetX = local ? 0 : mask.offsetX, offsetY = local ? 0 : mask.offsetY;
  // Translation and rotation only change SVG placement for the local modes.
  const result = useMemo(() => {
    try {
      const preview = local ? createMaskSurface(width, height, mask, asset, mode === "guides")
        : createMaskPreview(element, mask, asset, false, rotation);
      return { preview, failed: false };
    } catch { return { preview: null, failed: true }; }
  }, [width, height, local ? 0 : element.rotation, local ? 0 : element.rotationX, local ? 0 : element.rotationY,
    local ? undefined : element.type, local ? undefined : element.textBox?.scaleX, local ? undefined : element.textBox?.scaleY,
    mask.enabled, mask.enableSoftEdge, mask.imageId, mask.imageType, local ? null : mask.width, local ? null : mask.height,
    offsetX, offsetY, rotation, mask.reverseMaskArea, mask.softEdgeMode, mask.softEdgeWidthX, mask.softEdgeWidthY,
    mask.horizontalSoftRange, mask.verticalSoftRange, asset, mode]);
  const failed = active && (result.failed || Boolean(loaded?.id === mask.imageId && loaded.failed));
  const loading = active && !isBasicMask(mask.imageId) && !asset && !failed;
  return { ...result, failed, loading, metadata: asset?.metadata, retry: () => setRevision(n => n + 1) };
}
