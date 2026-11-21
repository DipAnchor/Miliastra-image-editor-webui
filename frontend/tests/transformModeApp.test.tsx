import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {act,fireEvent,render,waitFor,within} from "@testing-library/react";
import App,{type SceneDocument,type SceneElement} from "../src/App";
import {I18nProvider,translations} from "../src/i18n";
type Tool=Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0];
const tools=new Map<string,Tool>();
const label=(key:string)=>translations.zh[key] as string;
const leaf=(id:string,patch:Record<string,unknown>={}):SceneElement=>({id,name:id,layerName:id,type:"rectangle",x:100,y:80,width:80,height:60,rotation:0,color:"#c2410c",opacity:1,zIndex:0,visible:true,isBackground:false,...patch});
const makeScene=(elements:SceneElement[]=[leaf("a"),leaf("b",{x:240,y:180,zIndex:1})]):SceneDocument=>({canvas:{width:300,height:240,background:"transparent"},elements,groups:[],meta:{sourceType:"editor",sourceName:"transform-test",warnings:[]},library:{activeCategory:"basic-shape",categories:[{key:"basic-shape",label:"基础形状",supported:true}],baseShapePresets:[],savedItems:[]}});
beforeEach(()=>{
 localStorage.clear();localStorage.setItem("miliastra-editor-lang","zh");localStorage.setItem("miliastra-editor-tour-seen","1");tools.clear();
 Object.defineProperty(document,"modelContext",{configurable:true,value:{registerTool:async(tool:Tool)=>{tools.set(tool.name,tool);}}});
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({images:{},categories:{},names:{}}),{status:200,headers:{"Content-Type":"application/json"}})));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();Reflect.deleteProperty(document,"modelContext");});
async function readScene(){const result=await tools.get("get_scene")!.execute({},{});if(!result||typeof result!=="object"||!("elements"in result))throw new Error("Scene unavailable");return result as SceneDocument;}
async function mount(initial=makeScene()){
 localStorage.setItem("miliastra-last-canvas",JSON.stringify({name:"Transform test",scene:initial,savedAt:1}));localStorage.setItem("miliastra-restore-on-load","1");
 const view=render(<I18nProvider><App/></I18nProvider>),root=view.container.querySelector<HTMLElement>(".app-shell")!;
 await waitFor(()=>expect(root.querySelectorAll(".canvas > .shape")).toHaveLength(initial.elements.length));
 fireEvent.click(root.querySelector(".zoom-display")!);
 const canvas=root.querySelector<HTMLElement>(".canvas")!;
 vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({x:0,y:0,left:0,top:0,right:300,bottom:240,width:300,height:240,toJSON:()=>({})});
 return root;
}
const row=(root:HTMLElement,id:string)=>root.querySelector<HTMLElement>('.layer-row-item[data-element-id="'+id+'"]')!;
const shape=(root:HTMLElement,id="a")=>root.querySelector<HTMLElement>('.canvas .shape[data-element-id="'+id+'"]')!;
const button=(root:HTMLElement,key:string)=>within(root).getByRole("button",{name:label(key)});
function enable(root:HTMLElement){fireEvent.click(row(root,"a"));fireEvent.click(button(root,"transform.mode"));}
function drag(target:Element,x:number,y:number,toX:number,toY:number){fireEvent.mouseDown(target,{button:0,clientX:x,clientY:y});fireEvent.mouseMove(window,{buttons:1,clientX:toX,clientY:toY});fireEvent.mouseUp(window);}
function resize(root:HTMLElement){drag(root.querySelector('[data-handle="se"]')!,140,110,180,140);}
function key(value:string,patch:Record<string,unknown>={}){fireEvent.keyDown(document.body,{key:value,...patch});fireEvent.keyUp(document.body,{key:value,...patch});}
const undo=(root:HTMLElement)=>within(root).getByTitle(label("topbar.undoShort"));
const redo=(root:HTMLElement)=>within(root).getByTitle(label("topbar.redoShort"));

