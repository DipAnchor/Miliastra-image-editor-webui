import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import App, { type SceneDocument } from "../src/App";
import { I18nProvider, translations } from "../src/i18n";

type RegisteredTool = Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0];
const tools = new Map<string, RegisteredTool>();
const ring = "Ring elements are omitted from SVG export.";
const tint = "Image tint cannot be represented exactly in SVG.";
const svg = (warnings: string[]) => '<svg xmlns="http://www.w3.org/2000/svg">' + warnings.map(text => '<!-- Miliastra-Warning: ' + text + ' -->').join("") + '</svg>';
let warnings: string[] = [];
let subsetWarnings: string[] | null = null;
const createUrl = vi.fn(() => "blob:editor-flow-test");
const revokeUrl = vi.fn();
const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

function label(key: string): string {
  const value = translations.zh[key];
  if (typeof value !== "string") throw new Error("Expected static label: " + key);
  return value;
}
function fixture(): SceneDocument {
  return {
    schemaVersion: 2, canvas: { width: 320, height: 240, background: "transparent" }, groups: [],
    meta: { sourceType: "editor", sourceName: "editor-flow-test", warnings: [] },
    elements: ["a", "b"].map((id, index) => ({
      id, name: id, layerName: id, type: "rectangle", x: 80 + index * 120, y: 100,
      width: 50, height: 40, rotation: 0, color: "#c2410c", opacity: 1,
      zIndex: index, isBackground: false, visible: true, groupId: null
    })),
    library: { activeCategory: "basic-shape", categories: [{ key: "basic-shape", label: "Basic", supported: true }], baseShapePresets: [], savedItems: [] }
  };
}
async function mount(showWelcome = false): Promise<HTMLElement> {
  localStorage.setItem("miliastra-last-canvas", JSON.stringify({ name: "Flow test", scene: fixture(), savedAt: 1 }));
  localStorage.setItem("miliastra-restore-on-load", "1");
  if (showWelcome) localStorage.removeItem("miliastra-editor-tour-seen");
  const view = render(<I18nProvider><App /></I18nProvider>);
  await waitFor(() => expect(tools.has("get_scene")).toBe(true));
  return view.container.querySelector(".app-shell")!;
}
async function readScene() {
  return structuredClone(await tools.get("get_scene")!.execute({}, {}));
}
async function openSvg(root: HTMLElement) {
  fireEvent.click(within(root).getByRole("button", { name: label("tab.code"), exact: true }));
  fireEvent.click(within(root.querySelector(".code-panel") as HTMLElement).getByRole("button", { name: "SVG", exact: true }));
  await waitFor(() => expect(root.querySelector<HTMLTextAreaElement>(".code-panel textarea")?.value).toContain("<svg"));
}
function exportSvg(root: HTMLElement) {
  fireEvent.click(within(root).getByRole("button", { name: label("topbar.export"), exact: true }));
  const menu = root.querySelector(".topbar .menu")!;
  fireEvent.click(within(menu as HTMLElement).getByRole("button", { name: /^SVG/ }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("miliastra-editor-lang", "zh");
  // Node Response.blob() uses the global Blob, but jsdom 25 omits Blob.text().
  vi.stubGlobal("Blob", NodeBlob);
  localStorage.setItem("miliastra-editor-tour-seen", "1");
  tools.clear(); warnings = []; subsetWarnings = null;
  createUrl.mockClear(); revokeUrl.mockClear();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeUrl });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/api/export/svg")) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const selected = subsetWarnings && (body?.scene ?? body)?.elements?.length === 1 ? subsetWarnings : warnings;
      return new Response(svg(selected), { status: 200, headers: { "Content-Type": "image/svg+xml" } });
    }
    return new Response(JSON.stringify({ version: 1, width: 96, height: 96, categories: {}, images: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  Object.defineProperty(document, "modelContext", { configurable: true, value: {
    registerTool: vi.fn(async (tool: RegisteredTool) => { tools.set(tool.name, tool); }),
    unregisterTool: vi.fn(async (name: string) => { tools.delete(name); })
  } });
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "modelContext");
  if (originalCreate) Object.defineProperty(URL, "createObjectURL", originalCreate);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("onboarding import entry", () => {
  it("opens the real import dialog, preserves the library and cancels without a scene/history edit", async () => {
    const root = await mount(true);
    const initial = await readScene();
    fireEvent.click(within(root.querySelector(".welcome-dialog") as HTMLElement).getByRole("button", { name: label("welcome.import"), exact: true }));
    expect(root.querySelector(".welcome-dialog")).toBeNull();
    const dialog = root.querySelector<HTMLElement>("dialog.import-dialog")!;
    expect(dialog).not.toBeNull();
    expect(root.querySelector(".sidebar-left select")).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: label("archive.cancel"), exact: true }));
    expect(root.querySelector("dialog.import-dialog")).toBeNull();
    expect(await readScene()).toEqual(initial);
    expect(within(root).getByTitle(label("topbar.undoShort"))).toBeDisabled();
    fireEvent.click(within(root).getByRole("button", { name: label("tab.import"), exact: true }));
    expect(root.querySelector("dialog.import-dialog")).not.toBeNull();
  });
  it("keeps the start-with-library entry working", async () => {
    const root = await mount(true);
    fireEvent.click(within(root.querySelector(".welcome-dialog") as HTMLElement).getByRole("button", { name: label("welcome.start"), exact: true }));
    expect(root.querySelector(".welcome-dialog")).toBeNull();
    expect(root.querySelector("dialog.import-dialog")).toBeNull();
    expect(root.querySelector(".sidebar-left select")).not.toBeNull();
  });
});

