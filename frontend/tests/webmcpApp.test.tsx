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

describe("WebMCP element capability discovery", () => {
  it("queries full and filtered capabilities without changing scene, selection or history", async () => {
    const { root } = await mount();
    fireEvent.click(root.querySelector('.layer-row-item[data-element-id="a"]')!);
    const selectedIds = () => Array.from(root.querySelectorAll<HTMLElement>(".layer-row-item.selected"), row => row.dataset.elementId);
    expect(selectedIds()).toEqual(["a"]);
    const initial = await readScene();
    expect(undo(root)).toBeDisabled();
    expect(redo(root)).toBeDisabled();
    const definition = tools.get("get_element_capabilities");
    expect(definition?.annotations?.readOnlyHint).toBe(true);
    const all = await definition!.execute({}, {}) as { ok: boolean; elements: Record<string, { editing: { fields: string[] } }> };
    expect(all.ok).toBe(true);
    expect(Object.keys(all.elements)).toHaveLength(11);
    expect(all.elements["smart-object"].editing.fields).toContain("scale");
    expect(all.elements.rectangle.editing.fields).not.toContain("scale");
    for (const type of ["image", "smart-object", "ring"]) {
      const result = await definition!.execute({ type }, {}) as typeof all;
      expect(result.ok).toBe(true);
      expect(Object.keys(result.elements)).toEqual([type]);
    }
    expect(await definition!.execute({ type: "unknown" }, {})).toMatchObject({ ok: false });
    all.elements["smart-object"].editing.fields.push("width");
    const fresh = await definition!.execute({ type: "smart-object" }, {}) as typeof all;
    expect(fresh.elements["smart-object"].editing.fields).not.toContain("width");
    expect(await readScene()).toEqual(initial);
    expect(selectedIds()).toEqual(["a"]);
    expect(undo(root)).toBeDisabled();
    expect(redo(root)).toBeDisabled();
  });
});