function propertyInput(root: HTMLElement, text: string): HTMLInputElement {
 const field=Array.from(root.querySelectorAll<HTMLElement>('.sidebar-right .num-field, .sidebar-right .field')).find(node=>node.firstElementChild?.textContent===text);
 const input=field?.querySelector<HTMLInputElement>('input[type="number"]');
 if(!input)throw new Error('Missing property input: '+text);
 return input;
}
function setProperty(root: HTMLElement, text: string, value: number) {
 const input=propertyInput(root,text);fireEvent.focus(input);fireEvent.change(input,{target:{value:String(value)}});return input;
}
describe("transform property preview",()=>{
 it("enables geometry inputs while keeping appearance locked and cancels all numeric edits",async()=>{
  const root=await mount(),initial=await readScene();enable(root);resize(root);
  for(const name of ['X','Y',label('props.width'),label('props.height'),...['Z','X','Y'].map(axis=>label('props.rotation')+' '+axis)]) {
   expect(propertyInput(root,name)).toBeEnabled();expect(propertyInput(root,name).closest('[inert]')).toBeNull();
  }
  expect(root.querySelector('.sidebar-right .layer-controls input')!.closest('[inert]')).not.toBeNull();
  setProperty(root,'X',145);setProperty(root,'Y',115);setProperty(root,label('props.width'),150);setProperty(root,label('props.height'),100);
  setProperty(root,label('props.rotation')+' Z',45);setProperty(root,label('props.rotation')+' X',20);setProperty(root,label('props.rotation')+' Y',-15);
  expect(propertyInput(root,'X')).toHaveValue(160);expect(propertyInput(root,'Y')).toHaveValue(120);
  expect(propertyInput(root,label('props.width'))).toHaveValue(150);expect(propertyInput(root,label('props.rotation')+' Y')).toHaveValue(-15);
  expect(root).toHaveClass('transform-locked');expect(undo(root)).toBeDisabled();
  fireEvent.click(button(root,'transform.cancel'));expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();
 });
 it("applies numeric geometry with one undo and redo",async()=>{
  const root=await mount(),initial=await readScene();enable(root);resize(root);
  setProperty(root,label('props.width'),144);setProperty(root,label('props.height'),99);setProperty(root,'X',150);setProperty(root,'Y',105);
  setProperty(root,label('props.rotation')+' Z',30);setProperty(root,label('props.rotation')+' X',20);setProperty(root,label('props.rotation')+' Y',10);
  fireEvent.click(button(root,'transform.apply'));const applied=await readScene();
  expect(applied.elements[0]).toMatchObject({x:150,y:105,width:144,height:99,rotation:30,rotationX:20,rotationY:10});expect(applied.elements[1]).toEqual(initial.elements[1]);
  fireEvent.click(undo(root));expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();
  fireEvent.click(redo(root));expect(await readScene()).toEqual(applied);
 });
 it("continues handle resizing from the numerically edited frame",async()=>{
  const root=await mount(),initial=await readScene();enable(root);resize(root);
  setProperty(root,label('props.width'),160);setProperty(root,'X',170);
  drag(root.querySelector('[data-handle="se"]')!,250,140,270,150);
  expect(propertyInput(root,label('props.width'))).toHaveValue(180);expect(propertyInput(root,label('props.height'))).toHaveValue(100);
  expect(propertyInput(root,'X')).toHaveValue(180);expect(propertyInput(root,'Y')).toHaveValue(100);
  fireEvent.click(button(root,'transform.apply'));expect((await readScene()).elements[0]).toMatchObject({x:180,y:100,width:180,height:100});
  fireEvent.click(undo(root));expect(await readScene()).toEqual(initial);
 });
 it("moves a pending multi-selection through its existing position fields",async()=>{
  const root=await mount(),initial=await readScene();fireEvent.click(row(root,'a'));fireEvent.click(row(root,'b'),{ctrlKey:true});fireEvent.click(button(root,'transform.mode'));
  drag(root.querySelector('[data-handle="se"]')!,280,210,290,220);setProperty(root,'X',180);setProperty(root,'Y',150);
  expect(root).toHaveClass('transform-locked');expect(propertyInput(root,'X').closest('[inert]')).toBeNull();
  fireEvent.click(button(root,'transform.apply'));const applied=await readScene();
  const layers=applied.elements.filter(e=>e.type!=='smart-object');
  const minX=Math.min(...layers.map(e=>e.x-e.width/2)),maxX=Math.max(...layers.map(e=>e.x+e.width/2));
  const minY=Math.min(...layers.map(e=>e.y-e.height/2)),maxY=Math.max(...layers.map(e=>e.y+e.height/2));
  expect((minX+maxX)/2).toBeCloseTo(180);expect((minY+maxY)/2).toBeCloseTo(150);
  fireEvent.click(undo(root));expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();
 });
 it("keeps smart-object position rotation and scale usable without unlocking contents",async()=>{
  const object:SceneElement={id:'a',name:'Object',layerName:'Object',type:'smart-object',x:100,y:80,rotation:0,scale:1,opacity:1,zIndex:0,visible:true,content:{frame:{width:80,height:60},elements:[leaf('inside') as Exclude<SceneElement,{type:'smart-object'}>],groups:[]}};
  const root=await mount(makeScene([object])),initial=await readScene();enable(root);resize(root);
  expect(button(root,'smartObject.edit')).toBeDisabled();expect(button(root,'smartObject.release')).toBeDisabled();
  expect(propertyInput(root,label('smartObject.opacity'))).toBeDisabled();expect(root.querySelector('.smart-object-inspector input:not([type])')).toBeDisabled();
  setProperty(root,label('smartObject.scale'),200);setProperty(root,'X',165);setProperty(root,'Y',125);setProperty(root,label('smartObject.rotationZ'),35);
  fireEvent.click(button(root,'transform.apply'));const applied=await readScene();
  expect(applied.elements[0]).toMatchObject({type:'smart-object',x:165,y:125,rotation:35,scale:2});expect(applied.elements[0]).not.toHaveProperty('width');
  expect((applied.elements[0] as typeof object).content).toEqual(object.content);
  fireEvent.click(undo(root));expect(await readScene()).toEqual(initial);
 });
 it("does not add history when numeric edits restore the original transform",async()=>{
  const root=await mount(),initial=await readScene();enable(root);resize(root);
  setProperty(root,label('props.width'),80);setProperty(root,label('props.height'),60);setProperty(root,'X',101);setProperty(root,'X',100);setProperty(root,'Y',81);setProperty(root,'Y',80);
  fireEvent.click(button(root,'transform.apply'));expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();
 });
 it("preserves ordinary numeric editing outside a transform transaction",async()=>{
  const root=await mount(),initial=await readScene();fireEvent.click(row(root,'a'));setProperty(root,'X',125);
  expect(root).not.toHaveClass('transform-locked');expect((await readScene()).elements[0].x).toBe(125);
  fireEvent.click(undo(root));expect(await readScene()).toEqual(initial);
 });
});

