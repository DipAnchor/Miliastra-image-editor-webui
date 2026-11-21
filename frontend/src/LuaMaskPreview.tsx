import { useId, type CSSProperties, type ReactNode } from "react";
import type { SceneLeaf } from "./App";
import { useMaskPreview } from "./useMaskPreview";
import { useI18n } from "./i18n";
import { rotationCss } from "./rotation";
import { MASK_POLYGONS } from "./maskShapes";
import { maskPreviewBounds, type MaskPreview } from "./maskPreview";
import { luaMaskOf } from "./luaMask";

export function LuaMaskPreview({ element, appearance, children, guides = false, zoom = 1 }: {
  element: SceneLeaf; appearance: CSSProperties; children: ReactNode;
  guides?: boolean;
  zoom?: number;
}) {
  const mask = element.luaMask;
  const guideMask = luaMaskOf(mask);
  const tintId = useId();
  const { preview, loading, failed } = useMaskPreview(element, guides ? { ...guideMask, enabled: true } : mask, guides ? "guides" : "clip");
  const { t } = useI18n();
  const visual = <div className="shape-content" style={{ ...appearance, position: "absolute", left: "50%", top: "50%",
    width: element.width, height: element.height, transform: `translate(-50%, -50%) ${rotationCss(element)}`,
    pointerEvents: "none", zIndex: 0 }}>{children}</div>;
  if (!preview) return <>{visual}{loading || failed ? <span className="mask-preview-status" role="status">{t(loading ? "luaMask.loadingPreview" : "luaMask.failedPreview")}</span> : null}</>;
  if (guides) {
    const bounds = maskPreviewBounds(element);
    const left = -bounds.width / 2, top = -bounds.height / 2;
    const { offsetX, offsetY, rotation = 0 } = guideMask;
    const width = guideMask.width ?? bounds.contentWidth, height = guideMask.height ?? bounds.contentHeight;
    return <div className="lua-mask-guides" style={{ position: "absolute", left: "50%", top: "50%",
      width: bounds.width, height: bounds.height, transform: "translate(-50%, -50%)", pointerEvents: "none" }}>
      {visual}
      <svg className="mask-hidden-overlay" viewBox={`${left} ${top} ${bounds.width} ${bounds.height}`} aria-hidden="true">
        <defs><mask id={tintId} x={left} y={top} width={bounds.width} height={bounds.height}
          maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" style={{ maskType: "luminance" }}>
          <rect x={left} y={top} width={bounds.width} height={bounds.height} fill="white" />
          <MaskSurfaceImage preview={preview} x={offsetX} y={offsetY} rotation={rotation} dark />
        </mask></defs>
        <rect x={left} y={top} width={bounds.width} height={bounds.height} fill="rgba(27, 38, 43, .22)" mask={`url(#${tintId})`} />
      </svg>
      <MaskOutline bounds={bounds} outline={preview.outline} x={offsetX - width / 2} y={offsetY - height / 2}
        width={width} height={height} rotation={rotation} imageId={guideMask.imageId} zoom={zoom} />
    </div>;
  }
  return <div className="lua-mask-preview" data-mask-preview={mask?.enableSoftEdge && mask.softEdgeMode === "Percentage" ? "percentage" : "pixel"} style={{
    position: "absolute", left: "50%", top: "50%", width: preview.width, height: preview.height,
    transform: "translate(-50%, -50%)", pointerEvents: "none",
    maskImage: preview.image, WebkitMaskImage: preview.image,
    maskSize: "100% 100%", WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskMode: "alpha"
  }}>{visual}</div>;
}

export function MaskSurfaceImage({ preview, x, y, rotation = 0, dark }: {
  preview: MaskPreview; x: number; y: number; rotation?: number; dark?: boolean;
}) {
  return <image href={preview.image.slice(5, -2)} width={preview.width} height={preview.height}
    x={-preview.width / 2} y={-preview.height / 2} preserveAspectRatio="none"
    transform={`translate(${x} ${y}) rotate(${-(rotation % 360)})`} style={dark ? { filter: "brightness(0)" } : undefined} />;
}

function MaskOutline({ bounds, outline, x, y, width, height, rotation, imageId, zoom }: {
  bounds: { width: number; height: number }; outline: MaskPreview["outline"];
  x: number; y: number; width: number; height: number; rotation: number; imageId: number; zoom: number;
}) {
  const shape = imageId === 100001 ? <rect x={x} y={y} width={width} height={height} /> :
    imageId === 100002 || imageId === 100006 ? <>
      <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} />
      {imageId === 100006 ? <ellipse cx={x + width / 2} cy={y + height / 2} rx={width * .4} ry={height * .4} /> : null}
    </> : MASK_POLYGONS[imageId] ? <polygon points={MASK_POLYGONS[imageId].map(([px, py]) => `${x + px * width},${y + py * height}`).join(" ")} /> :
    outline ? <path d={outline.path} transform={`translate(${x} ${y}) scale(${width / outline.width} ${height / outline.height})`} /> : null;
  // CSS canvas zoom sits outside the SVG viewport; non-scaling-stroke alone does
  // not compensate it. Set actual screen-pixel line widths through this factor.
  return <svg className="mask-guide-outline" viewBox={`${-bounds.width / 2} ${-bounds.height / 2} ${bounds.width} ${bounds.height}`} aria-hidden="true"
    style={{ "--mask-stroke": `${1 / zoom}px`, "--mask-dash": `${4 / zoom}px ${4 / zoom}px` } as CSSProperties}>
    <g transform={`rotate(${-(rotation % 360)} ${x + width / 2} ${y + height / 2})`}>
      <g className="mask-outline-dark">{shape}</g><g className="mask-outline-light">{shape}</g>
    </g>
  </svg>;
}
