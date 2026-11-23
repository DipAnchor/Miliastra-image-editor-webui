import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import App, { type SceneDocument, type SceneElement, type SceneGroup, type SceneLeaf, type TextBoxSettings } from "../src/App";
import { I18nProvider, translations } from "../src/i18n";
import type { SmartObject } from "../src/smartObjectModel";

type RegisteredTool = Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0];
const registeredTools = new Map<string, RegisteredTool>();
const hitTest = vi.fn<(x: number, y: number) => Element | null>();
const writeText = vi.fn(async (_text: string) => {});
const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const lastCanvasKey = "miliastra-last-canvas";

function label(key: string): string {
  const value = translations.zh[key];
  if (typeof value !== "string") throw new Error("Expected a static translated label: " + key);
  return value;
}

function leaf(id: string, patch: Partial<SceneLeaf> = {}): SceneLeaf {
  return {
    id, name: id, layerName: id, type: "rectangle", x: 80, y: 60, width: 40, height: 30,
    rotation: 0, color: "#c2410c", opacity: 1, zIndex: 0, visible: true, isBackground: false,
    groupId: null, ...patch
  };
}

function group(id: string, patch: Partial<SceneGroup> = {}): SceneGroup {
  return { id, name: id, parentId: null, visible: true, opacity: 1, collapsed: false, order: 0, ...patch };
}

function scene(elements: SceneElement[], groups: SceneGroup[] = []): SceneDocument {
  return {
    schemaVersion: 2, canvas: { width: 300, height: 240, background: "transparent" }, elements, groups,
    meta: { sourceType: "editor", sourceName: "lock-safety-app-test", warnings: [] },
    library: {
      activeCategory: "basic-shape",
      categories: [{ key: "basic-shape", label: "基础形状", supported: true }],
      baseShapePresets: [], savedItems: []
    }
  };
}

function object(patch: Partial<SmartObject> = {}): SmartObject {
  return {
    id: "object", name: "Object", layerName: "Object", type: "smart-object",
    x: 180, y: 140, rotation: 0, scale: 1, opacity: 1, zIndex: 0, visible: true, groupId: null,
    content: { frame: { width: 40, height: 30 }, elements: [leaf("inside", { x: 20, y: 15 })], groups: [] },
    ...patch
  };
}

function textBox(): TextBoxSettings {
  return {
    text: "Selected text", fontSize: 24, autoSize: false, minFontSize: 12,
    textColor: "#15803d", textOpacity: 0.8, bgColor: "#000000", bgOpacity: 0,
    outlineEnabled: false, outlineColor: "#000000", outlineOpacity: 1,
    alignH: "center", alignV: "middle", anchorType: "center", visible: true,
    scaleX: 1, scaleY: 1, anchorMinX: 0.5, anchorMinY: 0.5,
    anchorMaxX: 0.5, anchorMaxY: 0.5, pivotX: 0.5, pivotY: 0.5
  };
}

const importJson = vi.fn((content: string): SceneDocument => JSON.parse(content));
const json = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200, headers: { "Content-Type": "application/json" }
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("miliastra-editor-lang", "zh");
  localStorage.setItem("miliastra-editor-tour-seen", "1");
  registeredTools.clear();
  hitTest.mockReset();
  writeText.mockClear();
  importJson.mockClear();
  Object.defineProperty(document, "modelContext", { configurable: true, value: {
    registerTool: async (tool: RegisteredTool) => { registeredTools.set(tool.name, tool); }
  } });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  // jsdom lacks PointerEvent. The app uses the coordinates and buttons supplied by MouseEvent.
  if (!window.PointerEvent) vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("/api/library/catalog")) return json({ images: {}, categories: {}, names: {} });
    if (url === "/api/import" && init?.method === "POST") {
      const payload: { sourceType: string; content: string } = JSON.parse(String(init.body));
      if (payload.sourceType !== "json") throw new Error("Expected a JSON import, got " + payload.sourceType);
      return json({ scene: importJson(payload.content), warnings: [] });
    }
    throw new Error("Unexpected network request in lock safety App test: " + url);
  }));
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
  if (originalHitTest) Object.defineProperty(document, "elementFromPoint", originalHitTest);
  else Reflect.deleteProperty(document, "elementFromPoint");
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function readScene(): Promise<SceneDocument> {
  const tool = registeredTools.get("get_scene");
  if (!tool) throw new Error("App did not register get_scene");
  const result = await tool.execute({}, {});
  if (!result || typeof result !== "object" || !("elements" in result)) throw new Error("Scene unavailable: " + JSON.stringify(result));
  return result as SceneDocument;
}

