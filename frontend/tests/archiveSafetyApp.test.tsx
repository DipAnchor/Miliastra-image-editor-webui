import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import App, { type SceneDocument, type SceneElement, type SceneLeaf } from "../src/App";
import type { SceneArchive } from "../src/archives";
import { I18nProvider, translations } from "../src/i18n";

type RegisteredTool = Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0];
const registeredTools = new Map<string, RegisteredTool>();
const archiveKey = "miliastra-scene-archives";
const canvasIdKey = "miliastra-current-canvas-id";
const label = (key: string) => translations.zh[key] as string;

function rectangle(id: string, x = 100, y = 80): SceneLeaf {
  return {
    id, name: id, layerName: id, type: "rectangle", x, y, width: 80, height: 60,
    rotation: 0, color: "#c2410c", opacity: 1, zIndex: 0,
    visible: true, isBackground: false, groupId: null
  };
}

function makeScene(elements: SceneElement[]): SceneDocument {
  return {
    schemaVersion: 2, canvas: { width: 300, height: 240, background: "transparent" },
    elements, groups: [], meta: { sourceType: "editor", sourceName: "archive-safety", warnings: [] },
    library: { activeCategory: "basic-shape", categories: [{ key: "basic-shape", label: "基础形状", supported: true }], baseShapePresets: [], savedItems: [] }
  };
}

function archive(id: string, name: string, elements: SceneElement[]): SceneArchive {
  return { id: "archive-" + id, canvasId: id, name, savedAt: 1, scene: makeScene(elements) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

let importResponse: ReturnType<typeof deferred<Response>>;
const importRequest = vi.fn();

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("miliastra-editor-lang", "zh");
  localStorage.setItem("miliastra-editor-tour-seen", "1");
  registeredTools.clear();
  importRequest.mockClear();
  importResponse = deferred<Response>();
  Object.defineProperty(document, "modelContext", { configurable: true, value: {
    registerTool: async (tool: RegisteredTool) => { registeredTools.set(tool.name, tool); }
  } });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("/api/library/catalog")) return json({ images: {}, categories: {}, names: {} });
    if (url === "/api/import") {
      importRequest();
      return importResponse.promise;
    }
    throw new Error("Unexpected archive safety request: " + url);
  }));
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type SceneView = Pick<SceneDocument, "canvas" | "elements" | "groups" | "meta" | "library">;

async function readScene(): Promise<SceneView> {
  const result = await registeredTools.get("get_scene")?.execute({}, {});
  if (!result || typeof result !== "object" || !("elements" in result)) throw new Error("Main scene is unavailable");
  return result as SceneView;
}

const elementIds = (scene: Pick<SceneDocument, "elements">) => scene.elements.map(element => element.id);
const currentCanvasId = () => localStorage.getItem(canvasIdKey);
const storedArchives = (): SceneArchive[] => JSON.parse(localStorage.getItem(archiveKey) ?? "[]");
const byId = (id: string) => storedArchives().find(record => record.canvasId === id);
const byName = (name: string) => storedArchives().find(record => record.name === name);

async function mount(expectedIds: string[]) {
  registeredTools.clear();
  const view = render(<I18nProvider><App /></I18nProvider>);
  const root = view.container.querySelector<HTMLElement>(".app-shell")!;
  await waitFor(async () => expect(elementIds(await readScene())).toEqual(expectedIds));
  return { root, unmount: view.unmount };
}

async function mountCurrent(extraElements: SceneElement[] = []) {
  const a = archive("canvas-a", "作品 A", [rectangle("a"), ...extraElements]);
  const b = archive("canvas-b", "作品 B", [rectangle("b", 140)]);
  localStorage.setItem(archiveKey, JSON.stringify([a, b]));
  localStorage.setItem(canvasIdKey, a.canvasId);
  localStorage.setItem("miliastra-last-canvas", JSON.stringify({ canvasId: a.canvasId, name: a.name, savedAt: a.savedAt, scene: a.scene }));
  localStorage.setItem("miliastra-restore-on-load", "1");
  return { ...await mount(elementIds(a.scene)), a, b };
}

const title = (root: HTMLElement, key: string) => within(root).getByTitle(label(key));
const button = (root: HTMLElement, key: string) => within(root).getByRole("button", { name: label(key) });
const dialog = (root: HTMLElement) => within(root).getByRole("dialog");
const undo = (root: HTMLElement) => title(root, "topbar.undoShort");
const redo = (root: HTMLElement) => title(root, "topbar.redoShort");

