import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import App, { type SceneDocument, type SceneElement, type SceneGroup, type SceneLeaf } from "../src/App";
import { I18nProvider, translations } from "../src/i18n";

type RegisteredTool = Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0];
type Node = { kind: "group" | "element"; id: string };
const registeredTools = new Map<string, RegisteredTool>();
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
const hitTest = vi.fn<(x: number, y: number) => Element | null>();

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

function scene(elements: SceneElement[], groups: SceneGroup[] = []): SceneDocument {
  return {
    schemaVersion: 2, canvas: { width: 300, height: 240, background: "transparent" }, elements, groups,
    meta: { sourceType: "editor", sourceName: "layer-tree-app-test", warnings: [] },
    library: {
      activeCategory: "basic-shape",
      categories: [{ key: "basic-shape", label: "基础形状", supported: true }],
      baseShapePresets: [], savedItems: []
    }
  };
}

function selectionScene(): SceneDocument {
  return scene([
    leaf("outside", { zIndex: 0 }),
    leaf("b-child", { zIndex: 1, groupId: "B-child" }),
    leaf("b", { zIndex: 2, groupId: "B" }),
    leaf("loose", { zIndex: 3 }),
    leaf("a-child", { zIndex: 4, groupId: "A-child" }),
    leaf("a", { zIndex: 5, groupId: "A" })
  ], [group("A"), group("A-child", { parentId: "A" }), group("B"), group("B-child", { parentId: "B" })]);
}

function dragScene(): SceneDocument {
  return scene([
    leaf("parent-leaf", { zIndex: 0, groupId: "parent" }),
    leaf("child-leaf", { zIndex: 1, groupId: "child" }),
    leaf("grandchild-leaf", { zIndex: 2, groupId: "grandchild" }),
    leaf("target-leaf", { zIndex: 3, groupId: "target" }),
    leaf("target-child-leaf", { zIndex: 4, groupId: "target-child" }),
    leaf("loose", { zIndex: 5 })
  ], [
    group("parent"), group("child", { parentId: "parent" }), group("grandchild", { parentId: "child" }),
    group("target"), group("target-child", { parentId: "target" }), group("empty")
  ]);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("miliastra-editor-lang", "zh");
  localStorage.setItem("miliastra-editor-tour-seen", "1");
  registeredTools.clear();
  // Only the public, read-only scene tool is called; no private App state is injected.
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool: async (tool: RegisteredTool) => { registeredTools.set(tool.name, tool); } }
  });
  hitTest.mockReset();
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
  // jsdom lacks PointerEvent. MouseEvent preserves the pointer coordinates/buttons used by App.
  if (!window.PointerEvent) vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("/api/library/catalog")) {
      return new Response(JSON.stringify({ images: {}, categories: {}, names: {} }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }
    throw new Error("Unexpected network request in layer-tree App test: " + url);
  }));
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
  if (originalElementFromPoint) Object.defineProperty(document, "elementFromPoint", originalElementFromPoint);
  else Reflect.deleteProperty(document, "elementFromPoint");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(initial: SceneDocument): Promise<HTMLElement> {
  localStorage.setItem("miliastra-last-canvas", JSON.stringify({ name: "Layer regression", scene: initial, savedAt: 1 }));
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
  if (!result || typeof result !== "object" || !("elements" in result)) throw new Error("Main scene is unavailable");
  return result as SceneDocument;
}

function row(main: HTMLElement, node: Node): HTMLElement {
  const attribute = node.kind === "group" ? "data-group-id" : "data-element-id";
  const result = main.querySelector<HTMLElement>('.layer-row-item[' + attribute + '="' + node.id + '"]');
  if (!result) throw new Error("Missing " + node.kind + " row: " + node.id);
  return result;
}

function selectedGroups(main: HTMLElement): string[] {
  return [...main.querySelectorAll<HTMLElement>(".layer-group-row.selected")].map(item => item.dataset.groupId!).sort();
}

function selectedElements(main: HTMLElement): string[] {
  return [...main.querySelectorAll<HTMLElement>(".layer-row-item.selected[data-element-id]")].map(item => item.dataset.elementId!).sort();
}