async function mount(initial: SceneDocument): Promise<HTMLElement> {
  localStorage.setItem(lastCanvasKey, JSON.stringify({ name: "Lock safety regression", scene: initial, savedAt: 1 }));
  localStorage.setItem("miliastra-restore-on-load", "1");
  const view = render(<I18nProvider><App /></I18nProvider>);
  await waitFor(async () => expect((await readScene()).elements.map(item => item.id)).toEqual(initial.elements.map(item => item.id)));
  return requiredNode(view.container, ".app-shell");
}

function requiredNode(root: HTMLElement, selector: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error("Missing App node: " + selector);
  return node;
}

const layerRow = (main: HTMLElement, id: string) => requiredNode(main, '.layer-row-item[data-element-id="' + id + '"]');
const groupRow = (main: HTMLElement, id: string) => requiredNode(main, '.layer-group-row[data-group-id="' + id + '"]');
const undo = (main: HTMLElement) => within(main).getByTitle(label("topbar.undoShort"));
const button = (root: HTMLElement, key: string) => within(root).getByRole("button", { name: label(key), exact: true });

function selectLayers(main: HTMLElement, ids: string[]) {
  ids.forEach((id, index) => fireEvent.click(layerRow(main, id), { ctrlKey: index > 0 }));
  expect([...main.querySelectorAll<HTMLElement>(".layer-row-item.selected[data-element-id]")]
    .map(row => row.dataset.elementId).sort()).toEqual([...ids].sort());
}

async function lockGroup(main: HTMLElement, id: string) {
  // Set the group lock through the UI so import/restore normalization cannot mask these interaction tests.
  fireEvent.click(groupRow(main, id));
  expect(groupRow(main, id)).toHaveClass("selected");
  fireEvent.click(requiredNode(main, ".layer-opacity-lock"));
  const current = await readScene();
  expect(current.groups?.find(item => item.id === id)?.locked).toBe(true);
  return current;
}

async function expectUndoTo(main: HTMLElement, before: SceneDocument) {
  expect(undo(main)).toBeEnabled();
  fireEvent.click(undo(main));
  expect(await readScene()).toEqual(before);
}

function press(key: string, modifiers: KeyboardEventInit = {}) {
  fireEvent.keyDown(document.body, { key, ...modifiers });
  fireEvent.keyUp(document.body, { key, ...modifiers });
}

function dragLayerIntoGroup(main: HTMLElement, leafId: string, groupId: string) {
  const target = groupRow(main, groupId);
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
    x: 80, y: 100, left: 80, top: 100, right: 320, bottom: 140, width: 240, height: 40, toJSON: () => ({})
  });
  hitTest.mockReturnValue(requiredNode(target, ".layer-info strong"));
  fireEvent.pointerDown(layerRow(main, leafId), { button: 0, buttons: 1, pointerId: 1, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(window, { button: 0, buttons: 1, pointerId: 1, clientX: 140, clientY: 120 });
  fireEvent.pointerUp(window, { button: 0, buttons: 0, pointerId: 1, clientX: 140, clientY: 120 });
}

function groupLocks(current: SceneDocument) {
  return Object.fromEntries((current.groups ?? []).map(item => [item.name, item.locked]));
}

function incomingScene() {
  return scene([
    leaf("pinned-member", { groupId: "pinned" }),
    leaf("editable-member", { groupId: "editable", zIndex: 1 })
  ], [group("pinned", { locked: true }), group("editable", { parentId: "pinned", locked: false })]);
}

function importThroughDialog(main: HTMLElement, incoming: SceneDocument, mode: "replace" | "append") {
  const content = JSON.stringify(incoming);
  fireEvent.click(within(main).getByTitle(label("tab.import")));
  const dialog = within(main).getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: content } });
  fireEvent.click(button(dialog, "import.submit"));
  fireEvent.click(button(within(main).getByRole("dialog"), mode === "replace" ? "import.modeReplace" : "import.modeAppend"));
  expect(importJson).toHaveBeenCalledTimes(1);
  expect(importJson).toHaveBeenCalledWith(content);
}

