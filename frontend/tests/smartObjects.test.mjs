import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const url = source => `data:text/javascript;base64,` + Buffer.from(source).toString('base64');
const compile = name => ts.transpileModule(readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const rotationSource = compile('rotation');
const rotationUrl = url(rotationSource);
const { rotationMatrix } = await import(rotationUrl);
const selectionUrl = url(compile('editorSelection').replace('"./rotation"', JSON.stringify(rotationUrl)).replace('"./sceneLayer"', JSON.stringify(url(compile('sceneLayer')))));
const maskUrl = url(compile('luaMask'));
const smartObjectsUrl = url(compile('smartObjects').replace('"./rotation"', JSON.stringify(rotationUrl)).replace('"./editorSelection"', JSON.stringify(selectionUrl)).replace('"./luaMask"', JSON.stringify(maskUrl)));
const { packGroup, releaseObject, cloneObject, objectSize, validateSmartObject } = await import(smartObjectsUrl);
const el = (id, zIndex, extra = {}) => ({ id, name: id, type: 'rectangle', x: 40, y: 30, width: 20, height: 10, rotation: 0, color: '#ffffff', opacity: 1, zIndex, isBackground: false, ...extra });
const group = (id, parentId = null, extra = {}) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order: 0, ...extra });
const fixture = () => ({ elements: [el('before', 0), el('a', 1, { groupId: 'g', visible: false, locked: true }), el('b', 2, { groupId: 'sub', x: 80, rotation: 30 }), el('after', 3)], groups: [group('parent'), group('g', 'parent', { opacity: .5 }), group('sub', 'g')] });
const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-8, a + ' != ' + b);
test('pack and release preserve geometry, hidden members, groups and parent without mutating source', () => {
 const input = fixture(), snapshot = structuredClone(input);
 const packed = packGroup(input, 'g', 'obj');
 assert.deepEqual(input, snapshot);
 assert.deepEqual(packed.elements.map(e => e.id), ['before', 'obj', 'after']);
 const object = packed.elements[1];
 assert.equal(object.type, 'smart-object'); assert.equal(object.groupId, 'parent');
 assert.equal(object.content.elements[0].locked, true);
 assert.equal(object.content.elements[0].visible, false);
 const released = releaseObject(packed, 'obj');
 assert.equal(released.releasedGroupId, 'g');
 assert.equal(released.groups.length, input.groups.length);
 assert.equal(released.groups.some(g => g.id === 'obj'), false);
 assert.equal(released.groups.find(g => g.id === 'g').parentId, 'parent');
 assert.equal(released.groups.find(g => g.id === 'g').opacity, .5);
 assert.equal(released.groups.find(g => g.id === 'sub').parentId, 'g');
 for (const original of input.elements) { const restored = released.elements.find(e => e.id === original.id); close(restored.x, original.x); close(restored.y, original.y); close(restored.rotation, original.rotation); }
});
test('release reuses the complete root, combines shell state once and preserves real subgroups', () => {
 for (const shellVisible of [true, false]) for (const rootVisible of [true, false])
 for (const shellLocked of [true, false]) for (const rootLocked of [true, false]) {
  const packed = packGroup(fixture(), 'g', 'obj'), object = packed.elements[1];
  Object.assign(object, {layerName:'Renamed shell', opacity:.5, visible:shellVisible, locked:shellLocked});
  Object.assign(object.content.groups[0], {opacity:.4, visible:rootVisible, locked:rootLocked, collapsed:true});
  Object.assign(object.content.groups[1], {opacity:.3, visible:false, locked:true});
  const before=structuredClone(packed), child=structuredClone(object.content.groups[1]);
  const result=releaseObject(packed,'obj'), root=result.groups.find(g=>g.id==='g');
  assert.equal(result.releasedGroupId,'g');
  assert.equal(result.groups.length,3); assert.equal(root.name,'Renamed shell');
  close(root.opacity,.2); assert.equal(root.visible,shellVisible && rootVisible);
  assert.equal(root.locked,shellLocked || rootLocked); assert.equal(root.collapsed,true);
  assert.equal(root.parentId,'parent'); assert.equal(root.order,object.zIndex);
  assert.deepEqual(result.groups.find(g=>g.id==='sub'),child);
  assert.equal(result.elements.find(e=>e.id==='a').groupId,'g');
  assert.equal(result.elements.find(e=>e.id==='b').groupId,'sub');
  assert.deepEqual(packed,before);
 }
});
test('pack and release repeatedly keep the original group depth and opacity', () => {
 let document=fixture();
 for(let i=0;i<5;i++) {
  const packed=packGroup(document,'g','object-'+i);
  document=releaseObject(packed,'object-'+i);
  assert.equal(document.releasedGroupId,'g'); assert.equal(document.groups.length,3);
  assert.equal(document.groups.find(g=>g.id==='g').parentId,'parent');
  assert.equal(document.groups.find(g=>g.id==='sub').parentId,'g');
  close(document.groups.find(g=>g.id==='g').opacity,.5);
 }
});
test('a single root with loose leaves still needs a wrapper and empty content releases safely', () => {
 const packed=packGroup(fixture(),'g','obj'), object=packed.elements[1];
 object.content.elements[0].groupId=null;
 const result=releaseObject(packed,'obj');
 assert.equal(result.releasedGroupId,'obj');
 assert.equal(result.groups.find(g=>g.id==='g').parentId,'obj');
 assert.equal(result.elements.find(e=>e.id==='a').groupId,'obj');
 object.content.elements=[];
 const emptyRoot=releaseObject(packed,'obj');
 assert.equal(emptyRoot.releasedGroupId,'g'); assert.equal(emptyRoot.groups.length,3);
 object.content.groups=[];
 const empty=releaseObject(packed,'obj');
 assert.equal(empty.releasedGroupId,'obj'); assert.equal(empty.groups.find(g=>g.id==='obj').parentId,'parent');
});
test('interleaved group cannot silently reorder unrelated layers', () => {
 const input = fixture(); input.elements[2].zIndex = 4;
 assert.throws(() => packGroup(input, 'g', 'obj'), /contiguous/);
});
test('copy remaps shell, element and group ids and shares no mutable contents', () => {
 const object = packGroup(fixture(), 'g', 'obj').elements[1]; let n = 0;
 const copy = cloneObject(object, () => 'copy-' + ++n);
 assert.notEqual(copy.id, object.id);
 assert.notEqual(copy.content.elements[0].groupId, object.content.elements[0].groupId);
 assert.equal(copy.content.groups[1].parentId, copy.content.groups[0].id);
 copy.content.elements[0].color = '#000000'; assert.equal(object.content.elements[0].color, '#ffffff');
});
test('external transform changes derived size without modifying content; release rotates centers with scene Z convention', () => {
 const packed = packGroup(fixture(), 'g', 'obj'), object = packed.elements[1];
 const source = structuredClone(object.content); object.rotation = 90; object.scale = 3;
 close(objectSize(object).width, object.content.frame.width * 3);
 const released = releaseObject(packed, 'obj');
 for (const local of source.elements) { const world = released.elements.find(e => e.id === local.id); close(world.x, object.x + 3 * (local.y - source.frame.height / 2)); close(world.y, object.y - 3 * (local.x - source.frame.width / 2)); close(world.width, local.width * 3); close(world.rotation, local.rotation + 90); }
 assert.deepEqual(object.content, source);
});
test('invalid scale, id collisions, empty group and unknown targets fail atomically', () => {
 const input = fixture(); assert.throws(() => packGroup(input, 'missing', 'obj'), /group/);
 assert.throws(() => packGroup(input, 'g', 'before'), /id/);
 assert.throws(() => packGroup({elements:[],groups:[group('empty')]}, 'empty', 'obj'), /empty/);
 const packed = packGroup(input,'g','obj'); packed.elements[1].scale = 0;
 assert.throws(() => releaseObject(packed,'obj'), /scale/);
});
test('release reports unsupported mixed-axis composition instead of losing source tilt', () => {
 const input=fixture(); input.elements[1].rotationX=30;
 const packed=packGroup(input,"g","obj"); packed.elements[1].rotation=40;
 assert.throws(() => releaseObject(packed,'obj'), /a.*mixed-axis/);
 assert.equal(packed.elements[1].content.elements[0].rotationX,30);
});

