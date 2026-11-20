import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import App, { type SceneDocument, type SceneElement, type SceneLeaf } from "../src/App";
import { I18nProvider, translations } from "../src/i18n";
import type { SmartObject } from "../src/smartObjectModel";

type Tool = Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0];
type Result = { ok: boolean; error?: string; count?: number; element?: SceneElement; elements?: SceneElement[] };
const tools = new Map<string, Tool>();
const label = (key: string) => translations.zh[key] as string;
const leaf = (id: string, patch: Partial<SceneLeaf> = {}): SceneLeaf => ({
  id, name: id, layerName: id, type: "rectangle", x: 100, y: 80,
  width: 80, height: 60, rotation: 0, color: "#c2410c", opacity: 1,
  zIndex: 0, visible: true, isBackground: false, groupId: null, ...patch
});
const object = (): SmartObject => ({
  id: "object", name: "Object", layerName: "Object", type: "smart-object",
  x: 220, y: 160, rotation: 0, scale: 1, opacity: 1, zIndex: 1, visible: true,
  content: { frame: { width: 80, height: 60 }, elements: [leaf("inside", { x: 40, y: 30 })], groups: [] }
});
const scene = (elements: SceneElement[] = [leaf("a"), object()]): SceneDocument => ({
  schemaVersion: 2, canvas: { width: 300, height: 240, background: "transparent" }, elements, groups: [],
  meta: { sourceType: "editor", sourceName: "webmcp-regression", warnings: [] },
  library: { activeCategory: "basic-shape", categories: [{ key: "basic-shape", label: "基础形状", supported: true }], baseShapePresets: [], savedItems: [] }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
let importResponse: ReturnType<typeof deferred<Response>>;
let importRequested: ReturnType<typeof deferred<void>>;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("miliastra-editor-lang", "zh");
  localStorage.setItem("miliastra-editor-tour-seen", "1");
  tools.clear();
  importResponse = deferred<Response>(); importRequested = deferred<void>();
  Object.defineProperty(document, "modelContext", { configurable: true, value: {
    registerTool: async (tool: Tool) => { tools.set(tool.name, tool); }
  } });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("/api/library/catalog")) return json({ images: {}, categories: {}, names: {} });
    if (url === "/api/import") { importRequested.resolve(); return importResponse.promise; }
    throw new Error("Unexpected WebMCP regression request: " + url);
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, "modelContext"); });
async function readScene(): Promise<SceneDocument> {
  const result = await tools.get("get_scene")!.execute({}, {});
  if (!result || typeof result !== "object" || !("elements" in result)) throw new Error("Scene unavailable: " + JSON.stringify(result));
  return result as SceneDocument;
}
async function mount(initial = scene()) {
  localStorage.setItem("miliastra-last-canvas", JSON.stringify({ name: "WebMCP regression", scene: initial, savedAt: 1 }));
  localStorage.setItem("miliastra-restore-on-load", "1");
  const view = render(<I18nProvider><App /></I18nProvider>);
  const root = view.container.querySelector<HTMLElement>(".app-shell")!;
  await waitFor(async () => expect((await readScene()).elements).toHaveLength(initial.elements.length));
  fireEvent.click(root.querySelector(".zoom-display")!);
  vi.spyOn(root.querySelector<HTMLElement>(".canvas")!, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 240, width: 300, height: 240, toJSON: () => ({})
  });
  return { root, unmount: view.unmount };
}
async function execute(name: string, args: Record<string, unknown>) {
  let result: unknown;
  await act(async () => { result = await tools.get(name)!.execute(args, {}); });
  return result as Result;
}
const button = (root: HTMLElement, key: string) => within(root).getByRole("button", { name: label(key) });
const undo = (root: HTMLElement) => within(root).getByTitle(label("topbar.undoShort"));
const redo = (root: HTMLElement) => within(root).getByTitle(label("topbar.redoShort"));
function enterObject(root: HTMLElement) {
  fireEvent.doubleClick(root.querySelector('.canvas > .shape[data-element-id="object"]')!);
  expect(root.querySelector(".object-editor-overlay")).not.toBeNull();
}
function closeObject(root: HTMLElement) {
  const draft = root.querySelector<HTMLElement>(".object-editor-overlay .app-shell")!;
  fireEvent.click(button(draft, "smartObject.discard"));
  expect(root.querySelector(".object-editor-overlay")).toBeNull();
}
function enterTransform(root: HTMLElement) {
  fireEvent.click(root.querySelector('.layer-row-item[data-element-id="a"]')!);
  fireEvent.click(button(root, "transform.mode"));
  fireEvent.mouseDown(root.querySelector('[data-handle="se"]')!, { button: 0, clientX: 140, clientY: 110 });
  fireEvent.mouseMove(window, { buttons: 1, clientX: 180, clientY: 140 });
  fireEvent.mouseUp(window);
  expect(root).toHaveClass("transform-locked");
}