describe("App lock safety", () => {
  it.each(["self", "ancestor"] as const)("ignores arrows and Shift+arrows with %s locking and records no nudge", async lock => {
    const main = await mount(scene([
      leaf("target", lock === "self" ? { locked: true } : { groupId: "nested" })
    ], [group("parent"), group("nested", { parentId: "parent" })]));
    const initial = await readScene();
    const before = lock === "ancestor" ? await lockGroup(main, "parent") : initial;
    selectLayers(main, ["target"]);
    press("ArrowRight");
    expect.soft(await readScene()).toEqual(before);
    press("ArrowDown", { shiftKey: true });
    expect.soft(await readScene()).toEqual(before);
    if (lock === "ancestor") await expectUndoTo(main, initial);
    expect(undo(main)).toBeDisabled();
  });

  it("nudges only the movable leaf in a mixed selection and records one undo", async () => {
    const main = await mount(scene([
      leaf("movable", { x: 40 }), leaf("self-locked", { x: 100, zIndex: 1, locked: true }),
      leaf("inherited", { x: 160, zIndex: 2, groupId: "parent" }), leaf("outside", { x: 220, zIndex: 3 })
    ], [group("parent")]));
    const before = await lockGroup(main, "parent");
    selectLayers(main, ["movable", "self-locked", "inherited"]);
    press("ArrowDown", { shiftKey: true });
    expect.soft(await readScene()).toEqual({
      ...before, elements: before.elements.map(item => item.id === "movable" ? { ...item, y: item.y + 10 } : item)
    });
    await expectUndoTo(main, before);
  });

  it("does not delete a locked group or its layers when Delete is pressed", async () => {
    const main = await mount(scene([leaf("member", { groupId: "parent" })], [group("parent")]));
    const initial = await readScene();
    const before = await lockGroup(main, "parent");
    press("Delete");
    expect.soft(await readScene()).toEqual(before);
    await expectUndoTo(main, initial);
    expect(undo(main)).toBeDisabled();
  });

  it("retains protected members and their lock when Delete targets an unlocked ancestor group", async () => {
    const main = await mount(scene([
      leaf("editable", { groupId: "parent" }),
      leaf("self-locked", { groupId: "parent", locked: true, zIndex: 1 }),
      leaf("inherited", { groupId: "nested", zIndex: 2 })
    ], [group("parent"), group("nested", { parentId: "parent" })]));
    await lockGroup(main, "nested");
    fireEvent.click(groupRow(main, "parent"));
    expect(groupRow(main, "parent")).toHaveClass("selected");
    press("Delete");
    const after = await readScene();
    expect(after.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "self-locked", locked: true }),
      expect.objectContaining({ id: "inherited", groupId: "nested" })
    ]));
    expect(after.groups).toEqual(expect.arrayContaining([expect.objectContaining({ id: "nested", locked: true })]));
  });

  it("deletes an ordinary unlocked group and its members with one undo", async () => {
    const main = await mount(scene([
      leaf("outside"), leaf("member", { groupId: "parent", zIndex: 1 })
    ], [group("parent")]));
    const before = await readScene();
    fireEvent.click(groupRow(main, "parent"));
    expect(groupRow(main, "parent")).toHaveClass("selected");
    press("Delete");
    expect(await readScene()).toEqual({ ...before, groups: [], elements: before.elements.filter(item => item.id === "outside") });
    await expectUndoTo(main, before);
    expect(undo(main)).toBeDisabled();
  });

  it("does not move a locked ordinary layer via layer-panel drag and drop", async () => {
    const main = await mount(scene([
      leaf("locked", { locked: true }), leaf("movable", { zIndex: 1 }),
      leaf("member", { groupId: "destination", zIndex: 2 })
    ], [group("destination")]));
    const before = await readScene();
    dragLayerIntoGroup(main, "locked", "destination");
    expect.soft(await readScene()).toEqual(before);
    expect.soft(undo(main)).toBeDisabled();
    dragLayerIntoGroup(main, "movable", "destination");
    expect((await readScene()).elements.find(item => item.id === "movable")?.groupId).toBe("destination");
  });

  it.each(["self", "ancestor"] as const)("blocks smart object editing by double-click with %s locking", async lock => {
    const main = await mount(scene([
      object(lock === "self" ? { locked: true } : { groupId: "parent" })
    ], [group("parent")]));
    const initial = await readScene();
    const before = lock === "ancestor" ? await lockGroup(main, "parent") : initial;
    vi.spyOn(main.querySelector<HTMLElement>(".canvas")!, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 240, width: 300, height: 240, toJSON: () => ({})
    });
    fireEvent.doubleClick(requiredNode(main, ".canvas"), { clientX: 180, clientY: 140 });
    expect(main.querySelector(".object-editor-overlay") !== null).toBe(false);
    fireEvent.doubleClick(within(layerRow(main, "object")).getByTitle(label("smartObject.edit")));
    expect(main.querySelector(".object-editor-overlay") !== null).toBe(false);
    expect(await readScene()).toEqual(before);
    if (lock === "ancestor") await expectUndoTo(main, initial);
    expect(undo(main)).toBeDisabled();
  });

  it("changes layer panel opacity only on editable selected layers and synchronizes textbox text opacity", async () => {
    const main = await mount(scene([
      leaf("editable", { opacity: 0.7 }),
      leaf("text", { type: "textbox", opacity: 0.8, color: "#15803d", textBox: textBox(), zIndex: 1 }),
      leaf("self-locked", { locked: true, opacity: 0.6, zIndex: 2 }),
      leaf("inherited", { groupId: "parent", opacity: 0.5, zIndex: 3 }),
      leaf("outside", { opacity: 0.4, zIndex: 4 })
    ], [group("parent")]));
    const before = await lockGroup(main, "parent");
    selectLayers(main, ["editable", "text", "self-locked", "inherited"]);
    const input = within(requiredNode(main, ".layer-opacity-row")).getByRole("spinbutton");
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "25" } });
    const after = await readScene();
    expect.soft(after.elements.map(({ id, opacity }) => [id, opacity])).toEqual([
      ["editable", 0.25], ["text", 0.25], ["self-locked", 0.6], ["inherited", 0.5], ["outside", 0.4]
    ]);
    expect.soft(after.elements.find(item => item.id === "text")).toMatchObject({ textBox: { textOpacity: 0.25 } });
    expect(after.groups).toEqual(before.groups);
    await expectUndoTo(main, before);
  });
  it("does not drop an editable layer into a locked destination group", async () => {
    const main = await mount(scene([leaf("movable"), leaf("member", { groupId: "destination", zIndex: 1 })], [group("destination")]));
    const initial = await readScene();
    const before = await lockGroup(main, "destination");
    dragLayerIntoGroup(main, "movable", "destination");
    expect(await readScene()).toEqual(before);
    await expectUndoTo(main, initial);
    expect(undo(main)).toBeDisabled();
  });

  it.each(["self", "child"] as const)("protects group opacity with %s locking", async lock => {
    const main = await mount(scene([leaf("member", { groupId: "child" })], [group("parent"), group("child", { parentId: "parent" })]));
    const initial = await readScene();
    const before = await lockGroup(main, lock === "self" ? "parent" : "child");
    fireEvent.click(groupRow(main, "parent"));
    fireEvent.change(within(requiredNode(main, ".layer-opacity-row")).getByRole("spinbutton"), { target: { value: "25" } });
    expect(await readScene()).toEqual(before);
    await expectUndoTo(main, initial);
    expect(undo(main)).toBeDisabled();
  });

  it("updates selected root groups and loose text opacity once, without changing locked extras or member opacity", async () => {
    const main = await mount(scene([
      leaf("member", { groupId: "parent", opacity: 0.8 }),
      leaf("text", { type: "textbox", textBox: textBox(), opacity: 0.8, zIndex: 1 }),
      leaf("locked", { locked: true, opacity: 0.6, zIndex: 2 })
    ], [group("parent")]));
    const before = await readScene();
    fireEvent.click(groupRow(main, "parent"));
    fireEvent.click(layerRow(main, "text"), { ctrlKey: true });
    fireEvent.click(layerRow(main, "locked"), { ctrlKey: true });
    fireEvent.change(within(requiredNode(main, ".layer-opacity-row")).getByRole("spinbutton"), { target: { value: "25" } });
    const after = await readScene();
    expect(after.groups?.find(item => item.id === "parent")?.opacity).toBe(0.25);
    expect(after.elements.find(item => item.id === "member")?.opacity).toBe(0.8);
    expect(after.elements.find(item => item.id === "locked")?.opacity).toBe(0.6);
    expect(after.elements.find(item => item.id === "text")).toMatchObject({ opacity: 0.25, textBox: { textOpacity: 0.25 } });
    await expectUndoTo(main, before);
    expect(undo(main)).toBeDisabled();
  });

  it("blocks layer-order buttons for protected groups while keeping ordinary group ordering editable", async () => {
    const main = await mount(scene([leaf("member", { groupId: "parent" }), leaf("outside", { zIndex: 1 })], [group("parent")]));
    const initial = await readScene();
    const before = await lockGroup(main, "parent");
    fireEvent.contextMenu(groupRow(main, "parent"), { clientX: 30, clientY: 60 });
    fireEvent.click(button(requiredNode(main, ".layer-context-menu"), "props.layerTop"));
    expect(await readScene()).toEqual(before);
    await expectUndoTo(main, initial);
    expect(undo(main)).toBeDisabled();
    fireEvent.contextMenu(groupRow(main, "parent"), { clientX: 30, clientY: 60 });
    fireEvent.click(button(requiredNode(main, ".layer-context-menu"), "props.layerTop"));
    expect((await readScene()).elements.find(item => item.id === "member")?.zIndex).toBe(1);
    await expectUndoTo(main, initial);
    expect(undo(main)).toBeDisabled();
  });
});

