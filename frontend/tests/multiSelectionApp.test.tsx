import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import App, { type SceneDocument, type SceneElement, type SceneLeaf, type TextBoxSettings } from "../src/App";
import { I18nProvider, translations } from "../src/i18n";
import { rotationMatrix } from "../src/rotation";

type RegisteredTool = Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0];
const registeredTools = new Map<string, RegisteredTool>();

function label(key: string): string {
  const value = translations.zh[key];
  if (typeof value !== "string") throw new Error("Expected a static translated label: " + key);
  return value;
}

function selectionCount(count: number): string {
  const value = translations.zh["selection.count"];
  if (typeof value !== "function") throw new Error("Expected selection.count to be a translated formatter");
  return value(count);
}

function leaf(id: string, patch: Partial<SceneLeaf> = {}): SceneLeaf {
  return {
    id, name: id, layerName: id, type: "rectangle", x: 60, y: 50, width: 40, height: 30,
    rotation: 0, color: "#c2410c", opacity: 1, zIndex: 0, isBackground: false,
    visible: true, locked: false, groupId: null, ...patch
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

function makeScene(elements: SceneElement[] = [
  leaf("a"), leaf("gap", { x: 120, zIndex: 1 }),
  leaf("b", { x: 180, zIndex: 2 }), leaf("outside", { x: 240, zIndex: 3 })
]): SceneDocument {
  return {
    schemaVersion: 2, canvas: { width: 300, height: 240, background: "transparent" },
    elements, groups: [],
    meta: { sourceType: "editor", sourceName: "multi-selection-app-test", warnings: [] },
    library: {
      activeCategory: "basic-shape",
      categories: [{ key: "basic-shape", label: "基础形状", supported: true }],
      baseShapePresets: [], savedItems: []
    }
  };
}

function appearanceScene(): SceneDocument {
  const object: Extract<SceneElement, { type: "smart-object" }> = {
    id: "object", name: "Object", layerName: "Object", type: "smart-object",
    x: 210, y: 140, rotation: 0, scale: 1, opacity: 0.9, zIndex: 4,
    visible: true, locked: false, groupId: null,
    content: { frame: { width: 40, height: 30 }, elements: [leaf("inside", { x: 20, y: 15 })], groups: [] }
  };
  const initial = makeScene([
    leaf("a", { opacity: 0.7 }),
    leaf("text", { type: "textbox", x: 120, color: "#15803d", opacity: 0.8, textBox: textBox(), zIndex: 1 }),
    leaf("locked", { x: 180, color: "#1d4ed8", opacity: 0.6, locked: true, zIndex: 2 }),
    leaf("inherited", { x: 240, color: "#a21caf", opacity: 0.5, groupId: "locked-group", zIndex: 3 }),
    object,
    leaf("outside", { y: 190, color: "#ca8a04", opacity: 0.4, zIndex: 5 }),
    leaf("outside-locked", { x: 120, y: 190, color: "#0369a1", opacity: 0.3, locked: true, zIndex: 6 })
  ]);
  initial.groups = [{ id: "locked-group", name: "Locked group", parentId: null, visible: true, opacity: 1, collapsed: false, locked: true, order: 0 }];
  return initial;
}

beforeEach(() => {
  // This is the isolated jsdom store, never the running application page.
  localStorage.clear();
  localStorage.setItem("miliastra-editor-lang", "zh");
  localStorage.setItem("miliastra-editor-tour-seen", "1");
  registeredTools.clear();
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool: async (tool: RegisteredTool) => { registeredTools.set(tool.name, tool); } }
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ images: {}, categories: {}, names: {} }), {
    status: 200, headers: { "Content-Type": "application/json" }
  })));
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function readScene(): Promise<SceneDocument> {
  const tool = registeredTools.get("get_scene");
  if (!tool) throw new Error("App did not register get_scene");
  const result = await tool.execute({}, {});
  if (!result || typeof result !== "object" || !("elements" in result)) throw new Error("Main scene is unavailable");
  return result as SceneDocument;
}