function archiveMenu(root: HTMLElement) {
  fireEvent.click(title(root, "topbar.archives"));
  return within(root).getByRole("menu");
}

function archiveRow(menu: HTMLElement, name: string) {
  return within(menu).getByTitle(name).closest<HTMLElement>(".archive-row")!;
}

function openArchive(root: HTMLElement, name: string) {
  fireEvent.click(button(archiveRow(archiveMenu(root), name), "archive.open"));
  fireEvent.click(button(dialog(root), "archive.confirmContinue"));
}

function saveAs(root: HTMLElement, source: string, name: string) {
  fireEvent.click(button(archiveRow(archiveMenu(root), source), "archive.saveAs"));
  const prompt = dialog(root);
  fireEvent.change(within(prompt).getByRole("textbox"), { target: { value: name } });
  fireEvent.click(button(prompt, "archive.saveAsConfirm"));
}

function selectLayer(root: HTMLElement, id: string) {
  fireEvent.click(root.querySelector('.layer-row-item[data-element-id="' + id + '"]')!);
}

function nudgeLayer(root: HTMLElement, id: string) {
  selectLayer(root, id);
  fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true });
  fireEvent.keyUp(document.body, { key: "ArrowRight", shiftKey: true });
}

function shortcut(key: string) {
  fireEvent.keyDown(document.body, { key, ctrlKey: true });
}

function startManualReplace(root: HTMLElement) {
  fireEvent.click(title(root, "tab.import"));
  const prompt = dialog(root);
  fireEvent.change(within(prompt).getByLabelText(label("import.paste")), {
    target: { value: JSON.stringify(makeScene([rectangle("imported")])) }
  });
  fireEvent.click(button(prompt, "import.submit"));
  fireEvent.click(button(dialog(root), "import.modeReplace"));
}

function startWebMcpImport() {
  return registeredTools.get("import_source")!.execute({ sourceType: "json", content: "{}" }, {});
}

async function finishImport(pending?: ReturnType<typeof startWebMcpImport>) {
  let result: unknown;
  await act(async () => {
    importResponse.resolve(json({ scene: makeScene([rectangle("imported")]), warnings: [] }));
    if (pending) result = await pending;
  });
  return result;
}

const expectImportStarted = () => waitFor(() => expect(importRequest).toHaveBeenCalledTimes(1));

function visitObjectEditor(root: HTMLElement) {
  fireEvent.doubleClick(root.querySelector('.canvas > .shape[data-element-id="object"]')!);
  const editor = root.querySelector<HTMLElement>(".object-editor-overlay .app-shell")!;
  fireEvent.click(button(editor, "smartObject.discard"));
  expect(root.querySelector(".object-editor-overlay")).toBeNull();
}

function cancelTransformPreview(root: HTMLElement) {
  fireEvent.click(root.querySelector(".zoom-display")!);
  vi.spyOn(root.querySelector<HTMLElement>(".canvas")!, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 240, width: 300, height: 240, toJSON: () => ({})
  });
  selectLayer(root, "a");
  fireEvent.click(button(root, "transform.mode"));
  fireEvent.mouseDown(root.querySelector('[data-handle="se"]')!, { button: 0, clientX: 140, clientY: 110 });
  fireEvent.mouseMove(window, { buttons: 1, clientX: 180, clientY: 140 });
  fireEvent.mouseUp(window);
  expect(root).toHaveClass("transform-locked");
  fireEvent.click(button(root, "transform.cancel"));
  expect(root).not.toHaveClass("transform-locked");
}

function smartObject(): SceneElement {
  return {
    id: "object", name: "Object", layerName: "Object", type: "smart-object",
    x: 220, y: 160, rotation: 0, scale: 1, opacity: 1, zIndex: 1, visible: true,
    content: { frame: { width: 80, height: 60 }, elements: [rectangle("inside", 40, 30)], groups: [] }
  };
}

