import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync(new URL('../src/canvasZoom.ts', import.meta.url), 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText;
const { wheelZoom, zoomAnchorScroll } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' != '+expected);
test('wheel up zooms in, down zooms out and opposite deltas cancel',()=>{
 assert.ok(wheelZoom(1,-100,0,600)>1); assert.ok(wheelZoom(1,100,0,600)<1);
 close(wheelZoom(wheelZoom(1,-100,0,600),100,0,600),1);
 close(wheelZoom(1,-50,0,600)**2,wheelZoom(1,-100,0,600));
});
test('wheel units normalize pixels, lines and pages',()=>{
 close(wheelZoom(1,-48,0,600),wheelZoom(1,-3,1,600));
 close(wheelZoom(1,-600,0,600),wheelZoom(1,-1,2,600));
});
test('zoom can go above 400 percent and return to the previous scale',()=>{
 const large=wheelZoom(4,-100,0,600);
 assert.ok(large>4);
 close(wheelZoom(large,100,0,600),4);
 close(wheelZoom(1,-500*Math.log(16),0,600),16);
});
test('zoom retains its 25 percent minimum and rejects invalid or overflowing deltas',()=>{
 assert.equal(wheelZoom(1,1e6,0,600),.25);
 for(const delta of [0,NaN,Infinity,-Infinity,-1e6]) assert.equal(wheelZoom(1,delta,0,600),1);
 assert.equal(wheelZoom(.25,10,0,600),.25);
 assert.equal(wheelZoom(1,10,99,600),1);
});
test('scroll compensation preserves arbitrary cursor anchors, even outside the canvas',()=>{
 for(const ratio of [.25,.8,1,1.3,4,16]) for(const pointer of [{x:340,y:230},{x:90,y:70},{x:900,y:750}]) {
  const before={left:160,top:140},after={left:230,top:210};
  const delta=zoomAnchorScroll(before,after,pointer,ratio);
  close(after.left-delta.x+(pointer.x-before.left)*ratio,pointer.x);
  close(after.top-delta.y+(pointer.y-before.top)*ratio,pointer.y);
 }
});
