import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import App, { type SceneDocument, type SceneGroup, type SceneLeaf } from "../src/App";
import { I18nProvider, translations } from "../src/i18n";

type RegisteredTool = Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0];
type Point = [x: number, y: number];
const tools = new Map<string, RegisteredTool>();
const looseCenter: Point = [180, 60];
const looseDestination: Point = [208, 78];
const allTargets: [Point, Point] = [[15, 25], [215, 100]];
const groupOnly: [Point, Point] = [[15, 25], [130, 100]];
const looseOnly: [Point, Point] = [[150, 35], [215, 85]];

function label(key: string) {
  const text = translations.zh[key];
  if (typeof text !== "string") throw new Error("Expected a translated label: " + key);
  return text;
}

function sceneFixture(): SceneDocument {
  const leaf = (id: string, x: number, y: number, zIndex: number, groupId: string | null = null): SceneLeaf => ({
    id, name: id, layerName: id, type: "rectangle", x, y, zIndex, groupId,
    width: 24, height: 20, rotation: 0, color: "#c2410c", opacity: 1,
    isBackground: false, visible: true, locked: false
  });
  const group = (id: string, parentId: string | null, order: number): SceneGroup => ({
    id, name: id, parentId, order, visible: true, opacity: 1, collapsed: false
  });
  return {
    schemaVersion: 2,
    canvas: { width: 300, height: 240, background: "transparent" },
    elements: [leaf("a", 50, 50, 0, "G"), leaf("b", 105, 70, 1, "nested"),
      leaf("c", ...looseCenter, 2), leaf("unrelated", 255, 175, 3)],
    groups: [group("G", null, 0), group("nested", "G", 1)],
    meta: { sourceType: "editor", sourceName: "selection-safety-app-test", warnings: [] },
    library: { activeCategory: "basic-shape", categories: [{ key: "basic-shape", label: "基础形状", supported: true }], baseShapePresets: [], savedItems: [] }
  };
}

const originalModelContext = Object.getOwnPropertyDescriptor(document, "modelContext");
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("miliastra-editor-lang", "zh");
  localStorage.setItem("miliastra-editor-tour-seen", "1");
  tools.clear();
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool: async (tool: RegisteredTool) => { tools.set(tool.name, tool); } }
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("/api/library/catalog")) throw new Error("Unexpected selection regression request: " + url);
    return new Response(JSON.stringify({ images: {}, categories: {}, names: {} }), {
      headers: { "Content-Type": "application/json" }
    });
  }));
});