describe("WebMCP creation keeps manual favorites unchanged", () => {
  it("inserts a locked ordinary favorite as an unlocked manual copy", async () => {
    const initial = scene([leaf("a")]);
    initial.library.savedItems = [{ id: "favorite", name: "Locked favorite", element: leaf("saved", { locked: true }) }];
    const { root } = await mount(initial), before = await readScene();
    fireEvent.doubleClick(within(root).getByRole("button", { name: /Locked favorite/ }));
    const after = await readScene();
    expect(after.elements).toHaveLength(2);
    expect(after.elements[1].locked).toBeUndefined();
    expect(after.library.savedItems).toEqual(initial.library.savedItems);
    fireEvent.click(undo(root));
    expect(await readScene()).toEqual(before);
    expect(undo(root)).toBeDisabled();
  });
});

describe("WebMCP asynchronous write sessions", () => {
  it.each(["object", "object-exited", "transform", "transform-exited"])("rejects a late import after entering %s", async context => {
    const { root } = await mount(), initial = await readScene();
    const pending = tools.get("import_source")!.execute({ sourceType: "json", content: "{}" }, {});
    await importRequested.promise;
    if (context.startsWith("object")) enterObject(root); else enterTransform(root);
    if (context === "object-exited") closeObject(root);
    if (context === "transform-exited") fireEvent.click(button(root, "transform.cancel"));
    const before = Array.from(root.querySelectorAll(".canvas")).map(node => node.innerHTML);
    const feedback = Array.from(root.querySelectorAll(".statusbar")).map(node => node.textContent);
    const selected = Array.from(root.querySelectorAll(".layer-row-item.selected")).map(node => node.getAttribute("data-element-id"));
    let result: unknown;
    await act(async () => {
      importResponse.resolve(json({ scene: scene([leaf("late")]), warnings: ["late warning"] }));
      result = await pending;
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/changed|retry|pending|cancel/i) });
    expect(Array.from(root.querySelectorAll(".canvas")).map(node => node.innerHTML)).toEqual(before);
    expect(Array.from(root.querySelectorAll(".statusbar")).map(node => node.textContent)).toEqual(feedback);
    expect(Array.from(root.querySelectorAll(".layer-row-item.selected")).map(node => node.getAttribute("data-element-id"))).toEqual(selected);
    expect(undo(root)).toBeDisabled();
    if (context === "object") closeObject(root);
    if (context === "transform") fireEvent.click(button(root, "transform.cancel"));
    expect(await readScene()).toEqual(initial);
    expect(undo(root)).toBeDisabled();
  });

  it("keeps an ordinary import atomic and undoable once", async () => {
    const { root } = await mount(), initial = await readScene();
    const pending = tools.get("import_source")!.execute({ sourceType: "json", content: "{}" }, {});
    await importRequested.promise;
    let result: unknown;
    await act(async () => { importResponse.resolve(json({ scene: scene([leaf("imported")]), warnings: [] })); result = await pending; });
    expect(result).toMatchObject({ ok: true });
    const imported = await readScene(); expect(imported.elements.map(element => element.id)).toEqual(["imported"]);
    fireEvent.click(undo(root)); expect(await readScene()).toEqual(initial); expect(undo(root)).toBeDisabled();
    fireEvent.click(redo(root)); expect(await readScene()).toEqual(imported);
  });

  it("rejects an import that finishes after unregistering the App", async () => {
    const { unmount } = await mount();
    const pending = tools.get("import_source")!.execute({ sourceType: "json", content: "{}" }, {});
    await importRequested.promise; unmount();
    const stored = localStorage.getItem("miliastra-last-canvas");
    let result: unknown;
    await act(async () => { importResponse.resolve(json({ scene: scene([leaf("late")]), warnings: [] })); result = await pending; });
    expect(result).toMatchObject({ ok: false });
    expect(localStorage.getItem("miliastra-last-canvas")).toBe(stored);
  });
});

