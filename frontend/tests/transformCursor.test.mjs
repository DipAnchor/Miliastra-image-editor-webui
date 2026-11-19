import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const code=ts.transpileModule(readFileSync(new URL("../src/transformCursor.ts",import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText;
const {rotationCursor}=await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));
const svgOf=cursor=>decodeURIComponent(cursor.slice(cursor.indexOf('"')+1,cursor.lastIndexOf('"')).slice("data:image/svg+xml,".length));
test("arc opening faces the pivot around the full circle",()=>{
 for(let direction=0;direction<360;direction+=17){
  const radians=direction*Math.PI/180,pointer={x:180*Math.cos(radians),y:180*Math.sin(radians)},pivot={x:0,y:0};
  const cursor=rotationCursor(pointer,pivot),svg=svgOf(cursor),angle=Number(svg.split("rotate(")[1].split(")")[0])*Math.PI/180;
  const opening={x:(-Math.cos(angle)-Math.sin(angle))/Math.SQRT2,y:(-Math.sin(angle)+Math.cos(angle))/Math.SQRT2};
  const alignment=(opening.x*-pointer.x+opening.y*-pointer.y)/180;
  assert.ok(alignment>=Math.cos(2.50001*Math.PI/180),"Opening faces away from pivot at "+direction);
  assert.ok(svg.includes('width="32" height="32" viewBox="0 0 32 32"'));
  assert.ok(cursor.endsWith(') 16 16, crosshair'));
 }
});
test("cursor direction follows a moved pivot and is invariant under zoom and translation",()=>{
 const pointer={x:200,y:80},pivot={x:120,y:150};
 assert.notEqual(rotationCursor(pointer,pivot),rotationCursor(pointer,{x:120,y:20}));
 for(const scale of [0.25,1,4])assert.equal(rotationCursor({x:pointer.x*scale+53,y:pointer.y*scale-71},{x:pivot.x*scale+53,y:pivot.y*scale-71}),rotationCursor(pointer,pivot));
});
test("continuous movement uses a bounded set of native cursor images",()=>{
 const seen=new Set();
 for(let degrees=0;degrees<360;degrees+=0.1){const a=degrees*Math.PI/180;seen.add(rotationCursor({x:Math.cos(a),y:Math.sin(a)},{x:0,y:0}));}
 assert.ok(seen.size<=72);assert.ok(seen.size>=60);
});
test("invalid cursor coordinates use the standard fallback",()=>{
 assert.equal(rotationCursor({x:NaN,y:0},{x:0,y:0}),"crosshair");
 assert.equal(rotationCursor({x:0,y:0},{x:0,y:Infinity}),"crosshair");
});
