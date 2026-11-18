import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import App, {type SceneDocument} from "../src/App";
import { I18nProvider, translations } from "../src/i18n";

const scene:SceneDocument={canvas:{width:300,height:240,background:"transparent"},elements:[{id:"leaf",name:"Leaf",type:"rectangle",x:60,y:50,width:40,height:30,rotation:0,color:"#c2410c",opacity:1,zIndex:0,visible:true,isBackground:false}],groups:[],meta:{sourceType:"editor",sourceName:"wheel-test",warnings:[]},library:{activeCategory:"basic-shape",categories:[{key:"basic-shape",label:"基础形状",supported:true}],baseShapePresets:[],savedItems:[]}};
const label=(key:string)=>translations.zh[key] as string;
const zoom=(root:HTMLElement)=>Number(root.querySelector('.zoom-display')!.textContent!.replace('%',''));
function wheel(target:Element,patch:WheelEventInit={}) {
 const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100,clientX:260,clientY:190,...patch});
 act(()=>{target.dispatchEvent(event);}); return event;
}
beforeEach(()=>{
 localStorage.clear();localStorage.setItem('miliastra-editor-lang','zh');localStorage.setItem('miliastra-editor-tour-seen','1');
 localStorage.setItem('miliastra-last-canvas',JSON.stringify({name:'Wheel regression',scene,savedAt:1}));localStorage.setItem('miliastra-restore-on-load','1');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({images:{},categories:{},names:{}}),{status:200,headers:{'Content-Type':'application/json'}})));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(){const view=render(<I18nProvider><App/></I18nProvider>);const root=view.container.querySelector<HTMLElement>('.app-shell')!;await waitFor(()=>expect(root.querySelector('.shape[data-element-id="leaf"]')).not.toBeNull());return root;}