test('release inserts descendants within layer order and object parent scope', () => {
 const packed=packGroup(fixture(),'g','obj');
 const released=releaseObject(packed,'obj');
 const byZ=[...released.elements].sort((a,b)=>a.zIndex-b.zIndex);
 assert.deepEqual(byZ.map(e=>e.id),['before','a','b','after']);
 assert.equal(released.releasedGroupId,'g');
 assert.equal(released.groups.find(g=>g.id==='g').parentId,'parent');
 assert.equal(released.groups.find(g=>g.id==='sub').parentId,'g');
});

test('transform round-trips every leaf corner at varied angles and positive scales', () => {
 const corners = e => { const r=rotationMatrix(e); return [[-e.width/2,-e.height/2],[e.width/2,-e.height/2],[e.width/2,e.height/2],[-e.width/2,e.height/2]].map(([x,y])=>[e.x+r.a*x+r.c*y,e.y+r.b*x+r.d*y]); };
 for (const angle of [-135,-40,40,90,179]) for (const scale of [.25,1,3]) {
  const packed=packGroup(fixture(),'g','obj'), object=packed.elements.find(e=>e.id==='obj');
  const source=object.content.elements.map(e=>({...e})); object.rotation=angle; object.scale=scale;
  const released=releaseObject(packed,'obj');
  for (const local of source) {
   const result=released.elements.find(e=>e.id===local.id);
   const sourceCorners=corners(local), resultCorners=corners(result);
   const r=rotationMatrix({rotation:angle});
   for (let i=0;i<4;i++) {
    const x=sourceCorners[i][0]-object.content.frame.width/2;
    const y=sourceCorners[i][1]-object.content.frame.height/2;
    const worldX=object.x+scale*(r.a*x+r.c*y), worldY=object.y+scale*(r.b*x+r.d*y);
    close(resultCorners[i][0],worldX); close(resultCorners[i][1],worldY);
   }
  }
 }
});

