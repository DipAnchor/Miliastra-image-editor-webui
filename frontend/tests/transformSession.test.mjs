import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";
const modules=new Map();
function moduleUrl(name){
 if(modules.has(name))return modules.get(name);
 const source=readFileSync(new URL('../src/'+name+'.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const rewritten=compiled.replace(new RegExp('from "[.]/([^"]+)"','g'),(_,dependency)=>'from '+JSON.stringify(moduleUrl(dependency)));
 const url='data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64');modules.set(name,url);return url;
}
const {beginTransformSession,rebaseTransformSession,selectionTransformBox,moveTransformSession,resizeTransformSession,rotateTransformSession}=await import(moduleUrl('transformSession'));
const {pointFromBox,HANDLE_POINTS}=await import(moduleUrl('transformGeometry'));
const {rotationMatrix}=await import(moduleUrl('rotation'));
const leaf=(id,patch={})=>({id,name:id,type:'rectangle',x:100,y:80,width:80,height:60,rotation:0,color:'#ffffff',opacity:1,zIndex:0,visible:true,isBackground:false,...patch});
const document=(elements)=>({canvas:{width:500,height:400,background:'transparent'},elements,groups:[{id:'g',name:'Group',opacity:1,visible:true,parentId:null}],library:{savedItems:[]},meta:{warnings:[]}});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,actual+' != '+expected);
const near=(a,b)=>{close(a.x,b.x);close(a.y,b.y);};
const corners=e=>{
 const m=rotationMatrix(e),w=e.type==='smart-object'?e.content.frame.width*e.scale:e.width*(e.textBox?.scaleX??1),h=e.type==='smart-object'?e.content.frame.height*e.scale:e.height*(e.textBox?.scaleY??1);
 return [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>({x:e.x+m.a*x+m.c*y,y:e.y+m.b*x+m.d*y}));
};
const sameProjectedCorners=(before,after,map)=>{
 const actual=corners(after);corners(before).forEach((p,j)=>near(actual[j],map(p)));
};
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('numeric preview edits rebase the projected frame and local pivot without changing the original',()=>{
 const original=freeze(document([leaf('a',{rotation:25,rotationX:20,rotationY:-15}),leaf('other')]));
 const initial=beginTransformSession(original,['a']),local={x:0.2,y:0.7},start={...initial,pivot:pointFromBox(initial.box,local)};
 const changed={...original.elements[0],x:180,y:130,width:140,height:95,rotation:-35,rotationX:45,rotationY:10};
 const preview={...original,elements:[changed,original.elements[1]]},next=rebaseTransformSession(start,preview);
 assert.equal(next.original,original);assert.equal(next.preview,preview);assert.equal(next.ids,start.ids);
 assert.deepEqual(next.box,selectionTransformBox([changed]));near(next.pivot,pointFromBox(next.box,local));
 assert.equal(next.preview.elements[1],original.elements[1]);assert.equal(original.elements[0].width,80);
 assert.equal(rebaseTransformSession(start,original),start);
});
test('pointer resizing continues from numerically edited geometry rather than the initial frame',()=>{
 const original=freeze(document([leaf('a',{rotation:35,rotationX:20,rotationY:15})]));
 const start=beginTransformSession(original,['a']);
 const edited=rebaseTransformSession(start,{...original,elements:[{...original.elements[0],x:180,y:120,width:160,height:90}]});
 const fixed=pointFromBox(edited.box,HANDLE_POINTS.nw),handle=pointFromBox(edited.box,HANDLE_POINTS.se);
 const next=resizeTransformSession(edited,'se',{x:fixed.x+1.3*(handle.x-fixed.x),y:fixed.y+1.3*(handle.y-fixed.y)},false,false);
 close(next.preview.elements[0].width,208);close(next.preview.elements[0].height,117);near(corners(next.preview.elements[0])[0],corners(edited.preview.elements[0])[0]);
 assert.equal(next.original,original);assert.equal(original.elements[0].width,80);
});
test('numeric smart-object scale and signed text scale use their rendered frame',()=>{
 const smart={id:'o',type:'smart-object',x:100,y:80,rotation:0,scale:1,content:{frame:{width:80,height:60},elements:[],groups:[]}};
 const original=document([smart]),start=beginTransformSession(original,['o']);
 const next=rebaseTransformSession(start,{...original,elements:[{...smart,scale:2.25,rotation:-40}]});
 close(next.box.width,180);close(next.box.height,135);assert.equal(next.preview.elements[0].content,smart.content);
 assert.equal('width' in next.preview.elements[0],false);assert.equal(next.original,original);
 const text=leaf('t',{type:'textbox',textBox:{scaleX:-2,scaleY:0.5}}),scene=document([text]);
 const rebased=rebaseTransformSession(beginTransformSession(scene,['t']),{...scene,elements:[{...text,width:150,height:100}]});
 close(rebased.box.width,300);close(rebased.box.height,50);
});
test('numeric edge-on rotations remain finite and can be edited back to a usable frame',()=>{
 const original=document([leaf('a')]),start=beginTransformSession(original,['a']);
 const edge=rebaseTransformSession({...start,pivot:{x:70,y:55}},{...original,elements:[{...original.elements[0],rotationX:90}]});
 const restored=rebaseTransformSession(edge,{...original,elements:[{...original.elements[0],x:130,width:120,rotationX:0}]});
 assert.ok([edge.pivot.x,edge.pivot.y,restored.pivot.x,restored.pivot.y].every(Number.isFinite));
 close(restored.box.width,120);close(restored.box.x+restored.box.width/2,130);
 const moved=moveTransformSession(restored,10,5);close(moved.preview.elements[0].x,140);assert.equal(moved.original,original);
 assert.equal(rebaseTransformSession(start,{...original,elements:[]}),start);
 assert.equal(rebaseTransformSession(start,{...original,elements:[{...original.elements[0],width:NaN}]}),start);
});