describe("WebMCP explicit creation lock flags", () => {
  it.each(["add_element", "add_elements", "set_elements"])("preserves true, false and omission through %s", async name => {
    const { root } = await mount(), initial = await readScene();
    for (const locked of [true, false, undefined]) {
      const input = { type: "rectangle", id: "added", ...(locked !== undefined ? { locked } : {}) };
      const result = await execute(name, name === "add_element" ? input : { elements: [input], returnElements: true });
      expect(result.ok).toBe(true);
      const returned = name === "add_element" ? result.element : result.elements?.[0];
      const saved = (await readScene()).elements.find(element => element.id === "added")!;
      if (locked === undefined) { expect(returned).not.toHaveProperty("locked"); expect(saved).not.toHaveProperty("locked"); }
      else { expect(returned).toHaveProperty("locked", locked); expect(saved).toHaveProperty("locked", locked); }
      fireEvent.click(undo(root)); expect(await readScene()).toEqual(initial); expect(undo(root)).toBeDisabled();
    }
  });

  it("still allows AI edits and deletion of a locked layer", async () => {
    const { root } = await mount(scene([leaf("locked", { locked: true })]));
    expect(await execute("update_element", { id: "locked", x: 125 })).toMatchObject({ ok: true, count: 1 });
    expect(await execute("remove_element", { id: "locked" })).toMatchObject({ ok: true });
    expect((await readScene()).elements).toEqual([]); fireEvent.click(undo(root));
    expect((await readScene()).elements[0]).toMatchObject({ id: "locked", locked: true, x: 125 });
  });
});

describe("WebMCP smart-object update contract", () => {
  it("updates only shell scale, treats repeated values as no-ops, and undoes once", async () => {
    const { root } = await mount(), initial = await readScene();
    expect(await execute("update_element", { id: "object", scale: 2 })).toMatchObject({ ok: true, count: 1 });
    const changed = await readScene();
    expect(changed.elements[1]).toEqual({ ...initial.elements[1], scale: 2 });
    expect(await execute("update_elements", { updates: [{ id: "object", scale: 2 }] })).toMatchObject({ ok: true, count: 0 });
    fireEvent.click(undo(root)); expect(await readScene()).toEqual(initial); expect(undo(root)).toBeDisabled();
    fireEvent.click(redo(root)); expect(await readScene()).toEqual(changed);
  });

  it.each([0, -1, NaN, Infinity, -Infinity, "2", null, true])("rejects invalid scale %s without partially applying x", async scale => {
    const { root } = await mount(), initial = await readScene();
    expect(await execute("update_element", { id: "object", x: 123, scale })).toMatchObject({ ok: false });
    expect(await readScene()).toEqual(initial); expect(undo(root)).toBeDisabled();
  });

  it("rejects scale on ordinary leaves while preserving width and shell rotation", async () => {
    const { root } = await mount(), initial = await readScene();
    expect(await execute("update_element", { id: "a", x: 123, scale: 2 })).toMatchObject({ ok: false });
    expect(await readScene()).toEqual(initial); expect(undo(root)).toBeDisabled();
    expect(await execute("update_elements", { updates: [{ id: "a", width: 120 }, { id: "object", rotation: 15 }] })).toMatchObject({ ok: true, count: 2 });
    expect((await readScene()).elements[0]).toMatchObject({ width: 120 });
    expect((await readScene()).elements[1]).toMatchObject({ rotation: 15, scale: 1 });
    fireEvent.click(undo(root)); expect(await readScene()).toEqual(initial); expect(undo(root)).toBeDisabled();
  });

  it.each([{ width: 120 }, { height: 120 }, { color: "#123456" }, { groupId: null }, { rotationX: 15 }, { isBackground: true }])("rejects unsupported shell fields %j atomically", async patch => {
    const { root } = await mount(), initial = await readScene();
    expect(await execute("update_elements", { updates: [{ id: "a", x: 123 }, { id: "object", ...patch }] })).toMatchObject({ ok: false });
    expect(await readScene()).toEqual(initial); expect(undo(root)).toBeDisabled();
  });
});
