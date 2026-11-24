import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import App, { type SceneDocument, type SceneElement, type SceneGroup, type SceneLeaf } from "../src/App";
import { I18nProvider, translations } from "../src/i18n";
import type { SmartObject } from "../src/smartObjectModel";
import { rotationMatrix } from "../src/rotation";

type RegisteredTool = Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0];
const registeredTools = new Map<string, RegisteredTool>();

function label(key: string): string {
  const value = translations.zh[key];
  if (typeof value !== "string") throw new Error("Expected a static translated label: " + key);
  return value;
}

function leaf(id: string, patch: Partial<SceneLeaf> = {}): SceneLeaf {
  return {
    id, name: id, layerName: id, type: "rectangle", x: 50, y: 40,
    width: 40, height: 30, rotation: 0, color: "#c2410c", opacity: 1,
    zIndex: 0, isBackground: false, visible: true, groupId: null, ...patch
  };
}

function group(id: string, patch: Partial<SceneGroup> = {}): SceneGroup {
  return { id, name: id, parentId: null, visible: true, opacity: 1, collapsed: false, order: 0, ...patch };
}

function object(patch: Partial<SmartObject> = {}): SmartObject {
  return {
    id: "object", name: "Test object", layerName: "Test object", type: "smart-object",
    x: 150, y: 120, rotation: 0, opacity: 1, zIndex: 0, visible: true, groupId: null, scale: 1,
    content: {
      frame: { width: 120, height: 100 },
      elements: [leaf("inside-a", { groupId: "inside-group" }),
        leaf("inside-b", { type: "ellipse", x: 85, y: 65, zIndex: 1, groupId: "inside-nested" })],
      groups: [group("inside-group"), group("inside-nested", { parentId: "inside-group" })]
    }, ...patch
  };
}

function scene(elements: SceneElement[], groups: SceneGroup[] = []): SceneDocument {
  return {
    schemaVersion: 2, canvas: { width: 300, height: 240, background: "transparent" }, elements, groups,
    meta: { sourceType: "editor", sourceName: "smart-object-app-test", warnings: [] },
    library: {
      activeCategory: "basic-shape",
      categories: [{ key: "basic-shape", label: "基础形状", supported: true }],
      baseShapePresets: [], savedItems: []
    }
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("miliastra-editor-lang", "zh");
  localStorage.setItem("miliastra-editor-tour-seen", "1");
  registeredTools.clear();
  // Keep the real App bridge: tests only execute its public read-only get_scene tool.
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool: async (tool: RegisteredTool) => { registeredTools.set(tool.name, tool); } }
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("/api/library/catalog")) {
      return new Response(JSON.stringify({ images: {}, categories: {}, names: {} }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }
    throw new Error("Unexpected network request in App integration test: " + url);
  }));
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
  vi.unstubAllGlobals();
});

async function mount(initial: SceneDocument) {
  // Exercise the same persisted-scene restore path used by the real application.
  localStorage.setItem("miliastra-last-canvas", JSON.stringify({ name: "App regression", scene: initial, savedAt: 1 }));
  localStorage.setItem("miliastra-restore-on-load", "1");
  const view = render(<I18nProvider><App /></I18nProvider>);
  const main = view.container.querySelector<HTMLElement>(".app-shell")!;
  await waitFor(async () => expect((await readScene()).elements).toHaveLength(initial.elements.length));
  return main;
}

async function readScene(): Promise<SceneDocument> {
  const tool = registeredTools.get("get_scene");
  if (!tool) throw new Error("App did not register get_scene");
  const result = await tool.execute({}, {});
  if (!result || typeof result !== "object" || !("elements" in result)) {
    throw new Error("Main scene is unavailable: " + JSON.stringify(result));
  }
  return result as SceneDocument;
}

function row(root: HTMLElement, id: string): HTMLElement {
  const target = root.querySelector<HTMLElement>('.layer-row-item[data-element-id="' + id + '"]');
  if (!target) throw new Error("Missing layer row: " + id);
  return target;
}

function shape(root: HTMLElement, id: string): HTMLElement {
  const target = root.querySelector<HTMLElement>('.shape[data-element-id="' + id + '"]');
  if (!target) throw new Error("Missing canvas layer: " + id);
  return target;
}

function editor(main: HTMLElement): HTMLElement {
  const target = main.querySelector<HTMLElement>(".object-editor-overlay .app-shell");
  if (!target) throw new Error("Object editor is not open");
  return target;
}