describe("explicit transform mode",()=>{
 it("limits rotation to the outer twenty-percent band and preserves resize cursors",async()=>{
  const root=await mount(),initial=await readScene(),stage=root.querySelector<HTMLElement>(".canvas-stage")!;
  fireEvent.mouseMove(stage,{clientX:152,clientY:80});expect(stage).not.toHaveAttribute("data-transform-cursor");
  enable(root);fireEvent.mouseMove(stage,{clientX:152,clientY:80});expect(stage).toHaveAttribute("data-transform-cursor","rotate");
  expect(stage.style.getPropertyValue("--transform-rotate-cursor").startsWith('url("data:image/svg+xml,')).toBe(true);
  fireEvent.mouseMove(stage,{clientX:156,clientY:80});expect(stage).toHaveAttribute("data-transform-cursor","rotate");
  fireEvent.mouseMove(stage,{clientX:157,clientY:80});expect(stage).not.toHaveAttribute("data-transform-cursor");
  fireEvent.mouseMove(shape(root,"b"),{clientX:240,clientY:180});expect(stage).not.toHaveAttribute("data-transform-cursor");
  fireEvent.mouseMove(shape(root),{clientX:100,clientY:80});expect(stage).toHaveAttribute("data-transform-cursor","move");
  const handle=root.querySelector<HTMLElement>('[data-handle="se"]')!;fireEvent.mouseMove(handle,{clientX:140,clientY:110});expect(handle.style.cursor).toMatch(/-resize$/);
  fireEvent.mouseLeave(stage);expect(stage).not.toHaveAttribute("data-transform-cursor");expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();
 });
 it("uses the projected frame for rotation cursor hit testing",async()=>{
  const root=await mount(makeScene([leaf("a",{rotation:45})])),stage=root.querySelector<HTMLElement>(".canvas-stage")!;enable(root);
  fireEvent.mouseMove(stage,{clientX:138,clientY:42});expect(stage).toHaveAttribute("data-transform-cursor","rotate");
  fireEvent.mouseMove(stage,{clientX:145,clientY:35});expect(stage).not.toHaveAttribute("data-transform-cursor");
  fireEvent.mouseMove(stage,{clientX:120,clientY:80});expect(stage).toHaveAttribute("data-transform-cursor","move");
 });
 it("shows moving inside the empty space of a selected group frame",async()=>{
  const initial=makeScene([leaf("a",{groupId:"g"}),leaf("b",{x:200,y:80,groupId:"g"})]);initial.groups=[{id:"g",name:"Group",parentId:null,opacity:1,visible:true,collapsed:false,order:0}];
  const root=await mount(initial),stage=root.querySelector<HTMLElement>(".canvas-stage")!;fireEvent.click(root.querySelector('.layer-group-row[data-group-id="g"]')!);fireEvent.click(button(root,"transform.mode"));
  fireEvent.mouseMove(stage,{clientX:150,clientY:80});expect(stage).toHaveAttribute("data-transform-cursor","move");
  fireEvent.mouseMove(stage,{clientX:150,clientY:114});expect(stage).toHaveAttribute("data-transform-cursor","rotate");
  fireEvent.mouseMove(stage,{clientX:150,clientY:140});expect(stage).not.toHaveAttribute("data-transform-cursor");
 });
 it("keeps the rotation cursor during an active drag and locks the preview outside the band",async()=>{
  const root=await mount(),stage=root.querySelector<HTMLElement>(".canvas-stage")!;enable(root);fireEvent.mouseDown(stage,{button:0,clientX:152,clientY:80});
  fireEvent.mouseMove(stage,{buttons:1,clientX:200,clientY:100});expect(stage).toHaveAttribute("data-transform-cursor","rotate");
  fireEvent.mouseMove(stage,{buttons:1,clientX:100,clientY:80});expect(stage).toHaveAttribute("data-transform-cursor","rotate");
  fireEvent.mouseMove(stage,{buttons:1,clientX:10,clientY:10});expect(stage).toHaveAttribute("data-transform-cursor","rotate");fireEvent.mouseUp(window);
  const preview=shape(root).style.transform;drag(stage,10,10,20,20);
  expect(shape(root).style.transform).toBe(preview);expect(row(root,"a")).toHaveClass("selected");expect(root.querySelector("[inert]")).not.toBeNull();
  key("Escape");expect(undo(root)).toBeDisabled();
 });
 it("updates the arc orientation after moving the pivot",async()=>{
  const root=await mount(),stage=root.querySelector<HTMLElement>(".canvas-stage")!;enable(root);fireEvent.mouseMove(stage,{clientX:144,clientY:80});
  const original=stage.style.getPropertyValue("--transform-rotate-cursor");drag(root.querySelector('[data-handle="pivot"]')!,100,80,70,50);
  fireEvent.mouseMove(stage,{clientX:144,clientY:80});expect(stage).toHaveAttribute("data-transform-cursor","rotate");expect(stage.style.getPropertyValue("--transform-rotate-cursor")).not.toBe(original);
  key("Escape");expect(undo(root)).toBeDisabled();
 });
 it("leaves distant blank drags as selection and supports adding a distant layer",async()=>{
  const root=await mount(),initial=await readScene(),stage=root.querySelector<HTMLElement>(".canvas-stage")!;enable(root);drag(stage,200,20,220,25);
  expect(root.querySelector("[inert]")).toBeNull();expect(root.querySelector(".transform-controls")).toBeNull();expect(await readScene()).toEqual(initial);
  fireEvent.click(row(root,"a"));fireEvent.mouseDown(shape(root,"b"),{button:0,ctrlKey:true,clientX:240,clientY:180});fireEvent.mouseUp(window);
  expect(row(root,"a")).toHaveClass("selected");expect(row(root,"b")).toHaveClass("selected");expect(root.querySelector("[inert]")).toBeNull();expect(undo(root)).toBeDisabled();
 });
 it("moves a different layer beyond the rotation band without opening a preview",async()=>{
  const root=await mount(),initial=await readScene();enable(root);drag(shape(root,"b"),240,180,250,190);
  expect(row(root,"b")).toHaveClass("selected");expect(row(root,"a")).not.toHaveClass("selected");expect(root.querySelector("[inert]")).toBeNull();
  const applied=await readScene();expect(applied.elements[0]).toEqual(initial.elements[0]);expect(applied.elements[1]).toMatchObject({x:250,y:190,rotation:0});
  fireEvent.click(undo(root));expect(await readScene()).toEqual(initial);
 });
 it("moves immediately without opening transform editing and commits one ordinary undo",async()=>{
  const root=await mount(),initial=await readScene();enable(root);
  fireEvent.mouseDown(shape(root),{button:0,clientX:100,clientY:80});
  fireEvent.mouseMove(window,{buttons:1,clientX:110,clientY:85});expect(root.querySelector("[inert]")).toBeNull();expect((await readScene()).elements[0]).toMatchObject({x:110,y:85});
  fireEvent.mouseMove(window,{buttons:1,clientX:120,clientY:90});fireEvent.mouseUp(window);
  const moved=await readScene();expect(moved.elements[0]).toMatchObject({x:120,y:90,width:80,height:60});expect(root.querySelector("[inert]")).toBeNull();expect(within(root).queryByRole("button",{name:label("transform.apply")})).toBeNull();
  await act(async()=>{await new Promise(resolve=>window.setTimeout(resolve,950));});expect(JSON.parse(localStorage.getItem("miliastra-last-canvas")!).scene.elements).toEqual(moved.elements);
  fireEvent.click(row(root,"b"));expect(row(root,"b")).toHaveClass("selected");fireEvent.click(undo(root));expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();fireEvent.click(redo(root));expect(await readScene()).toEqual(moved);
 });
 it("keeps completed movement separate from a later cancelled or applied transform",async()=>{
  const root=await mount(),initial=await readScene();enable(root);drag(shape(root),100,80,120,90);const moved=await readScene();
  resize(root);key("Escape");expect(await readScene()).toEqual(moved);expect(shape(root).style.width).toBe("80px");
  resize(root);key("Enter");const transformed=await readScene();expect(transformed.elements[0].width).toBe(120);
  fireEvent.click(undo(root));expect(await readScene()).toEqual(moved);fireEvent.click(undo(root));expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();
 });
 it("keeps movement inside an existing transform preview isolated until apply",async()=>{
  const root=await mount(),initial=await readScene();enable(root);resize(root);drag(shape(root),120,95,135,105);
  expect(root.querySelector("[inert]")).not.toBeNull();expect(undo(root)).toBeDisabled();
  // 右边缘吸附到 b 的左边缘，因此预览中心为 140。
  fireEvent.click(button(root,"transform.apply"));expect((await readScene()).elements[0]).toMatchObject({x:140,y:105,width:120,height:90});fireEvent.click(undo(root));expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();
 });
 it("cancels a held ordinary move without entering transform editing or adding history",async()=>{
  const root=await mount(),initial=await readScene();enable(root);fireEvent.mouseDown(shape(root),{button:0,clientX:100,clientY:80});fireEvent.mouseMove(window,{buttons:1,clientX:120,clientY:90});
  expect(root.querySelector("[inert]")).toBeNull();expect((await readScene()).elements[0].x).toBe(120);key("Escape");fireEvent.mouseMove(window,{buttons:1,clientX:140,clientY:100});fireEvent.mouseUp(window);
  expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();expect(root.querySelector("[inert]")).toBeNull();
 });
 it("hides transform UI in normal mode and preserves ordinary movement",async()=>{
  const root=await mount();fireEvent.click(row(root,"a"));expect(root.querySelector(".transform-controls")).toBeNull();expect(root.querySelector(".rotate-handle")).toBeNull();
  drag(shape(root),100,80,120,90);const scene=await readScene();expect(scene.elements[0].x).toBe(120);expect(scene.elements[0].y).toBe(90);expect(undo(root)).toBeEnabled();
 });
 it("shows eight resize squares and one movable anchor only while transform mode is enabled",async()=>{
  const root=await mount();enable(root);expect(root.querySelectorAll(".transform-resize-point")).toHaveLength(8);expect(root.querySelectorAll(".transform-pivot")).toHaveLength(1);expect(root.querySelector(".rotate-handle")).toBeNull();
  expect(within(root).getByTitle(label("canvas.centerResizeTitle"))).not.toHaveClass("active");
  fireEvent.click(button(root,"transform.mode"));expect(root.querySelector(".transform-controls")).toBeNull();expect(undo(root)).toBeDisabled();
 });
 it("locks targets and keeps several preview gestures out of history until a single apply",async()=>{
  const root=await mount(),initial=await readScene();enable(root);resize(root);expect(shape(root).style.width).toBe("120px");
  expect(root.querySelector(".sidebar-left")).toHaveAttribute("inert");expect(root.querySelector(".sidebar-right")).not.toHaveAttribute("inert");expect(propertyInput(root,label("props.width")).closest("[inert]")).toBeNull();expect(undo(root)).toBeDisabled();
  fireEvent.click(row(root,"b"));key("Delete");key("z",{ctrlKey:true});key("d",{ctrlKey:true});key("s",{ctrlKey:true});
  expect(row(root,"a")).toHaveClass("selected");expect(row(root,"b")).not.toHaveClass("selected");expect(root.querySelectorAll(".canvas .shape")).toHaveLength(2);
  key("ArrowRight");expect(shape(root).style.width).toBe("120px");fireEvent.click(button(root,"transform.apply"));
  const applied=await readScene();expect(applied.elements[0]).toMatchObject({x:121,y:95,width:120,height:90});expect(applied.elements[1]).toEqual(initial.elements[1]);expect(root.querySelector("[inert]")).toBeNull();
  fireEvent.click(undo(root));expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();fireEvent.click(redo(root));expect(await readScene()).toEqual(applied);
 });
 it("keeps an active preview out of the cache after autosave has actually run",async()=>{
  const root=await mount(),initial=await readScene();enable(root);resize(root);
  await act(async()=>{await new Promise(resolve=>window.setTimeout(resolve,950));});
  const cached=JSON.parse(localStorage.getItem("miliastra-last-canvas")!);
  expect(cached.savedAt).toBeGreaterThan(1);expect(cached.scene.elements).toEqual(initial.elements);expect(cached.scene.canvas).toEqual(initial.canvas);
  expect(shape(root).style.width).toBe("120px");expect(root.querySelector("[inert]")).not.toBeNull();expect(undo(root)).toBeDisabled();
  key("Escape");expect(await readScene()).toEqual(initial);expect(shape(root).style.width).toBe("80px");
 });
 it("cancels the complete preview without undo or autosaved scene changes",async()=>{
  const root=await mount(),initial=await readScene(),stored=localStorage.getItem("miliastra-last-canvas");enable(root);resize(root);key("ArrowDown",{shiftKey:true});
  fireEvent.click(button(root,"transform.cancel"));expect(await readScene()).toEqual(initial);expect(shape(root).style.width).toBe("80px");expect(undo(root)).toBeDisabled();expect(localStorage.getItem("miliastra-last-canvas")).toBe(stored);
 });
 it("applies with Enter, cancels with Escape, and adds no history for pivot-only changes",async()=>{
  const root=await mount(),initial=await readScene();enable(root);drag(root.querySelector('[data-handle="pivot"]')!,100,80,70,60);key("Enter");expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();
  resize(root);key("Escape");expect(await readScene()).toEqual(initial);resize(root);key("Enter");expect((await readScene()).elements[0].width).toBe(120);expect(undo(root)).toBeEnabled();
 });
 it("keeps the opposite corner fixed by default and a moved pivot fixed in center resize mode",async()=>{
  const root=await mount();enable(root);resize(root);key("Enter");let scene=await readScene();expect(scene.elements[0].x-scene.elements[0].width!/2).toBe(60);expect(scene.elements[0].y-scene.elements[0].height!/2).toBe(50);
  fireEvent.click(undo(root));fireEvent.click(row(root,"a"));fireEvent.click(within(root).getByTitle(label("canvas.centerResizeTitle")));drag(root.querySelector('[data-handle="pivot"]')!,100,80,70,60);
  drag(root.querySelector('[data-handle="se"]')!,140,110,210,160);key("Enter");scene=await readScene();expect(scene.elements[0]).toMatchObject({x:130,y:100,width:160,height:120});
 });
 it("rotates outside the frame around the moved anchor without a rotation handle",async()=>{
  const root=await mount();enable(root);drag(root.querySelector('[data-handle="pivot"]')!,100,80,60,50);
  drag(root.querySelector(".canvas-stage")!,144,50,60,134);key("Enter");const rotated=(await readScene()).elements[0];expect(rotated.x).toBeCloseTo(30,8);expect(rotated.y).toBeCloseTo(90,8);expect(rotated.rotation).toBe(270);
 });
 it("keeps a complete selected group together and commits it in one undo step",async()=>{
  const initial=makeScene([leaf("a",{x:100,y:80,groupId:"g"}),leaf("b",{x:200,y:80,groupId:"g"}),leaf("other",{x:260,y:200})]);initial.groups=[{id:"g",name:"Group",parentId:null,opacity:1,visible:true,collapsed:false,order:0}];
  const root=await mount(initial);fireEvent.click(root.querySelector('.layer-group-row[data-group-id="g"]')!);fireEvent.click(button(root,"transform.mode"));
  drag(root.querySelector(".canvas-stage")!,150,80,170,100);expect(root.querySelector("[inert]")).toBeNull();const next=await readScene();expect(next.elements.map(e=>[e.x,e.y])).toEqual([[120,100],[220,100],[260,200]]);expect(next.groups).toEqual(initial.groups);
  fireEvent.click(undo(root));expect((await readScene()).elements).toEqual(initial.elements);
 });
 it("does not expose handles for a locked target",async()=>{
  const root=await mount(makeScene([leaf("a",{locked:true})]));enable(root);expect(root.querySelector(".transform-controls")).toBeNull();expect(root.querySelector(".transform-status")).toBeInTheDocument();
 });
 it("lets a click select another canvas target without locking a transform",async()=>{
  const root=await mount();enable(root);
  fireEvent.mouseDown(shape(root,"b"),{button:0,clientX:240,clientY:180});
  fireEvent.mouseMove(window,{buttons:1,clientX:241,clientY:181});fireEvent.mouseUp(window);
  expect(row(root,"b")).toHaveClass("selected");expect(row(root,"a")).not.toHaveClass("selected");
  expect(root.querySelector("[inert]")).toBeNull();expect(undo(root)).toBeDisabled();
  fireEvent.mouseDown(root.querySelector(".canvas-stage")!,{button:0,clientX:10,clientY:10});fireEvent.mouseUp(window);
  expect(root.querySelector(".transform-controls")).toBeNull();expect(root.querySelector("[inert]")).toBeNull();
 });
 it("keeps the initial grab offset for resize and pivot handles",async()=>{
  const root=await mount(),initial=await readScene();enable(root);
  const handle=root.querySelector('[data-handle="se"]')!;
  fireEvent.mouseDown(handle,{button:0,clientX:143,clientY:113});
  fireEvent.mouseMove(window,{buttons:1,clientX:183,clientY:143});expect(shape(root).style.width).toBe("120px");
  fireEvent.mouseMove(window,{buttons:1,clientX:143,clientY:113});fireEvent.mouseUp(window);key("Enter");
  expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();
  drag(root.querySelector('[data-handle="pivot"]')!,108,85,128,75);
  const pivot=root.querySelector<HTMLElement>('[data-handle="pivot"]')!;
  expect(pivot.style.left).toBe("120px");expect(pivot.style.top).toBe("70px");key("Escape");
 });
 it("preserves native Enter and Space activation on a focused cancel button",async()=>{
  const root=await mount(),initial=await readScene();enable(root);resize(root);
  const cancel=button(root,"transform.cancel");cancel.focus();
  expect(fireEvent.keyDown(cancel,{key:"Enter",code:"Enter"})).toBe(true);
  expect(fireEvent.keyDown(cancel,{key:" ",code:"Space"})).toBe(true);
  expect(root.querySelector("[inert]")).not.toBeNull();fireEvent.click(cancel);expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();
 });
 it("keeps edge resizing single-axis when free corner resizing is off",async()=>{
  const root=await mount();enable(root);fireEvent.click(within(root).getByTitle(label("canvas.freeResizeTitle")));
  drag(root.querySelector('[data-handle="e"]')!,140,80,180,80);key("Enter");
  expect((await readScene()).elements[0]).toMatchObject({x:120,y:80,width:120,height:60});
 });
 it("cancels a held pointer gesture before any later mousemove can reapply it",async()=>{
  const root=await mount(),initial=await readScene();enable(root);
  fireEvent.mouseDown(root.querySelector('[data-handle="se"]')!,{button:0,clientX:140,clientY:110});
  fireEvent.mouseMove(window,{buttons:1,clientX:180,clientY:140});key("Escape");
  fireEvent.mouseMove(window,{buttons:1,clientX:210,clientY:160});fireEvent.mouseUp(window);
  expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();expect(root.querySelector("[inert]")).toBeNull();
 });
 it("rotates using the canvas content origin inside its border",async()=>{
  const root=await mount();enable(root);const canvas=root.querySelector<HTMLElement>(".canvas")!;
  Object.defineProperty(canvas,"clientLeft",{configurable:true,value:1});Object.defineProperty(canvas,"clientTop",{configurable:true,value:1});
  drag(root.querySelector(".canvas-stage")!,145,81,101,125);key("Enter");expect((await readScene()).elements[0].rotation).toBeCloseTo(270,8);
 });
});