test('a session resolves existing targets once and preserves its immutable original',()=>{
 const original=freeze(document([leaf('a'),leaf('b',{x:250})])),baseline=structuredClone(original);
 const start=beginTransformSession(original,['a','missing','a']);assert.deepEqual(start.ids,['a']);assert.equal(start.original,original);assert.equal(start.preview,original);
 const moved=moveTransformSession(start,20,-10);assert.deepEqual(original,baseline);assert.equal(moved.original,original);assert.equal(moved.preview.elements[1],original.elements[1]);
 assert.equal(beginTransformSession(original,[]),null);assert.equal(beginTransformSession(original,['missing']),null);
});
test('moving selected members clamps one common delta and moves the pivot with the visible frame',()=>{
 const start=beginTransformSession(document([leaf('a',{x:100,groupId:'g'}),leaf('b',{x:450,groupId:'g'}),leaf('c',{x:200})]),['a','b']);
 const shifted=moveTransformSession({...start,pivot:{x:25,y:30}},100,-200);
 near(shifted.preview.elements[0],{x:150,y:0});near(shifted.preview.elements[1],{x:500,y:0});near(shifted.pivot,{x:75,y:-50});
 close(shifted.box.x,start.box.x+50);close(shifted.box.y,start.box.y-80);assert.equal(shifted.preview.groups,start.preview.groups);
 assert.equal(moveTransformSession(start,0,0),start);assert.equal(moveTransformSession(start,NaN,0),start);
});
test('single projected layer resizing fixes the opposite corner without losing XY rotations',()=>{
 const element=leaf('a',{rotation:37,rotationX:25,rotationY:-20}),start=beginTransformSession(document([element]),['a']);
 const fixed=pointFromBox(start.box,HANDLE_POINTS.nw),handle=pointFromBox(start.box,HANDLE_POINTS.se);
 const next=resizeTransformSession(start,'se',{x:fixed.x+1.4*(handle.x-fixed.x),y:fixed.y+1.4*(handle.y-fixed.y)},false,true);
 const changed=next.preview.elements[0];close(changed.width,112);close(changed.height,84);near(corners(changed)[0],corners(element)[0]);
 assert.equal(changed.rotationX,25);assert.equal(changed.rotationY,-20);assert.equal(element.width,80);
});
test('text box resize respects the existing positive and negative text scale without changing text settings',()=>{
 const element=leaf('t',{type:'textbox',textBox:{scaleX:-2,scaleY:0.5,text:'Example'}}),start=beginTransformSession(document([element]),['t']);
 close(start.box.width,160);close(start.box.height,30);
 const fixed=pointFromBox(start.box,HANDLE_POINTS.nw),handle=pointFromBox(start.box,HANDLE_POINTS.se);
 const next=resizeTransformSession(start,'se',{x:fixed.x+2*(handle.x-fixed.x),y:fixed.y+2*(handle.y-fixed.y)},false,true),changed=next.preview.elements[0];
 close(changed.width,160);close(changed.height,120);assert.equal(changed.textBox,element.textBox);near(pointFromBox(selectionTransformBox([changed]),HANDLE_POINTS.nw),fixed);
});
test('a moved pivot stays fixed for center scaling, and ordinary scaling still fixes the opposite edge',()=>{
 let start=beginTransformSession(document([leaf('a')]),['a']);start={...start,pivot:{x:70,y:55}};
 const handle=pointFromBox(start.box,HANDLE_POINTS.se),pointer={x:70+2*(handle.x-70),y:55+2*(handle.y-55)};
 const centered=resizeTransformSession(start,'se',pointer,true,true);near(centered.pivot,start.pivot);close(centered.preview.elements[0].width,160);
 const fixed=pointFromBox(start.box,HANDLE_POINTS.nw),normal=resizeTransformSession(start,'se',pointer,false,true);near(pointFromBox(normal.box,HANDLE_POINTS.nw),fixed);assert.notDeepEqual(normal.pivot,start.pivot);
});
test('smart objects and mixed selections keep positive uniform scale and retain independent content',()=>{
 const content={frame:{width:80,height:60},elements:[leaf('inside')],groups:[]};
 const smart={id:'o',type:'smart-object',x:100,y:80,rotation:0,scale:1,content,opacity:1,zIndex:0,visible:true};
 const start=beginTransformSession(document([smart,leaf('a',{x:250}),leaf('other')]),['o','a']);
 const fixed=pointFromBox(start.box,HANDLE_POINTS.nw),handle=pointFromBox(start.box,HANDLE_POINTS.se);
 const next=resizeTransformSession(start,'se',{x:fixed.x+1.5*(handle.x-fixed.x),y:fixed.y+1.5*(handle.y-fixed.y)},false,false);
 close(next.preview.elements[0].scale,1.5);assert.equal(next.preview.elements[0].content,content);assert.equal('width' in next.preview.elements[0],false);
 close(next.preview.elements[1].width,120);close(next.preview.elements[1].height,90);assert.equal(next.preview.elements[2],start.preview.elements[2]);
});
for(const degrees of [-135,-40,40,90,179])test('multi-selection rotation keeps every rendered corner rigid for screen angle '+degrees,()=>{
 const original=document([leaf('a',{x:190,y:155,rotation:23,groupId:'g'}),leaf('b',{x:65,y:70,rotation:311,groupId:'g'}),leaf('other')]);
 let start=beginTransformSession(original,['a','b']);start={...start,pivot:{x:120,y:80}};
 const rad=degrees*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad),next=rotateTransformSession(start,{x:220,y:80},{x:120+100*cos,y:80+100*sin});
 for(let i=0;i<2;i++){const before=corners(original.elements[i]),after=corners(next.preview.elements[i]);before.forEach((p,j)=>near(after[j],{x:120+(p.x-120)*cos-(p.y-80)*sin,y:80+(p.x-120)*sin+(p.y-80)*cos}));}
 assert.equal(next.preview.elements[2],original.elements[2]);assert.equal(next.preview.groups,original.groups);near(next.pivot,start.pivot);
});
test('multi-selection rotation applies a rigid screen-space rotation to tilted, edge-on, and smart layers',()=>{
 const original=freeze(document([
  leaf('a',{x:190,y:155,rotation:23,rotationX:60,rotationY:37}),
  leaf('b',{x:65,y:70,rotation:311,rotationX:89.999999,rotationY:-29}),
  leaf('c',{x:110,y:200,rotation:101,rotationX:90,rotationY:75}),
  leaf('d',{x:215,y:170,rotation:10,rotationX:124,rotationY:-125}),
  {id:'o',type:'smart-object',x:250,y:120,rotation:15,scale:1.3,content:{frame:{width:50,height:30},elements:[],groups:[]}},
 ]));
 const pivot={x:70,y:116},start={...beginTransformSession(original,original.elements.map(e=>e.id)),pivot};
 for(const degrees of [-179,-90,-47,55,90,167]){
  const rad=degrees*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
  const rotate=p=>({x:pivot.x+cos*(p.x-pivot.x)-sin*(p.y-pivot.y),y:pivot.y+sin*(p.x-pivot.x)+cos*(p.y-pivot.y)});
  const next=rotateTransformSession(start,{x:pivot.x+100,y:pivot.y},rotate({x:pivot.x+100,y:pivot.y}));
  original.elements.forEach((e,i)=>{
   const changed=next.preview.elements[i];sameProjectedCorners(e,changed,rotate);
   if(e.type==='smart-object'){assert.equal(changed.scale,e.scale);assert.equal(changed.content,e.content);}
   else{assert.equal(changed.width,e.width);assert.equal(changed.height,e.height);}
  });
 }
});

