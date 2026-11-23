import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import App, { type SceneDocument, type SceneLeaf } from "../src/App";
import { I18nProvider, translations } from "../src/i18n";
import { QUICK_FAVORITES_STORAGE_KEY, type QuickFavorite } from "../src/quickLibraryFavorites";
import type { SmartObject } from "../src/smartObjectModel";

type Tool = Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0];
const registeredTools = new Map<string, Tool>();
const shapeTypes = ["ellipse", "rectangle", "triangle", "four_point_star", "five_point_star", "ring", "textbox"] as const;
const label = (key: string) => translations.zh[key] as string;

function makeScene(): SceneDocument {
  const element = { id: "existing", name: "Existing shape", type: "rectangle" as const, x: 120, y: 90, width: 80, height: 50, rotation: 12, color: "#abcdef", opacity: 0.7, zIndex: 4, visible: true, locked: true, isBackground: false, groupId: "existing-group" };
  return {
    canvas: { width: 320, height: 240, background: "transparent" }, elements: [element],
    groups: [{ id: "existing-group", name: "Existing group", parentId: null, visible: true, locked: true, opacity: 0.8, collapsed: false, order: 3 }],
    meta: { sourceType: "editor", sourceName: "existing-library-scene", warnings: [] },
    library: { activeCategory: "basic-shape", categories: [{ key: "basic-shape", label: "基础形状", supported: true }], baseShapePresets: [], savedItems: [{ id: "saved", name: "Saved shape", element: { ...element, id: "saved-element", groupId: null } }] }
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("miliastra-editor-lang", "zh");
  localStorage.setItem("miliastra-editor-tour-seen", "1");
  registeredTools.clear();
  Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool: async (tool: Tool) => { registeredTools.set(tool.name, tool); } } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    images: { "100001": { id: 100001, img: "basic.png" }, "100002": { id: 100002, img: "icon.png" } },
    categories: { "8": { id: 8, images: [100001] }, "3": { id: 3, images: [100002] } }, names: { "zh-CN": { "8": "基础形状", "3": "功能图标" } }
  }), { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, "modelContext"); });

async function readScene(): Promise<SceneDocument> {
  const tool = registeredTools.get("get_scene");
  if (!tool) throw new Error("App did not register get_scene");
  const result = await tool.execute({}, {});
  if (!result || typeof result !== "object" || !("elements" in result)) throw new Error("Scene unavailable");
  return result as SceneDocument;
}

async function mount(initial: SceneDocument, canvasId = "canvas-a") {
  localStorage.setItem("miliastra-current-canvas-id", canvasId);
  localStorage.setItem("miliastra-last-canvas", JSON.stringify({ canvasId, name: "Existing canvas", scene: initial, savedAt: 1 }));
  localStorage.setItem("miliastra-restore-on-load", "1");
  const view = render(<I18nProvider><App /></I18nProvider>);
  const root = view.container.querySelector<HTMLElement>(".app-shell")!;
  await waitFor(async () => expect((await readScene()).elements).toEqual(initial.elements));
  await waitFor(() => expect(root.querySelector('.sidebar-left option[value="basic-shape"]')).not.toBeNull());
  return root;
}

function expectShapeCards(root: HTMLElement) {
  const cards = root.querySelectorAll(".sidebar-left .library-card");
  expect(cards).toHaveLength(shapeTypes.length);
  shapeTypes.forEach((type, index) => expect(within(cards[index] as HTMLElement).getByText(label("shape." + type), { exact: true })).toBeVisible());
}