describe("WebMCP layer group creation", () => {
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
  const batch = { groups: [
    { key: "child", name: " Child ", parent: { newGroupKey: "root" }, elementIds: ["a"] },
    { key: "root", name: "Root", elementIds: ["b"] }
  ] };
  it("registers discoverable schema and creates a forward-referenced tree in one undo without altering selection or drawing fields", async () => {
    const initial = scene([leaf("a", { zIndex: 2, luaMask: { enabled: true, rotation: 27 } }), leaf("b", { zIndex: 5 })]);
    const { root } = await mount(initial), before = await readScene();
    fireEvent.click(root.querySelector('.layer-row-item[data-element-id="a"]')!);
    const definition = tools.get("create_layer_groups")!;
    expect(tools.size).toBe(26);
    expect(definition.annotations?.readOnlyHint).not.toBe(true);
    expect(definition.inputSchema).toMatchObject({ type: "object", additionalProperties: false, required: ["groups"] });
    const result = await execute("create_layer_groups", batch) as Result & { groups: { key: string; id: string; name: string; parentId: string | null }[] };
    expect(result).toMatchObject({ ok: true, count: 2, groups: [
      { key: "child", name: "Child", parentId: expect.any(String) }, { key: "root", name: "Root", parentId: null }
    ] });
    expect(result.groups[0].parentId).toBe(result.groups[1].id);
    const after = await readScene();
    expect(after.elements).toEqual(before.elements.map((element, index) => ({ ...element, groupId: result.groups[index].id })));
    expect(after.groups).toHaveLength(2);
    expect(root.querySelector('.layer-row-item[data-element-id="a"]')).toHaveClass("selected");
    result.groups[0].name = "mutated";
    expect((await readScene()).groups[0].name).toBe("Child");
    fireEvent.click(undo(root)); expect(await readScene()).toEqual(before); expect(undo(root)).toBeDisabled();
    fireEvent.click(redo(root)); expect(await readScene()).toEqual(after); expect(redo(root)).toBeDisabled();
  });
  it("keeps scene, selection and redo branch untouched after a whole-batch rejection", async () => {
    const { root } = await mount(scene([leaf("a", { zIndex: 0 }), leaf("middle", { zIndex: 1 }), leaf("b", { zIndex: 2 })]));
    await execute("update_element", { id: "a", x: 123 });
    fireEvent.click(undo(root));
    fireEvent.click(root.querySelector('.layer-row-item[data-element-id="a"]')!);
    const before = await readScene();
    expect(await execute("create_layer_groups", { groups: [{ key: "bad", name: "Bad", elementIds: ["a", "b"] }] }))
      .toMatchObject({ ok: false, code: "INTERLEAVED_LAYERS", blockingElementIds: ["middle"] });
    expect(await readScene()).toEqual(before); expect(undo(root)).toBeDisabled(); expect(redo(root)).not.toBeDisabled();
    expect(root.querySelector('.layer-row-item[data-element-id="a"]')).toHaveClass("selected");
    fireEvent.click(redo(root)); expect((await readScene()).elements[0].x).toBe(123);
  });
  it.each([{}, { groups: [] }, { groups: [{ key: "g", name: "G", elementIds: ["a"], opacity: .5 }] }])("rejects malformed input %j without history", async args => {
    const { root } = await mount(), before = await readScene();
    expect(await execute("create_layer_groups", args)).toMatchObject({ ok: false });
    expect(await readScene()).toEqual(before); expect(undo(root)).toBeDisabled();
  });
  it("honors a cancelled call before writing", async () => {
    const { root } = await mount(), before = await readScene(), controller = new AbortController();
    controller.abort();
    const result = await tools.get("create_layer_groups")!.execute({ groups: [{ key: "g", name: "G", elementIds: ["a"] }] }, { signal: controller.signal });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/cancel/i) });
    expect(await readScene()).toEqual(before); expect(undo(root)).toBeDisabled();
  });
  it.each(["object", "transform", "mask"])("cannot write while %s draft is active", async mode => {
    const { root } = await mount(), before = await readScene();
    if (mode === "object") enterObject(root);
    else if (mode === "transform") enterTransform(root);
    else {
      fireEvent.click(root.querySelector('.layer-row-item[data-element-id="a"]')!);
      fireEvent.click(within(root).getByText(label("props.advanced"), { exact: true }));
      fireEvent.click(button(root, "luaMask.editTransform"));
    }
    const canvases = Array.from(root.querySelectorAll(".canvas"), node => node.innerHTML);
    expect(await execute("create_layer_groups", { groups: [{ key: "g", name: "G", elementIds: ["a"] }] })).toMatchObject({ ok: false });
    expect(Array.from(root.querySelectorAll(".canvas"), node => node.innerHTML)).toEqual(canvases);
    if (mode === "object") closeObject(root);
    else fireEvent.click(button(root, "transform.cancel"));
    expect(await readScene()).toEqual(before); expect(undo(root)).toBeDisabled();
  });
  it("rejects an active canvas gesture without consuming it and works once it ends", async () => {
    const { root } = await mount(scene([leaf("a")]));
    fireEvent.mouseDown(root.querySelector('.canvas > .shape[data-element-id="a"]')!, { button: 0, clientX: 100, clientY: 80 });
    expect(await execute("create_layer_groups", { groups: [{ key: "g", name: "G", elementIds: ["a"] }] }))
      .toMatchObject({ ok: false, code: "EDITOR_BUSY" });
    expect((await readScene()).groups).toEqual([]); expect(undo(root)).toBeDisabled();
    fireEvent.mouseUp(window);
    expect(await execute("create_layer_groups", { groups: [{ key: "g", name: "G", elementIds: ["a"] }] })).toMatchObject({ ok: true, count: 1 });
  });
  it("finalizes pending keyboard nudges only on success and keeps them separately undoable", async () => {
    const { root } = await mount(scene([leaf("a")])), initial = await readScene();
    fireEvent.click(root.querySelector('.layer-row-item[data-element-id="a"]')!);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect((await readScene()).elements[0].x).toBe(101);
    expect(await execute("create_layer_groups", { groups: [{ key: "g", name: "G", elementIds: ["a"] }] })).toMatchObject({ ok: true });
    fireEvent.keyUp(window, { key: "ArrowRight" });
    fireEvent.click(undo(root));
    expect((await readScene()).elements[0].x).toBe(101); expect((await readScene()).groups).toEqual([]);
    fireEvent.click(undo(root)); expect(await readScene()).toEqual(initial); expect(undo(root)).toBeDisabled();
  });
  it("does not finalize a pending nudge when grouping fails", async () => {
    const { root } = await mount(scene([leaf("a")])), initial = await readScene();
    fireEvent.click(root.querySelector('.layer-row-item[data-element-id="a"]')!);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await execute("create_layer_groups", { groups: [{ key: "g", name: "G", elementIds: ["missing"] }] })).toMatchObject({ ok: false, code: "UNKNOWN_ELEMENT" });
    expect(undo(root)).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyUp(window, { key: "ArrowRight" });
    expect(await readScene()).toEqual(initial); expect(undo(root)).toBeDisabled();
  });
  it("uses the latest scene synchronously for consecutive calls beneath an existing hidden half-opacity parent", async () => {
    const initial = scene([leaf("a", { groupId: "existing", zIndex: 2 }), leaf("b", { groupId: "existing", zIndex: 5 })]);
    initial.groups = [{ id: "existing", name: "Existing", parentId: null, visible: false, opacity: .5, collapsed: false, order: 0 }];
    const { root } = await mount(initial), before = await readScene();
    let first: unknown, second: unknown;
    await act(async () => {
      first = await tools.get("create_layer_groups")!.execute({ groups: [{ key: "one", name: "One", parent: { groupId: "existing" }, elementIds: ["a"] }] }, {});
      second = await tools.get("create_layer_groups")!.execute({ groups: [{ key: "two", name: "Two", parent: { groupId: "existing" }, elementIds: ["b"] }] }, {});
    });
    expect(first).toMatchObject({ ok: true }); expect(second).toMatchObject({ ok: true });
    expect((await readScene()).groups).toHaveLength(3);
    expect((await readScene()).groups[0]).toEqual(before.groups[0]);
    fireEvent.click(undo(root)); expect((await readScene()).groups).toHaveLength(2);
    fireEvent.click(undo(root)); expect(await readScene()).toEqual(before); expect(undo(root)).toBeDisabled();
  });
});
