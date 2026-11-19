import type { SceneDocument, SceneElement } from "./App";
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
  const targets = preview.elements.filter(element => session.ids.includes(element.id));
  const box = selectionTransformBox(targets);
  if (!box || targets.length !== session.ids.length ||
      ![box.x, box.y, box.width, box.height, box.rotation ?? 0, box.rotationX ?? 0, box.rotationY ?? 0].every(Number.isFinite) ||
      box.width <= 0 || box.height <= 0) return session;
  const localPivot = normalizedPoint(session.box, session.pivot);
  const pivot = localPivot ? pointFromBox(box, localPivot) : {
    x: session.pivot.x + box.x + box.width / 2 - session.box.x - session.box.width / 2,
    y: session.pivot.y + box.y + box.height / 2 - session.box.y - session.box.height / 2,
  };
  return { ...session, preview, box, pivot };
}
export function moveTransformSession(session:TransformSession,dx:number,dy:number):TransformSession {
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return session;
  const elements=translateSelection(session.preview.elements,session.ids,dx,dy,session.preview.canvas);
  if(elements===session.preview.elements)return session;
  const first=session.ids[0],a=session.preview.elements.find(e=>e.id===first)!,b=elements.find(e=>e.id===first)!;
  dx=b.x-a.x;dy=b.y-a.y;
  return {...session,preview:{...session.preview,elements},box:{...session.box,x:session.box.x+dx,y:session.box.y+dy},pivot:{x:session.pivot.x+dx,y:session.pivot.y+dy}};
}
export function resizeTransformSession(session:TransformSession,handle:HandleDirection,pointer:Point,centerAnchored:boolean,keepAspect:boolean):TransformSession {
  const chosen=new Set(session.ids), targets=session.preview.elements.filter(e=>chosen.has(e.id));
  const result=resizeTransform(session.box,handle,pointer,{centerAnchored,pivot:session.pivot,keepAspect:keepAspect||targets.some(e=>e.type==='smart-object')});
  if(!result)return session;
  const nonUniformGroup = targets.length > 1 && result.scaleX !== result.scaleY;
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
    elements.push({ ...e, ...projection.rotation, ...center, width, height });
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
  const orbit=(point:Point):Point=>{
    const p=unprojectVector(point.x-session.pivot.x,point.y-session.pivot.y,plane)!;
    const x=p.x*cos-p.y*sin,y=p.x*sin+p.y*cos;
    return{x:session.pivot.x+m.a*x+m.c*y,y:session.pivot.y+m.b*x+m.d*y};
  };
  const chosen = new Set(session.ids), elements = session.preview.elements.map(e => {
    if (!chosen.has(e.id)) return e;
    const rotation = single || e.type === "smart-object"
      ? { rotation: normalized(e.rotation + degrees) }
      : rotateProjectedLayer(e, degrees);
    return { ...e, ...rotation, ...orbit(e) };
  });
  const center=orbit({x:session.box.x+session.box.width/2,y:session.box.y+session.box.height/2});
  return {...session,preview:{...session.preview,elements},box:{...session.box,x:center.x-session.box.width/2,y:center.y-session.box.height/2,rotation:normalized((session.box.rotation??0)+degrees)}};
}