describe("archive identity in App", () => {
  it("starts independent undo and redo history when opening another archive", async () => {
    const { root, a, b } = await mountCurrent();
    nudgeLayer(root, "a");
    expect(undo(root)).toBeEnabled();
    fireEvent.click(undo(root));
    expect(redo(root)).toBeEnabled();

    openArchive(root, b.name);
    expect(currentCanvasId()).toBe(b.canvasId);
    const opened = await readScene();
    expect(elementIds(opened)).toEqual(["b"]);
    expect(undo(root)).toBeDisabled();
    expect(redo(root)).toBeDisabled();
    shortcut("z");
    shortcut("y");
    expect(await readScene()).toEqual(opened);

    nudgeLayer(root, "b");
    fireEvent.click(undo(root));
    expect(await readScene()).toEqual(opened);
    expect(undo(root)).toBeDisabled();
    fireEvent.click(redo(root));
    expect((await readScene()).elements[0]).toMatchObject({ id: "b", x: 150 });
    expect(currentCanvasId()).toBe(b.canvasId);
    expect(byId(a.canvasId)).toEqual(a);
    expect(byId(b.canvasId)).toEqual(b);
  });

  it("starts a new canvas after disabling startup restore and preserves the old archive on Ctrl+S", async () => {
    const { root, unmount, a, b } = await mountCurrent();
    fireEvent.click(button(archiveMenu(root), "archive.settings"));
    const settings = dialog(root);
    const restore = within(settings).getByRole("checkbox", { name: label("archive.autoRestore") });
    expect(restore).toBeChecked();
    fireEvent.click(restore);
    fireEvent.click(button(settings, "archive.save"));
    unmount();

    await mount([]);
    const blankId = currentCanvasId();
    shortcut("s");
    expect(byId(a.canvasId)).toEqual(a);
    expect(byId(b.canvasId)).toEqual(b);
    expect(blankId).toBeTruthy();
    expect(blankId).not.toBe(a.canvasId);
    expect(blankId).not.toBe(b.canvasId);
    expect(byId(blankId!)?.scene.elements).toEqual([]);
  });

  it("saves the live edited scene when saving the current archive as a new work", async () => {
    const { root, a } = await mountCurrent();
    nudgeLayer(root, "a");
    const live = await readScene();
    expect(live.elements[0].x).toBe(110);
    expect(byId(a.canvasId)).toEqual(a);

    saveAs(root, a.name, "A 当前副本");
    const copy = byName("A 当前副本");
    expect(copy?.scene).toMatchObject(live);
    expect(copy?.canvasId).not.toBe(a.canvasId);
    expect(currentCanvasId()).toBe(copy?.canvasId);
    expect(byId(a.canvasId)).toEqual(a);
  });

  it("copies an inactive archive's saved snapshot without switching the active canvas", async () => {
    const { root, a, b } = await mountCurrent();
    nudgeLayer(root, "a");
    const live = await readScene();
    expect(live.elements[0].x).toBe(110);

    saveAs(root, b.name, "B 存档副本");
    const copy = byName("B 存档副本");
    expect(copy?.scene).toEqual(b.scene);
    expect(copy?.canvasId).not.toBe(b.canvasId);
    expect(currentCanvasId()).toBe(a.canvasId);
    expect(await readScene()).toEqual(live);
    expect(byId(b.canvasId)).toEqual(b);
  });
  it.each(["open", "new", "save-as"] as const)("keeps content and identity paired when reloading before autosave after %s", async kind => {
    const { root, unmount, a, b } = await mountCurrent();
    vi.useFakeTimers();
    let reloaded: ReturnType<typeof render> | undefined;
    try {
      if (kind === "open") openArchive(root, b.name);
      else if (kind === "new") {
        fireEvent.click(title(root, "topbar.newCanvas"));
        fireEvent.click(button(dialog(root), "newCanvas.confirm"));
      } else {
        nudgeLayer(root, "a");
        saveAs(root, a.name, "刷新前实时副本");
      }
      const beforeReload = await readScene();
      const identity = currentCanvasId();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      unmount();
      registeredTools.clear();
      reloaded = render(<I18nProvider><App /></I18nProvider>);
      expect(await readScene()).toEqual(beforeReload);
      if (kind !== "new") expect(currentCanvasId()).toBe(identity);
      else expect([a.canvasId, b.canvasId]).not.toContain(currentCanvasId());
      shortcut("s");
      expect(byId(a.canvasId)).toEqual(a);
      if (kind === "open") expect(byId(b.canvasId)).toMatchObject({
        canvasId: b.canvasId, name: b.name,
        scene: { canvas: beforeReload.canvas, elements: beforeReload.elements, groups: beforeReload.groups, meta: beforeReload.meta },
      });
      else expect(byId(b.canvasId)).toEqual(b);
    } finally {
      reloaded?.unmount();
      vi.useRealTimers();
    }
  });

  it("restores a legacy snapshot under a fresh identity instead of borrowing an unrelated current ID", async () => {
    const { unmount, a, b } = await mountCurrent();
    unmount();
    localStorage.setItem("miliastra-last-canvas", JSON.stringify({ name: a.name, savedAt: 1, scene: a.scene }));
    localStorage.setItem(canvasIdKey, b.canvasId);
    await mount(["a"]);
    expect([a.canvasId, b.canvasId]).not.toContain(currentCanvasId());
    shortcut("s");
    expect(byId(a.canvasId)).toEqual(a);
    expect(byId(b.canvasId)).toEqual(b);
  });
});

