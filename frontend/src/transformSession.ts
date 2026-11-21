import type { SceneDocument, SceneElement, SceneLeaf } from "./App";
import { luaMaskActive, luaMaskOf } from "./luaMask";
import { sceneLayerSize } from "./sceneLayer";
import { selectionBounds, translateSelection } from "./editorSelection";
import { rotationMatrix, unprojectVector } from "./rotation";
import { pointFromBox, normalizedPoint, resizeTransform, mapResizedPoint, rotateDelta, type TransformBox, type Point, type HandleDirection } from "./transformGeometry";
import { resizeProjectedLayer, rotateProjectedLayer } from "./transformAffine";

export type TransformSession = { original: SceneDocument; preview: SceneDocument; ids: string[]; box: TransformBox; pivot: Point };
export function selectionTransformBox(elements: SceneElement[]): TransformBox | null {
  if (elements.length !== 1) return selectionBounds(elements);
  const e=elements[0], size=sceneLayerSize(e);
  const width=size.width*(e.type==='textbox'?Math.abs(e.textBox?.scaleX??1):1);
  const height=size.height*(e.type==='textbox'?Math.abs(e.textBox?.scaleY??1):1);
  return {x:e.x-width/2,y:e.y-height/2,width,height,rotation:e.rotation,
    rotationX:e.type==='smart-object'?0:e.rotationX??0,rotationY:e.type==='smart-object'?0:e.rotationY??0};
}
export function beginTransformSession(scene: SceneDocument, ids: readonly string[]): TransformSession | null {
  const chosen=new Set(ids),targets=scene.elements.filter(e=>chosen.has(e.id)),box=selectionTransformBox(targets);
  if (!box || !targets.length) return null;
  return {original:scene,preview:scene,ids:targets.map(e=>e.id),box,pivot:pointFromBox(box,{x:0.5,y:0.5})};
}
/** Rebase numeric property edits without committing or restarting the transaction. */
export function rebaseTransformSession(session: TransformSession, preview: SceneDocument): TransformSession {
  if (preview === session.preview) return session;
  const chosen = new Set(session.ids);
  const targets = preview.elements.filter(element => chosen.has(element.id));
  const box = selectionTransformBox(targets);
  if (!box || targets.length !== session.ids.length ||
      ![box.x, box.y, box.width, box.height, box.rotation ?? 0, box.rotationX ?? 0, box.rotationY ?? 0].every(Number.isFinite) ||
      box.width <= 0 || box.height <= 0) return session;
  const previous = new Map(session.preview.elements.filter(element => chosen.has(element.id)).map(element => [element.id, element]));
  let elements: SceneElement[] | undefined;
  for (const [index, next] of preview.elements.entries()) {
    const before = previous.get(next.id);
    if (!before || before === next || before.type === "smart-object" || next.type === "smart-object" ||
        !luaMaskActive(before.luaMask) || before.luaMask !== next.luaMask) continue;

    const oldSize = scaledLeafSize(before), newSize = scaledLeafSize(next);
    const sameTilt = (before.rotationX ?? 0) === (next.rotationX ?? 0) && (before.rotationY ?? 0) === (next.rotationY ?? 0);
    if (oldSize.width === newSize.width && oldSize.height === newSize.height && before.rotation === next.rotation && sameTilt) continue;
    const sx = newSize.width / oldSize.width, sy = newSize.height / oldSize.height;
    if (![sx, sy].every(Number.isFinite)) return session;

    const projection = rotationMatrix(next);
    const mapVector = (vector: Point) => {
      // Relative vectors exclude the translation already carried by the new layer center.
      const local = unprojectVector(vector.x, vector.y, before);
      if (!local) return null;
      const x = local.x * sx, y = local.y * sy;
      return { x: projection.a * x + projection.c * y, y: projection.b * x + projection.d * y };
    };
    const resizing = sameTilt && sx > 0 && sy > 0 && (sx !== 1 || sy !== 1);
    const mask = resizing ? resizeAttachedMask(before, next, sx, sy, mapVector) : mapMaskAffine(before, next, mapVector);
    if (!mask) return session;
    elements ??= preview.elements.slice();
    elements[index] = { ...next, luaMask: mask };
  }
  const localPivot = normalizedPoint(session.box, session.pivot);
  const pivot = localPivot ? pointFromBox(box, localPivot) : {
    x: session.pivot.x + box.x + box.width / 2 - session.box.x - session.box.width / 2,
    y: session.pivot.y + box.y + box.height / 2 - session.box.y - session.box.height / 2,
  };
  return { ...session, preview: elements ? { ...preview, elements } : preview, box, pivot };
}
export function moveTransformSession(session:TransformSession,dx:number,dy:number):TransformSession {
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return session;
  const elements=translateSelection(session.preview.elements,session.ids,dx,dy,session.preview.canvas);
  if(elements===session.preview.elements)return session;
  const first=session.ids[0],a=session.preview.elements.find(e=>e.id===first)!,b=elements.find(e=>e.id===first)!;
  dx=b.x-a.x;dy=b.y-a.y;
  return {...session,preview:{...session.preview,elements},box:{...session.box,x:session.box.x+dx,y:session.box.y+dy},pivot:{x:session.pivot.x+dx,y:session.pivot.y+dy}};
}
function scaledLeafSize(element: SceneLeaf) {
  const text = element.type === "textbox" ? element.textBox : undefined;
  return { width: element.width * (text?.scaleX ?? 1), height: element.height * (text?.scaleY ?? 1) };
}