afterEach(() => {
  cleanup();
  if (originalModelContext) Object.defineProperty(document, "modelContext", originalModelContext);
  else Reflect.deleteProperty(document, "modelContext");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function readScene(): Promise<SceneDocument> {
  const tool = tools.get("get_scene");
  if (!tool) throw new Error("App did not register get_scene");
  const scene = await tool.execute({}, {});
  if (!scene || typeof scene !== "object" || !("elements" in scene)) throw new Error("Scene is unavailable");
  return scene as SceneDocument;
}

async function execute(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  let result: unknown;
  await act(async () => { result = await tools.get(name)?.execute(args, {}); });
  if (!result || typeof result !== "object" || !("ok" in result)) throw new Error("Tool result is unavailable: " + name);
  return result as { ok: boolean; error?: string };
}

function find(root: HTMLElement, selector: string): HTMLElement {
  const target = root.querySelector<HTMLElement>(selector);
  if (!target) throw new Error("Missing App element: " + selector);
  return target;
}

async function mount() {
  const scene = sceneFixture();
  localStorage.setItem("miliastra-last-canvas", JSON.stringify({ name: "Selection regression", scene, savedAt: 1 }));
  localStorage.setItem("miliastra-restore-on-load", "1");
  const { container } = render(<I18nProvider><App /></I18nProvider>);
  const root = find(container, ".app-shell");
  await waitFor(async () => expect((await readScene()).elements.map(element => element.id)).toEqual(["a", "b", "c", "unrelated"]));
  fireEvent.click(within(root).getByTitle(label("canvas.zoomReset")));
  const snap = within(root).getByTitle(label("canvas.snapTitle"));
  if (snap.classList.contains("active")) fireEvent.click(snap);
  expect(snap).not.toHaveClass("active");
  const { width, height } = scene.canvas;
  vi.spyOn(find(root, ".canvas"), "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({})
  });
  return root;
}

const groupRow = (root: HTMLElement, id = "G") => find(root, '.layer-group-row[data-group-id="' + id + '"]');
const layerRow = (root: HTMLElement, id: string) => find(root, '.layer-row-item[data-element-id="' + id + '"]');
const shape = (root: HTMLElement, id: string) => find(root, '.canvas > .shape[data-element-id="' + id + '"]');
const stage = (root: HTMLElement) => find(root, ".canvas-stage");
const undo = (root: HTMLElement) => within(root).getByTitle(label("topbar.undoShort"));
const key = (value: string, ctrlKey = false) => fireEvent.keyDown(window, { key: value, ctrlKey });

function selected(root: HTMLElement) {
  return {
    groups: Array.from(root.querySelectorAll<HTMLElement>(".layer-group-row.selected"), row => row.dataset.groupId).sort(),
    elements: Array.from(root.querySelectorAll<HTMLElement>(".layer-row-item.selected[data-element-id]"), row => row.dataset.elementId).sort()
  };
}

function mouseGesture(target: HTMLElement, [clientX, clientY]: Point, end?: Point) {
  fireEvent.mouseDown(target, { button: 0, buttons: 1, clientX, clientY });
  if (end) fireEvent.mouseMove(window, { buttons: 1, clientX: end[0], clientY: end[1] });
  fireEvent.mouseUp(window, { button: 0, clientX: end?.[0] ?? clientX, clientY: end?.[1] ?? clientY });
}

async function undoOnce(root: HTMLElement, before: SceneDocument) {
  expect(undo(root)).toBeEnabled();
  fireEvent.click(undo(root));
  expect(await readScene()).toEqual(before);
  expect(undo(root)).toBeDisabled();
}

async function hideGroup(root: HTMLElement) {
  fireEvent.click(within(groupRow(root)).getByTitle(label("layer.hide")));
  const hidden = await readScene();
  expect(hidden.groups?.find(group => group.id === "G")?.visible).toBe(false);
  expect(hidden.elements.filter(element => element.id === "a" || element.id === "b").map(element => element.visible)).toEqual([true, true]);
  expect(root.querySelectorAll('.canvas > .shape[data-element-id="a"], .canvas > .shape[data-element-id="b"]')).toHaveLength(0);
  return hidden;
}

async function lockGroup(root: HTMLElement) {
  fireEvent.click(groupRow(root));
  fireEvent.click(within(root).getByTitle(label("layer.lock")));
  const locked = await readScene();
  expect(locked.groups?.find(group => group.id === "G")?.locked).toBe(true);
  expect(locked.elements.filter(element => element.id === "a" || element.id === "b").map(element => element.locked)).toEqual([false, false]);
  return locked;
}

function expectOneClonePerTarget(before: SceneDocument, after: SceneDocument) {
  const originals = new Set(before.elements.map(element => element.id));
  const copies = after.elements.filter(element => !originals.has(element.id));
  expect(copies.map(element => element.x).sort((a, b) => a - b)).toEqual([50, 105, 180]);
  expect(new Set(after.elements.map(element => element.id)).size).toBe(after.elements.length);
  const originalGroups = new Set(before.groups?.map(group => group.id));
  const copiedGroups = (after.groups ?? []).filter(group => !originalGroups.has(group.id));
  expect(copiedGroups).toHaveLength(2);
  const top = copiedGroups.find(group => group.parentId === null);
  expect(top).toBeDefined();
  const nested = copiedGroups.find(group => group.parentId === top?.id);
  expect(nested).toBeDefined();
  expect(copies.find(element => element.x === 50)?.groupId).toBe(top?.id);
  expect(copies.find(element => element.x === 105)?.groupId).toBe(nested?.id);
  expect(copies.find(element => element.x === 180)?.groupId).toBeNull();
}

describe("App selection safety", () => {
  it("deletes only the canvas layer clicked outside the previously selected group and undoes it once", async () => {
    const root = await mount();
    const before = await readScene();
    fireEvent.click(groupRow(root));
    expect(selected(root)).toEqual({ groups: ["G"], elements: ["a", "b"] });
    mouseGesture(shape(root, "c"), looseCenter);
    expect.soft(selected(root)).toEqual({ groups: [], elements: ["c"] });
    key("Delete");
    const after = await readScene();
    expect(after.elements.map(element => element.id)).toEqual(["a", "b", "unrelated"]);
    expect(after.groups).toEqual(before.groups);
    await undoOnce(root, before);
  });

  it("clears the old group when clicking empty canvas and leaves Delete without a target", async () => {
    const root = await mount();
    const before = await readScene();
    fireEvent.click(groupRow(root));
    mouseGesture(stage(root), [25, 210]);
    expect(selected(root)).toEqual({ groups: [], elements: [] });
    key("Delete");
    expect(await readScene()).toEqual(before);
    expect(undo(root)).toBeDisabled();
  });

  it("replaces the old group when drawing a marquee around an unrelated ordinary layer", async () => {
    const root = await mount();
    const before = await readScene();
    fireEvent.click(groupRow(root));
    mouseGesture(stage(root), ...looseOnly);
    expect(selected(root)).toEqual({ groups: [], elements: ["c"] });
    key("Delete");
    const after = await readScene();
    expect(after.elements.map(element => element.id)).toEqual(["a", "b", "unrelated"]);
    expect(after.groups).toEqual(before.groups);
    await undoOnce(root, before);
  });

  it.each(["keyboard", "layer panel"] as const)("deletes a Ctrl-mixed group and loose layer from the %s in one undo step", async source => {
    const root = await mount();
    const before = await readScene();
    if (source === "keyboard") {
      fireEvent.click(groupRow(root));
      fireEvent.click(layerRow(root, "c"), { ctrlKey: true });
    } else {
      fireEvent.click(layerRow(root, "c"));
      fireEvent.click(groupRow(root), { ctrlKey: true });
    }
    expect(selected(root)).toEqual({ groups: ["G"], elements: ["a", "b", "c"] });
    if (source === "keyboard") key("Delete");
    else fireEvent.click(within(find(root, ".layer-actions")).getByRole("button", { name: label("layers.deleteAction") }));
    const after = await readScene();
    expect(after.elements.map(element => element.id)).toEqual(["unrelated"]);
    expect(after.groups).toEqual([]);
    if (source === "keyboard") {
      await waitFor(() => {
        const saved = JSON.parse(localStorage.getItem("miliastra-last-canvas") ?? "null");
        expect(saved?.scene).toMatchObject({ elements: after.elements, groups: after.groups });
      }, { timeout: 2000 });
    }
    await undoOnce(root, before);
  });

  it.each([false, true])("duplicates the whole Ctrl-mixed selection once (also selecting nested group: %s)", async includeNested => {
    const root = await mount();
    const before = await readScene();
    fireEvent.click(groupRow(root));
    if (includeNested) fireEvent.click(groupRow(root, "nested"), { ctrlKey: true });
    fireEvent.click(layerRow(root, "c"), { ctrlKey: true });
    expect(selected(root)).toEqual({ groups: includeNested ? ["G", "nested"] : ["G"], elements: ["a", "b", "c"] });
    key("d", true);
    expectOneClonePerTarget(before, await readScene());
    await undoOnce(root, before);
  });

  it("deletes only the visible loose layer when marquee crosses a group hidden during editing", async () => {
    const root = await mount();
    fireEvent.click(groupRow(root));
    const hidden = await hideGroup(root);
    mouseGesture(stage(root), ...allTargets);
    expect.soft(selected(root)).toEqual({ groups: [], elements: ["c"] });
    key("Delete");
    const after = await readScene();
    expect(after.elements.map(element => element.id)).toEqual(["a", "b", "unrelated"]);
    expect(after.groups).toEqual(hidden.groups);
    fireEvent.click(undo(root));
    expect(await readScene()).toEqual(hidden);
  });

  it("keeps a hidden-only marquee empty and creates no Delete history entry", async () => {
    const root = await mount();
    const before = await readScene();
    await hideGroup(root);
    mouseGesture(stage(root), ...groupOnly);
    expect.soft(selected(root)).toEqual({ groups: [], elements: [] });
    key("Delete");
    expect((await readScene()).elements).toEqual(before.elements);
    await undoOnce(root, before);
  });

  it.each(["marquee", "mixed layer panel"] as const)("moves only the editable loose layer from a %s selection after locking its neighbors' ancestor", async source => {
    const root = await mount();
    const beforeLock = await readScene();
    const locked = await lockGroup(root);
    if (source === "marquee") {
      mouseGesture(stage(root), ...allTargets);
      expect.soft(selected(root)).toEqual({ groups: [], elements: ["c"] });
    } else {
      fireEvent.click(layerRow(root, "c"));
      fireEvent.click(groupRow(root), { ctrlKey: true });
      expect(selected(root).groups).toEqual(["G"]);
      expect(selected(root).elements).toContain("c");
    }
    mouseGesture(shape(root, "c"), looseCenter, looseDestination);
    const after = await readScene();
    const [x, y] = looseDestination;
    expect(after.elements).toEqual(locked.elements.map(element => element.id === "c" ? { ...element, x, y } : element));
    expect(after.groups).toEqual(locked.groups);
    fireEvent.click(undo(root));
    expect(await readScene()).toEqual(locked);
    await undoOnce(root, beforeLock);
  });

  it("deletes only the pasted layer after copying a loose layer and selecting a group", async () => {
    const root = await mount();
    const before = await readScene();
    fireEvent.click(layerRow(root, "c"));
    let clipboardText = "";
    const clipboardData = {
      setData: (_format: string, text: string) => { clipboardText = text; },
      getData: () => clipboardText
    };
    fireEvent.copy(stage(root), { clipboardData });
    expect(JSON.parse(clipboardText)).toMatchObject({ format: "miliastra-editor-selection", elements: [{ id: "c" }] });
    fireEvent.click(groupRow(root));
    fireEvent.paste(stage(root), { clipboardData });
    const afterPaste = await readScene();
    expect(afterPaste.elements).toHaveLength(before.elements.length + 1);
    expect.soft(selected(root).groups).toEqual([]);
    expect(selected(root).elements).toHaveLength(1);

    key("Delete");
    const afterDelete = await readScene();
    expect(afterDelete.elements.map(element => element.id).sort()).toEqual(before.elements.map(element => element.id).sort());
    expect(afterDelete.groups).toEqual(before.groups);
    fireEvent.click(undo(root));
    expect(await readScene()).toEqual(afterPaste);
    await undoOnce(root, before);
  });

  it("clears the group selection before Delete from the inspector clear action", async () => {
    const root = await mount();
    const before = await readScene();
    fireEvent.click(groupRow(root));
    fireEvent.click(within(root).getByRole("button", { name: label("selection.clear") }));
    expect.soft(selected(root)).toEqual({ groups: [], elements: [] });
    key("Delete");
    expect(await readScene()).toEqual(before);
    expect(undo(root)).toBeDisabled();
  });

  it("does not restore a drag-start element array after WebMCP replaces the scene", async () => {
    const root = await mount();
    const before = await readScene();
    fireEvent.mouseDown(shape(root, "c"), { button: 0, buttons: 1, clientX: looseCenter[0], clientY: looseCenter[1] });
    const result = await execute("set_elements", { elements: [{ type: "rectangle", id: "replacement", x: 90, y: 85, width: 30, height: 25 }], select: false });
    expect(result.ok).toBe(true);
    const replaced = await readScene();
    expect(replaced.elements.map(element => element.id)).toEqual(["replacement"]);
    fireEvent.mouseMove(window, { buttons: 1, clientX: looseDestination[0], clientY: looseDestination[1] });
    fireEvent.mouseUp(window);
    expect(await readScene()).toEqual(replaced);
    await undoOnce(root, before);
  });

  it.each(["locks the dragged layer", "adds an unrelated layer"] as const)("preserves WebMCP changes made during an active drag when it %s", async change => {
    const root = await mount();
    const before = await readScene();
    fireEvent.mouseDown(shape(root, "c"), { button: 0, buttons: 1, clientX: looseCenter[0], clientY: looseCenter[1] });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 190, clientY: 66 });
    const dragged = await readScene();
    expect(dragged.elements.find(element => element.id === "c")).toMatchObject({ x: 190, y: 66 });
    const result = change === "locks the dragged layer"
      ? await execute("update_element", { id: "c", locked: true })
      : await execute("add_element", { type: "rectangle", id: "arrived-during-drag", x: 255, y: 175, width: 20, height: 16, select: false });
    expect(result.ok).toBe(true);
    const changed = await readScene();
    fireEvent.mouseMove(window, { buttons: 1, clientX: looseDestination[0], clientY: looseDestination[1] });
    fireEvent.mouseUp(window);
    const afterMove = await readScene();
    expect(afterMove.elements).toEqual(changed.elements);
    if (change === "locks the dragged layer") expect(afterMove.elements.find(element => element.id === "c")).toMatchObject({ locked: true, x: 190, y: 66 });
    else expect(afterMove.elements.find(element => element.id === "arrived-during-drag")).toMatchObject({ x: 255, y: 175 });
    await undoOnce(root, before);
  });

  it.each(["undo", "redo"] as const)("does not replay an active drag after WebMCP %s", async operation => {
    const root = await mount();
    const before = await readScene();
    expect(await execute("update_element", { id: "unrelated", x: 265 })).toMatchObject({ ok: true });
    const edited = await readScene();
    if (operation === "redo") expect(await execute("undo", {})).toMatchObject({ ok: true });

    fireEvent.mouseDown(shape(root, "c"), { button: 0, buttons: 1, clientX: looseCenter[0], clientY: looseCenter[1] });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 190, clientY: 66 });
    expect((await readScene()).elements.find(element => element.id === "c")).toMatchObject({ x: 190, y: 66 });
    expect(await execute(operation, {})).toMatchObject({ ok: true });
    const restored = operation === "undo" ? before : edited;
    expect(await readScene()).toEqual(restored);

    fireEvent.mouseMove(window, { buttons: 1, clientX: looseDestination[0], clientY: looseDestination[1] });
    expect.soft(await readScene()).toEqual(restored);
    key("Escape");
    fireEvent.mouseUp(window);
    expect(await readScene()).toEqual(restored);
    const redo = within(root).getByTitle(label("topbar.redoShort"));
    if (operation === "redo") {
      expect(redo).toBeDisabled();
      await undoOnce(root, before);
    } else {
      expect(undo(root)).toBeDisabled();
      expect(redo).toBeEnabled();
      fireEvent.click(redo);
      expect(await readScene()).toEqual(edited);
      expect(redo).toBeDisabled();
    }
  });
});