describe("SVG warnings", () => {
  it("renders every distinct warning from the full preview", async () => {
    warnings = [ring, tint, ring];
    const root = await mount();
    await openSvg(root);
    const messages = [...root.querySelectorAll("[data-tour=svg-ring-warning] p")].map(node => node.textContent);
    expect(messages).toEqual([ring, tint]);
  });
  it.each([["none", []], ["ring", [ring]], ["tint", [tint]], ["mixed", [ring, tint]]] as const)("downloads %s using exactly the response warnings", async (_name, values) => {
    warnings = [...values];
    const root = await mount();
    const initial = await readScene();
    exportSvg(root);
    await waitFor(() => expect(HTMLAnchorElement.prototype.click, root.querySelector(".statusbar")?.textContent).toHaveBeenCalledTimes(1));
    if (values.length) {
      expect(window.alert).toHaveBeenCalledTimes(1);
      expect(window.alert).toHaveBeenCalledWith(values.join("\n\n"));
      expect(root.textContent).toContain("请注意导出提示");
    } else {
      expect(window.alert).not.toHaveBeenCalled();
      expect(root.textContent).toContain("已下载");
    }
    expect(await readScene()).toEqual(initial);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith("blob:editor-flow-test");
  });
  it("does not let a layer download overwrite full-scene preview warnings", async () => {
    warnings = [ring, tint]; subsetWarnings = [tint];
    const root = await mount();
    const initial = await readScene();
    // Select first: selecting a different layer intentionally opens its properties panel.
    fireEvent.click(root.querySelector('.layer-row-item[data-element-id="a"]')!);
    await openSvg(root);
    const fullPreview = root.querySelector<HTMLTextAreaElement>(".code-panel textarea")!.value;
    expect(fullPreview).toBe(svg(warnings));
    fireEvent.contextMenu(root.querySelector('.layer-row-item[data-element-id="a"]')!, { clientX: 200, clientY: 200 });
    const menu = root.querySelector<HTMLElement>(".layer-context-menu")!;
    fireEvent.click(within(menu).getByRole("button", { name: "SVG", exact: true }));
    await waitFor(() => expect(HTMLAnchorElement.prototype.click, root.querySelector(".statusbar")?.textContent).toHaveBeenCalledTimes(1));
    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(window.alert).toHaveBeenCalledWith(tint);
    expect([...root.querySelectorAll("[data-tour=svg-ring-warning] p")].map(node => node.textContent)).toEqual([ring, tint]);
    expect(root.querySelector<HTMLTextAreaElement>(".code-panel textarea")!.value).toBe(fullPreview);
    expect(await readScene()).toEqual(initial);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(await (createUrl.mock.calls[0][0] as Blob).text()).toBe(svg([tint]));
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith("blob:editor-flow-test");
  });
});