function geometry(root:HTMLElement){
 const stage=root.querySelector<HTMLElement>('.canvas-stage')!,canvas=root.querySelector<HTMLElement>('.canvas')!;
 Object.defineProperties(stage,{clientWidth:{configurable:true,value:500},clientHeight:{configurable:true,value:400},scrollWidth:{configurable:true,value:2000},scrollHeight:{configurable:true,value:1600}});
 stage.scrollLeft=200;stage.scrollTop=150;
 const before=()=>({left:320-stage.scrollLeft,top:290-stage.scrollTop,width:300,height:240,right:620-stage.scrollLeft,bottom:530-stage.scrollTop,x:0,y:0,toJSON:()=>({})});
 vi.spyOn(canvas,'getBoundingClientRect').mockImplementation(()=>{const z=Number(canvas.style.transform.match(/scale\(([^)]+)\)/)?.[1]??1);return{...before(),left:320-stage.scrollLeft,top:290-stage.scrollTop,width:300*z,height:240*z};});
 return{stage,canvas};
}
describe('canvas cursor wheel zoom',()=>{
 it('uses a cancellable non-passive stage event and preserves the cursor anchor without adding undo',async()=>{
  const root=await mount(),{stage}=geometry(root),initial=zoom(root);
  const event=wheel(stage);expect(event.defaultPrevented).toBe(true);expect(zoom(root)).toBeGreaterThan(initial);
  const ratio=Number(root.querySelector<HTMLElement>('.canvas')!.style.transform.match(/scale\(([^)]+)\)/)![1]);
  expect(stage.scrollLeft).toBeCloseTo(200+140*(ratio-1),7);expect(stage.scrollTop).toBeCloseTo(150+50*(ratio-1),7);
  expect(within(root).getByTitle(label('topbar.undoShort'))).toBeDisabled();
  wheel(stage,{deltaY:100});expect(zoom(root)).toBe(initial);expect(stage.scrollLeft).toBeCloseTo(200,7);expect(stage.scrollTop).toBeCloseTo(150,7);
 });
 it('handles consecutive events, delta modes and clamps without stale zoom state',async()=>{
  const root=await mount(),{stage}=geometry(root);
  act(()=>{stage.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100}));stage.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100}));});
  expect(zoom(root)).toBeGreaterThan(130);
  wheel(stage,{deltaY:-1e6});expect(zoom(root)).toBe(400);expect(wheel(stage,{deltaY:-1}).defaultPrevented).toBe(true);
  wheel(stage,{deltaY:1e6});expect(zoom(root)).toBe(25);
  wheel(stage,{deltaY:-3,deltaMode:1});expect(zoom(root)).toBeGreaterThan(25);
 });
 it('does not zoom panels, toolbar inputs, horizontal wheel, invalid events, drags or modal backgrounds',async()=>{
  const root=await mount(),{stage}=geometry(root),initial=zoom(root);
  for(const target of [root.querySelector('.sidebar-left')!,root.querySelector('.sidebar-right')!,root.querySelector('.canvas-toolbar input')!]){expect(wheel(target).defaultPrevented).toBe(false);expect(zoom(root)).toBe(initial);}
  for(const patch of [{deltaY:0,deltaX:100},{buttons:1},{cancelable:false}]){expect(wheel(stage,patch).defaultPrevented).toBe(false);expect(zoom(root)).toBe(initial);}
  const invalid=new WheelEvent('wheel',{bubbles:true,cancelable:true});Object.defineProperty(invalid,'deltaY',{value:NaN});act(()=>{stage.dispatchEvent(invalid);});expect(zoom(root)).toBe(initial);
  const input=document.createElement('input');stage.append(input);wheel(input);expect(zoom(root)).toBe(initial);input.remove();
  fireEvent.mouseDown(stage,{button:1,clientX:220,clientY:170});wheel(stage);expect(zoom(root)).toBe(initial);fireEvent.mouseUp(window);
  const dialog=document.createElement('dialog');document.body.append(dialog);dialog.showModal();wheel(stage);expect(zoom(root)).toBe(initial);dialog.remove();
 });
 it('keeps button/reset/fit zoom usable after wheel zoom',async()=>{
  const root=await mount(),{stage}=geometry(root);wheel(stage);fireEvent.click(root.querySelector('.zoom-display')!);expect(zoom(root)).toBe(100);
  fireEvent.click(within(root).getByTitle(label('canvas.zoomIn')));expect(zoom(root)).toBe(110);
  fireEvent.click(within(root).getByTitle(label('canvas.zoomOut')));expect(zoom(root)).toBe(100);
  fireEvent.click(within(root).getByTitle(label('canvas.fit')));expect(zoom(root)).toBe(127);
 });
 it('zooms only the internal canvas while object editing and leaves its draft clean',async()=>{
  const objectScene={...scene,schemaVersion:2,elements:[{id:'object',type:'smart-object',name:'Wheel object',x:150,y:120,rotation:0,scale:1,opacity:1,zIndex:0,visible:true,content:{frame:{width:120,height:100},elements:scene.elements,groups:[]}}]};
  localStorage.setItem('miliastra-last-canvas',JSON.stringify({name:'Wheel object',scene:objectScene,savedAt:1}));
  const view=render(<I18nProvider><App/></I18nProvider>);const root=view.container.querySelector<HTMLElement>('.app-shell')!;
  await waitFor(()=>expect(root.querySelector('.shape-smart-object')).not.toBeNull());fireEvent.doubleClick(root.querySelector('.shape-smart-object')!);
  const child=root.querySelector<HTMLElement>('.object-editor-overlay .app-shell')!,parentStage=root.querySelector('.canvas-stage')!,childStage=child.querySelector('.canvas-stage')!;
  const parentZoom=zoom(root),childZoom=zoom(child);wheel(parentStage);expect(zoom(root)).toBe(parentZoom);wheel(childStage);expect(zoom(child)).toBeGreaterThan(childZoom);
  const positions=[...child.querySelectorAll<HTMLElement>('.canvas .shape')].map(item=>item.style.left);
  fireEvent.keyDown(document.body,{key:'z',ctrlKey:true});fireEvent.keyUp(document.body,{key:'z',ctrlKey:true});
  expect([...child.querySelectorAll<HTMLElement>('.canvas .shape')].map(item=>item.style.left)).toEqual(positions);
  expect(within(child).getByText(label('smartObject.saved'))).toBeInTheDocument();expect(within(root).getByTitle(label('topbar.undoShort'))).toBeDisabled();
 });
});