describe('transform mode shortcut',()=>{
 it.each([{ctrlKey:true},{metaKey:true}])('toggles the ready mode once without changing the scene: %j',async modifier=>{
  const root=await mount(),initial=await readScene();fireEvent.click(row(root,'a'));
  key('t',{...modifier,altKey:true});expect(button(root,'transform.mode')).toHaveAttribute('aria-pressed','true');expect(root.querySelector('.transform-controls')).not.toBeNull();
  key('t',{...modifier,altKey:true,repeat:true});expect(button(root,'transform.mode')).toHaveAttribute('aria-pressed','true');
  key('t',{...modifier,altKey:true});expect(button(root,'transform.mode')).toHaveAttribute('aria-pressed','false');expect(root.querySelector('.transform-controls')).toBeNull();
  expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();
 });
 it('preserves input keys and requires the exact modifier combination',async()=>{
  const root=await mount();fireEvent.click(row(root,'a'));
  fireEvent.keyDown(propertyInput(root,'X'),{key:'t',ctrlKey:true,altKey:true});
  for(const modifiers of [{ctrlKey:true},{altKey:true},{ctrlKey:true,altKey:true,shiftKey:true}])key('t',modifiers);
  expect(button(root,'transform.mode')).toHaveAttribute('aria-pressed','false');
  const dialog=document.createElement('dialog');document.body.append(dialog);dialog.showModal();
  try{key('t',{ctrlKey:true,altKey:true});expect(button(root,'transform.mode')).toHaveAttribute('aria-pressed','false');}finally{dialog.remove();}
 });
 it('keeps pending preview changes until apply or cancel',async()=>{
  const root=await mount(),initial=await readScene();enable(root);resize(root);const width=shape(root).style.width;
  key('t',{ctrlKey:true,altKey:true});expect(root).toHaveClass('transform-locked');expect(shape(root).style.width).toBe(width);expect(button(root,'transform.mode')).toHaveAttribute('aria-pressed','true');
  key('Escape');key('t',{ctrlKey:true,altKey:true});expect(button(root,'transform.mode')).toHaveAttribute('aria-pressed','false');expect(await readScene()).toEqual(initial);expect(undo(root)).toBeDisabled();
 });
});

