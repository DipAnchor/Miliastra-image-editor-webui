import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = name => ts.transpileModule(readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const rotation = url(compile('rotation'));
const selection = url(compile('editorSelection').replace('"./rotation"', JSON.stringify(rotation)).replace('"./sceneLayer"', JSON.stringify(url(compile('sceneLayer')))));
const mask = url(compile('luaMask'));
const objects = url(compile('smartObjects').replace('"./rotation"', JSON.stringify(rotation)).replace('"./editorSelection"', JSON.stringify(selection)).replace('"./luaMask"', JSON.stringify(mask)));
const { packGroup } = await import(objects);
const { selectionBounds } = await import(selection);
const { rotationMatrix } = await import(rotation);
const { startObjectSession, changeObjectDraft, undoObjectDraft, redoObjectDraft, objectSessionDirty, applyObjectSession, finishObjectSession, discardObjectSession, rebaseObjectContent } = await import(url(compile('smartObjectSession').replace('"./smartObjects"', JSON.stringify(objects)).replace('"./editorSelection"', JSON.stringify(selection)).replace('"./rotation"', JSON.stringify(rotation))));
const fixture = () => ({
  ...packGroup({elements:[{id:'a',name:'A',type:'rectangle',x:50,y:30,width:20,height:10,rotation:0,color:'#ffffff',opacity:1,zIndex:0,isBackground:false,groupId:'g'}],groups:[{id:'g',name:'Group',parentId:null,opacity:.5,visible:true,collapsed:false,order:0}]}, 'g', 'obj'),
  width: 800, height: 600, background: '#123456', library: [{id:'library-item'}]
});
const change = (session, x) => { const content=structuredClone(session.draft); content.elements[0].x=x; return changeObjectDraft(session,content); };
const near = (actual, expected) => assert.ok(Math.abs(actual-expected) <= 1e-8*Math.max(1,Math.abs(expected)), actual+' != '+expected);
const worldPoint = (object, point, frame=object.content.frame) => {
  const {a,b,c,d}=rotationMatrix(object), x=point.x-frame.width/2, y=point.y-frame.height/2;
  return {x:object.x+object.scale*(a*x+c*y),y:object.y+object.scale*(b*x+d*y)};
};
const worldCorners = (object, content=object.content) => content.elements.map(element => {
  const {a,b,c,d}=rotationMatrix(element);
  const w=element.width*Math.abs(element.type==='textbox' ? element.textBox?.scaleX??1 : 1)/2;
  const h=element.height*Math.abs(element.type==='textbox' ? element.textBox?.scaleY??1 : 1)/2;
  return [[-w,-h],[w,-h],[w,h],[-w,h]].map(([x,y])=>worldPoint(object,{x:element.x+a*x+c*y,y:element.y+b*x+d*y},content.frame));
});
const sameCorners = (actual,expected) => {
  assert.equal(actual.length,expected.length);
  actual.forEach((corners,i)=>corners.forEach((point,j)=>{near(point.x,expected[i][j].x);near(point.y,expected[i][j].y);}));
};

test('opening and local edits never alias or mutate the main document or saved baseline', () => {
  const scene=fixture(), before=structuredClone(scene);
  let session=startObjectSession(scene,'obj');
  assert.equal(objectSessionDirty(session),false);
  session=change(session,200);
  assert.deepEqual(scene,before); assert.equal(objectSessionDirty(session),true);
  session.draft.elements[0].color='#000000';
  assert.equal(session.saved.elements[0].color,'#ffffff');
  assert.equal(scene.elements[0].content.elements[0].color,'#ffffff');
});

test('save commits content once and stays open; unchanged save and finish add no main history', () => {
  let scene=fixture(), session=startObjectSession(scene,'obj'), commits=0;
  const original=structuredClone(scene), mainHistory=[];
  session=change(change(session,70),90);
  const saved=applyObjectSession(scene,session);
  if(saved.changed){mainHistory.push(scene);commits++;} scene=saved.scene;session=saved.session;
  assert.equal(commits,1); assert.equal(session.objectId,'obj');assert.equal(objectSessionDirty(session),false);
  assert.equal(scene.elements[0].content.elements[0].x,10);
  near(scene.elements[0].x,130);assert.deepEqual(scene.library,original.library);
  assert.equal(scene.background,original.background);assert.equal(scene.width,original.width);
  const noChange=applyObjectSession(scene,session);assert.equal(noChange.changed,false);assert.equal(noChange.scene,scene);
  const finished=finishObjectSession(scene,session);assert.equal(finished.changed,false);assert.equal(finished.session,null);
  assert.deepEqual(mainHistory[0],original);
});

test('finish applies only post-save changes as one additional main commit', () => {
  const scene=fixture(), first=applyObjectSession(scene,change(startObjectSession(scene,'obj'),60));
  const finished=finishObjectSession(first.scene,change(change(first.session,70),80));
  assert.equal(first.changed,true);assert.equal(finished.changed,true);assert.equal(finished.session,null);
  assert.equal(first.scene.elements[0].content.elements[0].x,10);near(first.scene.elements[0].x,100);
  assert.equal(finished.scene.elements[0].content.elements[0].x,10);near(finished.scene.elements[0].x,170);
});

test('discard before saving changes nothing, and after saving preserves the last applied content', () => {
  const scene=fixture(), session=change(startObjectSession(scene,'obj'),60);
  const cancelled=discardObjectSession(scene);assert.equal(cancelled.scene,scene);assert.equal(cancelled.changed,false);
  const saved=applyObjectSession(scene,session), later=change(saved.session,90);
  assert.equal(objectSessionDirty(later),true);
  const discarded=discardObjectSession(saved.scene);
  assert.equal(discarded.scene,saved.scene);assert.equal(discarded.session,null);
  assert.equal(discarded.scene.elements[0].content.elements[0].x,10);near(discarded.scene.elements[0].x,100);
});

test('local undo and redo remain independent across saves and compare against last saved content', () => {
  const scene=fixture(), opened=startObjectSession(scene,'obj'), local=change(change(opened,60),70);
  const saved=applyObjectSession(scene,local);
  const undone=undoObjectDraft(saved.session);
  assert.equal(undone.draft.elements[0].x,0);assert.equal(objectSessionDirty(undone),true);
  assert.equal(saved.scene.elements[0].content.elements[0].x,10);
  const redone=redoObjectDraft(undone);assert.equal(redone.draft.elements[0].x,10);assert.equal(objectSessionDirty(redone),false);
  const branch=change(undone,100);assert.equal(branch.future.length,0);
  assert.equal(undoObjectDraft(opened),opened);assert.equal(redoObjectDraft(opened),opened);
});

test('no-op edits ignore property insertion order and preserve local redo history', () => {
  const scene=fixture(), session=undoObjectDraft(change(startObjectSession(scene,'obj'),60));
  const reordered={groups:structuredClone(session.draft.groups),elements:structuredClone(session.draft.elements),frame:{height:session.draft.frame.height,width:session.draft.frame.width}};
  assert.equal(changeObjectDraft(session,reordered),session);assert.equal(session.future.length,1);
  assert.equal(objectSessionDirty(session),false);
});

test('save preserves current outer changes but refuses deleted targets and independently changed content atomically', () => {
  const scene=fixture(), session=change(startObjectSession(scene,'obj'),60);
  const moved={...scene,background:'#abcdef',elements:[{...scene.elements[0],x:400,rotation:30,scale:2}]};
  const applied=applyObjectSession(moved,session);
  near(applied.scene.elements[0].x,400+100*Math.cos(Math.PI/6));near(applied.scene.elements[0].y,-20);assert.equal(applied.scene.elements[0].rotation,30);
  sameCorners(worldCorners(applied.scene.elements[0]),worldCorners(moved.elements[0],session.draft));
  assert.equal(applied.scene.elements[0].scale,2);assert.equal(applied.scene.background,'#abcdef');
  assert.throws(()=>applyObjectSession({...scene,elements:[]},session),/no longer exists/);
  const conflict=structuredClone(scene);conflict.elements[0].content.elements[0].x=999;
  const before=structuredClone(conflict);assert.throws(()=>applyObjectSession(conflict,session),/outside the current editing session/);
  assert.deepEqual(conflict,before);
});

test('fixed frame and invalid drafts cannot be applied, including through a tampered session', () => {
  const scene=fixture(), session=startObjectSession(scene,'obj'), before=structuredClone(scene);
  for(const mutate of [c=>c.frame.width++,c=>c.elements[0].groupId='missing',c=>c.elements[0].type='smart-object',c=>c.elements[0].width=Infinity]){
    const invalid=structuredClone(session.draft);mutate(invalid);
    assert.throws(()=>changeObjectDraft(session,invalid));
    assert.throws(()=>applyObjectSession(scene,{...session,draft:invalid}));
  }
  assert.deepEqual(scene,before);
});

test('local history is bounded and does not share mutable snapshots with caller content', () => {
  const scene=fixture();let session=startObjectSession(scene,'obj');
  for(let i=0;i<110;i++)session=change(session,100+i);
  assert.equal(session.past.length,100);
  const draft=structuredClone(session.draft), updated=changeObjectDraft(session,{...draft,elements:draft.elements.map(e=>({...e,x:999}))});
  draft.elements[0].x=-1;assert.equal(updated.draft.elements[0].x,999);
  assert.equal(updated.past.at(-1).elements[0].x,209);
});

test('changed save fits shifted, expanded and contracted bounds without changing world corners', () => {
  for(const rotation of [0,37,90,-135])for(const scale of [.3,1,2.75])for(const width of [7,140]){
    const scene=fixture();Object.assign(scene.elements[0],{x:321,y:-57,rotation,scale});
    let session=startObjectSession(scene,'obj');
    const content=structuredClone(session.draft);Object.assign(content.elements[0],{x:-81,y:129,width,height:3});
    session=changeObjectDraft(session,content);
    assert.deepEqual(session.draft.frame,{width:20,height:10});
    const beforeScene=structuredClone(scene),beforeSession=structuredClone(session),expected=worldCorners(scene.elements[0],content);
    const applied=applyObjectSession(scene,session),object=applied.scene.elements[0];
    assert.deepEqual(object.content.frame,{width,height:3});
    assert.deepEqual(applied.rebase,{x:width/2+81,y:1.5-129});
    assert.equal(object.rotation,rotation);assert.equal(object.scale,scale);
    sameCorners(worldCorners(object),expected);
    assert.deepEqual(scene,beforeScene);assert.deepEqual(session,beforeSession);
    assert.equal(objectSessionDirty(applied.session),false);
    assert.notEqual(applied.session.draft,object.content);assert.notEqual(applied.session.saved,applied.session.draft);
  }
});

test('bounds include hidden and locked leaves even inside hidden groups', () => {
  const scene=fixture(),opened=startObjectSession(scene,'obj'),content=structuredClone(opened.draft);
  content.groups[0].visible=false;content.groups[0].locked=true;
  content.elements.push({...structuredClone(content.elements[0]),id:'hidden',x:-40,y:50,width:10,height:12,visible:false,locked:true});
  content.elements.push({...structuredClone(content.elements[0]),id:'locked',x:95,y:-20,width:6,height:8,locked:true});
  const session=changeObjectDraft(opened,content),bounds=selectionBounds(content.elements),applied=applyObjectSession(scene,session);
  assert.deepEqual(applied.scene.elements[0].content.frame,{width:bounds.width,height:bounds.height});
  sameCorners(worldCorners(applied.scene.elements[0]),worldCorners(scene.elements[0],content));
  assert.equal(applied.session.draft.elements[1].visible,false);assert.equal(applied.session.draft.elements[2].locked,true);
  assert.deepEqual(applied.session.draft.groups,content.groups);
});

test('text scale and mixed XY rotation use projected selection bounds on save', () => {
  const scene=fixture();Object.assign(scene.elements[0],{rotation:61,scale:1.7});
  const opened=startObjectSession(scene,'obj'),content=structuredClone(opened.draft);
  Object.assign(content.elements[0],{type:'textbox',x:104,y:-56,width:79,height:33,rotation:27,rotationX:43,rotationY:-32,textBox:{text:'scaled',fontSize:17,scaleX:-1.8,scaleY:.6,anchorMinX:.1,pivotY:.8}});
  const expected=worldCorners(scene.elements[0],content),bounds=selectionBounds(content.elements);
  const applied=applyObjectSession(scene,changeObjectDraft(opened,content)),object=applied.scene.elements[0];
  assert.deepEqual(object.content.frame,{width:Math.max(1,bounds.width),height:Math.max(1,bounds.height)});
  sameCorners(worldCorners(object),expected);assert.deepEqual(object.content.elements[0].textBox,content.elements[0].textBox);
});

test('edge-on and subpixel projections receive a legal centered one-pixel frame', () => {
  for(const leafPatch of [{rotationY:90},{rotationX:90},{width:.2,height:.3}]){
    const scene=fixture(),opened=startObjectSession(scene,'obj'),content=structuredClone(opened.draft);
    Object.assign(content.elements[0],{x:-12,y:40,...leafPatch});
    const bounds=selectionBounds(content.elements),expected=worldCorners(scene.elements[0],content);
    const applied=applyObjectSession(scene,changeObjectDraft(opened,content)),object=applied.scene.elements[0];
    assert.deepEqual(object.content.frame,{width:Math.max(1,bounds.width),height:Math.max(1,bounds.height)});
    assert.ok(object.content.frame.width>=1 && object.content.frame.height>=1);
    sameCorners(worldCorners(object),expected);
    near(object.content.elements[0].x,object.content.frame.width/2);near(object.content.elements[0].y,object.content.frame.height/2);
  }
});

test('empty changed content keeps frame and shell; no-op save never fits overflowing content', () => {
  const scene=fixture(),opened=startObjectSession(scene,'obj'),empty={...structuredClone(opened.draft),elements:[]};
  const applied=applyObjectSession(scene,changeObjectDraft(opened,empty));
  assert.equal(applied.changed,true);assert.deepEqual(applied.rebase,{x:0,y:0});
  assert.deepEqual(applied.session.draft.frame,opened.draft.frame);assert.deepEqual(applied.session.draft.elements,[]);
  for(const key of ['x','y','rotation','scale'])assert.equal(applied.scene.elements[0][key],scene.elements[0][key]);
  const overflowScene=fixture();Object.assign(overflowScene.elements[0].content.elements[0],{x:300,y:-90});
  const overflowSession=undoObjectDraft(change(startObjectSession(overflowScene,'obj'),400));
  const noop=applyObjectSession(overflowScene,overflowSession);
  assert.equal(noop.changed,false);assert.equal(noop.scene,overflowScene);assert.equal(noop.session,overflowSession);
  assert.deepEqual(noop.rebase,{x:0,y:0});assert.equal(noop.session.future.length,1);
});

test('every past and future snapshot is rebased with new frame and retains exact undo redo geometry', () => {
  const scene=fixture();Object.assign(scene.elements[0],{rotation:-28,scale:2.1});
  const opened=startObjectSession(scene,'obj');
  const changed=structuredClone(opened.draft);Object.assign(changed.elements[0],{x:70,y:-18,width:120,height:32});
  const middle=changeObjectDraft(opened,changed),later=change(middle,140),session=undoObjectDraft(later);
  const applied=applyObjectSession(scene,session),nextObject=applied.scene.elements[0],frame=nextObject.content.frame;
  assert.equal(applied.session.past.length,session.past.length);assert.equal(applied.session.future.length,session.future.length);
  for(const [key,snapshots] of [['past',session.past],['future',session.future]]){
    snapshots.forEach((old,index)=>{
      const rebased=applied.session[key][index];assert.deepEqual(rebased.frame,frame);
      near(rebased.elements[0].x,old.elements[0].x+applied.rebase.x);near(rebased.elements[0].y,old.elements[0].y+applied.rebase.y);
      sameCorners(worldCorners(nextObject,rebased),worldCorners(scene.elements[0],old));
    });
  }
  const undone=undoObjectDraft(applied.session);sameCorners(worldCorners(nextObject,undone.draft),worldCorners(scene.elements[0],opened.draft));
  const redone=redoObjectDraft(undone);assert.equal(objectSessionDirty(redone),false);
  const future=redoObjectDraft(redone);sameCorners(worldCorners(nextObject,future.draft),worldCorners(scene.elements[0],later.draft));
  assert.deepEqual(future.draft.frame,frame);
});

test('repeat save after undo and redo uses the last rebased frame without coordinate drift', () => {
  let scene=fixture(),session=startObjectSession(scene,'obj');
  for(let i=0;i<4;i++){
    const content=structuredClone(session.draft);Object.assign(content.elements[0],{x:content.elements[0].x+13.25,y:content.elements[0].y-7.5,width:20+i*9,height:10+i*3});
    const edited=changeObjectDraft(session,content),expected=worldCorners(scene.elements[0],content);
    const applied=applyObjectSession(scene,edited);scene=applied.scene;session=applied.session;
    sameCorners(worldCorners(scene.elements[0]),expected);
    const noop=applyObjectSession(scene,session);assert.equal(noop.changed,false);assert.equal(noop.scene,scene);assert.deepEqual(noop.rebase,{x:0,y:0});
    const undone=undoObjectDraft(session),undoExpected=worldCorners(scene.elements[0],undone.draft),undoSave=applyObjectSession(scene,undone);
    sameCorners(worldCorners(undoSave.scene.elements[0]),undoExpected);assert.equal(undoSave.session.future.length,1);
    const redone=redoObjectDraft(undoSave.session),redoExpected=worldCorners(undoSave.scene.elements[0],redone.draft),redoSave=applyObjectSession(undoSave.scene,redone);
    sameCorners(worldCorners(redoSave.scene.elements[0]),redoExpected);sameCorners(worldCorners(redoSave.scene.elements[0]),expected);
    scene=redoSave.scene;session=redoSave.session;
  }
});

test('content rebase deep-clones every field while preserving ids, hierarchy and non-coordinate properties', () => {
  const scene=fixture(),content=structuredClone(scene.elements[0].content);
  content.extra={nested:[{retain:true}]};content.frame.extra={retain:1};content.groups[0].extra={nested:[2]};
  Object.assign(content.elements[0],{layerName:'named',zIndex:17,locked:true,visible:false,rotationX:22,textBox:{text:'keep',scaleX:-2},luaMask:{nested:{value:3}},extra:{nested:[4]}});
  const before=structuredClone(content),frame={width:230,height:77,extra:{retain:5}},rebased=rebaseObjectContent(content,frame,{x:11,y:-9});
  const expected=structuredClone(content);expected.frame=structuredClone(frame);expected.elements[0].x+=11;expected.elements[0].y-=9;
  assert.deepEqual(rebased,expected);assert.deepEqual(content,before);assert.notEqual(rebased,content);assert.notEqual(rebased.frame,frame);
  rebased.groups[0].extra.nested[0]=99;rebased.elements[0].extra.nested[0]=99;rebased.extra.nested[0].retain=false;rebased.frame.extra.retain=99;
  assert.deepEqual(content,before);assert.equal(frame.extra.retain,5);
});

test('non-finite fitted geometry, shell compensation and history translation fail atomically', () => {
  const scenarios=[
    {patch:c=>Object.assign(c.elements[0],{x:1.7e308,width:1.7e308})},
    {patch:c=>{c.elements[0].textBox={scaleX:Infinity};c.elements[0].type='textbox';}},
    {shell:{x:1.7e308,scale:1e308},patch:c=>{c.elements[0].x=100;}},
    {shell:{scale:1e308},patch:c=>{c.elements[0].width=100;}},
    {patch:c=>{c.elements[0].x=-1.7e308;},history:true}
  ];
  for(const scenario of scenarios){
    const scene=fixture();Object.assign(scene.elements[0],scenario.shell??{});
    const opened=startObjectSession(scene,'obj'),content=structuredClone(opened.draft);scenario.patch(content);
    const session=changeObjectDraft(opened,content);
    if(scenario.history)session.past[0].elements[0].x=1.7e308;
    const beforeScene=structuredClone(scene),beforeSession=structuredClone(session);
    assert.throws(()=>applyObjectSession(scene,session),/finite|geometry|frame|bounds/i);
    assert.deepEqual(scene,beforeScene);assert.deepEqual(session,beforeSession);
  }
  const content=fixture().elements[0].content,before=structuredClone(content);
  assert.throws(()=>rebaseObjectContent(content,content.frame,{x:Infinity,y:0}),/finite|geometry|offset/i);
  assert.deepEqual(content,before);
});