test('source and copy release independently with distinct ids and local group links', () => {
 const packed = packGroup(fixture(), 'g', 'obj');
 const original = packed.elements[1];
 let next = 0;
 const copy = cloneObject(original, () => 'copy-' + ++next);
 assert.equal(original.content.groups.find(g => g.id === 'g').parentId, null);
 const withCopy = { ...packed, elements: [...packed.elements, { ...copy, zIndex: packed.elements.length }] };
 const released = releaseObject(releaseObject(withCopy, original.id), copy.id);
 const all = [...released.elements, ...released.groups];
 assert.equal(new Set(all.map(item => item.id)).size, all.length);
 for (const object of [original, copy]) {
  const root = object.content.groups.find(g => g.parentId === null);
  assert.equal(released.groups.some(g => g.id === object.id), false);
  assert.equal(released.groups.find(g => g.id === root.id).parentId, 'parent');
  for (const child of object.content.groups.filter(g => g.parentId !== null)) assert.equal(released.groups.find(g => g.id === child.id).parentId, child.parentId);
 }
});

test('release rejects a scoped id collision without modifying the input', () => {
 const packed = packGroup(fixture(), 'g', 'obj');
 packed.elements.push(el('a', packed.elements.length));
 const snapshot = structuredClone(packed);
 assert.throws(() => releaseObject(packed, 'obj'), /duplicate id a/);
 assert.deepEqual(packed, snapshot);
});