describe("App JSON group lock round trip", () => {
  it("preserves explicit group locks when replacing the scene, saving the snapshot, and copying JSON", async () => {
    const main = await mount(scene([leaf("original")]));
    const before = await readScene();
    importThroughDialog(main, incomingScene(), "replace");
    await waitFor(async () => expect((await readScene()).elements.map(item => item.id)).toEqual(["pinned-member", "editable-member"]));
    const expectedLocks = { pinned: true, editable: false };
    expect.soft(groupLocks(await readScene())).toEqual(expectedLocks);
    expect((await readScene()).groups?.find(item => item.id === "editable")?.parentId).toBe("pinned");

    fireEvent.click(button(requiredNode(main, ".sidebar-right"), "tab.code"));
    const copyLabel = translations.zh["code.copy"];
    if (typeof copyLabel !== "function") throw new Error("Missing JSON copy label formatter");
    fireEvent.click(within(requiredNode(main, ".sidebar-right")).getByRole("button", { name: copyLabel("JSON"), exact: true }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect.soft(groupLocks(JSON.parse(writeText.mock.calls[0][0]))).toEqual(expectedLocks);

    let stored: SceneDocument;
    await waitFor(() => {
      stored = JSON.parse(localStorage.getItem(lastCanvasKey)!).scene;
      expect(stored.elements.map(item => item.id)).toEqual(["pinned-member", "editable-member"]);
    }, { timeout: 2000 });
    expect.soft(groupLocks(stored!)).toEqual(expectedLocks);
    await expectUndoTo(main, before);
    expect(undo(main)).toBeDisabled();
  });

  it("preserves true and false group locks when appending and remapping an imported hierarchy", async () => {
    const main = await mount(scene([leaf("original", { groupId: "existing" })], [group("existing")]));
    const before = await lockGroup(main, "existing");
    importThroughDialog(main, incomingScene(), "append");
    await waitFor(async () => expect((await readScene()).elements).toHaveLength(3));
    const appended = await readScene();
    const pinned = appended.groups?.find(item => item.name === "pinned");
    const editable = appended.groups?.find(item => item.name === "editable");
    expect(pinned?.id).toEqual(expect.any(String));
    expect(pinned?.id).not.toBe("pinned");
    expect(editable?.id).toEqual(expect.any(String));
    expect(editable?.id).not.toBe("editable");
    expect(editable?.parentId).toBe(pinned?.id);
    expect(appended.groups?.some(item => item.id === pinned?.parentId && item.parentId === null)).toBe(true);
    expect(appended.elements.find(item => item.layerName === "pinned-member")?.groupId).toBe(pinned?.id);
    expect(appended.elements.find(item => item.layerName === "editable-member")?.groupId).toBe(editable?.id);
    expect(appended.elements.find(item => item.id === "original")).toEqual(before.elements[0]);
    expect.soft(groupLocks(appended)).toMatchObject({ existing: true, pinned: true, editable: false });
    await expectUndoTo(main, before);
  });
});
