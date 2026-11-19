import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import App, { type SceneDocument } from "../src/App";
import { I18nProvider, translations } from "../src/i18n";

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

async function mount(initial: SceneDocument) {
  localStorage.setItem("miliastra-last-canvas", JSON.stringify({ name: "Existing canvas", scene: initial, savedAt: 1 }));
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
