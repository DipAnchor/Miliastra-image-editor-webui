import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import App, { type SceneDocument, type SceneElement } from "../src/App";
import { I18nProvider, translations } from "../src/i18n";
import { DEFAULT_LUA_MASK } from "../src/luaMask";

type Tool = Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0];
const tools = new Map<string, Tool>();
const label = (key: string) => translations.zh[key] as string;
const leaf = (patch: Record<string, unknown> = {}): SceneElement => ({
  id: "masked", name: "Masked", layerName: "Masked", type: "rectangle",
  x: 100, y: 80, width: 80, height: 60, rotation: 0, color: "#c2410c",
  opacity: 1, zIndex: 0, visible: true, isBackground: false,
  luaMask: { ...DEFAULT_LUA_MASK, enabled: true, imageId: 100002 }, ...patch
});
const scene = (element: SceneElement): SceneDocument => ({
  canvas: { width: 300, height: 240, background: "transparent" }, elements: [element], groups: [],
  meta: { sourceType: "editor", sourceName: "mask-export", warnings: [] },
  library: { activeCategory: "basic-shape", categories: [{ key: "basic-shape", label: "基础形状", supported: true }], baseShapePresets: [], savedItems: [] }
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("miliastra-editor-lang", "zh");
  localStorage.setItem("miliastra-editor-tour-seen", "1");
  tools.clear();
  Object.defineProperty(document, "modelContext", { configurable: true, value: {
    registerTool: async (tool: Tool) => { tools.set(tool.name, tool); }
  } });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).startsWith("/api/export/")
    ? new Response(new Blob(["gia"]), { status: 200 })
    : new Response(JSON.stringify({ images: {}, prefabs: {}, categories: {}, names: {} }), { status: 200, headers: { "Content-Type": "application/json" } })));
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:mask-export");
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, "modelContext"); });

async function mount(initial: SceneDocument) {
  localStorage.setItem("miliastra-last-canvas", JSON.stringify({ name: "Mask export", scene: initial, savedAt: 1 }));
  localStorage.setItem("miliastra-restore-on-load", "1");
  const view = render(<I18nProvider><App /></I18nProvider>);
  await waitFor(() => expect(tools.has("get_scene")).toBe(true));
  await waitFor(async () => expect(await tools.get("get_scene")!.execute({}, {})).toMatchObject({ elements: [{ id: initial.elements[0].id }] }));
  fireEvent.click(within(view.container).getByRole("button", { name: label("topbar.export"), exact: true }));
  return within(view.container);
}
const exportRequest = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/export/container-node");

describe("masked container-node exports", () => {
  it.each([false, true])("downloads masked content, smart object = %s", async (smart) => {
    const element: SceneElement = smart ? {
      id: "object", name: "Object", layerName: "Object", type: "smart-object", x: 100, y: 80,
      rotation: 0, scale: 1, opacity: 1, zIndex: 0, visible: true,
      content: { frame: { width: 80, height: 60 }, groups: [], elements: [leaf() as Exclude<SceneElement, { type: "smart-object" }>] }
    } : leaf();
    const ui = await mount(scene(element));
    const container = ui.getByRole("button", { name: new RegExp(label("export.containerNode.label")) });
    expect(container).toBeEnabled();
    for (const format of ["GIA", "CSS", "SVG", "PNG"]) {
      expect(ui.getByText(format, { selector: "strong", exact: true }).closest("button")).toBeDisabled();
    }
    fireEvent.click(container);
    await waitFor(() => expect(exportRequest()).toHaveLength(1));
    const body = JSON.parse(String(exportRequest()[0][1]!.body));
    const exported = body.scene.elements[0];
    expect(smart ? exported.content.elements[0].luaMask : exported.luaMask).toMatchObject({ enabled: true, imageId: 100002 });
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
  });

  it("keeps prefab content blocked even when it has a mask", async () => {
    const ui = await mount(scene(leaf({ type: "prefab", prefabId: 20001003, prefabVariable: "prefab_20001003" })));
    const container = ui.getByRole("button", { name: new RegExp(label("export.containerNode.label")) });
    expect(container).toBeDisabled();
    expect(container).toHaveAttribute("title", label("prefab.luaOnly"));
    fireEvent.click(container);
    expect(exportRequest()).toHaveLength(0);
  });
});
