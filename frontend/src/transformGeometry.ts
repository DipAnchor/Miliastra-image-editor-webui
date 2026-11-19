import { rotationMatrix, unprojectVector, type Rotation } from "./rotation";

export type Point = { x: number; y: number };
export type TransformBox = Point & { width: number; height: number } & Partial<Rotation>;
export type HandleDirection = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLE_POINTS: Record<HandleDirection, Point> = {
  nw: {x:0,y:0}, n: {x:0.5,y:0}, ne: {x:1,y:0}, e: {x:1,y:0.5},
  se: {x:1,y:1}, s: {x:0.5,y:1}, sw: {x:0,y:1}, w: {x:0,y:0.5}
};
const finite = (...values: number[]) => values.every(Number.isFinite);
const rotationOf = (box: TransformBox): Rotation => ({ rotation: box.rotation ?? 0, rotationX: box.rotationX ?? 0, rotationY: box.rotationY ?? 0 });
export function pointFromBox(box: TransformBox, normalized: Point): Point {
  const m = rotationMatrix(rotationOf(box));
  const x = (normalized.x - 0.5) * box.width, y = (normalized.y - 0.5) * box.height;
  return { x: box.x + box.width / 2 + m.a*x + m.c*y, y: box.y + box.height / 2 + m.b*x + m.d*y };
}
export const centerAnchor = pointFromBox;
export function normalizedPoint(box: TransformBox, world: Point): Point | null {
  if (!(box.width > 0 && box.height > 0)) return null;
  const p = unprojectVector(world.x-box.x-box.width/2, world.y-box.y-box.height/2, rotationOf(box));
  return p && finite(p.x,p.y) ? { x:0.5+p.x/box.width, y:0.5+p.y/box.height } : null;
}
// The outer band follows the projected frame and stays proportional at every zoom.
export function transformPointerRegion(box: TransformBox, pointer: Point): "move" | "rotate" | null {
  const local = normalizedPoint(box, pointer);
  if (!local) return null;
  const outside = Math.max(0, -local.x, local.x - 1, -local.y, local.y - 1);
  if (outside <= 1e-9) return "move";
  return outside <= 0.2 + 1e-9 ? "rotate" : null;
}
export type ResizeResult = {
  scaleX: number; scaleY: number; translateX: number; translateY: number;
  anchor: Point; newBounds: TransformBox;
};
export function resizeTransform(box: TransformBox, handle: HandleDirection, pointer: Point,
  options: {centerAnchored:boolean; keepAspect:boolean; pivot?:Point; minSize?:number}): ResizeResult | null {
  const h = HANDLE_POINTS[handle], min = options.minSize ?? 1;
  if (!h || !finite(box.x,box.y,box.width,box.height,pointer.x,pointer.y,min,box.rotation??0,box.rotationX??0,box.rotationY??0) || box.width<=0 || box.height<=0 || min<=0) return null;
  const anchor = options.centerAnchored ? options.pivot ?? pointFromBox(box,{x:0.5,y:0.5}) : pointFromBox(box,{x:1-h.x,y:1-h.y});
  if (!finite(anchor.x,anchor.y)) return null;
  const start = pointFromBox(box,h), rotation = rotationOf(box);
  const from = unprojectVector(start.x-anchor.x,start.y-anchor.y,rotation);
  const to = unprojectVector(pointer.x-anchor.x,pointer.y-anchor.y,rotation);
  if (!from || !to) return null;
  const activeX = h.x!==0.5, activeY = h.y!==0.5;
  if ((activeX && Math.abs(from.x)<1e-9) || (activeY && Math.abs(from.y)<1e-9)) return null;
  let sx = activeX ? to.x/from.x : 1, sy = activeY ? to.y/from.y : 1;
  if (options.keepAspect) {
    const scale = activeX && activeY ? (to.x*from.x+to.y*from.y)/(from.x*from.x+from.y*from.y) : activeX ? sx : sy;
    sx = sy = Math.max(min/box.width,min/box.height,scale);
  } else {
    if (activeX) sx = Math.max(min/box.width,sx);
    if (activeY) sy = Math.max(min/box.height,sy);
  }
  const center = {x:box.x+box.width/2,y:box.y+box.height/2};
  const local = unprojectVector(center.x-anchor.x,center.y-anchor.y,rotation);
  if (!local) return null;
  const m = rotationMatrix(rotation), dx = local.x*sx, dy = local.y*sy;
  const nextCenter = {x:anchor.x+m.a*dx+m.c*dy,y:anchor.y+m.b*dx+m.d*dy};
  const width=box.width*sx,height=box.height*sy;
  if (!finite(sx,sy,nextCenter.x,nextCenter.y,width,height)) return null;
  return {scaleX:sx,scaleY:sy,translateX:nextCenter.x-center.x,translateY:nextCenter.y-center.y,anchor,
    newBounds:{...box,x:nextCenter.x-width/2,y:nextCenter.y-height/2,width,height}};
}
export function mapResizedPoint(box: TransformBox, result: ResizeResult, world: Point): Point | null {
  const rotation=rotationOf(box), local=unprojectVector(world.x-result.anchor.x,world.y-result.anchor.y,rotation);
  if(!local)return null;
  const m=rotationMatrix(rotation),x=local.x*result.scaleX,y=local.y*result.scaleY;
  const point={x:result.anchor.x+m.a*x+m.c*y,y:result.anchor.y+m.b*x+m.d*y};
  return finite(point.x,point.y)?point:null;
}
export function rotateDelta(start: Point, current: Point, pivot: Point, baseAngle=0): number | null {
  if (!finite(start.x,start.y,current.x,current.y,pivot.x,pivot.y,baseAngle) || Math.hypot(start.x-pivot.x,start.y-pivot.y)<1e-9 || Math.hypot(current.x-pivot.x,current.y-pivot.y)<1e-9) return null;
  const delta=(Math.atan2(current.y-pivot.y,current.x-pivot.x)-Math.atan2(start.y-pivot.y,start.x-pivot.x))*180/Math.PI;
  const value=((baseAngle-delta)%360+360)%360;
  return value>180?value-360:value;
}