test('multi-selection free resize scales projected corners in the transform box axes around an offset pivot',()=>{
 const original=freeze(document([
  leaf('a',{x:190,y:155,rotation:45}),
  leaf('b',{x:65,y:70,rotation:311,rotationX:89.99999,rotationY:-29}),
  leaf('c',{type:'textbox',x:110,y:200,rotation:101,rotationX:33,rotationY:45,textBox:{scaleX:-1.4,scaleY:0.4,text:'Signed'}}),
  leaf('d',{x:210,y:195,rotation:25,rotationX:90,rotationY:40}),
 ]));
 const initial=beginTransformSession(original,original.elements.map(e=>e.id));
 const origin=initial.pivot;
 const rotated=rotateTransformSession(initial,{x:origin.x+100,y:origin.y},{x:origin.x+50,y:origin.y+86.60254037844386});
 const pivot=pointFromBox(rotated.box,{x:0.27,y:0.64}),start={...rotated,pivot};
 const m=rotationMatrix({rotation:rotated.box.rotation});
 const resize=p=>{const x=p.x-pivot.x,y=p.y-pivot.y,u=2*(m.a*x+m.b*y),v=0.5*(m.c*x+m.d*y);return{x:pivot.x+m.a*u+m.c*v,y:pivot.y+m.b*u+m.d*v};};
 const handle=pointFromBox(start.box,HANDLE_POINTS.se),next=resizeTransformSession(start,'se',resize(handle),true,false);
 near(next.pivot,pivot);near(pointFromBox(next.box,HANDLE_POINTS.se),resize(handle));
 for(let i=0;i<original.elements.length;i++)sameProjectedCorners(start.preview.elements[i],next.preview.elements[i],resize);
 assert.equal(next.preview.elements[2].textBox,original.elements[2].textBox);
});

