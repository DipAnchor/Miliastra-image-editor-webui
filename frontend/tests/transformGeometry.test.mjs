import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText;
const url=code=>"data:text/javascript;base64,"+Buffer.from(code).toString("base64");
const rotation=url(compile("../src/rotation.ts"));
const api=await import(url(compile("../src/transformGeometry.ts").replaceAll('"./rotation"',JSON.stringify(rotation))));
const {HANDLE_POINTS,pointFromBox,normalizedPoint,transformPointerRegion,resizeTransform,mapResizedPoint,rotateDelta}=api;
const box={x:10,y:20,width:100,height:80};
const near=(a,b)=>{assert.ok(Math.abs(a.x-b.x)<1e-7,JSON.stringify({a,b}));assert.ok(Math.abs(a.y-b.y)<1e-7,JSON.stringify({a,b}));};
for(const handle of Object.keys(HANDLE_POINTS))test('opposite point stays fixed for '+handle,()=>{
 const h=HANDLE_POINTS[handle],anchor=pointFromBox(box,{x:1-h.x,y:1-h.y}),start=pointFromBox(box,h);
 const result=resizeTransform(box,handle,{x:anchor.x+(start.x-anchor.x)*1.5,y:anchor.y+(start.y-anchor.y)*1.5},{centerAnchored:false,keepAspect:false});
 assert.ok(result);near(mapResizedPoint(box,result,anchor),anchor);
 assert.equal(result.scaleX,h.x===0.5?1:1.5);assert.equal(result.scaleY,h.y===0.5?1:1.5);
});
test('off-center pivot is fixed only for center scaling',()=>{
 const pivot={x:30,y:40},start=pointFromBox(box,HANDLE_POINTS.se),pointer={x:pivot.x+2*(start.x-pivot.x),y:pivot.y+2*(start.y-pivot.y)};
 const r=resizeTransform(box,'se',pointer,{centerAnchored:true,pivot,keepAspect:true});assert.ok(r);assert.equal(r.scaleX,2);near(mapResizedPoint(box,r,pivot),pivot);
 const regular=resizeTransform(box,'se',pointer,{centerAnchored:false,pivot,keepAspect:false});assert.notDeepEqual(regular.anchor,pivot);
});
test('projected XY/Z boxes preserve opposite corners and invert normalized points',()=>{
 const b={...box,rotation:37,rotationX:20,rotationY:-25},h=HANDLE_POINTS.nw,anchor=pointFromBox(b,HANDLE_POINTS.se),start=pointFromBox(b,h);
 const r=resizeTransform(b,'nw',{x:anchor.x+0.6*(start.x-anchor.x),y:anchor.y+0.6*(start.y-anchor.y)},{centerAnchored:false,keepAspect:true});
 assert.ok(r);near(mapResizedPoint(b,r,anchor),anchor);assert.ok(Math.abs(r.scaleX-0.6)<1e-7);near(normalizedPoint(b,start),h);
});
test('edge aspect lock scales both dimensions around opposite midpoint',()=>{
 const r=resizeTransform(box,'e',{x:210,y:60},{centerAnchored:false,keepAspect:true});assert.equal(r.scaleX,2);assert.equal(r.scaleY,2);near(pointFromBox(r.newBounds,HANDLE_POINTS.w),pointFromBox(box,HANDLE_POINTS.w));
});
test('crossing the anchor clamps to minimum without mirroring',()=>{
 const r=resizeTransform(box,'se',{x:-100,y:-100},{centerAnchored:false,keepAspect:false,minSize:2});assert.equal(r.newBounds.width,2);assert.equal(r.newBounds.height,2);
});
test('corner ratio lock permits shrink and preserves ratio',()=>{
 const r=resizeTransform(box,'se',{x:60,y:60},{centerAnchored:false,keepAspect:true});assert.equal(r.scaleX,0.5);assert.equal(r.scaleY,0.5);
});
test('non-finite, zero-sized and singular projections return null',()=>{
 for(const patch of [{width:0},{height:-1},{x:NaN},{rotation:Infinity},{rotationX:90}])assert.equal(resizeTransform({...box,...patch},'se',{x:100,y:100},{centerAnchored:false,keepAspect:false}),null);
 assert.equal(resizeTransform(box,'se',{x:Infinity,y:0},{centerAnchored:false,keepAspect:false}),null);
 assert.equal(resizeTransform(box,'se',{x:0,y:0},{centerAnchored:true,keepAspect:false,pivot:pointFromBox(box,HANDLE_POINTS.se)}),null);
});
test('screen-clockwise drag produces negative scene Z and wraps angles',()=>{
 assert.equal(rotateDelta({x:1,y:0},{x:0,y:1},{x:0,y:0}),-90);
 assert.equal(rotateDelta({x:-1,y:0},{x:0,y:-1},{x:0,y:0},170),80);
 assert.equal(rotateDelta({x:0,y:0},{x:1,y:0},{x:0,y:0}),null);
 assert.equal(rotateDelta({x:NaN,y:0},{x:1,y:0},{x:0,y:0}),null);
});
test('rotation hit region is a twenty-percent band outside all projected edges',()=>{
 for(const projection of [{},{rotation:45},{rotation:137,rotationX:28,rotationY:-31}]){
  const frame={...box,...projection};
  for(const p of [{x:0,y:0},{x:1,y:1},{x:0.5,y:0.5}])assert.equal(transformPointerRegion(frame,pointFromBox(frame,p)),"move");
  for(const p of [{x:-0.15,y:0.5},{x:1.15,y:0.5},{x:0.5,y:-0.15},{x:0.5,y:1.15},{x:-0.2,y:0.5},{x:1.2,y:0.5},{x:0.5,y:-0.2},{x:0.5,y:1.2},{x:-0.2,y:-0.2},{x:1.2,y:-0.2},{x:-0.2,y:1.2},{x:1.2,y:1.2}])assert.equal(transformPointerRegion(frame,pointFromBox(frame,p)),"rotate");
  for(const p of [{x:-0.201,y:0.5},{x:1.201,y:0.5},{x:0.5,y:-0.201},{x:0.5,y:1.201}])assert.equal(transformPointerRegion(frame,pointFromBox(frame,p)),null);
 }
});
test('rotation hit region scales with frame size and rejects unusable geometry',()=>{
 for(const scale of [0.25,1,4]){
  const frame={...box,width:box.width*scale,height:box.height*scale};
  assert.equal(transformPointerRegion(frame,pointFromBox(frame,{x:1.19,y:0.5})),"rotate");
  assert.equal(transformPointerRegion(frame,pointFromBox(frame,{x:1.21,y:0.5})),null);
 }
 for(const patch of [{width:0},{height:-1},{rotationX:90}])assert.equal(transformPointerRegion({...box,...patch},{x:0,y:0}),null);
 assert.equal(transformPointerRegion(box,{x:NaN,y:0}),null);
});