describe("restored basic shape library", () => {
  it.each(["empty", "missing"] as const)("rebuilds %s presets without changing scene content or adding undo", async kind => {
    const initial = makeScene();
    if (kind === "missing") Reflect.deleteProperty(initial.library, "baseShapePresets");
    const root = await mount(initial);
    expectShapeCards(root);
    const restored = await readScene();
    expect(restored.elements).toEqual(initial.elements);
    expect(restored.groups).toEqual(initial.groups);
    expect(restored.canvas).toEqual(initial.canvas);
    expect(restored.meta).toEqual(initial.meta);
    expect(restored.library.savedItems).toEqual(initial.library.savedItems);
    expect(restored.library.baseShapePresets.map(item => item.type)).toEqual([...shapeTypes]);
    expect(within(root).getByTitle(label("topbar.undoShort"))).toBeDisabled();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("miliastra-last-canvas")!).scene.library.baseShapePresets).toHaveLength(shapeTypes.length), { timeout: 2000 });
  });

  it("keeps custom presets when filling missing types and creating or undoing a shape", async () => {
    const initial = makeScene();
    const preset = { type: "rectangle" as const, color: "#123456", width: 147, height: 93 };
    initial.library.baseShapePresets = [preset];
    const root = await mount(initial);
    expectShapeCards(root);
    expect((await readScene()).library.baseShapePresets.find(item => item.type === "rectangle")).toEqual(preset);
    const card = [...root.querySelectorAll(".sidebar-left .library-card")].find(item => item.textContent === label("shape.rectangle"))!;
    fireEvent.doubleClick(card);
    const added = await readScene();
    expect(added.elements).toHaveLength(2);
    expect(added.elements[1]).toMatchObject(preset);
    // Creating a shape compacts z-indices; undo must still restore the original scene.
    expect(added.elements[0]).toEqual({ ...initial.elements[0], zIndex: 0 });
    expect(added.groups).toEqual(initial.groups);
    expect(added.library.savedItems).toEqual(initial.library.savedItems);
    fireEvent.click(within(root).getByTitle(label("topbar.undoShort")));
    expect((await readScene()).elements).toEqual(initial.elements);
    expectShapeCards(root);
    expect(within(root).getByTitle(label("topbar.undoShort"))).toBeDisabled();
  });

  it("adds a basic shape right above a selected nested layer, inheriting color and relative size in one undo", async () => {
    const initial = makeScene();
    initial.groups![0] = { ...initial.groups![0], parentId: "outer", locked: false };
    initial.groups!.push({ id: "outer", name: "Outer group", parentId: null, visible: true, opacity: 1, collapsed: false, order: 0 });
    const reference = { ...initial.elements[0] as SceneLeaf, width: 160, height: 120, locked: false };
    initial.elements = [{ ...reference, id: "above", zIndex: 7 }, reference];
    initial.library.baseShapePresets = [
      { type: "rectangle", color: "#123456", width: 80, height: 40 },
      { type: "ellipse", color: "#654321", width: 90, height: 50 }
    ];
    const root = await mount(initial);
    const before = await readScene();
    fireEvent.click(root.querySelector('.layer-row-item[data-element-id="existing"]')!);
    const card = [...root.querySelectorAll(".sidebar-left .library-card")].find(item => item.textContent === label("shape.ellipse"))!;
    fireEvent.doubleClick(card);
    const added = await readScene();
    expect(added.elements.map(element => element.id)).toEqual(["existing", expect.any(String), "above"]);
    expect(added.elements[1]).toMatchObject({ type: "ellipse", groupId: "existing-group", color: "#abcdef", width: 180, height: 150, rotation: 0, opacity: 0.85, zIndex: 1 });
    expect(added.groups).toEqual(before.groups);
    expect(added.library).toEqual(before.library);
    fireEvent.click(within(root).getByTitle(label("topbar.undoShort")));
    expect((await readScene()).elements).toEqual(before.elements);
    expect(within(root).getByTitle(label("topbar.undoShort"))).toBeDisabled();
  });

  it("keeps other categories visible and supplies the restored shapes to the quick library", async () => {
    const root = await mount(makeScene());
    const category = root.querySelector<HTMLSelectElement>(".sidebar-left select")!;
    await waitFor(() => expect(category.querySelector('option[value="function-icon"]')).not.toBeNull());
    fireEvent.change(category, { target: { value: "function-icon" } });
    expect(root.querySelectorAll(".sidebar-left .asset-card")).toHaveLength(1);
    fireEvent.change(category, { target: { value: "basic-shape" } });
    expectShapeCards(root);
    fireEvent.contextMenu(root.querySelector(".canvas-stage")!, { clientX: 250, clientY: 180 });
    const menu = root.querySelector<HTMLElement>(".quick-library-menu")!;
    fireEvent.click(within(menu).getByRole("button", { name: label("quickLibrary.all"), exact: true }));
    expect(menu.querySelectorAll(".quick-library-add")).toHaveLength(shapeTypes.length + 1);
    const names = [...menu.querySelectorAll(".quick-library-add strong")].map(item => item.textContent);
    expect(names).toEqual([...shapeTypes.map(type => label("shape." + type)), "Saved shape"]);
  });
});