test('ordinary axis-aligned multi-selection resize does not create artificial tilt',()=>{
 const original=document([leaf('a',{x:190,y:155}),leaf('b',{x:65,y:70,rotation:90})]);
 const start=beginTransformSession(original,['a','b']),fixed=pointFromBox(start.box,HANDLE_POINTS.nw);
 const resize=p=>({x:fixed.x+2*(p.x-fixed.x),y:fixed.y+0.5*(p.y-fixed.y)});
 const next=resizeTransformSession(start,'se',resize(pointFromBox(start.box,HANDLE_POINTS.se)),false,false);
 original.elements.forEach((e,i)=>{
  const changed=next.preview.elements[i];sameProjectedCorners(e,changed,resize);
  assert.equal(changed.rotation,e.rotation);assert.equal(changed.rotationX,e.rotationX);assert.equal(changed.rotationY,e.rotationY);
 });
});

test('single tilted rotation keeps an off-center anchor fixed in the projected plane',()=>{
 const original=leaf('a',{rotation:20,rotationX:35,rotationY:-15}),start0=beginTransformSession(document([original]),['a']);
 const fixed=corners(original)[0],start={...start0,pivot:fixed},plane=rotationMatrix({...original,rotation:0});
 const project=(x,y)=>({x:fixed.x+plane.a*x+plane.c*y,y:fixed.y+plane.b*x+plane.d*y});
 const rotated=rotateTransformSession(start,project(100,0),project(0,100));near(corners(rotated.preview.elements[0])[0],fixed);close(rotated.preview.elements[0].rotation,290);
});
const maskFrame = element => {
 const mask = element.luaMask;
 return {
  x: element.x + (mask.offsetX ?? 0), y: element.y + (mask.offsetY ?? 0),
  rotation: mask.rotation ?? 0,
  width: mask.width ?? Math.abs(element.width * (element.textBox?.scaleX ?? 1)),
  height: mask.height ?? Math.abs(element.height * (element.textBox?.scaleY ?? 1)),
 };
};

test('numeric position and Z rotation rebase the active mask from the current preview', () => {
 const mask = {enabled:true, offsetX:7, offsetY:3, width:40, height:null, rotation:25,
  enableSoftEdge:true, softEdgeMode:'Pixel', softEdgeWidthX:2, softEdgeWidthY:4};
 const element = leaf('a', {rotation:15, luaMask:mask});
 const source = freeze(document([element, leaf('other')]));
 const start = beginTransformSession(source, ['a']);
 const moved = {...element, x:125, y:70};
 const positionPatch = freeze({...source, elements:[moved, source.elements[1]]});
 const positioned = rebaseTransformSession(start, positionPatch);
 assert.equal(positioned.preview, positionPatch);
 assert.equal(positioned.preview.elements[0].luaMask, mask);
 sameProjectedCorners(maskFrame(element), maskFrame(moved), p => ({x:p.x+25, y:p.y-10}));

 const proposal = {...moved, x:147, y:93, rotation:105};
 const edited = rebaseTransformSession(positioned, freeze({...source, elements:[proposal, source.elements[1]]}));
 const changed = edited.preview.elements[0];
 const map = p => ({x:147+(p.y-70), y:93-(p.x-125)});
 sameProjectedCorners(moved, changed, map);
 sameProjectedCorners(maskFrame(moved), maskFrame(changed), map);
 close(changed.luaMask.rotation, 115);
 close(changed.luaMask.width, 40); assert.equal(changed.luaMask.height, null);
 close(changed.luaMask.softEdgeWidthX, 2); close(changed.luaMask.softEdgeWidthY, 4);
 assert.equal(edited.original, source); assert.equal(edited.preview.elements[1], source.elements[1]);
 assert.equal(proposal.luaMask, mask);
});