async function mount(initial = makeScene()): Promise<HTMLElement> {
  localStorage.setItem("miliastra-last-canvas", JSON.stringify({ name: "Multi-selection regression", scene: initial, savedAt: 1 }));
  localStorage.setItem("miliastra-restore-on-load", "1");
  const view = render(<I18nProvider><App /></I18nProvider>);
  const main = view.container.querySelector<HTMLElement>(".app-shell")!;
  await waitFor(async () => {
    expect((await readScene()).elements).toHaveLength(initial.elements.length);
    expect(main.querySelectorAll(".canvas > .shape")).toHaveLength(initial.elements.length);
  });
  return main;
}

function row(main: HTMLElement, id: string): HTMLElement {
  const result = main.querySelector<HTMLElement>('.layer-row-item[data-element-id="' + id + '"]');
  if (!result) throw new Error("Missing layer row: " + id);
  return result;
}

function select(main: HTMLElement, ids: string[]) {
  ids.forEach((id, index) => fireEvent.click(row(main, id), { ctrlKey: index > 0 }));
}

function selectedIds(main: HTMLElement): string[] {
  return [...main.querySelectorAll<HTMLElement>(".layer-row-item.selected[data-element-id]")]
    .map(item => item.dataset.elementId!).sort();
}

function sidebar(main: HTMLElement): HTMLElement {
  const result = main.querySelector<HTMLElement>(".sidebar-right");
  if (!result) throw new Error("Missing right sidebar");
  return result;
}

function button(region: HTMLElement, key: string): HTMLElement {
  return within(region).getByRole("button", { name: label(key), exact: true });
}

function openMenu(main: HTMLElement, id: string): HTMLElement {
  const shape = main.querySelector<HTMLElement>('.canvas > .shape[data-element-id="' + id + '"]');
  if (!shape) throw new Error("Missing canvas shape: " + id);
  fireEvent.contextMenu(shape, { clientX: 110, clientY: 90 });
  const menu = main.querySelector<HTMLElement>(".quick-edit-menu");
  if (!menu) throw new Error("Canvas quick-edit menu did not open");
  return menu;
}

function element(scene: SceneDocument, id: string): SceneElement {
  const result = scene.elements.find(item => item.id === id);
  if (!result) throw new Error("Missing scene element: " + id);
  return result;
}

function order(scene: SceneDocument): string[] {
  return [...scene.elements].sort((a, b) => a.zIndex - b.zIndex).map(item => item.id);
}

function undo(main: HTMLElement): HTMLElement {
  return within(main).getByTitle(label("topbar.undoShort"));
}

async function expectSingleUndo(main: HTMLElement, initial: SceneDocument) {
  expect(undo(main)).toBeEnabled();
  fireEvent.click(undo(main));
  expect(await readScene()).toEqual(initial);
  expect(undo(main)).toBeDisabled();
}

describe("multi-selection right sidebar", () => {
  it("groups the selected layers from the right sidebar with one undo", async () => {
    const main = await mount(), initial = await readScene();
    select(main, ["a", "b"]);
    expect(within(sidebar(main)).getByText(selectionCount(2))).toBeInTheDocument();
    fireEvent.click(button(sidebar(main), "layer.group"));
    const grouped = await readScene();
    expect(grouped.groups).toHaveLength(1);
    const groupId = grouped.groups![0].id;
    expect(element(grouped, "a").groupId).toBe(groupId);
    expect(element(grouped, "b").groupId).toBe(groupId);
    // Grouping may compact interleaved z-indices without changing unrelated layer content.
    for (const id of ["gap", "outside"]) expect(element(grouped, id)).toEqual({ ...element(initial, id), zIndex: expect.any(Number) });
    await expectSingleUndo(main, initial);
  });

  it("brings the complete selection to the top in its original relative order with one undo", async () => {
    const main = await mount(), initial = await readScene();
    select(main, ["a", "b"]);
    fireEvent.click(button(sidebar(main), "props.layerTop"));
    expect(order(await readScene())).toEqual(["gap", "outside", "a", "b"]);
    expect(selectedIds(main)).toEqual(["a", "b"]);
    await expectSingleUndo(main, initial);
  });

  it("locks every selected layer from the right sidebar with one undo", async () => {
    const main = await mount(), initial = await readScene();
    select(main, ["a", "b"]);
    fireEvent.click(button(sidebar(main), "layer.lock"));
    const locked = await readScene();
    expect(element(locked, "a").locked).toBe(true);
    expect(element(locked, "b").locked).toBe(true);
    expect(element(locked, "gap")).toEqual(element(initial, "gap"));
    expect(element(locked, "outside")).toEqual(element(initial, "outside"));
    await expectSingleUndo(main, initial);
  });
});