function openQuickLibrary(root: HTMLElement, tab: "favorites" | "all" = "favorites") {
  fireEvent.click(within(root).getByTitle(label("canvas.zoomReset")));
  fireEvent.contextMenu(root.querySelector(".canvas-stage")!, { clientX: 250, clientY: 180 });
  const menu = root.querySelector<HTMLElement>(".quick-library-menu")!;
  fireEvent.click(within(menu).getByRole("button", { name: label("quickLibrary." + tab), exact: true }));
  return menu;
}

function quickCard(menu: HTMLElement, name: string) {
  return within(menu).getByText(name, { exact: true }).closest<HTMLElement>(".quick-library-item")!;
}

function starSaved(root: HTMLElement, name: string) {
  const menu = openQuickLibrary(root, "all");
  fireEvent.click(within(quickCard(menu, name)).getByRole("button", { name: label("quickLibrary.addFavorite"), exact: true }));
}

async function newCanvas(root: HTMLElement) {
  fireEvent.click(within(root).getByTitle(label("topbar.newCanvas")));
  fireEvent.click(within(root).getByRole("button", { name: label("newCanvas.confirm"), exact: true }));
  await waitFor(async () => expect((await readScene()).elements).toEqual([]));
}

function savedScene(name = "Frozen A shape", patch: Partial<SceneLeaf> = {}): SceneDocument {
  const initial = makeScene();
  initial.library.savedItems[0] = {
    id: "saved", name, category: "basic-shape",
    element: { ...initial.elements[0] as SceneLeaf, id: "saved-element", groupId: "existing-group", ...patch }
  };
  return initial;
}

function archive(scene: SceneDocument, canvasId: string, name: string) {
  return { id: "archive-" + name, canvasId, name, scene, savedAt: 1 };
}

async function openArchive(root: HTMLElement, name: string) {
  fireEvent.click(within(root).getByTitle(label("topbar.archives")));
  const menu = root.querySelector<HTMLElement>(".archive-menu")!;
  const row = within(menu).getByTitle(name).closest<HTMLElement>(".archive-row")!;
  fireEvent.click(within(row).getByRole("button", { name: label("archive.open"), exact: true }));
  const confirm = within(root).queryByRole("button", { name: label("archive.confirmContinue"), exact: true });
  if (confirm) fireEvent.click(confirm);
  await waitFor(() => expect(root.querySelector(".archive-menu")).toBeNull());
}

function transfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: "none", dropEffect: "none",
    setData: vi.fn((type: string, value: string) => { values.set(type, value); }),
    getData: vi.fn((type: string) => values.get(type) ?? "")
  };
}

function dragFavorite(root: HTMLElement, name: string) {
  const card = quickCard(openQuickLibrary(root), name);
  const button = card.querySelector<HTMLButtonElement>(".quick-library-add")!;
  expect(button).toBeEnabled();
  expect(button.draggable).toBe(true);
  const dataTransfer = transfer();
  fireEvent.dragStart(button, { dataTransfer });
  const payload = dataTransfer.getData("application/miliastra-shape");
  expect(payload).not.toBe("");
  const drop = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 165, clientY: 130 });
  Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
  fireEvent(root.querySelector(".canvas")!, drop);
  return JSON.parse(payload);
}

function savedFavorites() {
  return (JSON.parse(localStorage.getItem(QUICK_FAVORITES_STORAGE_KEY) ?? "[]") as QuickFavorite[]).filter(item => item.kind === "saved");
}

async function exportJson() {
  const tool = registeredTools.get("export_scene");
  if (!tool) throw new Error("App did not register export_scene");
  const result = await tool.execute({ format: "json" }, {});
  if (!result || typeof result !== "object" || !("content" in result) || typeof result.content !== "string") throw new Error("JSON export unavailable");
  return JSON.parse(result.content);
}

async function editThroughTool(name: string, args: Record<string, unknown>) {
  const tool = registeredTools.get(name);
  if (!tool) throw new Error("App did not register " + name);
  await act(async () => { await tool.execute(args, {}); });
}

