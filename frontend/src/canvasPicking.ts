import type { SceneElement, SceneGroup, SceneLeaf } from "./App";
import { effectiveGroupOpacity, effectiveLocked, effectiveVisible } from "./layerTree";
import { MASK_POLYGONS } from "./maskShapes";
import type { MaskPreview } from "./maskPreview";
import { unprojectVector } from "./rotation";

type Point = { x: number; y: number };
type Shape = Pick<SceneLeaf, "type" | "width" | "height">;
type PaintTest = (leaf: SceneLeaf, local: Point, projected: Point, parentId?: string) => boolean;
const polygons: Partial<Record<SceneLeaf["type"], number[][]>> = {
  triangle: MASK_POLYGONS[100003], four_point_star: MASK_POLYGONS[100004], five_point_star: MASK_POLYGONS[100005]
};

function insideUnit(x: number, y: number) {
  return x >= 0 && x < 1 && y >= 0 && y < 1;
}

export function primitiveContains(shape: Shape, local: Point): boolean {
  const x = local.x / shape.width + .5, y = local.y / shape.height + .5;
  if (!insideUnit(x, y)) return false;
  if (shape.type === "ellipse" || shape.type === "ring") {
    const radius = 2 * Math.hypot(x - .5, y - .5);
    // The ring gradient starts fading in at 79.5% of the outer radius.
    return radius <= 1 && (shape.type === "ellipse" || radius > .795);
  }
  const polygon = polygons[shape.type];
  if (!polygon) return shape.type === "rectangle";
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i], [bx, by] = polygon[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function transparent(color: string) {
  return color === "transparent" || /^#[\da-f]{3}0$|^#[\da-f]{6}00$/i.test(color)
    || /^(?:rgba|hsla)\([^)]*,\s*0(?:\.0+)?%?\s*\)$/i.test(color)
    || /\/\s*0(?:\.0+)?%?\s*\)$/.test(color);
}

/** Input is in render order, back to front. Internal locks do not lock the object shell. */
export function pickCanvasLayer(elements: readonly SceneElement[], groups: Map<string, SceneGroup>, point: Point, painted: PaintTest) {
  const hitLeaf = (leaf: SceneLeaf, p: Point, parentId?: string) => {
    const projected = { x: p.x - leaf.x, y: p.y - leaf.y };
    const local = unprojectVector(projected.x, projected.y, leaf);
    if (!local) return false;
    switch (leaf.type) {
      case "textbox": return painted(leaf, local, projected, parentId);
      case "image": case "prefab":
        return insideUnit(local.x / leaf.width + .5, local.y / leaf.height + .5) && painted(leaf, local, projected, parentId);
      default:
        return !transparent(leaf.color) && primitiveContains(leaf, local) && painted(leaf, local, projected, parentId);
    }
  };
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (!effectiveVisible(element, groups) || effectiveLocked(element, groups) ||
        effectiveGroupOpacity({ opacity: element.type === "textbox" ? 1 : element.opacity, groupId: element.groupId }, groups) <= 0) continue;
    if (element.type !== "smart-object") {
      if (hitLeaf(element, point)) return element;
      continue;
    }
    const local = unprojectVector(point.x - element.x, point.y - element.y, element);
    if (!local || !(element.scale > 0)) continue;
    const frame = element.content.frame;
    const inObject = { x: local.x / element.scale + frame.width / 2, y: local.y / element.scale + frame.height / 2 };
    const nestedGroups = new Map(element.content.groups.map(group => [group.id, group]));
    if (element.content.elements.some(leaf => effectiveVisible(leaf, nestedGroups) &&
        effectiveGroupOpacity({ opacity: leaf.type === "textbox" ? 1 : leaf.opacity, groupId: leaf.groupId }, nestedGroups) > 0 &&
        hitLeaf(leaf, inObject, element.id))) return element;
  }
  return null;
}

const masks = new WeakMap<HTMLElement, MaskPreview>();
export function bindCanvasMask(node: HTMLDivElement | null, preview: MaskPreview) {
  if (node) masks.set(node, preview);
}