describe("ordinary transform of a masked layer", () => {
  it("resizes, moves and rotates the layer and mask together in one edit", async () => {
    const root = await mount(makeScene([leaf("a", { luaMask: {
      enabled: true, offsetX: 10, offsetY: 6, width: 40, height: 30,
      enableSoftEdge: true, softEdgeMode: "Pixel", softEdgeWidthX: 2, softEdgeWidthY: 3
    } }), leaf("b", { x: 240, y: 180, zIndex: 1 })]));
    const initial = await readScene();
    enable(root);
    const stage = root.querySelector(".canvas-stage")!;
    const controls = root.querySelector('[data-testid="transform-controls"]')!;
    expect(root.querySelector('[data-testid="mask-transform-controls"]')).toBeNull();
    drag(controls.querySelector('[data-handle="e"]')!, 140, 80, 180, 80);
    drag(stage, 130, 85, 150, 95);
    fireEvent.mouseMove(stage, { clientX: 212, clientY: 90 });
    expect(stage).toHaveAttribute("data-transform-cursor", "rotate");
    drag(stage, 212, 90, 140, 162);
    fireEvent.click(button(root, "transform.apply"));
    const next = await readScene();
    expect(next.elements[0]).toMatchObject({ x: 140, y: 90, width: 120, height: 60, rotation: 270 });
    const mask = (next.elements[0] as Exclude<SceneElement, {type:"smart-object"}>).luaMask!;
    expect(mask).toMatchObject({ enabled: true, width: 60, height: 30, softEdgeWidthX: 3, softEdgeWidthY: 3 });
    expect(mask.offsetX).toBeCloseTo(-6);
    expect(mask.offsetY).toBeCloseTo(15);
    expect(mask.rotation).toBe(-90);
    expect(next.elements[1]).toEqual(initial.elements[1]);
    fireEvent.click(undo(root));
    expect(await readScene()).toEqual(initial);
    expect(undo(root)).toBeDisabled();
  });
});