function objectIds(object: SmartObject) {
  return [object.id, ...object.content.elements.map(item => item.id), ...object.content.groups.map(item => item.id)];
}

describe("frozen saved quick favorites", () => {
  beforeEach(() => { localStorage.setItem(QUICK_FAVORITES_STORAGE_KEY, "[]"); });

  it.each([true, false])("inserts A's frozen saved element after creating B without changing existing leaf locked=%s insertion behavior", async locked => {
    const initial = savedScene("Frozen A shape", { locked });
    const root = await mount(initial);
    starSaved(root, "Frozen A shape");
    expect(savedFavorites()[0]).toMatchObject({ sourceCanvasId: "canvas-a", savedId: "saved", name: "Frozen A shape", snapshot: { version: 1, element: { groupId: null, locked } } });
    await newCanvas(root);

    const card = quickCard(openQuickLibrary(root), "Frozen A shape");
    fireEvent.click(card.querySelector<HTMLButtonElement>(".quick-library-add")!);
    const added = await readScene();
    expect(added.elements).toHaveLength(1);
    expect(added.elements[0]).toMatchObject({ type: "rectangle", color: "#abcdef", width: 80, height: 50, rotation: 12, opacity: 0.7, groupId: null });
    expect(added.elements[0]).not.toHaveProperty("locked");
    expect(added.elements[0].id).not.toBe("saved-element");
    expect(added.groups).toEqual([]);
  });

  it("drags A's frozen content after opening B with a conflicting saved ID", async () => {
    const initial = savedScene();
    const other = savedScene("B live shape", { color: "#22aa66", width: 31, height: 29, locked: false });
    localStorage.setItem("miliastra-scene-archives", JSON.stringify([archive(other, "canvas-b", "Work B")]));
    const root = await mount(initial);
    starSaved(root, "Frozen A shape");
    await openArchive(root, "Work B");
    expect((await readScene()).library.savedItems[0].name).toBe("B live shape");

    expect(dragFavorite(root, "Frozen A shape")).toMatchObject({ type: "rectangle", override: { color: "#abcdef", width: 80, height: 50, locked: true, groupId: null } });
    await waitFor(async () => expect((await readScene()).elements).toHaveLength(2));
    const added = (await readScene()).elements[1];
    expect(added).toMatchObject({ color: "#abcdef", width: 80, height: 50, rotation: 12, opacity: 0.7, groupId: null });
    expect(added).not.toHaveProperty("locked");
    expect(Number.isFinite(added.x)).toBe(true);
    expect(Number.isFinite(added.y)).toBe(true);
    expect(added.id).not.toBe("saved-element");
  });

  it("retains captured content and name when the source saved item changes and is deleted", async () => {
    const initial = savedScene("Frozen A shape", { id: "source", locked: false, groupId: null });
    initial.elements = [structuredClone(initial.library.savedItems[0].element)];
    initial.groups = [];
    initial.library.savedItems[0].id = "source-saved-0";
    const root = await mount(initial);
    starSaved(root, "Frozen A shape");
    const frozen = localStorage.getItem(QUICK_FAVORITES_STORAGE_KEY);

    await editThroughTool("update_element", { id: "source", color: "#22aa66", name: "Changed source", width: 31 });
    fireEvent.click(within(root).getByRole("button", { name: new RegExp(label("topbar.save")) }));
    await waitFor(async () => expect((await readScene()).library.savedItems[0]).toMatchObject({ id: "source-saved-0", name: expect.stringContaining("Changed source"), element: { color: "#22aa66", width: 31 } }));
    let menu = openQuickLibrary(root);
    expect(within(menu).queryByText(/Changed source/)).toBeNull();
    fireEvent.click(quickCard(menu, "Frozen A shape").querySelector<HTMLButtonElement>(".quick-library-add")!);
    expect((await readScene()).elements[1]).toMatchObject({ name: "Existing shape", color: "#abcdef", width: 80, groupId: null });
    expect(localStorage.getItem(QUICK_FAVORITES_STORAGE_KEY)).toBe(frozen);

    for (const element of (await readScene()).elements) await editThroughTool("remove_element", { id: element.id });
    fireEvent.click(within(root).getByRole("button", { name: new RegExp(label("topbar.save")) }));
    await waitFor(async () => expect((await readScene()).library.savedItems).toEqual([]));
    expect((await readScene()).elements).toEqual([]);
    menu = openQuickLibrary(root);
    fireEvent.click(quickCard(menu, "Frozen A shape").querySelector<HTMLButtonElement>(".quick-library-add")!);
    expect((await readScene()).elements).toHaveLength(1);
    expect((await readScene()).elements[0]).toMatchObject({ name: "Existing shape", color: "#abcdef", width: 80, groupId: null });
    expect(localStorage.getItem(QUICK_FAVORITES_STORAGE_KEY)).toBe(frozen);
  });

  it("keeps two same-saved-ID favorites separate by canvas identity", async () => {
    const initial = savedScene();
    const other = savedScene("Frozen B shape", { color: "#22aa66", width: 31, locked: false });
    localStorage.setItem("miliastra-scene-archives", JSON.stringify([archive(other, "canvas-b", "Work B")]));
    const root = await mount(initial);
    starSaved(root, "Frozen A shape");
    await openArchive(root, "Work B");
    starSaved(root, "Frozen B shape");
    expect(savedFavorites()).toHaveLength(2);
    expect(savedFavorites().map(item => [item.sourceCanvasId, item.savedId, item.name])).toEqual(expect.arrayContaining([
      ["canvas-a", "saved", "Frozen A shape"], ["canvas-b", "saved", "Frozen B shape"]
    ]));

    for (const [name, color, width] of [["Frozen A shape", "#abcdef", 80], ["Frozen B shape", "#22aa66", 31]] as const) {
      const card = quickCard(openQuickLibrary(root), name);
      fireEvent.click(card.querySelector<HTMLButtonElement>(".quick-library-add")!);
      expect((await readScene()).elements.at(-1)).toMatchObject({ color, width, groupId: null });
    }
    expect((await readScene()).elements).toHaveLength(3);
  });

  it.each(["click", "drag"] as const)("inserts a favorite at the root by %s even when a destination group is selected", async mode => {
    const initial = savedScene("Frozen A shape", { locked: false });
    initial.groups!.push({ id: "target-group", name: "Destination group", parentId: null, zIndex: 5, visible: true, locked: false, opacity: 1 });
    const root = await mount(initial);
    starSaved(root, "Frozen A shape");
    const group = root.querySelector<HTMLElement>('.layer-group-row[data-group-id="target-group"]')!;
    expect(group).not.toBeNull();
    fireEvent.click(group);
    expect(group.className).toMatch(/selected/);
    if (mode === "click") fireEvent.click(quickCard(openQuickLibrary(root), "Frozen A shape").querySelector<HTMLButtonElement>(".quick-library-add")!);
    else expect(dragFavorite(root, "Frozen A shape")).toMatchObject({ override: { locked: false, groupId: null } });
    const added = await readScene();
    expect(added.elements).toHaveLength(2);
    expect(added.elements[1]).toMatchObject({ color: "#abcdef", groupId: null });
    expect(added.elements[1]).not.toHaveProperty("locked");
    expect(added.groups!.some(item => item.id === "target-group")).toBe(true);
  });

  it.each(["legacy", "bad snapshot", "missing source"] as const)("keeps %s favorites unresolved and removable despite a matching current saved ID", async kind => {
    const initial = savedScene("Matching current item");
    const favorite = {
      kind: "saved", savedId: "saved", name: "Unavailable saved",
      ...(kind === "bad snapshot" ? { sourceCanvasId: "canvas-a", snapshot: { version: 99, element: initial.library.savedItems[0].element } } : {}),
      ...(kind === "missing source" ? { snapshot: { version: 1, element: initial.library.savedItems[0].element } } : {})
    };
    const raw = JSON.stringify([favorite]);
    localStorage.setItem(QUICK_FAVORITES_STORAGE_KEY, raw);
    const root = await mount(initial);
    expect(localStorage.getItem(QUICK_FAVORITES_STORAGE_KEY)).toBe(raw);
    const menu = openQuickLibrary(root);
    const card = quickCard(menu, "Unavailable saved");
    const button = card.querySelector<HTMLButtonElement>(".quick-library-add")!;
    expect(button).toBeDisabled();
    expect(button.draggable).toBe(false);
    expect(card.querySelector(".quick-library-copy small")).toHaveTextContent(label("quickLibrary.unresolvedSaved"));
    const dataTransfer = transfer();
    fireEvent.dragStart(button, { dataTransfer });
    fireEvent.click(button);
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    expect((await readScene()).elements).toEqual(initial.elements);
    fireEvent.click(within(card).getByRole("button", { name: label("quickLibrary.removeFavorite"), exact: true }));
    expect(within(menu).queryByText("Unavailable saved", { exact: true })).toBeNull();
    expect(JSON.parse(localStorage.getItem(QUICK_FAVORITES_STORAGE_KEY)!)).toEqual([]);
  });

  it("inserts smart-object favorites with independent shell, element and group IDs by click and drag", async () => {
    const initial = savedScene("Frozen object");
    const smart: SmartObject = {
      id: "saved-object", name: "Frozen object layer", type: "smart-object", x: 80, y: 60, rotation: 15, opacity: 0.8,
      zIndex: 2, visible: true, locked: true, groupId: "existing-group", scale: 1.25,
      content: {
        frame: { width: 120, height: 100 },
        elements: [{ ...initial.elements[0] as SceneLeaf, id: "inside-a", x: 40, y: 30, groupId: "inside-group" }],
        groups: [{ ...initial.groups![0], id: "inside-group", parentId: null }]
      }
    };
    initial.schemaVersion = 2;
    initial.library.savedItems[0].element = smart;
    const other = makeScene();
    other.elements[0] = { ...other.elements[0] as SceneLeaf, id: "inside-a", groupId: "inside-group" };
    other.groups![0].id = "inside-group";
    other.library.savedItems = [];
    localStorage.setItem("miliastra-scene-archives", JSON.stringify([archive(other, "canvas-b", "Work B")]));
    const root = await mount(initial);
    starSaved(root, "Frozen object");
    const frozen = localStorage.getItem(QUICK_FAVORITES_STORAGE_KEY);
    await openArchive(root, "Work B");
    fireEvent.click(quickCard(openQuickLibrary(root), "Frozen object").querySelector<HTMLButtonElement>(".quick-library-add")!);
    expect(dragFavorite(root, "Frozen object")).toMatchObject({ object: { type: "smart-object", groupId: null, content: smart.content } });

    await waitFor(async () => expect((await readScene()).elements).toHaveLength(3));
    const added = await readScene();
    const copies = added.elements.filter((element): element is SmartObject => element.type === "smart-object");
    expect(copies).toHaveLength(2);
    const ids = [...added.elements.filter(element => element.type !== "smart-object").map(element => element.id), ...(added.groups ?? []).map(group => group.id), ...copies.flatMap(objectIds)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const copy of copies) {
      expect(objectIds(copy).some(id => objectIds(smart).includes(id))).toBe(false);
      expect(copy).toMatchObject({ name: smart.name, groupId: null, locked: true, scale: 1.25, rotation: 15, opacity: 0.8 });
      expect(copy.content.frame).toEqual(smart.content.frame);
      expect(copy.content.elements[0]).toMatchObject({ color: "#abcdef", width: 80, height: 50, locked: true, groupId: copy.content.groups[0].id });
      expect(copy.content.groups[0].parentId).toBeNull();
      expect(Number.isFinite(copy.x)).toBe(true);
      expect(Number.isFinite(copy.y)).toBe(true);
    }
    expect(localStorage.getItem(QUICK_FAVORITES_STORAGE_KEY)).toBe(frozen);
  });

  it("keeps global favorites out of exported scene JSON", async () => {
    const root = await mount(savedScene());
    const before = await exportJson();
    starSaved(root, "Frozen A shape");
    expect(savedFavorites()).toHaveLength(1);
    expect(await exportJson()).toEqual(before);
  });

  it.each(["quota", "general"] as const)("keeps favorites usable for the session after a %s write failure and clears the warning after a successful toggle", async kind => {
    const raw = '[{"kind":"shape","type":"rectangle","name":"Keep existing favorite"}]';
    localStorage.setItem(QUICK_FAVORITES_STORAGE_KEY, raw);
    const originalSetItem = Storage.prototype.setItem;
    let fail = true;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === QUICK_FAVORITES_STORAGE_KEY && fail) throw kind === "quota" ? new DOMException("Quota exceeded", "QuotaExceededError") : new Error("Storage blocked");
      originalSetItem.call(this, key, value);
    });
    const root = await mount(savedScene());
    expect(write.mock.calls.filter(([key]) => key === QUICK_FAVORITES_STORAGE_KEY)).toHaveLength(0);
    starSaved(root, "Frozen A shape");
    let menu = openQuickLibrary(root);
    expect(menu.querySelector(".quick-library-storage-warning")).toHaveTextContent(label("quickLibrary.sessionOnly"));
    expect(menu.querySelector(".quick-library-storage-warning")).toHaveAttribute("role", "status");
    expect(localStorage.getItem(QUICK_FAVORITES_STORAGE_KEY)).toBe(raw);
    fireEvent.click(quickCard(menu, "Frozen A shape").querySelector<HTMLButtonElement>(".quick-library-add")!);
    expect((await readScene()).elements).toHaveLength(2);
    expect((await readScene()).elements[1]).toMatchObject({ color: "#abcdef", groupId: null });
    expect((await readScene()).elements[1]).not.toHaveProperty("locked");

    fail = false;
    menu = openQuickLibrary(root, "all");
    fireEvent.click(within(quickCard(menu, label("shape.ellipse"))).getByRole("button", { name: label("quickLibrary.addFavorite"), exact: true }));
    await waitFor(() => expect(savedFavorites()).toHaveLength(1));
    expect(localStorage.getItem(QUICK_FAVORITES_STORAGE_KEY)).not.toBe(raw);
    expect(menu.querySelector(".quick-library-storage-warning")).toBeNull();
    expect(JSON.parse(localStorage.getItem(QUICK_FAVORITES_STORAGE_KEY)!)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "shape", type: "rectangle" }), expect.objectContaining({ kind: "shape", type: "ellipse" }), expect.objectContaining({ kind: "saved", name: "Frozen A shape", sourceCanvasId: "canvas-a", snapshot: expect.objectContaining({ version: 1 }) })
    ]));
  });

  it.each([
    ["legacy shape migration", '  ["rectangle"]  '],
    ["legacy saved migration", '[{"kind":"saved","savedId":"saved","name":"Old saved"}]'],
    ["malformed JSON", '{broken'],
    ["explicit empty favorites", ' [] ']
  ])("does not overwrite %s during initial loading", async (_name, raw) => {
    localStorage.setItem(QUICK_FAVORITES_STORAGE_KEY, raw);
    const write = vi.spyOn(Storage.prototype, "setItem");
    const root = await mount(savedScene());
    expect(localStorage.getItem(QUICK_FAVORITES_STORAGE_KEY)).toBe(raw);
    expect(write.mock.calls.filter(([key]) => key === QUICK_FAVORITES_STORAGE_KEY)).toHaveLength(0);
    if (raw.trim() === "[]") {
      const menu = openQuickLibrary(root);
      expect(menu.querySelectorAll(".quick-library-add")).toHaveLength(0);
      expect(within(menu).getByText(label("quickLibrary.empty"))).toBeVisible();
    }
  });

  it("leaves persisted favorites intact when their initial read throws and keeps fallback favorites usable", async () => {
    const raw = '[{"kind":"shape","type":"rectangle","name":"Persisted favorite"}]';
    localStorage.setItem(QUICK_FAVORITES_STORAGE_KEY, raw);
    const originalGetItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (key) {
      if (key === QUICK_FAVORITES_STORAGE_KEY) throw new Error("Storage read blocked");
      return originalGetItem.call(this, key);
    });
    const write = vi.spyOn(Storage.prototype, "setItem");
    const root = await mount(savedScene());
    expect(originalGetItem.call(localStorage, QUICK_FAVORITES_STORAGE_KEY)).toBe(raw);
    expect(write.mock.calls.filter(([key]) => key === QUICK_FAVORITES_STORAGE_KEY)).toHaveLength(0);
    const menu = openQuickLibrary(root);
    fireEvent.click(quickCard(menu, label("shape.rectangle")).querySelector<HTMLButtonElement>(".quick-library-add")!);
    expect((await readScene()).elements).toHaveLength(2);
    expect(originalGetItem.call(localStorage, QUICK_FAVORITES_STORAGE_KEY)).toBe(raw);
  });
});