test('numeric resize uses local rendered text ratios and preserves an independently rotated mask', () => {
 const element = leaf('t', {type:'textbox', textBox:{scaleX:-2, scaleY:0.5},
  luaMask:{enabled:true, offsetX:7, offsetY:3, width:null, height:null, rotation:47,
   enableSoftEdge:true, softEdgeMode:'Pixel', softEdgeWidthX:2, softEdgeWidthY:4}});
 const source = freeze(document([element])), start = beginTransformSession(source, ['t']);
 const changed = rebaseTransformSession(start, {...source, elements:[{...element, x:140, y:90, width:160, height:180}]}).preview.elements[0];
 const resize = p => ({x:140+2*(p.x-100), y:90+3*(p.y-80)});
 sameProjectedCorners(element, changed, resize);
 const frame = maskFrame(changed);
 near(frame, resize(maskFrame(element)));
 close(frame.rotation, 47); close(frame.width, 320); close(frame.height, 90);
 assert.equal(changed.luaMask.width, null); assert.equal(changed.luaMask.height, null);
 close(changed.luaMask.softEdgeWidthX, 4); close(changed.luaMask.softEdgeWidthY, 12);
 assert.equal(changed.textBox, element.textBox);
});

test('numeric edits compose the new and inverse old projection when the mask stays rectangular', () => {
 const element = leaf('a', {rotationY:60, luaMask:{enabled:true, offsetX:7, offsetY:3, width:null, height:20}});
 const source = freeze(document([element])), start = beginTransformSession(source, ['a']);
 const changed = rebaseTransformSession(start, {...source, elements:[{...element, rotationY:0, rotation:90}]}).preview.elements[0];
 const map = p => ({x:100+(p.y-80), y:80-2*(p.x-100)});
 sameProjectedCorners(element, changed, map);
 sameProjectedCorners(maskFrame(element), maskFrame(changed), map);
 close(changed.luaMask.rotation, 90); close(changed.luaMask.width, 160); close(changed.luaMask.height, 20);
});

test('numeric edits atomically preserve the current preview for sheared rotations or singular masks', () => {
 const a = leaf('a', {luaMask:{enabled:true, offsetX:3, width:25, height:10}});
 const b = leaf('b', {x:210, luaMask:{enabled:true, offsetX:7, width:40, height:20, rotation:45}});
 const source = freeze(document([a, b]));
 const start = moveTransformSession(beginTransformSession(source, ['a','b']), 5, 10);
 const [previousA, previousB] = start.preview.elements;
 for (const geometry of [{rotationY:60}, {rotationX:90}, {width:160, rotationX:90}]) {
  const proposal = freeze({...source, elements:[{...previousA, rotation:90}, {...previousB, ...geometry}]});
  assert.equal(rebaseTransformSession(start, proposal), start);
  assert.equal(proposal.elements[0].luaMask, a.luaMask);
  assert.equal(proposal.elements[1].luaMask, b.luaMask);
 }
 const edge = freeze(document([{...b, rotationX:90}])), edgeSession = beginTransformSession(edge, ['b']);
 assert.equal(rebaseTransformSession(edgeSession, {...edge, elements:[b]}), edgeSession);
 assert.equal(rebaseTransformSession(edgeSession, {...edge, elements:[{...edge.elements[0], width:160}]}), edgeSession);
});

test('single active mask translates and rotates with its layer around an off-center world pivot', () => {
 const mask = {enabled:true, imageType:'basic', offsetX:7, offsetY:3, width:40, height:null, rotation:25,
  enableSoftEdge:true, softEdgeMode:'Pixel', softEdgeWidthX:2, softEdgeWidthY:4};
 const source = freeze(document([leaf('a', {rotation:35, luaMask:mask}), leaf('other')]));
 const start = beginTransformSession(source, ['a']);
 const moved = moveTransformSession(start, 21, -100);
 const element = source.elements[0], translated = moved.preview.elements[0];
 const translate = p => ({x:p.x + 21, y:p.y - 80}); // Layer center clamps to the canvas.
 sameProjectedCorners(element, translated, translate);
 sameProjectedCorners(maskFrame(element), maskFrame(translated), translate);
 assert.equal(translated.luaMask, mask);

 const pivot = {x:95, y:52}, rotate = p => ({x:pivot.x + (p.y - pivot.y), y:pivot.y - (p.x - pivot.x)});
 const handle = {x:pivot.x + 100, y:pivot.y};
 const rotated = rotateTransformSession({...moved, pivot}, handle, rotate(handle));
 const changed = rotated.preview.elements[0], actualMask = changed.luaMask;
 sameProjectedCorners(translated, changed, rotate);
 sameProjectedCorners(maskFrame(translated), maskFrame(changed), rotate);
 near(maskFrame(changed), rotate(maskFrame(translated)));
 near({x:actualMask.offsetX, y:actualMask.offsetY}, {x:3, y:-7});
 close(actualMask.rotation, 115);
 assert.equal(actualMask.width, 40); assert.equal(actualMask.height, null);
 assert.equal(actualMask.softEdgeWidthX, 2); assert.equal(actualMask.softEdgeWidthY, 4);
 assert.equal(rotated.original, source); assert.equal(rotated.preview.elements[1], source.elements[1]);
 assert.equal(source.elements[0].luaMask, mask);
});