const svgImages = new Map<string, HTMLImageElement>();
export function prepareCanvasSprite(node: SVGImageElement | null) {
  const url = node?.getAttribute("href");
  if (!url) return undefined;
  let image = svgImages.get(url);
  if (!image) {
    image = new Image();
    image.src = url;
    svgImages.set(url, image);
    if (svgImages.size > 64) svgImages.delete(svgImages.keys().next().value!);
  }
  return image;
}

let sampleCanvas: HTMLCanvasElement | undefined;
function rasterContains(source: HTMLImageElement | HTMLCanvasElement, uv: Point) {
  const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!w || !h) return false;
  const x = Math.floor(uv.x * w), y = Math.floor(uv.y * h);
  try {
    if (source instanceof HTMLCanvasElement) return (source.getContext("2d")?.getImageData(x, y, 1, 1).data[3] ?? 0) > 0;
    if (!sampleCanvas) {
      sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = sampleCanvas.height = 1;
    }
    const ctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(source, x, y, 1, 1, 0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3] > 0;
  } catch {
    sampleCanvas = undefined;
    // A displayed remote sprite may forbid reading its pixels.
    return true;
  }
}

function textRunContains(node: Element, point: Point) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const style = text.parentElement && getComputedStyle(text.parentElement);
    if (style && transparent(style.color) && (!style.webkitTextStrokeWidth || style.webkitTextStrokeWidth === "0px" || transparent(style.webkitTextStrokeColor))) continue;
    for (const match of (text.textContent ?? "").matchAll(/\S+/gu)) {
      range.setStart(text, match.index!); range.setEnd(text, match.index! + match[0].length);
      if (Array.from(range.getClientRects()).some(rect => point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom)) return true;
    }
  }
  return false;
}

/** Consult the rendered mask and sprite so selection uses the same content as the editor. */
export function canvasPaintTest(canvas: HTMLElement, client: Point): PaintTest {
  let shells: Map<string, HTMLElement> | undefined;
  return (leaf, local, projected, parentId) => {
    shells ??= new Map(Array.from(canvas.querySelectorAll<HTMLElement>(":scope > .shape[data-element-id]"), node => [node.dataset.elementId!, node]));
    const shell = shells.get(parentId ?? leaf.id);
    const layer = parentId ? Array.from(shell?.querySelectorAll<HTMLElement>(".smart-object-content > .shape[data-content-id]") ?? [])
      .find(node => node.dataset.contentId === leaf.id) : shell;
    if (!layer) return false;
    const clip = layer.querySelector<HTMLElement>(":scope > .lua-mask-preview");
    const mask = clip && masks.get(clip);
    if (mask && !mask.containsPoint(projected.x, projected.y)) return false;
    if (leaf.type === "textbox") {
      const text = layer.querySelector<HTMLElement>(".textbox-preview");
      if (!text) return false;
      const x = local.x / (leaf.textBox?.scaleX ?? 1) / leaf.width + .5;
      const y = local.y / (leaf.textBox?.scaleY ?? 1) / leaf.height + .5;
      if (!insideUnit(x, y)) return false;
      if (Math.round((leaf.textBox?.bgOpacity ?? 0) * 255) > 0) return true;
      return textRunContains(text, client);
    }
    if (leaf.type !== "image" && leaf.type !== "prefab") return true;
    const sprite = layer.querySelector<HTMLCanvasElement | HTMLImageElement | SVGImageElement>("img.asset-sprite, canvas.asset-sprite, svg.asset-sprite > image");
    if (!sprite) {
      const placeholder = layer.querySelector(".prefab-placeholder");
      return Boolean(placeholder && textRunContains(placeholder, client));
    }
    const raster = sprite instanceof HTMLCanvasElement || sprite instanceof HTMLImageElement ? sprite : prepareCanvasSprite(sprite);
    return Boolean(raster && rasterContains(raster, { x: local.x / leaf.width + .5, y: local.y / leaf.height + .5 }));
  };
}