test('shell is JSON-compatible and group compositing is transferred exactly once', () => {
 const input = fixture(); input.groups[1].locked = true; input.groups[1].visible = false;
 const object = packGroup(input, 'g', 'obj').elements[1];
 assert.equal(object.opacity, .5); assert.equal(object.visible, false); assert.equal(object.locked, true);
 const root = object.content.groups.find(g => g.id === 'g');
 assert.equal(root.opacity, 1); assert.equal(root.visible, true); assert.equal(root.locked, false);
 assert.equal('width' in object, false); assert.equal('height' in object, false);
 for (const patch of [{width: 30}, {rotationX: 0}, {rotationY: 20}, {scale: Infinity}]) assert.throws(() => validateSmartObject({...object, ...patch}));
});

test('release wraps edited ungrouped leaves and every top-level group without overriding inner state', () => {
 const packed = packGroup(fixture(), 'g', 'obj'), object = packed.elements[1];
 object.content.groups = [group('sub', null, {opacity: .2}), group('extra')];
 object.content.elements[0].groupId = null;
 object.content.elements.push(el('new', 2, {groupId: 'extra'}));
 const result = releaseObject(packed, 'obj');
 assert.equal(result.elements.find(e => e.id === 'a').groupId, 'obj');
 for (const id of ['sub','extra']) assert.equal(result.groups.find(g=>g.id===id).parentId, 'obj');
 assert.equal(result.groups.find(g=>g.id==='sub').opacity, .2);
 assert.equal(result.groups.find(g=>g.id==='obj').opacity, .5);
});

test('pack bounds include text scales and edge-on projections keep a legal nonjumping frame', () => {
 for (const extra of [{type:'textbox', textBox:{scaleX:2,scaleY:3}}, {rotationX:90}]) {
  const input = {elements:[el('edge',0,{groupId:'g',...extra})],groups:[group('g')]};
  const packed = packGroup(input,'g','obj'), object = packed.elements[0];
  assert.ok(object.content.frame.width>0 && object.content.frame.height>0);
  if (extra.type==='textbox') { close(object.content.frame.width,40); close(object.content.frame.height,30); }
  const result=releaseObject(packed,'obj').elements[0]; close(result.x,40); close(result.y,30);
 }
});

test('release bakes text sizes and basic masks and rejects nonrepresentable visuals atomically', () => {
 const packed=packGroup(fixture(),'g','obj'), object=packed.elements[1];
 const leaf=object.content.elements[0]; leaf.type='textbox';
 leaf.textBox={text:'<size=8>Hi</size>',fontSize:12,minFontSize:6,scaleX:2,scaleY:1};
 leaf.luaMask={enabled:true,enableSoftEdge:true,imageType:'basic',offsetX:2,offsetY:3,width:20,height:null,softEdgeMode:'Pixel',softEdgeWidthX:4,softEdgeWidthY:5};
 object.scale=2;
 const result=releaseObject(packed,'obj').elements.find(e=>e.id==='a');
 assert.equal(result.textBox.fontSize,24); assert.equal(result.textBox.minFontSize,12);
 assert.equal(result.textBox.text,'<size=16>Hi</size>'); assert.equal(result.textBox.scaleX,2);
 assert.equal(result.luaMask.offsetX,4); assert.equal(result.luaMask.softEdgeWidthX,8);
 for (const setup of [() => {object.rotation=30;}, () => {object.rotation=0;leaf.type='image';leaf.imageType='stretch';}]) {
  setup(); const before=structuredClone(packed);
  assert.throws(()=>releaseObject(packed,'obj'),/cannot be released exactly/); assert.deepEqual(packed,before);
 }
});

test('clone rejects duplicate generators and content validation rejects nested objects and escaping links', () => {
 const object=packGroup(fixture(),'g','obj').elements[1];
 assert.throws(()=>cloneObject(object,()=> 'obj'),/id generator/);
 for (const mutate of [o=>o.content.elements[0].groupId='missing', o=>o.content.groups[0].parentId='sub', o=>o.content.elements[0].type='smart-object']) {
  const invalid=structuredClone(object); mutate(invalid); assert.throws(()=>validateSmartObject(invalid));
 }
});