function toolbarGroup(main: HTMLElement) {
  const actions = main.querySelector<HTMLElement>(".layer-actions")!;
  fireEvent.click(within(actions).getByRole("button", { name: label("layers.groupAction"), exact: true }));
}

function undo(main: HTMLElement): HTMLButtonElement {
  return within(main).getByTitle(label("topbar.undoShort")) as HTMLButtonElement;
}

function redo(main: HTMLElement): HTMLButtonElement {
  return within(main).getByTitle(label("topbar.redoShort")) as HTMLButtonElement;
}

function openMenu(main: HTMLElement, node: Node): HTMLElement {
  fireEvent.contextMenu(row(main, node), { clientX: 100, clientY: 100 });
  const menu = main.querySelector<HTMLElement>(".layer-context-menu");
  if (!menu) throw new Error("Layer context menu did not open");
  return menu;
}

function getGroup(document: SceneDocument, id: string): SceneGroup {
  const result = document.groups?.find(item => item.id === id);
  if (!result) throw new Error("Missing scene group: " + id);
  return result;
}

function getLeaf(document: SceneDocument, id: string): SceneElement {
  const result = document.elements.find(item => item.id === id);
  if (!result) throw new Error("Missing scene layer: " + id);
  return result;
}

async function assertWrapper(main: HTMLElement, before: SceneDocument, groupIds: string[], looseIds: string[] = []) {
  const after = await readScene();
  const originalIds = new Set(before.groups?.map(item => item.id));
  const wrappers = after.groups?.filter(item => !originalIds.has(item.id)) ?? [];
  expect(wrappers).toHaveLength(1);
  const wrapper = wrappers[0];
  expect(wrapper.parentId ?? null).toBe(null);
  expect(after.groups).toHaveLength((before.groups?.length ?? 0) + 1);
  for (const original of before.groups ?? []) {
    const actual = getGroup(after, original.id);
    expect(actual.parentId ?? null).toBe(groupIds.includes(original.id) ? wrapper.id : original.parentId ?? null);
    expect(actual.name).toBe(original.name);
  }
  for (const original of before.elements) {
    const actual = getLeaf(after, original.id);
    expect(actual.groupId ?? null).toBe(looseIds.includes(original.id) ? wrapper.id : original.groupId ?? null);
    expect(actual.x).toBe(original.x);
    expect(actual.y).toBe(original.y);
  }
  expect(selectedGroups(main)).toEqual([wrapper.id]);
  const members = [...looseIds];
  for (const id of groupIds) {
    const descendants = new Set([id]);
    for (const original of before.groups ?? []) if (original.parentId === id) descendants.add(original.id);
    members.push(...before.elements.filter(item => item.groupId && descendants.has(item.groupId)).map(item => item.id));
  }
  expect(selectedElements(main)).toEqual(members.sort());
  expect(undo(main)).not.toBeDisabled();
  fireEvent.click(undo(main));
  expect(await readScene()).toEqual(before);
  expect(undo(main)).toBeDisabled();
  fireEvent.click(redo(main));
  expect(await readScene()).toEqual(after);
}