describe("delayed imports in App", () => {
  it("does not overwrite a newly created canvas with a pending manual import", async () => {
    const { root, a } = await mountCurrent();
    startManualReplace(root);
    await expectImportStarted();
    fireEvent.click(title(root, "topbar.newCanvas"));
    fireEvent.click(button(dialog(root), "newCanvas.confirm"));
    const blank = await readScene();
    const blankId = currentCanvasId();
    expect(blank.elements).toEqual([]);
    expect(blankId).not.toBe(a.canvasId);

    await finishImport();
    expect(await readScene()).toEqual(blank);
    expect(currentCanvasId()).toBe(blankId);
    expect(undo(root)).toBeDisabled();
  });

  it("does not replace a manual edit made while the manual import is pending", async () => {
    const { root } = await mountCurrent();
    const before = await readScene();
    startManualReplace(root);
    await expectImportStarted();
    nudgeLayer(root, "a");
    const edited = await readScene();
    expect(edited.elements[0].x).toBe(110);

    await finishImport();
    expect(await readScene()).toEqual(edited);
    fireEvent.click(undo(root));
    expect(await readScene()).toEqual(before);
    expect(undo(root)).toBeDisabled();
  });

  it.each(["manual", "WebMCP"] as const)("rejects a %s import after an edit and Undo return to identical content", async channel => {
    const { root } = await mountCurrent();
    const before = await readScene();
    const pending = channel === "WebMCP" ? startWebMcpImport() : undefined;
    if (channel === "manual") startManualReplace(root);
    await expectImportStarted();
    nudgeLayer(root, "a");
    const edited = await readScene();
    expect(edited.elements[0].x).toBe(110);
    fireEvent.click(undo(root));
    expect(await readScene()).toEqual(before);
    expect(redo(root)).toBeEnabled();

    const result = await finishImport(pending);
    expect(await readScene()).toEqual(before);
    if (channel === "WebMCP") expect(result).toMatchObject({ ok: false });
    expect(undo(root)).toBeDisabled();
    fireEvent.click(redo(root));
    expect(await readScene()).toEqual(edited);
  });

  it.each([
    { context: "object editor", enterAndExit: visitObjectEditor, elements: [smartObject()] },
    { context: "transform preview", enterAndExit: cancelTransformPreview, elements: [] }
  ])("rejects a manual import after entering and leaving the $context", async ({ enterAndExit, elements }) => {
    const { root } = await mountCurrent(elements);
    const before = await readScene();
    startManualReplace(root);
    await expectImportStarted();
    enterAndExit(root);
    expect(await readScene()).toEqual(before);

    await finishImport();
    expect(await readScene()).toEqual(before);
    expect(undo(root)).toBeDisabled();
  });

  it("rejects a WebMCP import when another archive opens during the request", async () => {
    const { root, b } = await mountCurrent();
    const pending = startWebMcpImport();
    await expectImportStarted();
    openArchive(root, b.name);
    const opened = await readScene();
    expect(elementIds(opened)).toEqual(["b"]);

    const result = await finishImport(pending);
    expect(await readScene()).toEqual(opened);
    expect(result).toMatchObject({ ok: false });
    expect(currentCanvasId()).toBe(b.canvasId);
    expect(undo(root)).toBeDisabled();
  });

  it("commits a manual replacement as one undoable edit when the canvas has not changed", async () => {
    const { root, a } = await mountCurrent();
    const original = await readScene();
    startManualReplace(root);
    await expectImportStarted();
    await finishImport();
    const imported = await readScene();
    expect(elementIds(imported)).toEqual(["imported"]);
    expect(currentCanvasId()).toBe(a.canvasId);

    fireEvent.click(undo(root));
    expect(await readScene()).toEqual(original);
    expect(undo(root)).toBeDisabled();
    fireEvent.click(redo(root));
    expect(await readScene()).toEqual(imported);
  });
});