test('single active mask resize follows the body frame with local dimensions and fixed relative angle', () => {
 const pixelMask = {enabled:true, imageType:'basic', offsetX:10, offsetY:-6, width:null, height:24,
  enableSoftEdge:true, softEdgeMode:'Pixel', softEdgeWidthX:2, softEdgeWidthY:4};
 for (const [angle, scaleX, scaleY] of [[65, 2, 2], [30, 2, 3], [65, 2, 3], [120, 2, 3]]) {
  const element = leaf('t', {type:'textbox', rotation:30, textBox:{scaleX:-2, scaleY:0.5}, luaMask:{...pixelMask, rotation:angle}});
  const source = freeze(document([element]));
  const start = beginTransformSession(source, ['t']), anchor = pointFromBox(start.box, HANDLE_POINTS.nw);
  close(start.box.width, 160); close(start.box.height, 30); close(start.box.rotation, element.rotation);
  const cos = Math.sqrt(3) / 2, sin = 0.5;
  const resize = p => {
   const x = p.x - anchor.x, y = p.y - anchor.y;
   const u = scaleX * (cos*x - sin*y), v = scaleY * (sin*x + cos*y);
   return {x:anchor.x + cos*u + sin*v, y:anchor.y - sin*u + cos*v};
  };
  const handle = pointFromBox(start.box, HANDLE_POINTS.se);
  const next = resizeTransformSession(start, 'se', resize(handle), false, false);
  const changed = next.preview.elements[0], actualMask = changed.luaMask;
  sameProjectedCorners(element, changed, resize);
  near(maskFrame(changed), resize(maskFrame(element)));
  close(actualMask.rotation, angle);
  assert.equal(actualMask.width, null); close(maskFrame(changed).width, 160*scaleX);
  close(actualMask.height, 24*scaleY);
  close(actualMask.softEdgeWidthX, 2*scaleX); close(actualMask.softEdgeWidthY, 4*scaleY);
  assert.equal(changed.textBox, element.textBox);
  assert.equal(next.original, source); assert.equal(element.luaMask.width, null);
 }
});

test('single layer resize keeps Percentage feather settings and skips inactive masks', () => {
 const mask = {enabled:false, enableSoftEdge:true, offsetX:4, offsetY:-6, width:23, height:17,
  softEdgeMode:'Percentage', softEdgeWidthX:2, softEdgeWidthY:4, horizontalSoftRange:75, verticalSoftRange:80};
 for (const enableSoftEdge of [true, false]) {
  const element = leaf('a', {luaMask:{...mask, enableSoftEdge}});
  const start = beginTransformSession(document([element]), ['a']);
  const anchor = pointFromBox(start.box, HANDLE_POINTS.nw), handle = pointFromBox(start.box, HANDLE_POINTS.se);
  const resize = p => ({x:anchor.x + 2*(p.x-anchor.x), y:anchor.y + 3*(p.y-anchor.y)});
  const scaled = resizeTransformSession(start, 'se', resize(handle), false, false).preview.elements[0];
  sameProjectedCorners(element, scaled, resize);
  if (enableSoftEdge) {
   sameProjectedCorners(maskFrame(element), maskFrame(scaled), resize);
   for (const field of ['softEdgeWidthX','softEdgeWidthY','horizontalSoftRange','verticalSoftRange']) {
    assert.equal(scaled.luaMask[field], mask[field]);
   }
  } else {
   assert.equal(scaled.luaMask, element.luaMask);
   const p = start.pivot;
   assert.equal(rotateTransformSession(start, {x:p.x+50, y:p.y}, {x:p.x, y:p.y+50}).preview.elements[0].luaMask, element.luaMask);
  }
 }
});