const releaseFixture = (extra = {}, shell = {}) => ({ elements: [{
 id: 'obj', name: 'object', type: 'smart-object', x: 50, y: 45, rotation: 0, scale: 2, opacity: 1, zIndex: 0,
 content: { frame: {width: 20, height: 10}, groups: [], elements: [el('leaf', 0, {x: 15, y: 3, ...extra})] }, ...shell
}], groups: [] });
const rejectsRelease = (input, reason) => {
 const before = structuredClone(input);
 assert.throws(() => releaseObject(input, 'obj'), reason);
 assert.deepEqual(input, before);
};

test('release rejects fractional, clamped and overflowing scaled font sizes atomically', () => {
 for (const key of ['fontSize', 'minFontSize']) for (const value of [15, .5, 1e308]) {
  const input = releaseFixture({type: 'textbox', textBox: {text: 'Hi', fontSize: 20, minFontSize: 10, [key]: value}}, {scale: value === 15 ? 1.1 : .5});
  if (value === 1e308) input.elements[0].scale = 2;
  rejectsRelease(input, /obj[/]leaf.*font size/);
 }
 for (const text of ['<size=15>Hi</size>', '<size=0.1>Hi</size>', '<size=' + '9'.repeat(309) + '>Hi</size>']) {
  rejectsRelease(releaseFixture({type:'textbox', textBox:{text, fontSize:20, minFontSize:10}}, {scale:1.1}), /obj[/]leaf.*rich-text font size/);
 }
});

test('release canonicalizes exact integer text sizes and supplies missing textbox defaults', () => {
 const input = releaseFixture({type:'textbox', textBox:{text:'<SIZE = 15.0 >Hi</size>', fontSize:20, minFontSize:10, scaleX:2}}, {scale:.2 + .4});
 const before = structuredClone(input), result = releaseObject(input, 'obj').elements[0];
 assert.equal(result.textBox.fontSize,12); assert.equal(result.textBox.minFontSize,6);
 assert.equal(result.textBox.text,'<size=9>Hi</size>'); assert.equal(result.textBox.scaleX,2);
 assert.deepEqual(input,before);
 const defaults = releaseObject(releaseFixture({type:'textbox'}), 'obj').elements[0].textBox;
 assert.equal(defaults.fontSize,40); assert.equal(defaults.minFontSize,24); assert.equal(defaults.text,'');
});

test('release rejects every custom text anchor and pivot even at identity transform', () => {
 for (const key of ['anchorMinX','anchorMinY','anchorMaxX','anchorMaxY','pivotX','pivotY']) {
  rejectsRelease(releaseFixture({type:'textbox',textBox:{text:'Hi',fontSize:20,minFontSize:12,[key]:0}}, {scale:1}), /obj[/]leaf.*anchors[/]pivot/);
 }
 const input = releaseFixture({type:'textbox',textBox:{text:'Hi',fontSize:20,minFontSize:12,anchorType:'custom',anchorMinX:.5,anchorMinY:.5,anchorMaxX:.5,anchorMaxY:.5,pivotX:.5,pivotY:.5}}, {scale:1});
 assert.equal(releaseObject(input,'obj').elements[0].textBox.pivotX,.5);
});

test('release diagnoses dimension, world position and mask overflow without touching source', () => {
 for (const extra of [{width:1e308},{height:1e308},{width:.1}]) rejectsRelease(releaseFixture(extra), /obj[/]leaf.*dimensions/);
 for (const extra of [{x:1e308},{y:1e308}]) rejectsRelease(releaseFixture(extra, {x:1e308,y:1e308}), /obj[/]leaf.*world position.*overflow/);
 const mask = {enabled:true,imageType:'basic',offsetX:2,offsetY:3,width:20,height:null,softEdgeMode:'Pixel',softEdgeWidthX:4,softEdgeWidthY:5};
 for (const key of ['offsetX','offsetY','width','height','softEdgeWidthX','softEdgeWidthY']) {
  rejectsRelease(releaseFixture({luaMask:{...mask,[key]:1e308}}), /obj[/]leaf.*mask.*overflow/);
 }
 const percentage = releaseObject(releaseFixture({luaMask:{...mask,softEdgeMode:'Percentage',softEdgeWidthX:1e308}}),'obj').elements[0].luaMask;
 assert.equal(percentage.softEdgeWidthX,1e308); assert.equal(percentage.height,null);
});