describe("independent mask transform mode", () => {
  beforeEach(() => {
    const raster = new WeakMap<HTMLCanvasElement, number>();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      return {
        createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: (pixels: ImageData) => {
          let fingerprint = 0;
          for (let i = 3; i < pixels.data.length; i += 4) fingerprint = Math.imul(fingerprint, 31) + pixels.data[i] | 0;
          raster.set(this, fingerprint);
        },
      } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement) {
      return "data:image/png;base64," + btoa(String(raster.get(this)));
    });
  });
  function guidesInput(root: HTMLElement) {
    return within(root).getByLabelText<HTMLInputElement>(label("luaMask.previewOnCanvas"));
  }
  async function enter(showGuides = true) {
    const root = await mount();
    const initial = await readScene();
    fireEvent.click(row(root, "a"));
    fireEvent.click(within(root).getByText(label("props.advanced"), { exact: true }));
    if (!showGuides) fireEvent.click(guidesInput(root));
    fireEvent.click(button(root, "luaMask.editTransform"));
    return { root, initial };
  }
  function point(root: HTMLElement, handle: string) {
    const target = root.querySelector<HTMLElement>('[data-testid="mask-transform-controls"] [data-handle="'+handle+'"]')!;
    return { target, x: Number.parseFloat(target.style.left), y: Number.parseFloat(target.style.top) };
  }
  it("locks the scene, moves, resizes and rotates only the mask, then applies once", async () => {
    const { root, initial } = await enter();
    for (const selector of [".topbar", ".sidebar-left", ".canvas-toolbar", ".sidebar-right .sidebar-tabs", ".props-switch", '[role="tablist"]', ".mask-inspector-settings"]) {
      expect(root.querySelector(selector)).toHaveAttribute("inert");
    }
    const stage = root.querySelector<HTMLElement>(".canvas-stage")!;
    expect(stage).toHaveClass("transform-ready");
    expect(root.querySelector('[data-handle="rotate"]')).toBeNull();
    const move = point(root, "move");
    fireEvent.mouseMove(stage, { clientX: move.x + 10, clientY: move.y });
    expect(stage).toHaveAttribute("data-transform-cursor", "move");
    drag(stage, move.x + 10, move.y, move.x + 30, move.y - 10);
    const size = point(root, "se");
    drag(size.target, size.x, size.y, size.x + 30, size.y + 20);
    const center = point(root, "move"), top = point(root, "n");
    expect(center.x).toBe(move.x + 35);
    expect(center.y).toBe(move.y);
    const radius = center.y - top.y + 10;
    fireEvent.mouseMove(stage, { clientX: center.x, clientY: center.y - radius });
    expect(stage).toHaveAttribute("data-transform-cursor", "rotate");
    expect(stage.style.getPropertyValue("--transform-rotate-cursor")).toContain("data:image/svg+xml");
    drag(stage, center.x, center.y - radius, center.x + radius, center.y);
    expect(point(root, "n").x).toBeCloseTo(center.x + 40);
    expect(point(root, "n").y).toBeCloseTo(center.y);
    fireEvent.mouseDown(shape(root, "b"), { button: 0, clientX: 240, clientY: 180 });
    fireEvent.mouseUp(window);
    key("Delete");
    const unavailable = await tools.get("get_scene")!.execute({}, {});
    expect(unavailable).not.toHaveProperty("elements");
    fireEvent.click(button(root, "transform.apply"));
    const next = await readScene();
    expect(next.elements[0]).toEqual({ ...initial.elements[0], luaMask: expect.objectContaining({
      enabled: false, offsetX: 35, offsetY: 0, width: initial.elements[0].width + 30,
      height: initial.elements[0].height + 20, rotation: -90
    }) });
    expect(next.elements[1]).toEqual(initial.elements[1]);
    expect(root.querySelector(".sidebar-left")).not.toHaveAttribute("inert");
    key("z", { ctrlKey: true });
    expect(await readScene()).toEqual(initial);
    expect(undo(root)).toBeDisabled();
  });
  it("moves both guide surfaces without encoding another mask before pointer release", async () => {
    const { root } = await enter();
    const guide = () => shape(root).querySelector(".mask-hidden-overlay image")!;
    const coverage = () => root.querySelector(".mask-coverage-board image")!;
    const positions = () => [guide().getAttribute("transform"), coverage().getAttribute("transform")];
    const sources = () => [guide().getAttribute("href"), coverage().getAttribute("href")];
    const startPositions = positions(), startSources = sources();
    expect(startSources.every(source => source?.startsWith("data:image/png"))).toBe(true);
    const encodes = vi.mocked(HTMLCanvasElement.prototype.toDataURL).mock.calls.length;
    const move = point(root, "move");
    fireEvent.mouseDown(move.target, { button: 0, clientX: move.x, clientY: move.y });
    for (const distance of [4, 8, 16]) {
      const previous = positions();
      fireEvent.mouseMove(window, { buttons: 1, clientX: move.x + distance, clientY: move.y - distance / 2 });
      expect(positions()[0]).toBe("translate(" + distance + " " + (-distance / 2) + ") rotate(0)");
      expect(positions()[1]).not.toBe(previous[1]);
    }
    expect(sources()).toEqual(startSources);
    expect(vi.mocked(HTMLCanvasElement.prototype.toDataURL)).toHaveBeenCalledTimes(encodes);
    fireEvent.mouseUp(window);
    key("Escape");
    expect(coverage().getAttribute("transform")).toBe(startPositions[1]);
  });
  it("refreshes the main clip and right mask coverage before release, then restores them on cancel", async () => {
    const { root, initial } = await enter(false);
    const clip = () => shape(root).querySelector<HTMLElement>(".lua-mask-preview")?.style.maskImage;
    const coverage = () => root.querySelector(".sidebar-right .mask-coverage-board image")?.getAttribute("href");
    const heading = () => root.querySelector(".sidebar-right .mask-coverage-heading span");
    const oldClip = clip(), oldCoverage = coverage();
    expect(oldClip).toBeTruthy();
    expect(oldCoverage).toBeTruthy();
    expect(heading()).toHaveTextContent("80 × 60");
    const east = point(root, "e");
    fireEvent.mouseDown(east.target, { button: 0, clientX: east.x, clientY: east.y });
    fireEvent.mouseMove(window, { buttons: 1, clientX: east.x - 30, clientY: east.y });
    expect(clip()).toBeTruthy();
    expect(clip()).not.toBe(oldClip);
    expect(coverage()).toBeTruthy();
    expect(coverage()).not.toBe(oldCoverage);
    expect(heading()).toHaveTextContent("50 × 60");
    expect(heading()?.closest("[inert]")).toHaveClass("mask-inspector-settings");
    expect(shape(root).style.width).toBe("80px");
    fireEvent.mouseUp(window);
    key("Escape");
    expect(coverage()).toBe(oldCoverage);
    expect(heading()).toHaveTextContent("80 × 60");
    expect(clip()).toBeUndefined();
    expect(await readScene()).toEqual(initial);
    expect(undo(root)).toBeDisabled();
  });
  it("toggles only the guide display during a mask edit", async () => {
    const { root, initial } = await enter();
    const input = guidesInput(root);
    const outline = () => shape(root).querySelector(".mask-guide-outline g");
    const clip = () => shape(root).querySelector(".lua-mask-preview");
    const coverage = () => root.querySelector(".sidebar-right .mask-coverage-heading span");
    expect(input.closest("[inert]")).toBeNull();
    expect(input).toBeEnabled();
    expect(input).toBeChecked();
    expect(outline()).not.toBeNull();
    expect(clip()).toBeNull();
    fireEvent.click(input);
    expect(input).not.toBeChecked();
    expect(outline()).toBeNull();
    expect(clip()).not.toBeNull();
    const east = point(root, "e");
    drag(east.target, east.x, east.y, east.x - 30, east.y);
    expect(coverage()).toHaveTextContent("50 × 60");
    fireEvent.click(input);
    expect(input).toBeChecked();
    expect(outline()?.querySelector("rect")).toHaveAttribute("width", "50");
    expect(clip()).toBeNull();
    expect(coverage()).toHaveTextContent("50 × 60");
    fireEvent.click(button(root, "transform.cancel"));
    expect(await readScene()).toEqual(initial);
    expect(undo(root)).toBeDisabled();
  });
  it("previews area reversal during editing and saves it only on apply", async () => {
    const { root, initial } = await enter(false);
    const reverse = () => within(root).getByLabelText<HTMLInputElement>(label("luaMask.reverse"));
    const clip = () => shape(root).querySelector<HTMLElement>(".lua-mask-preview")?.style.maskImage;
    const coverage = () => root.querySelector(".mask-coverage-board image")?.getAttribute("href");
    const normalClip = clip(), normalCoverage = coverage();
    expect(normalClip).toBeTruthy();
    expect(normalCoverage).toBeTruthy();
    expect(reverse().closest("[inert]")).toBeNull();
    expect(reverse()).not.toBeChecked();
    fireEvent.click(reverse());
    expect(reverse()).toBeChecked();
    expect(clip()).not.toBe(normalClip);
    expect(coverage()).not.toBe(normalCoverage);
    fireEvent.click(reverse());
    expect(clip()).toBe(normalClip);
    expect(coverage()).toBe(normalCoverage);
    fireEvent.click(reverse());
    fireEvent.click(button(root, "transform.cancel"));
    expect(reverse()).not.toBeChecked();
    expect(await readScene()).toEqual(initial);
    expect(undo(root)).toBeDisabled();

    fireEvent.click(button(root, "luaMask.editTransform"));
    fireEvent.click(reverse());
    const east = point(root, "e");
    drag(east.target, east.x, east.y, east.x - 30, east.y);
    expect(reverse()).toBeChecked();
    fireEvent.click(button(root, "transform.apply"));
    expect((await readScene()).elements[0]).toEqual({ ...initial.elements[0], luaMask: expect.objectContaining({
      enabled: false, reverseMaskArea: true, width: 50, offsetX: -15,
    }) });
    fireEvent.click(undo(root));
    expect(await readScene()).toEqual(initial);
    expect(undo(root)).toBeDisabled();
  });
  it("cancels a mask draft without changing the scene or adding history", async () => {
    const { root, initial } = await enter();
    key("ArrowRight", { shiftKey: true });
    expect(point(root, "move").x).toBe(initial.elements[0].x + 10);
    key("Escape");
    expect(root.querySelector('[data-testid="mask-transform-controls"]')).toBeNull();
    expect(await readScene()).toEqual(initial);
    expect(undo(root)).toBeDisabled();
  });
});