test('tilted body resize moves only the mask center through the tilted projection', () => {
 const element = leaf('a', {rotation:30, rotationX:35, rotationY:-15,
  luaMask:{enabled:true, imageType:'basic', offsetX:7, offsetY:3, width:40, height:20, rotation:30}});
 const source = freeze(document([element])), start = beginTransformSession(source, ['a']);
 const pivot = pointFromBox(start.box, HANDLE_POINTS.nw), plane = rotationMatrix(element);
 const project = (x, y) => ({x:pivot.x + plane.a*x + plane.c*y, y:pivot.y + plane.b*x + plane.d*y});
 const next = resizeTransformSession(start, 'se', project(2*element.width, 0.5*element.height), false, false);
 const changed = next.preview.elements[0], frame = maskFrame(changed);
 near(corners(changed)[0], pivot);
 near(corners(changed)[2], project(2*element.width, 0.5*element.height));
 const det = plane.a*plane.d - plane.b*plane.c;
 const u = (plane.d*7 - plane.c*3)/det, v = (plane.a*3 - plane.b*7)/det;
 near(frame, project(2*(element.width/2 + u), 0.5*(element.height/2 + v)));
 close(frame.width, 80); close(frame.height, 10); close(frame.rotation, 30);

 const rotationPlane = rotationMatrix({...element, rotation:0});
 const projectRotation = (x,y) => ({x:pivot.x + rotationPlane.a*x + rotationPlane.c*y,
  y:pivot.y + rotationPlane.b*x + rotationPlane.d*y});
 const tilted = {...start, pivot};
 assert.equal(rotateTransformSession(tilted, projectRotation(100,0), projectRotation(50,50)), tilted);
});

test('single tilted mask follows exactly representable projected transforms', () => {
 const element = leaf('a', {rotationY:60, luaMask:{enabled:true, offsetX:7, offsetY:3, width:null, height:20,
  enableSoftEdge:true, softEdgeMode:'Pixel', softEdgeWidthX:2, softEdgeWidthY:4}});
 const source = freeze(document([element])), start = beginTransformSession(source, ['a']);
 const pivot = pointFromBox(start.box, HANDLE_POINTS.nw), handle = pointFromBox(start.box, HANDLE_POINTS.se);
 const scale = p => ({x:pivot.x+2*(p.x-pivot.x), y:pivot.y+2*(p.y-pivot.y)});
 const resized = resizeTransformSession(start, 'se', scale(handle), false, true).preview.elements[0];
 sameProjectedCorners(element, resized, scale);
 sameProjectedCorners(maskFrame(element), maskFrame(resized), scale);
 assert.equal(resized.luaMask.width, null);
 close(resized.luaMask.height, 40);

 // A 90-degree turn in this projection maps the old X and Y axes to scaled Y and X axes.
 const rotate = p => ({x:pivot.x+(p.y-pivot.y)/2, y:pivot.y-2*(p.x-pivot.x)});
 const pointer = {x:pivot.x+50, y:pivot.y};
 const rotated = rotateTransformSession({...start, pivot}, pointer, rotate(pointer));
 const changed = rotated.preview.elements[0];
 sameProjectedCorners(element, changed, rotate);
 sameProjectedCorners(maskFrame(element), maskFrame(changed), rotate);
 close(changed.luaMask.rotation, 90);
 close(changed.luaMask.width, 160); close(changed.luaMask.height, 10);
 close(changed.luaMask.softEdgeWidthX, 4); close(changed.luaMask.softEdgeWidthY, 2);
 assert.equal(changed.rotationY, 60); assert.equal(rotated.original.elements, source.elements);
});

test('multi-selection masks follow world rotation and scale', () => {
 const mask={enabled:true,imageType:'basic',offsetX:7,offsetY:3,width:40,height:20,rotation:25,softEdgeMode:'Pixel',softEdgeWidthX:2};
 const source=freeze(document([leaf('a',{luaMask:mask,groupId:'g'}),leaf('b',{x:220,groupId:'g'})]));
 const group=beginTransformSession(source,['a','b']);
 const p=group.pivot;
 const rotated=rotateTransformSession(group,{x:p.x+100,y:p.y},{x:p.x,y:p.y-100});
 const got=rotated.preview.elements[0].luaMask;
 close(got.offsetX,3); close(got.offsetY,-7); close(got.rotation,115);
 assert.equal(got.width,40); assert.equal(got.height,20);
 assert.equal(rotated.original,source);
 const anchor=pointFromBox(group.box,HANDLE_POINTS.nw), corner=pointFromBox(group.box,HANDLE_POINTS.se);
 const stretch=(x,y)=>({x:anchor.x+x*(corner.x-anchor.x),y:anchor.y+y*(corner.y-anchor.y)});
 const scaled=resizeTransformSession(group,'se',stretch(2,2),false,false).preview.elements[0].luaMask;
 close(scaled.offsetX,14); close(scaled.offsetY,6); close(scaled.rotation,25);
 close(scaled.width,80); close(scaled.height,40); close(scaled.softEdgeWidthX,4);
 const stretched=resizeTransformSession(group,'se',stretch(2,1),false,false).preview.elements[0].luaMask;
 close(stretched.offsetX,14); close(stretched.offsetY,3); close(stretched.rotation,25);
 close(stretched.width,80); close(stretched.height,20); close(stretched.softEdgeWidthX,4);
 assert.equal(source.elements[0].luaMask,mask);
});