function openEditor(main: HTMLElement, id = "object"): HTMLElement {
  fireEvent.doubleClick(within(row(main, id)).getByTitle(label("smartObject.edit")));
  return editor(main);
}

function command(key: string, shiftKey = false) {
  fireEvent.keyDown(document.body, { key, ctrlKey: true, shiftKey });
  fireEvent.keyUp(document.body, { key, ctrlKey: true, shiftKey });
}

function nudgeRight(root: HTMLElement, id: string) {
  fireEvent.click(row(root, id));
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  fireEvent.keyUp(document.body, { key: "ArrowRight" });
}

function save(root: HTMLElement) {
  fireEvent.click(within(root).getByRole("button", { name: label("smartObject.save") }));
}

function finish(root: HTMLElement) {
  fireEvent.click(within(root).getByRole("button", { name: label("smartObject.finish") }));
}

function undoButton(main: HTMLElement): HTMLButtonElement {
  return within(main).getByTitle(label("topbar.undoShort")) as HTMLButtonElement;
}

function redoButton(main: HTMLElement): HTMLButtonElement {
  return within(main).getByTitle(label("topbar.redoShort")) as HTMLButtonElement;
}

function savedObject(document: SceneDocument, id = "object"): SmartObject {
  const found = document.elements.find(element => element.id === id);
  if (!found || found.type !== "smart-object") throw new Error("Missing saved object: " + id);
  return found;
}

function worldCenter(smart: SmartObject, id = "inside-a") {
  const child = smart.content.elements.find(element => element.id === id)!;
  const { a, b, c, d } = rotationMatrix(smart);
  const x = child.x - smart.content.frame.width / 2, y = child.y - smart.content.frame.height / 2;
  return { x: smart.x + smart.scale * (a * x + c * y), y: smart.y + smart.scale * (b * x + d * y) };
}
function expectWorldOffset(actual: SmartObject, initial: SmartObject, dx: number, dy = 0, id = "inside-a") {
  const from = worldCenter(initial, id), to = worldCenter(actual, id), { a, b, c, d } = rotationMatrix(initial);
  expect(to.x).toBeCloseTo(from.x + initial.scale * (a * dx + c * dy), 9);
  expect(to.y).toBeCloseTo(from.y + initial.scale * (b * dx + d * dy), 9);
}

function firstObjectVisual(main: HTMLElement, id = "object"): HTMLElement {
  return shape(main, id).querySelector<HTMLElement>(".smart-object-content > .shape")!;
}

function effectiveVisualOpacity(visual: HTMLElement, boundary: HTMLElement) {
  let opacity = 1;
  for (let node: HTMLElement | null = visual; node && node !== boundary; node = node.parentElement) {
    if (node.style.opacity !== "") opacity *= Number(node.style.opacity);
  }
  return opacity;
}