test('release preserves image defaults at identity and requires explicit Basic for scaled images and active masks', () => {
 for (const imageType of [undefined, null, 'stretch']) {
  const input = releaseFixture({type:'image',imageAssetId:106001,imageType});
  rejectsRelease(input, imageType === 'stretch' ? /obj[/]leaf.*stretch/ : /obj[/]leaf.*explicit basic imageType/);
  input.elements[0].scale = 1;
  assert.equal(releaseObject(input,'obj').elements[0].imageType,imageType);
  rejectsRelease(releaseFixture({luaMask:{enabled:true,imageType,offsetX:0,offsetY:0,width:null,height:null,softEdgeMode:'Pixel',softEdgeWidthX:0,softEdgeWidthY:0}}), /obj[/]leaf.*mask/);
 }
 assert.equal(releaseObject(releaseFixture({type:'image',imageType:'basic'}),'obj').elements[0].width,40);
});

test('release verifies XY projection composition without forbidding object transforms', () => {
 for (const rotation of [40,400]) {
  const input = releaseFixture({rotationX:180,rotationY:180,rotation:-25}, {rotation});
  validateSmartObject(input.elements[0]);
  const result = releaseObject(input,'obj').elements[0];
  const outer = rotationMatrix({rotation}), local = rotationMatrix(input.elements[0].content.elements[0]), got = rotationMatrix(result);
  for (const [actual,expected] of [[got.a,outer.a*local.a+outer.c*local.b],[got.b,outer.b*local.a+outer.d*local.b],[got.c,outer.a*local.c+outer.c*local.d],[got.d,outer.b*local.c+outer.d*local.d]]) close(actual,expected);
 }
 const invalid = releaseFixture({rotationX:30,rotationY:20},{rotation:40});
 validateSmartObject(invalid.elements[0]); rejectsRelease(invalid,/obj[/]leaf.*mixed-axis/);
});

test('release keeps internal backgrounds in object scope instead of hoisting them below unrelated outer layers', () => {
 const input = releaseFixture();
 input.elements[0].zIndex = 1;
 input.elements[0].content.elements = [el('foreground',0),el('local-background',2,{isBackground:true}),el('middle',1)];
 input.elements.unshift(el('outer-background',0,{isBackground:true}));
 input.elements.push(el('above',2));
 const before = structuredClone(input), released = releaseObject(input,'obj');
 assert.deepEqual(released.elements.map(item=>item.id),["outer-background","foreground","middle","local-background","above"]);
 assert.deepEqual(released.elements.map(item=>item.isBackground),[true,false,false,false,false]);
 for (const item of released.elements.filter(item=>item.groupId==='obj')) assert.equal(item.isBackground,false);
 assert.deepEqual(input,before);
});

test('release checks hidden source leaves, normalizes partial text and mask defaults, and reports rotation overflow', () => {
 const hidden = releaseFixture({visible:false,type:'textbox',textBox:{fontSize:15,minFontSize:10}}, {scale:1.1});
 rejectsRelease(hidden,/obj[/]leaf.*font size/);
 const text = releaseObject(releaseFixture({type:'textbox',textBox:{text:'Hi'}}),'obj').elements[0].textBox;
 assert.equal(text.fontSize,40); assert.equal(text.minFontSize,24); assert.equal(text.text,'Hi');
 const mask = releaseObject(releaseFixture({luaMask:{enabled:true,imageType:'basic',offsetX:3}}),'obj').elements[0].luaMask;
 assert.equal(mask.offsetX,6); assert.equal(mask.offsetY,0); assert.equal(mask.width,null); assert.equal(mask.height,null);
 const overflow = releaseFixture({rotation:1e308}, {rotation:1e308});
 validateSmartObject(overflow.elements[0]); rejectsRelease(overflow,/obj[/]leaf.*rotation.*overflow/);
});