test('group resize uses rendered text dimensions for inherited mask sizes', () => {
 const source=document([leaf('a',{type:'textbox',textBox:{scaleX:2,scaleY:0.5},
  luaMask:{enabled:true,imageType:'basic',width:null,height:null,rotation:90}}),leaf('b',{x:450})]);
 const group=beginTransformSession(source,['a','b']);
 const anchor=pointFromBox(group.box,HANDLE_POINTS.nw), corner=pointFromBox(group.box,HANDLE_POINTS.se);
 const stretch=(x,y)=>({x:anchor.x+x*(corner.x-anchor.x),y:anchor.y+y*(corner.y-anchor.y)});
 const uniform=resizeTransformSession(group,'se',stretch(2,2),false,false).preview.elements[0].luaMask;
 assert.equal(uniform.width,null); assert.equal(uniform.height,null);
 const anisotropic=resizeTransformSession(group,'se',stretch(2,3),false,false).preview.elements[0].luaMask;
 assert.equal(anisotropic.width,null); assert.equal(anisotropic.height,null); close(anisotropic.rotation,90);
});

test('nonuniform group resize follows the reprojected body dimensions and keeps the relative Z angle', () => {
 const element = leaf('a', {rotation:35, luaMask:{enabled:true, offsetX:7, offsetY:3, width:40, height:20, rotation:60}});
 const source = freeze(document([element, leaf('b',{x:240})]));
 const start = beginTransformSession(source, ['a','b']);
 const anchor = pointFromBox(start.box, HANDLE_POINTS.nw);
 const stretch = p => ({x:anchor.x+2*(p.x-anchor.x), y:anchor.y+0.5*(p.y-anchor.y)});
 const next = resizeTransformSession(start, 'se', stretch(pointFromBox(start.box, HANDLE_POINTS.se)), false, false);
 const changed = next.preview.elements[0], frame = maskFrame(changed);
 sameProjectedCorners(element, changed, stretch);
 assert.notEqual(changed.rotation, element.rotation);
 near(frame, stretch(maskFrame(element)));
 close(frame.width, 40 * changed.width / element.width);
 close(frame.height, 20 * changed.height / element.height);
 close((frame.rotation - changed.rotation + 360) % 360, 25);
});

test('nonuniform group resize retains atomic protection for an edge-on masked member', () => {
 const edge = leaf('b', {x:220, rotationX:90, luaMask:{enabled:true, offsetX:7, width:40, height:20, rotation:45}});
 const source = freeze(document([leaf('a'), edge]));
 const start = beginTransformSession(source, ['a','b']);
 const anchor = pointFromBox(start.box, HANDLE_POINTS.nw), corner = pointFromBox(start.box, HANDLE_POINTS.se);
 const stretch = (sx, sy) => ({x:anchor.x+sx*(corner.x-anchor.x), y:anchor.y+sy*(corner.y-anchor.y)});
 assert.equal(resizeTransformSession(start, 'se', stretch(2, 1), false, false), start);
 const uniform = resizeTransformSession(start, 'se', stretch(2, 2), false, false);
 close(uniform.preview.elements[1].luaMask.width, 80);
 close(uniform.preview.elements[1].luaMask.height, 40);
});

test('angle snapping uses the absolute scene angle and invalid projections are atomic no-ops',()=>{
 const start=beginTransformSession(document([leaf('a',{rotation:10})]),['a']),p=start.pivot,rad=-15*Math.PI/180;
 const next=rotateTransformSession(start,{x:p.x+100,y:p.y},{x:p.x+100*Math.cos(rad),y:p.y+100*Math.sin(rad)},30);close(next.preview.elements[0].rotation,30);
 const singular=beginTransformSession(document([leaf('a',{rotationX:90})]),['a']);
 assert.equal(resizeTransformSession(singular,'se',{x:200,y:200},false,false),singular);assert.equal(rotateTransformSession(singular,{x:200,y:80},{x:100,y:180}),singular);
 assert.equal(rotateTransformSession(start,p,{x:200,y:80}),start);
});