describe("real App smart-object integration", () => {
  it("resolves a default mask, releases and restores its original null type with one undo", async () => {
    const smart=object({scale: .5, rotation: 30});
    smart.content.elements[0].luaMask={enabled:true,imageId:100003,imageType:null,width:60,height:60};
    const realFetch=globalThis.fetch;
    vi.stubGlobal("fetch",vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).includes("/meta/100003")
      ? new Response(JSON.stringify({id:100003,width:256,height:256,border:{left:0,right:0,top:0,bottom:0}}),{status:200})
      : realFetch(input,init)));
    const main=await mount(scene([smart])); const before=await readScene();
    fireEvent.click(row(main,"object"));
    fireEvent.click(within(main).getByRole("button",{name:label("smartObject.release")}));
    await waitFor(async()=>expect((await readScene()).elements.some(e=>e.type==="smart-object")).toBe(false));
    expect((await readScene()).elements[0].luaMask?.imageType).toBe("basic");
    fireEvent.click(undoButton(main)); expect(await readScene()).toEqual(before);
  });
  it("shows release failure without changing the document or adding undo history", async () => {
    const smart=object({scale:.5});
    smart.content.elements[0].luaMask={enabled:true,imageId:100004,imageType:"stretch",width:60,height:60};
    const main=await mount(scene([smart])); const before=await readScene();
    fireEvent.click(row(main,"object"));
    fireEvent.click(within(main).getByRole("button",{name:label("smartObject.release")}));
    await waitFor(()=>expect(within(main).getByRole("alert").textContent).toContain("mask transform"));
    expect(await readScene()).toEqual(before); expect(undoButton(main).disabled).toBe(true);
    fireEvent.click(within(main).getByRole("button",{name:label("smartObject.dismissReleaseError")}));
    expect(within(main).queryByRole("alert")).toBeNull();
  });
  it("does not overwrite edits made while asset information is pending", async () => {
    const smart=object({scale:.5});
    smart.content.elements[0].luaMask={enabled:true,imageId:100005,imageType:null,width:60,height:60};
    let complete!: (response: Response)=>void;
    const realFetch=globalThis.fetch;
    vi.stubGlobal("fetch",vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).includes("/meta/100005")
      ? new Promise<Response>(resolve=>{complete=resolve;}) : realFetch(input,init)));
    const main=await mount(scene([smart])); fireEvent.click(row(main,"object"));
    fireEvent.click(within(main).getByRole("button",{name:label("smartObject.release")}));
    await waitFor(()=>expect(complete).toBeTypeOf("function"));
    nudgeRight(main,"object"); const changed=await readScene();
    complete(new Response(JSON.stringify({id:100005,width:256,height:256,border:{left:0,right:0,top:0,bottom:0}}),{status:200}));
    await waitFor(()=>expect(within(main).getByRole("alert")).toBeTruthy());
    expect(await readScene()).toEqual(changed);
  });
  it.each(["single-root", "multiple-roots", "loose-leaf"])("releases %s with the correct group selected and one undo step", async mode => {
    const initialObject = object({groupId:"outer", opacity:.5, rotation:25, scale:1.25});
    if (mode === "multiple-roots") initialObject.content.groups[1].parentId = null;
    if (mode === "loose-leaf") initialObject.content.elements[0].groupId = null;
    initialObject.content.groups[0].opacity = .4;
    const initial=scene([initialObject], [group("outer")]);
    const main=await mount(initial);
    const restoredInitial=await readScene();
    fireEvent.click(row(main,"object"));
    fireEvent.click(within(main).getByRole("button", {name:label("smartObject.release")}));
    await waitFor(async () => expect((await readScene()).elements.every(element=>element.type!=="smart-object")).toBe(true));
    const released=await readScene();
    const expectedGroup=mode === "single-root" ? "inside-group" : "object";
    expect(released.elements.every(element=>element.type!=="smart-object")).toBe(true);
    expect(released.groups).toHaveLength(mode === "single-root" ? 3 : 4);
    expect(released.groups?.find(item=>item.id===expectedGroup)?.parentId).toBe("outer");
    expect(main.querySelector('.layer-group-row.selected')?.getAttribute("data-group-id")).toBe(expectedGroup);
    for(const child of initialObject.content.elements) {
      const expected=worldCenter(initialObject,child.id), actual=released.elements.find(item=>item.id===child.id)!;
      expect(actual.x).toBeCloseTo(expected.x,9); expect(actual.y).toBeCloseTo(expected.y,9);
      expect(actual.width).toBeCloseTo(child.width*initialObject.scale,9);
    }
    if(mode === "single-root") {
      expect(released.groups?.find(item=>item.id==="inside-group")?.opacity).toBeCloseTo(.2,9);
      expect(released.groups?.find(item=>item.id==="inside-nested")?.parentId).toBe("inside-group");
    }
    fireEvent.click(undoButton(main));
    expect(await readScene()).toEqual(restoredInitial); expect(undoButton(main)).toBeDisabled();
    fireEvent.click(redoButton(main)); expect(await readScene()).toEqual(released);
  });
  it.each([false, true])("opens content by double-clicking the layer thumbnail when selected=%s without changing scene history", async selected => {
    const initial = object();
    const main = await mount(scene([initial]));
    const objectRow = row(main, initial.id);
    if (selected) fireEvent.click(objectRow);
    const thumbnail = objectRow.querySelector<HTMLElement>(".glyph")!;
    // The two click events preceding dblclick must still select the layer normally.
    fireEvent.click(thumbnail);
    expect(objectRow).toHaveAttribute("aria-pressed", "true");
    expect(main.querySelector(".object-editor-overlay")).not.toBeInTheDocument();
    fireEvent.click(thumbnail);
    fireEvent.doubleClick(thumbnail);
    const draft = editor(main);
    expect(draft.querySelector(".object-editor-info strong")).toHaveTextContent(initial.layerName!);
    expect(row(draft, "inside-a")).toBeInTheDocument();
    expect(main.querySelector("dialog[open]")).not.toBeInTheDocument();
    finish(draft);
    expect(savedObject(await readScene())).toEqual(initial);
    expect(undoButton(main)).toBeDisabled();
  });

  it("does not open object content from a normal thumbnail or the object row details", async () => {
    const main = await mount(scene([object(), leaf("ordinary", { zIndex: 1 })]));
    const ordinaryRow = row(main, "ordinary");
    fireEvent.click(ordinaryRow.querySelector(".glyph")!);
    fireEvent.doubleClick(ordinaryRow.querySelector(".glyph")!);
    expect(ordinaryRow).toHaveAttribute("aria-pressed", "true");
    expect(main.querySelector(".object-editor-overlay")).not.toBeInTheDocument();
    fireEvent.doubleClick(row(main, "object").querySelector(".layer-info span")!);
    expect(main.querySelector(".object-editor-overlay")).not.toBeInTheDocument();
    expect(undoButton(main)).toBeDisabled();
  });
  it.each(["group", "selection"] as const)("converts a %s through its actual layer menu and undoes atomically", async mode => {
    const initial = scene([
      leaf("a", { groupId: mode === "group" ? "source-group" : null }),
      leaf("b", { x: 110, zIndex: 1, groupId: mode === "group" ? "source-group" : null }),
      leaf("outside", { x: 220, zIndex: 2 })
    ], mode === "group" ? [group("source-group", { name: "Source group", opacity: 0.7 })] : []);
    const main = await mount(initial);
    if (mode === "group") {
      fireEvent.contextMenu(main.querySelector('[data-group-id="source-group"]')!);
    } else {
      fireEvent.click(row(main, "a"));
      fireEvent.click(row(main, "b"), { ctrlKey: true });
      expect(row(main, "a")).toHaveAttribute("aria-pressed", "true");
      expect(row(main, "b")).toHaveAttribute("aria-pressed", "true");
      fireEvent.contextMenu(row(main, "b"));
    }
    fireEvent.click(within(main).getByRole("button", { name: label("smartObject.convert") }));
    const converted = await readScene();
    const packed = converted.elements.find(element => element.type === "smart-object") as SmartObject;
    expect(packed).toBeDefined();
    expect(converted.elements).toHaveLength(2);
    expect(packed.content.elements.map(element => element.id).sort()).toEqual(["a", "b"]);
    expect(packed.content.frame.width).toBeGreaterThan(0);
    expect(packed.content.frame.height).toBeGreaterThan(0);
    expect(converted.elements.find(element => element.id === "outside")).toEqual({ ...initial.elements[2], zIndex: 1 });
    expect(redoButton(main)).toBeDisabled();
    fireEvent.click(undoButton(main));
    expect((await readScene()).elements).toEqual(initial.elements);
    expect((await readScene()).groups).toEqual(initial.groups);
    expect(undoButton(main)).toBeDisabled();
    fireEvent.click(redoButton(main));
    expect((await readScene()).elements).toEqual(converted.elements);
  });

  it("isolates internal undo/redo and applies each changed save once, with no-op save/finish adding no main history", async () => {
    const main = await mount(scene([object()]));
    expect(undoButton(main)).toBeDisabled();
    const draft = openEditor(main);
    nudgeRight(draft, "inside-a");
    expect(shape(draft, "inside-a").style.left).toBe("51px");
    expect(firstObjectVisual(main).style.left).toBe("50px");
    expect(undoButton(main)).toBeDisabled();
    command("z");
    expect(shape(draft, "inside-a").style.left).toBe("50px");
    command("z", true);
    expect(shape(draft, "inside-a").style.left).toBe("51px");
    command("s");
    expect(editor(main)).toBe(draft);
    expect(firstObjectVisual(main).style.left).toBe("20px");
    expect(within(draft).getByRole("status")).toHaveTextContent(label("smartObject.saved"));
    expect(undoButton(main)).toBeEnabled();
    // Internal history survives a save and never consumes the parent's history.
    nudgeRight(draft, "inside-a");
    command("z");
    expect(shape(draft, "inside-a").style.left).toBe("20px");
    command("z", true);
    expect(shape(draft, "inside-a").style.left).toBe("21px");
    save(draft);
    save(draft);
    finish(draft);
    expect(main.querySelector(".object-editor-overlay")).not.toBeInTheDocument();
    expectWorldOffset(savedObject(await readScene()), object(), 2);
    fireEvent.click(undoButton(main));
    expectWorldOffset(savedObject(await readScene()), object(), 1);
    fireEvent.click(undoButton(main));
    expect(savedObject(await readScene()).content.elements[0].x).toBe(50);
    expect(undoButton(main)).toBeDisabled();
    fireEvent.click(redoButton(main));
    expectWorldOffset(savedObject(await readScene()), object(), 1);
    fireEvent.click(redoButton(main));
    expectWorldOffset(savedObject(await readScene()), object(), 2);
    expect(redoButton(main)).toBeDisabled();
  });

  it("finishes an unsaved draft in one main transaction and fits its frame without moving the edited content", async () => {
    const initial = object();
    const main = await mount(scene([initial]));
    const draft = openEditor(main);
    nudgeRight(draft, "inside-a");
    nudgeRight(draft, "inside-a");
    finish(draft);
    const finished = savedObject(await readScene());
    expectWorldOffset(finished, initial, 2);
    expectWorldOffset(finished, initial, 0, 0, "inside-b");
    expect(finished.content.frame).toEqual({ width: 73, height: 55 });
    expect([finished.scale, finished.rotation]).toEqual([1, 0]);
    fireEvent.click(undoButton(main));
    expect(savedObject(await readScene()).content).toEqual(initial.content);
    expect(undoButton(main)).toBeDisabled();
  });

  it.each([false, true])("discards only unsaved content (already saved: %s)", async saveFirst => {
    const initial = object();
    const main = await mount(scene([initial]));
    const draft = openEditor(main);
    nudgeRight(draft, "inside-a");
    if (saveFirst) save(draft);
    nudgeRight(draft, "inside-a");
    fireEvent.click(within(draft).getByRole("button", { name: label("smartObject.discard") }));
    const prompt = within(draft).getByRole("alertdialog");
    fireEvent.click(within(prompt).getByRole("button", { name: label("smartObject.discard") }));
    expect(main.querySelector(".object-editor-overlay")).not.toBeInTheDocument();
    expectWorldOffset(savedObject(await readScene()), initial, saveFirst ? 1 : 0);
    if (saveFirst) {
      fireEvent.click(undoButton(main));
      expect(savedObject(await readScene()).content.elements[0].x).toBe(50);
    }
    expect(undoButton(main)).toBeDisabled();
  });

  it("blocks object keyboard and clipboard edits while the unsaved-close confirmation is open", async () => {
    const main = await mount(scene([object()]));
    const draft = openEditor(main);
    nudgeRight(draft, "inside-a");
    fireEvent.click(within(draft).getByRole("button", { name: label("smartObject.close") }));
    const prompt = within(draft).getByRole("alertdialog");
    const setData = vi.fn();
    fireEvent.copy(document.body, { clipboardData: { setData } });
    command("s");
    command("d");
    fireEvent.keyDown(document.body, { key: "Delete" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyUp(document.body, { key: "ArrowRight" });
    command("z");
    expect(setData).not.toHaveBeenCalled();
    expect(firstObjectVisual(main).style.left).toBe("50px");
    expect(shape(draft, "inside-a").style.left).toBe("51px");
    expect(draft.querySelectorAll(".layer-row-item[data-element-id]")).toHaveLength(2);
    expect(within(draft).getByRole("alertdialog")).toBe(prompt);
    fireEvent.click(within(prompt).getByRole("button", { name: label("smartObject.keepEditing") }));
    expect(within(draft).queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(draft).getByRole("status")).toHaveTextContent(label("smartObject.unsaved"));
    finish(draft);
    expectWorldOffset(savedObject(await readScene()), object(), 1);
  });

  it.each(["duplicate", "clipboard"] as const)("makes a fully independent object through %s and saves edits only into the copy", async method => {
    const initial = object();
    const main = await mount(scene([initial]));
    fireEvent.click(row(main, "object"));
    if (method === "duplicate") command("d");
    else {
      let clipboard = "";
      fireEvent.copy(document.body, { clipboardData: { setData: (_format: string, value: string) => { clipboard = value; } } });
      expect(JSON.parse(clipboard).format).toBe("miliastra-editor-selection");
      fireEvent.paste(document.body, { clipboardData: { getData: () => clipboard } });
    }
    const copied = await readScene();
    expect(copied.elements).toHaveLength(2);
    const original = savedObject(copied);
    const copy = copied.elements.find(element => element.id !== "object") as SmartObject;
    expect(copy.type).toBe("smart-object");
    expect(copy.content).not.toBe(original.content);
    expect(copy.content.elements[0]).not.toBe(original.content.elements[0]);
    expect(copy.content.groups[0]).not.toBe(original.content.groups[0]);
    const originalIds = new Set([original.id, ...original.content.elements.map(element => element.id), ...original.content.groups.map(item => item.id)]);
    const copyIds = [copy.id, ...copy.content.elements.map(element => element.id), ...copy.content.groups.map(item => item.id)];
    expect(new Set(copyIds).size).toBe(copyIds.length);
    expect(copyIds.every(id => !originalIds.has(id))).toBe(true);
    const copyGroups = new Set(copy.content.groups.map(item => item.id));
    expect(copy.content.elements.every(element => !element.groupId || copyGroups.has(element.groupId))).toBe(true);
    expect(copy.content.groups.every(item => !item.parentId || copyGroups.has(item.parentId))).toBe(true);
    const draft = openEditor(main, copy.id);
    nudgeRight(draft, copy.content.elements[0].id);
    finish(draft);
    const edited = await readScene();
    expect(savedObject(edited).content).toEqual(initial.content);
    expectWorldOffset(savedObject(edited, copy.id), copy, 1, 0, copy.content.elements[0].id);
    fireEvent.click(undoButton(main));
    expect(savedObject(await readScene(), copy.id).content).toEqual(copy.content);
    expect(savedObject(await readScene()).content).toEqual(initial.content);
  });

  it("multiplies shell, leaf and nested group opacity exactly once, including ordinary leaves", async () => {
    const smart = object({ opacity: 0.6, groupId: "outer" });
    smart.content.elements[0].opacity = 0.4;
    smart.content.elements[0].groupId = "inside-nested";
    smart.content.groups[0].opacity = 0.5;
    smart.content.groups[1].opacity = 0.8;
    const main = await mount(scene([
      smart, leaf("ordinary", { x: 240, opacity: 0.4, groupId: "outer-nested", zIndex: 1 })
    ], [group("outer", { opacity: 0.5 }), group("outer-nested", { parentId: "outer", opacity: 0.8 })]));
    const ordinary = shape(main, "ordinary").querySelector<HTMLElement>(".shape-content")!;
    const child = firstObjectVisual(main).querySelector<HTMLElement>(".shape-content")!;
    expect(Number(ordinary.style.opacity)).toBeCloseTo(0.4 * 0.5 * 0.8);
    expect(effectiveVisualOpacity(ordinary, main)).toBeCloseTo(0.4 * 0.5 * 0.8);
    expect(Number(child.style.opacity)).toBeCloseTo(0.6 * 0.5 * 0.4 * 0.5 * 0.8);
    expect(effectiveVisualOpacity(child, main)).toBeCloseTo(0.6 * 0.5 * 0.4 * 0.5 * 0.8);
    fireEvent.click(row(main, "object"));
    fireEvent.change(within(main).getByRole("spinbutton", { name: label("smartObject.opacity") }), { target: { value: "80" } });
    expect(savedObject(await readScene()).opacity).toBe(0.8);
    expect(effectiveVisualOpacity(child, main)).toBeCloseTo(0.8 * 0.5 * 0.4 * 0.5 * 0.8);
  });

  it("keeps object overflow visible and preserves internal zIndex regardless of the GIA background marker", async () => {
    const smart = object({ content: {
      frame: { width: 120, height: 100 }, groups: [], elements: [
        leaf("foreground", { zIndex: 0 }),
        leaf("background", { type: "ellipse", zIndex: 5, isBackground: true, x: 0, width: 200 })
      ]
    } });
    const main = await mount(scene([smart]));
    const content = shape(main, "object").querySelector<HTMLElement>(".smart-object-content")!;
    expect(content.style.overflow).toBe("visible");
    const background = content.querySelector<HTMLElement>(".shape-ellipse")!;
    const foreground = content.querySelector<HTMLElement>(".shape-rectangle")!;
    const backgroundZ = Number(background.style.zIndex || 0);
    const foregroundZ = Number(foreground.style.zIndex || 0);
    expect(backgroundZ).toBe(5);
    expect(foregroundZ).toBe(0);
  });
  it("saves the object while a numeric property input has focus", async () => {
    const main = await mount(scene([object()]));
    const draft = openEditor(main);
    nudgeRight(draft, "inside-a");
    const input = Array.from(draft.querySelectorAll<HTMLInputElement>('input[type="number"]')).find(item => item.value === "51");
    expect(input).toBeDefined();
    input!.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input!, { key: "s", ctrlKey: true });
    fireEvent.keyUp(input!, { key: "s", ctrlKey: true });
    expect(editor(main)).toBe(draft);
    expect(firstObjectVisual(main).style.left).toBe("20px");
    expect(within(draft).getByRole("status")).toHaveTextContent(label("smartObject.saved"));
    finish(draft);
    fireEvent.click(undoButton(main));
    expect(savedObject(await readScene()).content.elements[0].x).toBe(50);
    expect(undoButton(main)).toBeDisabled();
  });

  it("rejects non-contiguous multi-selection conversion without changing main history", async () => {
    const initial = scene([leaf("a"), leaf("middle", { zIndex: 1 }), leaf("c", { zIndex: 2 })]);
    const main = await mount(initial);
    fireEvent.click(row(main, "a"));
    fireEvent.click(row(main, "c"), { ctrlKey: true });
    fireEvent.contextMenu(row(main, "c"));
    fireEvent.click(within(main).getByRole("button", { name: label("smartObject.convert") }));
    expect((await readScene()).elements).toEqual(initial.elements);
    expect(undoButton(main)).toBeDisabled();
    expect(within(main).getByText(label("smartObject.groupFirst"))).toBeInTheDocument();
  });
  it("does not paste an outer smart object into the isolated content editor", async () => {
    const initial = object();
    const main = await mount(scene([initial]));
    fireEvent.click(row(main, "object"));
    let clipboard = "";
    fireEvent.copy(document.body, { clipboardData: { setData: (_format: string, value: string) => { clipboard = value; } } });
    expect(JSON.parse(clipboard).elements[0].type).toBe("smart-object");
    const draft = openEditor(main);
    fireEvent.paste(document.body, { clipboardData: { getData: () => clipboard } });
    expect(draft.querySelectorAll(".smart-object-content")).toHaveLength(0);
    expect(within(draft).getByRole("status")).toHaveTextContent(label("smartObject.saved"));
    // Ordinary local leaf copy/paste remains available in the same editor.
    fireEvent.click(row(draft, "inside-a"));
    fireEvent.copy(document.body, { clipboardData: { setData: (_format: string, value: string) => { clipboard = value; } } });
    fireEvent.paste(document.body, { clipboardData: { getData: () => clipboard } });
    finish(draft);
    const result = savedObject(await readScene());
    expect(result.content.elements).toHaveLength(initial.content.elements.length + 1);
    expect(result.content.elements.every(element => element.type !== ("smart-object" as string))).toBe(true);
    fireEvent.click(undoButton(main));
    expect(savedObject(await readScene()).content).toEqual(initial.content);
    expect(undoButton(main)).toBeDisabled();
  });
  it.each(["inspector", "layer"] as const)("uses the current %s rename in the content editor title, including undo and redo", async source => {
    const initial = object();
    const main = await mount(scene([initial]));
    const renamed = "已改名的智能对象";
    fireEvent.click(row(main, "object"));
    if (source === "inspector") {
      fireEvent.change(within(main).getByRole("textbox", { name: label("smartObject.name") }), { target: { value: renamed } });
    } else {
      fireEvent.doubleClick(row(main, "object").querySelector("strong")!);
      const dialog = within(main).getByRole("dialog");
      expect(main.querySelector(".object-editor-overlay")).not.toBeInTheDocument();
      fireEvent.change(within(dialog).getByRole("textbox", { name: label("layer.nameLabel") }), { target: { value: renamed } });
      fireEvent.click(within(dialog).getByRole("button", { name: label("layer.confirm") }));
    }
    expect(savedObject(await readScene()).layerName).toBe(renamed);
    expect(savedObject(await readScene()).name).toBe(initial.name);
    const assertTitle = (expected: string) => {
      const draft = openEditor(main);
      expect(draft.querySelector(".object-editor-info strong")).toHaveTextContent(expected);
      expect(draft.querySelector(".object-editor-info strong")).toHaveAttribute("title", expected);
      finish(draft);
    };
    assertTitle(renamed);
    fireEvent.click(undoButton(main));
    assertTitle(initial.layerName!);
    expect(undoButton(main)).toBeDisabled();
    fireEvent.click(redoButton(main));
    assertTitle(renamed);
  });

  it.each(["", "   ", undefined])("falls back to the base object name when the layer name is %j", async layerName => {
    const main = await mount(scene([object({ layerName })]));
    const draft = openEditor(main);
    expect(draft.querySelector(".object-editor-info strong")).toHaveTextContent("Test object");
  });
  it("rejects a child-only historical coordinate overflow before committing the outer scene", async () => {
    const initial = object({ content: { frame: { width: 120, height: 100 }, groups: [], elements: [leaf("inside-a", { x: 0 })] } });
    const main = await mount(scene([initial]));
    const draft = openEditor(main);
    fireEvent.click(row(draft, "inside-a"));
    const input = within(draft).getByRole("spinbutton", { name: "X" });
    fireEvent.change(input, { target: { value: "1.7e308" } });
    fireEvent.change(input, { target: { value: "-1.7e308" } });
    save(draft);
    expect(editor(main)).toBe(draft);
    expect(undoButton(main)).toBeDisabled();
    expect(firstObjectVisual(main).style.left).toBe("0px");
    expect(within(draft).getByRole("status")).toHaveTextContent(label("smartObject.unsaved"));
    command("z");
    fireEvent.click(row(draft, "inside-a"));
    expect(within(draft).getByRole("spinbutton", { name: "X" })).toHaveValue(1.7e308);
    fireEvent.click(within(draft).getByRole("button", { name: label("smartObject.discard") }));
    fireEvent.click(within(within(draft).getByRole("alertdialog")).getByRole("button", { name: label("smartObject.discard") }));
    expect(savedObject(await readScene())).toEqual(initial);
  });
  it("leaves a legacy frame unchanged on no-op saves and preserves that frame when all content is deleted", async () => {
    const initial = object();
    const main = await mount(scene([initial]));
    const draft = openEditor(main);
    save(draft); save(draft);
    expect(draft.querySelector<HTMLElement>(".canvas")!.style.width).toBe("120px");
    expect(undoButton(main)).toBeDisabled();
    command("a"); fireEvent.keyDown(document.body, { key: "Delete" });
    save(draft);
    expect(draft.querySelector<HTMLElement>(".canvas")!.style.width).toBe("120px");
    command("z");
    expect(shape(draft, "inside-a").style.left).toBe("50px");
    command("z", true);
    finish(draft);
    const emptied = savedObject(await readScene());
    expect(emptied.content.elements).toEqual([]);
    expect(emptied.content.frame).toEqual(initial.content.frame);
    expect([emptied.x, emptied.y]).toEqual([initial.x, initial.y]);
    fireEvent.click(undoButton(main));
    expect(savedObject(await readScene()).content).toEqual(initial.content);
    expect(undoButton(main)).toBeDisabled();
  });
  it("fits changed saves under outer rotation and scale, rebases both local history directions, and keeps no-op saves clean", async () => {
    const initial = object({ rotation: 37, scale: 1.75 });
    const main = await mount(scene([initial]));
    const draft = openEditor(main);
    nudgeRight(draft, "inside-a");
    nudgeRight(draft, "inside-a");
    command("z"); // Save with a future entry, so both history directions must be rebased.
    expect(draft.querySelector<HTMLElement>(".canvas")!.style.width).toBe("120px");
    fireEvent.click(row(draft, "inside-a"));
    command("s");
    expect(editor(main)).toBe(draft);
    expect(shape(draft, "inside-a").style.left).toBe("20px");
    expect(row(draft, "inside-a")).toHaveAttribute("aria-pressed", "true");
    expect(draft.querySelector<HTMLElement>(".canvas")!.style.width).toBe("74px");
    expect(within(draft).getByRole("status")).toHaveTextContent(label("smartObject.saved"));
    command("z", true);
    expect(shape(draft, "inside-a").style.left).toBe("21px");
    expect(within(draft).getByRole("status")).toHaveTextContent(label("smartObject.unsaved"));
    command("z");
    expect(shape(draft, "inside-a").style.left).toBe("20px");
    expect(within(draft).getByRole("status")).toHaveTextContent(label("smartObject.saved"));
    command("z");
    expect(shape(draft, "inside-a").style.left).toBe("19px");
    save(draft);
    expect(draft.querySelector<HTMLElement>(".canvas")!.style.width).toBe("75px");
    expect(shape(draft, "inside-a").style.left).toBe("20px");
    command("z", true);
    expect(shape(draft, "inside-a").style.left).toBe("21px");
    save(draft);
    save(draft);
    finish(draft);
    const final = savedObject(await readScene());
    expect(final.content.frame).toEqual({ width: 74, height: 55 });
    expectWorldOffset(final, initial, 1);
    expectWorldOffset(final, initial, 0, 0, "inside-b");
    expect(final.rotation).toBe(initial.rotation); expect(final.scale).toBe(initial.scale);
    for (const dx of [0, 1, 0]) {
      fireEvent.click(undoButton(main));
      expectWorldOffset(savedObject(await readScene()), initial, dx);
    }
    expect(undoButton(main)).toBeDisabled();
  });
});