describe("multi-selection canvas quick-edit menu", () => {
  it("keeps a selected right-click target in the multi-selection and omits individual geometry inputs", async () => {
    const main = await mount(), initial = await readScene();
    select(main, ["a", "b"]);
    const menu = openMenu(main, "a");
    expect(selectedIds(main)).toEqual(["a", "b"]);
    expect(menu).toHaveClass("multi-quick-edit-menu");
    expect(within(menu).getByText(selectionCount(2))).toBeInTheDocument();
    expect(within(menu).queryAllByRole("spinbutton")).toHaveLength(0);
    for (const key of ["props.widthW", "props.heightH"]) expect(within(menu).queryByText(label(key))).not.toBeInTheDocument();
    for (const axis of ["Z", "X", "Y"]) expect(within(menu).queryByText(label("props.rotation") + " " + axis)).not.toBeInTheDocument();
    expect(await readScene()).toEqual(initial);
    expect(undo(main)).toBeDisabled();
  });

  it("groups all selected layers from the canvas menu with one undo", async () => {
    const main = await mount(), initial = await readScene();
    select(main, ["a", "b"]);
    fireEvent.click(button(openMenu(main, "b"), "layer.group"));
    const grouped = await readScene();
    expect(grouped.groups).toHaveLength(1);
    expect(element(grouped, "a").groupId).toBe(grouped.groups![0].id);
    expect(element(grouped, "b").groupId).toBe(grouped.groups![0].id);
    for (const id of ["gap", "outside"]) expect(element(grouped, id)).toEqual({ ...element(initial, id), zIndex: expect.any(Number) });
    await expectSingleUndo(main, initial);
  });

  it("brings all selected layers to the top from the canvas menu with one undo", async () => {
    const main = await mount(), initial = await readScene();
    select(main, ["a", "b"]);
    fireEvent.click(button(openMenu(main, "a"), "selection.top"));
    expect(order(await readScene())).toEqual(["gap", "outside", "a", "b"]);
    await expectSingleUndo(main, initial);
  });

  it("changes only selected unlocked leaf colors and synchronizes textbox text color with one undo", async () => {
    const main = await mount(appearanceScene()), initial = await readScene();
    select(main, ["a", "text", "locked", "inherited", "object"]);
    expect(selectedIds(main)).toEqual(["a", "inherited", "locked", "object", "text"]);
    const input = openMenu(main, "a").querySelector<HTMLInputElement>('input[type="color"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: "#7c3aed" } });
    const changed = await readScene();
    expect(element(changed, "a")).toMatchObject({ color: "#7c3aed", opacity: element(initial, "a").opacity });
    expect(element(changed, "text")).toMatchObject({ color: "#7c3aed", textBox: { textColor: "#7c3aed" } });
    for (const id of ["locked", "inherited", "outside", "outside-locked", "object"]) expect(element(changed, id)).toEqual(element(initial, id));
    expect(element(changed, "object")).not.toHaveProperty("color");
    await expectSingleUndo(main, initial);
  });

  it("changes opacity on selected unlocked leaves and the smart-object shell with one undo", async () => {
    const main = await mount(appearanceScene()), initial = await readScene();
    select(main, ["a", "text", "locked", "inherited", "object"]);
    const menu = openMenu(main, "a");
    const input = within(menu).getByRole("slider", { name: label("props.opacity"), exact: true });
    fireEvent.change(input, { target: { value: "0.25" } });
    const changed = await readScene();
    for (const id of ["a", "text", "object"]) expect(element(changed, id).opacity).toBe(0.25);
    expect(element(changed, "text")).toMatchObject({ textBox: { textOpacity: 0.25 } });
    expect(element(changed, "object")).toEqual({ ...element(initial, "object"), opacity: 0.25 });
    for (const id of ["locked", "inherited", "outside", "outside-locked"]) expect(element(changed, id)).toEqual(element(initial, id));
    await expectSingleUndo(main, initial);
  });

  it("hides all selected layers without hiding other layers and undoes the batch in one step", async () => {
    const main = await mount(), initial = await readScene();
    select(main, ["a", "b"]);
    fireEvent.click(button(openMenu(main, "a"), "layer.hide"));
    const hidden = await readScene();
    expect(element(hidden, "a").visible).toBe(false);
    expect(element(hidden, "b").visible).toBe(false);
    for (const id of ["gap", "outside"]) expect(element(hidden, id)).toEqual(element(initial, id));
    await expectSingleUndo(main, initial);
  });

  it("locks all selected layers from the canvas menu with one undo", async () => {
    const main = await mount(), initial = await readScene();
    select(main, ["a", "b"]);
    fireEvent.click(button(openMenu(main, "a"), "layer.lock"));
    const locked = await readScene();
    for (const id of ["a", "b"]) expect(element(locked, id).locked).toBe(true);
    for (const id of ["gap", "outside"]) expect(element(locked, id)).toEqual(element(initial, id));
    await expectSingleUndo(main, initial);
  });

  it("locks only other layers, restores them, and gives each batch one undo step", async () => {
    const main = await mount(), initial = await readScene();
    select(main, ["a", "b"]);
    fireEvent.click(button(openMenu(main, "a"), "layer.lockOthers"));
    const lockedOthers = await readScene();
    for (const id of ["a", "b"]) expect(element(lockedOthers, id)).toEqual(element(initial, id));
    for (const id of ["gap", "outside"]) expect(element(lockedOthers, id).locked).toBe(true);
    fireEvent.click(button(openMenu(main, "a"), "layer.restore"));
    expect((await readScene()).elements.every(item => item.locked === false)).toBe(true);
    fireEvent.click(undo(main));
    expect(await readScene()).toEqual(lockedOthers);
    await expectSingleUndo(main, initial);
  });

  it("returns to the single-object menu when right-clicking an unselected shape", async () => {
    const main = await mount(), initial = await readScene();
    select(main, ["a", "b"]);
    openMenu(main, "a");
    const menu = openMenu(main, "outside");
    expect(selectedIds(main)).toEqual(["outside"]);
    expect(menu).not.toHaveClass("multi-quick-edit-menu");
    expect(within(menu).queryByText(selectionCount(2))).not.toBeInTheDocument();
    expect(within(menu).getByText(label("props.widthW"))).toBeInTheDocument();
    expect(within(menu).getByText(label("props.heightH"))).toBeInTheDocument();
    expect(within(menu).getAllByRole("spinbutton")).toHaveLength(5);
    expect(await readScene()).toEqual(initial);
    expect(undo(main)).toBeDisabled();
  });
});

describe("redundant grouping protection", () => {
  it("ignores repeated sidebar and canvas-menu grouping without adding undo entries", async () => {
    const main = await mount(), initial = await readScene();
    select(main, ["a", "b"]);
    fireEvent.click(button(sidebar(main), "layer.group"));
    const grouped = await readScene();
    expect(grouped.groups).toHaveLength(1);
    for (let repeat = 0; repeat < 3; repeat++) {
      fireEvent.click(button(sidebar(main), "layer.group"));
      expect(await readScene()).toEqual(grouped);
      fireEvent.click(button(openMenu(main, "a"), "layer.group"));
      expect(await readScene()).toEqual(grouped);
      expect(selectedIds(main).sort()).toEqual(["a", "b"]);
      expect(within(main).getByText(label("layer.alreadyGrouped"))).toBeInTheDocument();
    }
    await expectSingleUndo(main, initial);
  });

  it("recognizes an existing complete group selected through individual rows as a history-free noop", async () => {
    const fixture = makeScene([leaf("a", { groupId: "existing" }), leaf("b", { groupId: "existing", zIndex: 1 }), leaf("outside", { zIndex: 2 })]);
    fixture.groups = [{ id: "existing", name: "Existing", parentId: null, visible: true, opacity: 1, collapsed: false, order: 0 }];
    const main = await mount(fixture), initial = await readScene();
    select(main, ["a", "b"]);
    fireEvent.click(button(openMenu(main, "a"), "layer.group"));
    expect(await readScene()).toEqual(initial);
    expect(undo(main)).toBeDisabled();
    expect(within(main).getByText(label("layer.alreadyGrouped"))).toBeInTheDocument();
  });

  it("still groups a proper subset of an existing group and undoes it in one step", async () => {
    const fixture = makeScene([leaf("a", { groupId: "existing" }), leaf("b", { groupId: "existing", zIndex: 1 }), leaf("outside", { groupId: "existing", zIndex: 2 })]);
    fixture.groups = [{ id: "existing", name: "Existing", parentId: null, visible: true, opacity: 1, collapsed: false, order: 0 }];
    const main = await mount(fixture), initial = await readScene();
    select(main, ["a", "b"]);
    fireEvent.click(button(sidebar(main), "layer.group"));
    const grouped = await readScene();
    expect(grouped.groups).toHaveLength(2);
    const child = grouped.groups!.find(group => group.id !== "existing")!;
    expect(child.parentId).toBe("existing");
    expect(element(grouped, "a").groupId).toBe(child.id);
    expect(element(grouped, "b").groupId).toBe(child.id);
    expect(element(grouped, "outside").groupId).toBe("existing");
    await expectSingleUndo(main, initial);
  });
});

describe("multi-selection quick scale", () => {
  function twoShapes() {
    return [
      leaf("a", { x: 100, y: 100, width: 40, height: 20 }),
      leaf("b", { x: 200, y: 140, width: 20, height: 40, zIndex: 1 })
    ];
  }

  function expectBox(item: SceneElement, x: number, y: number, width: number, height: number) {
    if (item.type === "smart-object") throw new Error("Expected a leaf: " + item.id);
    expect(item.x).toBeCloseTo(x, 8);
    expect(item.y).toBeCloseTo(y, 8);
    expect(item.width).toBeCloseTo(width, 8);
    expect(item.height).toBeCloseTo(height, 8);
  }

  function projectedCorners(item: SceneElement) {
    if (item.type === "smart-object") throw new Error("Expected a leaf: " + item.id);
    const { a, b, c, d } = rotationMatrix(item);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([signX, signY]) => {
      const x = signX * item.width / 2;
      const y = signY * item.height / 2;
      return { x: item.x + a * x + c * y, y: item.y + b * x + d * y };
    });
  }

  it.each([
    { key: "quick.grow", a: [95.5, 97.5, 44, 22] as const, b: [205.5, 141.5, 22, 44] as const },
    { key: "quick.shrink", a: [104.5, 102.5, 36, 18] as const, b: [194.5, 138.5, 18, 36] as const }
  ])("applies $key around the shared bounds center (145, 125)", async ({ key, a, b }) => {
    const main = await mount(makeScene(twoShapes())), initial = await readScene();
    select(main, ["a", "b"]);
    const scale = button(openMenu(main, "b"), key);
    expect(scale).toBeEnabled();
    fireEvent.click(scale);

    const scaled = await readScene();
    expectBox(element(scaled, "a"), ...a);
    expectBox(element(scaled, "b"), ...b);
    expect(selectedIds(main)).toEqual(["a", "b"]);
    await expectSingleUndo(main, initial);
  });

  it("maps every tilted corner around the projected bounds center and keeps all angles", async () => {
    const main = await mount(makeScene([
      leaf("a", { x: 100, y: 96, width: 72, height: 34, rotation: 32, rotationX: 41, rotationY: -16 }),
      leaf("b", { x: 209, y: 151, width: 24, height: 62, rotation: -21, rotationX: -37, rotationY: 28, zIndex: 1 })
    ]));
    const initial = await readScene();
    const initialCorners = initial.elements.flatMap(projectedCorners);
    const xs = initialCorners.map(point => point.x);
    const ys = initialCorners.map(point => point.y);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;

    select(main, ["a", "b"]);
    fireEvent.click(button(openMenu(main, "a"), "quick.grow"));
    const scaled = await readScene();
    for (const before of initial.elements) {
      expect(element(scaled, before.id)).toMatchObject({
        rotation: before.rotation, rotationX: before.rotationX, rotationY: before.rotationY
      });
    }
    scaled.elements.flatMap(projectedCorners).forEach((point, index) => {
      expect(point.x).toBeCloseTo(centerX + 1.1 * (initialCorners[index].x - centerX), 8);
      expect(point.y).toBeCloseTo(centerY + 1.1 * (initialCorners[index].y - centerY), 8);
    });
  });

  it("includes a rotated smart-object shell in the bounds and scales only its position and scale", async () => {
    const object: Extract<SceneElement, { type: "smart-object" }> = {
      id: "object", type: "smart-object", name: "Object", layerName: "Object",
      x: 210, y: 140, rotation: 90, scale: 2, opacity: 0.9, zIndex: 1,
      visible: true, locked: false, groupId: null,
      content: {
        frame: { width: 40, height: 30 },
        elements: [leaf("inside", { x: 20, y: 15, width: 12, height: 16, rotation: 18, groupId: "inner" })],
        groups: [{ id: "inner", name: "Inner", parentId: null, visible: true, opacity: 0.8, collapsed: false, order: 0 }]
      }
    };
    const main = await mount(makeScene([twoShapes()[0], object])), initial = await readScene();
    select(main, ["a", "object"]);
    fireEvent.click(button(openMenu(main, "object"), "quick.grow"));

    const scaled = await readScene();
    // The rotated 60 × 80 shell and the leaf produce a shared center of (160, 135).
    expectBox(element(scaled, "a"), 94, 96.5, 44, 22);
    const shell = element(scaled, "object");
    if (shell.type !== "smart-object") throw new Error("Smart-object shell was replaced");
    expect(shell.x).toBeCloseTo(215, 8);
    expect(shell.y).toBeCloseTo(140.5, 8);
    expect(shell.scale).toBeCloseTo(2.2, 8);
    expect(shell).toEqual({ ...element(initial, "object"), x: shell.x, y: shell.y, scale: shell.scale });
    await expectSingleUndo(main, initial);
  });

  it("uses the hidden selected layer and excludes self-locked, ancestor-locked and unselected layers from the bounds", async () => {
    const fixture = makeScene([
      ...twoShapes(),
      leaf("locked", { x: 20, y: 40, locked: true, zIndex: 2 }),
      leaf("inherited", { x: 260, y: 200, groupId: "child", zIndex: 3 }),
      leaf("outside", { x: 54, y: 216, zIndex: 4 })
    ]);
    fixture.groups = [
      { id: "parent", name: "Parent", parentId: null, visible: true, opacity: 1, collapsed: false, locked: true, order: 0 },
      { id: "child", name: "Child", parentId: "parent", visible: true, opacity: 1, collapsed: false, order: 0 }
    ];
    const main = await mount(fixture);
    fireEvent.click(button(row(main, "b"), "layer.hide"));
    const initial = await readScene();
    expect(element(initial, "b").visible).toBe(false);
    select(main, ["a", "b", "locked", "inherited"]);
    const menu = openMenu(main, "a");
    expect(within(menu).getByText(selectionCount(4))).toBeInTheDocument();
    const grow = button(menu, "quick.grow");
    expect(grow).toBeEnabled();
    fireEvent.click(grow);

    const scaled = await readScene();
    expectBox(element(scaled, "a"), 95.5, 97.5, 44, 22);
    expectBox(element(scaled, "b"), 205.5, 141.5, 22, 44);
    expect(element(scaled, "b").visible).toBe(false);
    for (const id of ["locked", "inherited", "outside"]) {
      expect(element(scaled, id)).toEqual(element(initial, id));
    }
  });

  it("closes the quick menu after locking all targets and prevents further scale requests", async () => {
    const main = await mount(makeScene(twoShapes())), initial = await readScene();
    select(main, ["a", "b"]);
    const menu = openMenu(main, "a");
    fireEvent.click(button(menu, "layer.lock"));
    const locked = await readScene();
    expect(locked.elements.every(item => item.locked)).toBe(true);
    expect(menu).not.toBeInTheDocument();
    fireEvent.contextMenu(main.querySelector<HTMLElement>('.shape[data-element-id="a"]')!, { clientX: 110, clientY: 90 });
    expect(main.querySelector(".quick-edit-menu")).not.toBeInTheDocument();
    expect(await readScene()).toEqual(locked);
    await expectSingleUndo(main, initial);
  });

  it("keeps the menu open and records consecutive clicks as separate undo and redo steps without a preview", async () => {
    const main = await mount(makeScene(twoShapes())), initial = await readScene();
    select(main, ["a", "b"]);
    const menu = openMenu(main, "a");
    const redo = within(main).getByTitle(label("topbar.redoShort"));
    const expectDirectEdit = () => {
      expect(menu).toBeInTheDocument();
      expect(button(main, "transform.mode")).toHaveAttribute("aria-pressed", "false");
      expect(within(main).queryByRole("button", { name: label("transform.apply"), exact: true })).not.toBeInTheDocument();
    };
    fireEvent.click(button(menu, "quick.grow"));
    const grown = await readScene();
    expectBox(element(grown, "a"), 95.5, 97.5, 44, 22);
    expectDirectEdit();
    fireEvent.click(button(menu, "quick.shrink"));
    const scaled = await readScene();
    expectBox(element(scaled, "a"), 100.45, 100.25, 39.6, 19.8);
    expectBox(element(scaled, "b"), 199.45, 139.85, 19.8, 39.6);
    expectDirectEdit();

    fireEvent.click(undo(main));
    expect(await readScene()).toEqual(grown);
    await expectSingleUndo(main, initial);
    fireEvent.click(redo);
    expect(await readScene()).toEqual(grown);
    fireEvent.click(redo);
    expect(await readScene()).toEqual(scaled);
    expect(redo).toBeDisabled();
  });

  it("preserves the single-layer behavior when right-clicking an unselected layer", async () => {
    const main = await mount(), initial = await readScene();
    select(main, ["a", "b"]);
    const menu = openMenu(main, "outside");
    expect(menu).not.toHaveClass("multi-quick-edit-menu");
    fireEvent.click(button(menu, "quick.grow"));
    const scaled = await readScene();
    expectBox(element(scaled, "outside"), 240, 50, 44, 33);
    for (const id of ["a", "b", "gap"]) expect(element(scaled, id)).toEqual(element(initial, id));
    await expectSingleUndo(main, initial);
  });

  it("skips the entire shrink when a selected leaf is already at the 1px width floor", async () => {
    const fixture = makeScene([
      leaf("a", { x: 100, y: 100, width: 1, height: 20 }),
      twoShapes()[1]
    ]);
    const main = await mount(fixture), initial = await readScene();
    select(main, ["a", "b"]);
    const shrink = button(openMenu(main, "b"), "quick.shrink");
    expect(shrink).toBeEnabled();
    fireEvent.click(shrink);

    expect(await readScene()).toEqual(initial);
    expect(undo(main)).toBeDisabled();
  });
  it("uses one constrained factor when a leaf reaches the minimum before the requested shrink", async () => {
    const main = await mount(makeScene([
      leaf("a", { x: 100, y: 100, width: 1.05, height: 20 }), twoShapes()[1]
    ])), initial = await readScene();
    select(main, ["a", "b"]);
    fireEvent.click(button(openMenu(main, "b"), "quick.shrink"));
    const scaled = await readScene(), factor = 1 / 1.05;
    expectBox(element(scaled, "a"), 154.7375 + (100 - 154.7375) * factor, 125 - 25 * factor, 1, 20 * factor);
    expectBox(element(scaled, "b"), 154.7375 + (200 - 154.7375) * factor, 125 + 15 * factor, 20 * factor, 40 * factor);
    await expectSingleUndo(main, initial);
  });
});