function beginDrag(main: HTMLElement, source: Node, target: Node, ratio: number) {
  const sourceRow = row(main, source), targetRow = row(main, target);
  const top = 100, height = 40, clientX = 140, clientY = top + height * ratio;
  vi.spyOn(targetRow, "getBoundingClientRect").mockReturnValue({
    x: 80, y: top, left: 80, top, right: 320, bottom: top + height, width: 240, height, toJSON: () => ({})
  });
  // Return an inner node, as the browser would; App must resolve the containing layer row.
  hitTest.mockReturnValue(targetRow.querySelector(".layer-info strong") ?? targetRow);
  fireEvent.pointerDown(sourceRow, { button: 0, buttons: 1, pointerId: 1, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(window, { button: 0, buttons: 1, pointerId: 1, clientX, clientY });
  expect(hitTest).toHaveBeenCalledWith(clientX, clientY);
  return {
    targetRow,
    finish: () => {
      fireEvent.pointerUp(window, { button: 0, buttons: 0, pointerId: 1, clientX, clientY });
      expect(main.querySelector(".is-drop-into, .is-drop-above, .is-drop-below")).toBeNull();
    }
  };
}

function assertHint(main: HTMLElement, target: HTMLElement, position: "above" | "below" | "into") {
  expect(target).toHaveClass("is-drop-" + position);
  expect(main.querySelectorAll(".is-drop-into, .is-drop-above, .is-drop-below")).toHaveLength(1);
}

function orderedIds(document: SceneDocument): string[] {
  return [...document.elements].sort((a, b) => a.zIndex - b.zIndex).map(item => item.id);
}

function assertContiguous(document: SceneDocument, ids: string[]) {
  const order = orderedIds(document), indices = ids.map(id => order.indexOf(id));
  expect(indices.every(index => index >= 0)).toBe(true);
  expect(indices).toEqual(Array.from({ length: indices.length }, (_, index) => indices[0] + index));
}

async function assertUndoRedo(main: HTMLElement, before: SceneDocument, after: SceneDocument) {
  expect(after).not.toEqual(before);
  fireEvent.click(undo(main));
  expect(await readScene()).toEqual(before);
  expect(undo(main)).toBeDisabled();
  fireEvent.click(redo(main));
  expect(await readScene()).toEqual(after);
}

describe("real App layer-tree selection and grouping", () => {
  it.each([
    ["Ctrl", "two-groups"], ["Shift", "two-groups"],
    ["Ctrl", "two-groups-reverse"], ["Shift", "two-groups-reverse"],
    ["Ctrl", "group-then-leaf"], ["Shift", "group-then-leaf"],
    ["Ctrl", "leaf-then-group"], ["Shift", "leaf-then-group"]
  ] as const)("preserves subtrees and selects a new wrapper after %s %s selection, undo and redo", async (modifier, mode) => {
    const main = await mount(selectionScene()), before = await readScene();
    const additive = modifier === "Ctrl" ? { ctrlKey: true } : { shiftKey: true };
    if (mode === "two-groups-reverse") {
      fireEvent.click(row(main, { kind: "group", id: "B" }));
      fireEvent.click(row(main, { kind: "group", id: "A" }), additive);
    } else if (mode === "leaf-then-group") {
      fireEvent.click(row(main, { kind: "element", id: "loose" }));
      fireEvent.click(row(main, { kind: "group", id: "A" }), additive);
    } else {
      fireEvent.click(row(main, { kind: "group", id: "A" }));
      fireEvent.click(row(main, mode === "two-groups" ? { kind: "group", id: "B" } : { kind: "element", id: "loose" }), additive);
    }
    const bothGroups = mode === "two-groups" || mode === "two-groups-reverse";
    const groups = bothGroups ? ["A", "B"] : ["A"];
    const members = bothGroups ? ["a", "a-child", "b", "b-child"] : ["a", "a-child", "loose"];
    expect(selectedGroups(main)).toEqual(groups);
    expect(selectedElements(main)).toEqual(members.sort());
    toolbarGroup(main);
    await assertWrapper(main, before, groups, bothGroups ? [] : ["loose"]);
  });

  it("keeps the selected group subtree when grouping mixed selection from the leaf context menu", async () => {
    const main = await mount(selectionScene()), before = await readScene();
    fireEvent.click(row(main, { kind: "group", id: "A" }));
    fireEvent.click(row(main, { kind: "element", id: "loose" }), { ctrlKey: true });
    const menu = openMenu(main, { kind: "element", id: "loose" });
    expect(selectedGroups(main)).toEqual(["A"]);
    expect(selectedElements(main)).toEqual(["a", "a-child", "loose"]);
    fireEvent.click(within(menu).getByRole("button", { name: label("layer.group"), exact: true }));
    await assertWrapper(main, before, ["A"], ["loose"]);
  });

  it("does not drop a loose selected leaf when opening the group context menu before grouping", async () => {
    const main = await mount(selectionScene()), before = await readScene();
    fireEvent.click(row(main, { kind: "element", id: "loose" }));
    fireEvent.click(row(main, { kind: "group", id: "A" }), { ctrlKey: true });
    const menu = openMenu(main, { kind: "group", id: "A" });
    expect(selectedGroups(main)).toEqual(["A"]);
    expect(selectedElements(main)).toEqual(["a", "a-child", "loose"]);
    fireEvent.click(within(menu).getByRole("button", { name: label("layer.group"), exact: true }));
    await assertWrapper(main, before, ["A"], ["loose"]);
  });
});

describe("real App lock other layers", () => {
  it("keeps every selected leaf ancestor editable, locks the rest and supports one-step undo", async () => {
    const initial = scene([
      leaf("chosen", { groupId: "inner", zIndex: 0 }), leaf("sibling", { groupId: "sibling-group", zIndex: 1 }),
      leaf("outside", { zIndex: 2 })
    ], [group("outer"), group("middle", { parentId: "outer" }), group("inner", { parentId: "middle" }), group("sibling-group", { parentId: "outer" }), group("outside-group")]);
    const main = await mount(initial), before = await readScene();
    fireEvent.click(row(main, { kind: "element", id: "chosen" }));
    const menu = openMenu(main, { kind: "element", id: "chosen" });
    fireEvent.click(within(menu).getByRole("button", { name: label("layer.lockOthers"), exact: true }));
    const after = await readScene();
    for (const id of ["outer", "middle", "inner"]) expect(getGroup(after, id).locked).not.toBe(true);
    expect(getLeaf(after, "chosen").locked).not.toBe(true);
    expect(row(main, { kind: "element", id: "chosen" }).querySelector(".layer-lock")).toBeNull();
    for (const id of ["sibling-group", "outside-group"]) expect(getGroup(after, id).locked).toBe(true);
    for (const id of ["sibling", "outside"]) expect(getLeaf(after, id).locked).toBe(true);
    await assertUndoRedo(main, before, after);
  });

  it("keeps the selected group, all descendant groups and leaves unlocked while locking other branches", async () => {
    const initial = scene([
      leaf("chosen", { groupId: "chosen-group", zIndex: 0 }),
      leaf("descendant", { groupId: "deep-child", zIndex: 1 }),
      leaf("sibling", { groupId: "sibling-group", zIndex: 2 }), leaf("outside", { zIndex: 3 })
    ], [group("outer"), group("chosen-group", { parentId: "outer" }), group("child", { parentId: "chosen-group" }), group("deep-child", { parentId: "child" }), group("sibling-group", { parentId: "outer" }), group("outside-group")]);
    const main = await mount(initial), before = await readScene();
    fireEvent.click(row(main, { kind: "group", id: "chosen-group" }));
    const menu = openMenu(main, { kind: "group", id: "chosen-group" });
    fireEvent.click(within(menu).getByRole("button", { name: label("layer.lockOthers"), exact: true }));
    const after = await readScene();
    for (const id of ["outer", "chosen-group", "child", "deep-child"]) expect(getGroup(after, id).locked).not.toBe(true);
    for (const id of ["chosen", "descendant"]) {
      expect(getLeaf(after, id).locked).not.toBe(true);
      expect(row(main, { kind: "element", id }).querySelector(".layer-lock")).toBeNull();
    }
    for (const id of ["sibling-group", "outside-group"]) expect(getGroup(after, id).locked).toBe(true);
    for (const id of ["sibling", "outside"]) expect(getLeaf(after, id).locked).toBe(true);
    await assertUndoRedo(main, before, after);
  });
});

describe("real App pointer layer-tree drag and drop", () => {
  it("moves a complete sibling group subtree into another group at its center", async () => {
    const main = await mount(dragScene()), before = await readScene();
    const drag = beginDrag(main, { kind: "group", id: "parent" }, { kind: "group", id: "target" }, .5);
    assertHint(main, drag.targetRow, "into");
    drag.finish();
    const after = await readScene();
    expect(getGroup(after, "parent").parentId).toBe("target");
    expect(getGroup(after, "child").parentId).toBe("parent");
    expect(getGroup(after, "grandchild").parentId).toBe("child");
    for (const id of ["parent-leaf", "child-leaf", "grandchild-leaf"]) expect(getLeaf(after, id).groupId).toBe(getLeaf(before, id).groupId);
    assertContiguous(after, ["parent-leaf", "child-leaf", "grandchild-leaf"]);
    await assertUndoRedo(main, before, after);
  });

  it.each([["above", .1], ["below", .9]] as const)("pulls a child subtree out as its parent's sibling at the %s edge", async (position, ratio) => {
    const main = await mount(dragScene()), before = await readScene();
    const drag = beginDrag(main, { kind: "group", id: "child" }, { kind: "group", id: "parent" }, ratio);
    assertHint(main, drag.targetRow, position);
    drag.finish();
    const after = await readScene();
    expect(getGroup(after, "child").parentId ?? null).toBe(null);
    expect(getGroup(after, "grandchild").parentId).toBe("child");
    expect(getLeaf(after, "parent-leaf").groupId).toBe("parent");
    assertContiguous(after, ["child-leaf", "grandchild-leaf"]);
    const rows = [...main.querySelectorAll(".layer-row-item")];
    const childIndex = rows.indexOf(row(main, { kind: "group", id: "child" }));
    const parentIndex = rows.indexOf(row(main, { kind: "group", id: "parent" }));
    expect(position === "above" ? childIndex < parentIndex : childIndex > parentIndex).toBe(true);
    await assertUndoRedo(main, before, after);
  });

  it.each([["above", .25], ["below", .75]] as const)("moves a child subtree %s another group's leaf as that leaf's sibling", async (position, ratio) => {
    const main = await mount(dragScene()), before = await readScene();
    const drag = beginDrag(main, { kind: "group", id: "child" }, { kind: "element", id: "target-leaf" }, ratio);
    assertHint(main, drag.targetRow, position);
    drag.finish();
    const after = await readScene();
    expect(getGroup(after, "child").parentId).toBe("target");
    expect(getGroup(after, "grandchild").parentId).toBe("child");
    expect(getLeaf(after, "child-leaf").groupId).toBe("child");
    expect(getLeaf(after, "grandchild-leaf").groupId).toBe("grandchild");
    assertContiguous(after, ["child-leaf", "grandchild-leaf"]);
    const ids = orderedIds(after), targetIndex = ids.indexOf("target-leaf");
    expect(position === "above" ? ids.indexOf("child-leaf") : ids.indexOf("grandchild-leaf")).toBe(targetIndex + (position === "above" ? 1 : -1));
    await assertUndoRedo(main, before, after);
  });

  it.each([["above", .1], ["into", .5], ["below", .9]] as const)("uses the same %s group hit zone for a normal leaf and for its drop hint", async (position, ratio) => {
    const main = await mount(dragScene()), before = await readScene();
    const drag = beginDrag(main, { kind: "element", id: "child-leaf" }, { kind: "group", id: "target" }, ratio);
    assertHint(main, drag.targetRow, position);
    drag.finish();
    const after = await readScene();
    expect(getLeaf(after, "child-leaf").groupId ?? null).toBe(position === "into" ? "target" : null);
    expect(getGroup(after, "child").parentId).toBe("parent");
    expect(getGroup(after, "grandchild").parentId).toBe("child");
    if (position !== "into") {
      const ids = orderedIds(after), moved = ids.indexOf("child-leaf");
      const targetMembers = [ids.indexOf("target-leaf"), ids.indexOf("target-child-leaf")];
      expect(position === "above" ? moved > Math.max(...targetMembers) : moved < Math.min(...targetMembers)).toBe(true);
    }
    await assertUndoRedo(main, before, after);
  });

  it.each(["self", "descendant"] as const)("rejects a %s drop without an actionable hint or undo entry", async target => {
    const main = await mount(dragScene()), before = await readScene();
    const drag = beginDrag(main, { kind: "group", id: "parent" }, { kind: "group", id: target === "self" ? "parent" : "grandchild" }, .5);
    expect(main.querySelector(".is-drop-into, .is-drop-above, .is-drop-below")).toBeNull();
    drag.finish();
    expect(await readScene()).toEqual(before);
    expect(undo(main)).toBeDisabled();
  });
  it.each(["Escape", "pointercancel"] as const)("clears the drop hint and cancels movement on %s", async cancellation => {
    const main = await mount(dragScene()), before = await readScene();
    const drag = beginDrag(main, { kind: "group", id: "parent" }, { kind: "group", id: "target" }, .5);
    assertHint(main, drag.targetRow, "into");
    if (cancellation === "Escape") fireEvent.keyDown(window, { key: "Escape" });
    else fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(main.querySelector(".is-drop-into, .is-drop-above, .is-drop-below")).toBeNull();
    drag.finish();
    expect(await readScene()).toEqual(before);
    expect(undo(main)).toBeDisabled();
  });
});