/** A mask's axes and offset are in canvas space, independent of its host layer's orientation. */
function mapMaskAffine(element: SceneLeaf, next: SceneLeaf, mapVector: (vector: Point) => Point | null) {
  const mask = luaMaskOf(element.luaMask), angle = mask.rotation ?? 0;
  const axes = rotationMatrix({ rotation: angle % 360 });
  const u = mapVector({ x: axes.a, y: axes.b }), v = mapVector({ x: axes.c, y: axes.d });
  const offset = mapVector({ x: mask.offsetX, y: mask.offsetY });
  if (!u || !v || !offset) return null;
  const factorX = Math.hypot(u.x, u.y), factorY = Math.hypot(v.x, v.y);
  if (!(factorX > 0 && factorY > 0)) return null;
  const ux = u.x / factorX, uy = u.y / factorX, vx = v.x / factorY, vy = v.y / factorY;
  // One Z angle plus two sizes can only represent perpendicular, orientation-preserving axes.
  if (Math.abs(ux * vx + uy * vy) > 1e-9 || !(ux * vy - uy * vx > 0)) return null;
  const oldSize = scaledLeafSize(element), newSize = scaledLeafSize(next);
  const nextWidth = (mask.width ?? Math.abs(oldSize.width)) * factorX;
  const nextHeight = (mask.height ?? Math.abs(oldSize.height)) * factorY;
  const rotation = Math.abs(axes.a - ux) < 1e-9 && Math.abs(axes.b - uy) < 1e-9
    ? angle : -Math.atan2(uy, ux) * 180 / Math.PI;
  const softEdgeWidthX = mask.softEdgeMode === "Pixel" ? mask.softEdgeWidthX * factorX : mask.softEdgeWidthX;
  const softEdgeWidthY = mask.softEdgeMode === "Pixel" ? mask.softEdgeWidthY * factorY : mask.softEdgeWidthY;
  if (![offset.x, offset.y, nextWidth, nextHeight, rotation, softEdgeWidthX, softEdgeWidthY].every(Number.isFinite)) return null;
  const follows = (actual: number, inherited: number) => Math.abs(actual - inherited) <= 1e-9 * Math.max(actual, inherited);
  return { ...mask, offsetX: offset.x, offsetY: offset.y, rotation, softEdgeWidthX, softEdgeWidthY,
    width: mask.width === null && follows(nextWidth, Math.abs(newSize.width)) ? null : nextWidth,
    height: mask.height === null && follows(nextHeight, Math.abs(newSize.height)) ? null : nextHeight };
}

/** Scale the rectangle in its own axes, applying the body's affine map only to its center. */
function resizeAttachedMask(element: SceneLeaf, next: SceneLeaf, sx: number, sy: number, mapVector: (vector: Point) => Point | null) {
  const mask = luaMaskOf(element.luaMask), offset = mapVector({ x: mask.offsetX, y: mask.offsetY });
  if (!offset) return null;
  const angleDelta = normalized(next.rotation % 360 - element.rotation % 360 + 180) - 180;
  const rotation = (mask.rotation ?? 0) + angleDelta;
  const width = mask.width === null ? null : mask.width * sx, height = mask.height === null ? null : mask.height * sy;
  const softEdgeWidthX = mask.softEdgeMode === "Pixel" ? mask.softEdgeWidthX * sx : mask.softEdgeWidthX;
  const softEdgeWidthY = mask.softEdgeMode === "Pixel" ? mask.softEdgeWidthY * sy : mask.softEdgeWidthY;
  if (![offset.x, offset.y, rotation, width ?? 0, height ?? 0, softEdgeWidthX, softEdgeWidthY].every(Number.isFinite)) return null;
  return { ...mask, offsetX: offset.x, offsetY: offset.y, width, height, rotation, softEdgeWidthX, softEdgeWidthY };
}

export function resizeTransformSession(session:TransformSession,handle:HandleDirection,pointer:Point,centerAnchored:boolean,keepAspect:boolean):TransformSession {
  const chosen=new Set(session.ids), targets=session.preview.elements.filter(e=>chosen.has(e.id));
  const result=resizeTransform(session.box,handle,pointer,{centerAnchored,pivot:session.pivot,keepAspect:keepAspect||targets.some(e=>e.type==='smart-object')});
  if(!result)return session;
  const nonUniformGroup = targets.length > 1 && result.scaleX !== result.scaleY;
  // Relative vectors use the same map as world points, with its translation removed.
  const vectorResize = { ...result, anchor: { x: 0, y: 0 } };
  const elements: SceneElement[] = [];
  for (const e of session.preview.elements) {
    if (!chosen.has(e.id)) { elements.push(e); continue; }
    const center = mapResizedPoint(session.box, result, e);
    if (!center) return session;
    if (e.type === "smart-object") {
      elements.push({ ...e, ...center, scale: e.scale * result.scaleX });
      continue;
    }
    const projection = nonUniformGroup
      ? resizeProjectedLayer(e, session.box.rotation ?? 0, result.scaleX, result.scaleY)
      : { rotation: e, widthFactor: result.scaleX, heightFactor: result.scaleY };
    if (!projection) return session;
    const width = e.width * projection.widthFactor, height = e.height * projection.heightFactor;
    if (!(Number.isFinite(width) && Number.isFinite(height))) return session;
    const transformed = { ...e, ...projection.rotation, ...center, width, height };
    const activeMask = luaMaskActive(e.luaMask);
    if (e.luaMask && (targets.length > 1 || activeMask) && (result.scaleX !== 1 || result.scaleY !== 1)) {
      const mapVector = (vector: Point) => mapResizedPoint(session.box, vectorResize, vector);
      // An edge-on member has no usable local plane for a nonuniform group resize.
      // Preserve the old exact mapping in that case, and for dormant group masks.
      const degenerateMember = nonUniformGroup && (!unprojectVector(0, 0, e) || !unprojectVector(0, 0, transformed));
      const mask = activeMask && !degenerateMember
        ? resizeAttachedMask(e, transformed, projection.widthFactor, projection.heightFactor, mapVector)
        : mapMaskAffine(e, transformed, mapVector);
      if (!mask) return session;
      transformed.luaMask = mask;
    }
    elements.push(transformed);
  }
  const pivot=mapResizedPoint(session.box,result,session.pivot);
  if(!pivot)return session;
  return {...session,preview:{...session.preview,elements},box:result.newBounds,pivot};
}
const normalized=(angle:number)=>((angle%360)+360)%360;
export function rotateTransformSession(session:TransformSession,start:Point,current:Point,angleStep=0):TransformSession {
  const targets=session.preview.elements.filter(e=>session.ids.includes(e.id)),single=targets.length===1?targets[0]:null;
  // Preserve the existing projected XY plane for a single tilted layer.
  const plane=single?{...single,rotation:0}:{rotation:0};
  const a=unprojectVector(start.x-session.pivot.x,start.y-session.pivot.y,plane);
  const b=unprojectVector(current.x-session.pivot.x,current.y-session.pivot.y,plane);
  if(!a||!b)return session;
  let degrees=rotateDelta(a,b,{x:0,y:0});
  if(degrees==null)return session;
  if(angleStep>0&&Number.isFinite(angleStep)) {
    const initial=single?.rotation??session.box.rotation??0;
    degrees=Math.round((initial+degrees)/angleStep)*angleStep-initial;
  }
  if(Math.abs(degrees)<1e-10)return session;
  const radians=-degrees*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians),m=rotationMatrix(plane);
  const rotateVector = (point: Point): Point => {
    const p = unprojectVector(point.x, point.y, plane)!;
    const x = p.x * cos - p.y * sin, y = p.x * sin + p.y * cos;
    return { x: m.a * x + m.c * y, y: m.b * x + m.d * y };
  };
  const orbit = (point: Point): Point => {
    const p = rotateVector({ x: point.x - session.pivot.x, y: point.y - session.pivot.y });
    return { x: session.pivot.x + p.x, y: session.pivot.y + p.y };
  };
  const screenPlane = m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;
  const chosen = new Set(session.ids), elements: SceneElement[] = [];
  for (const e of session.preview.elements) {
    if (!chosen.has(e.id)) { elements.push(e); continue; }
    if (e.type === "smart-object") {
      elements.push({ ...e, rotation: normalized(e.rotation + degrees), ...orbit(e) });
      continue;
    }
    const rotation = single ? { rotation: normalized(e.rotation + degrees) } : rotateProjectedLayer(e, degrees);
    const transformed = { ...e, ...rotation, ...orbit(e) };
    if (e.luaMask && (!single || luaMaskActive(e.luaMask))) {
      if (!screenPlane) {
        // A single tilted layer rotates in its projected plane, which can shear a canvas-space mask.
        const mask = mapMaskAffine(e, transformed, rotateVector);
        if (!mask) return session;
        transformed.luaMask = mask;
      } else {
        const mask = luaMaskOf(e.luaMask);
        const { x: offsetX, y: offsetY } = rotateVector({ x: mask.offsetX, y: mask.offsetY });
        const rotation = (mask.rotation ?? 0) + degrees;
        if (![offsetX, offsetY, rotation].every(Number.isFinite)) return session;
        transformed.luaMask = { ...mask, offsetX, offsetY, rotation };
      }
    }
    elements.push(transformed);
  }
  const center=orbit({x:session.box.x+session.box.width/2,y:session.box.y+session.box.height/2});
  return {...session,preview:{...session.preview,elements},box:{...session.box,x:center.x-session.box.width/2,y:center.y-session.box.height/2,rotation:normalized((session.box.rotation??0)+degrees)}};
}
