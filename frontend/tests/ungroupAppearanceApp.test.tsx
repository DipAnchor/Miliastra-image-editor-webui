import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import App, { type SceneDocument, type SceneElement, type SceneGroup, type SceneLeaf, type TextBoxSettings } from '../src/App';
import { I18nProvider, translations } from '../src/i18n';

type RegisteredTool = Parameters<NonNullable<Document['modelContext']>['registerTool']>[0];
const registeredTools = new Map<string, RegisteredTool>();
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

function label(key: string): string {
  const value = translations.zh[key];
  if (typeof value !== 'string') throw new Error('Expected static translation: ' + key);
  return value;
}

function leaf(id: string, patch: Partial<SceneLeaf> = {}): SceneLeaf {
  return {
    id, name: id, layerName: id, type: 'rectangle', x: 50, y: 40, width: 40, height: 30,
    rotation: 0, color: '#c2410c', opacity: 1, zIndex: 0, isBackground: false,
    visible: true, groupId: null, ...patch
  };
}

function group(id: string, patch: Partial<SceneGroup> = {}): SceneGroup {
  return { id, name: id, parentId: null, visible: true, opacity: 1, collapsed: false, order: 0, ...patch };
}

function scene(elements: SceneElement[], groups: SceneGroup[] = []): SceneDocument {
  return {
    schemaVersion: 2,
    canvas: { width: 300, height: 240, background: 'transparent' },
    elements,
    groups,
    meta: { sourceType: 'editor', sourceName: 'ungroup-appearance-app-test', warnings: [] },
    library: { activeCategory: 'basic-shape', categories: [{ key: 'basic-shape', label: '基础形状', supported: true }], baseShapePresets: [], savedItems: [] }
  } as SceneDocument;
}

function textBox(patch: Partial<TextBoxSettings> = {}): TextBoxSettings {
  return {
    text: 'Alpha', fontSize: 20, autoSize: false, minFontSize: 12, textColor: '#ffffff', textOpacity: 0.8,
    bgColor: '#ff0000', bgOpacity: 0.6, outlineEnabled: true, outlineColor: '#000000', outlineOpacity: 0.4,
    alignH: 'center', alignV: 'middle', anchorType: 'center', visible: true, scaleX: 1, scaleY: 1,
    anchorMinX: 0.5, anchorMinY: 0.5, anchorMaxX: 0.5, anchorMaxY: 0.5, pivotX: 0.5, pivotY: 0.5, ...patch
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('miliastra-editor-lang', 'zh');
  localStorage.setItem('miliastra-editor-tour-seen', '1');
  registeredTools.clear();
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: { registerTool: async (tool: RegisteredTool) => { registeredTools.set(tool.name, tool); } }
  });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('/api/library/catalog')) return new Response(JSON.stringify({ images: {}, categories: {}, names: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    throw new Error('Unexpected network request in ungroup appearance App test: ' + url);
  }));
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'modelContext');
  if (originalElementFromPoint) Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint);
  else Reflect.deleteProperty(document, 'elementFromPoint');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function readScene(): Promise<SceneDocument> {
  const tool = registeredTools.get('get_scene');
  if (!tool) throw new Error('App did not register get_scene');
  const result = await tool.execute({}, {});
  if (!result || typeof result !== 'object' || !('elements' in result)) throw new Error('Scene unavailable');
  return result as SceneDocument;
}

async function mount(initial: SceneDocument): Promise<HTMLElement> {
  localStorage.setItem('miliastra-last-canvas', JSON.stringify({ name: 'Ungroup appearance regression', scene: initial, savedAt: 1 }));
  localStorage.setItem('miliastra-restore-on-load', '1');
  const view = render(<I18nProvider><App /></I18nProvider>);
  const main = view.container.querySelector<HTMLElement>('.app-shell');
  if (!main) throw new Error('Missing App shell');
  await waitFor(async () => expect((await readScene()).elements.map(item => item.id)).toEqual(initial.elements.map(item => item.id)));
  return main;
}

function row(main: HTMLElement, kind: 'group' | 'element', id: string): HTMLElement {
  const attr = kind === 'group' ? 'data-group-id' : 'data-element-id';
  const result = main.querySelector<HTMLElement>('.layer-row-item[' + attr + '="' + id + '"]');
  if (!result) throw new Error('Missing ' + kind + ' row: ' + id);
  return result;
}

function ungroupButton(main: HTMLElement): HTMLElement {
  return within(main).getByRole('button', { name: label('layers.ungroupAction'), exact: true });
}

function undo(main: HTMLElement): HTMLButtonElement {
  return within(main).getByTitle(label('topbar.undoShort')) as HTMLButtonElement;
}

function redo(main: HTMLElement): HTMLButtonElement {
  return within(main).getByTitle(label('topbar.redoShort')) as HTMLButtonElement;
}

function shapeContent(main: HTMLElement, id: string): HTMLElement {
  const node = main.querySelector<HTMLElement>('.shape[data-element-id="' + id + '"] .shape-content');
  if (!node) throw new Error('Missing shape content: ' + id);
  return node;
}

function textboxPreview(main: HTMLElement, id: string): HTMLElement {
  const node = main.querySelector<HTMLElement>('.shape[data-element-id="' + id + '"] .textbox-preview');
  if (!node) throw new Error('Missing textbox preview: ' + id);
  return node;
}

function alpha(value: string): number {
  const rgba = value.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/);
  if (rgba) return Number(rgba[1]);
  const hex = value.match(/#(?:[0-9a-f]{6})([0-9a-f]{2})/i);
  if (hex) return parseInt(hex[1], 16) / 255;
  throw new Error('Unsupported CSS color: ' + value);
}

function sceneMember(current: SceneDocument, id: string): SceneElement {
  const member = current.elements.find(item => item.id === id);
  if (!member) throw new Error('Missing scene element: ' + id);
  return member;
}

describe('App ungroup appearance', () => {
  it('ungroups one group from the real layer panel and keeps leaf effective alpha, with one undo/redo', async () => {
    const main = await mount(scene([leaf('member', { groupId: 'target', opacity: 0.8 }), leaf('outside', { zIndex: 1 })], [group('target', { opacity: 0.5 })]));
    const before = await readScene();
    fireEvent.click(row(main, 'group', 'target'));
    fireEvent.click(ungroupButton(main));
    const after = await readScene();

    expect(after.groups).toEqual([]);
    expect(sceneMember(after, 'member')).toMatchObject({ groupId: null, opacity: 0.4 });
    expect(shapeContent(main, 'member').style.opacity).toBe('0.4');
    expect(undo(main)).toBeEnabled();
    fireEvent.click(undo(main));
    expect(await readScene()).toEqual(before);
    fireEvent.click(redo(main));
    expect(await readScene()).toEqual(after);
  });

  it('bakes hidden and zero-opacity target state into a direct leaf through the panel', async () => {
    const main = await mount(scene([leaf('member', { groupId: 'target', opacity: 0.8 })], [group('target', { visible: false, opacity: 0 })]));
    fireEvent.click(row(main, 'group', 'target'));
    fireEvent.click(ungroupButton(main));
    const after = await readScene();
    expect(sceneMember(after, 'member')).toMatchObject({ groupId: null, visible: false, opacity: 0 });
  });

  it('keeps textbox DOM/CSS effective alpha when the shell starts at opacity zero', async () => {
    const main = await mount(scene([leaf('text', { type: 'textbox', groupId: 'target', opacity: 0, textBox: textBox() })], [group('target', { opacity: 0.5 })]));
    expect(shapeContent(main, 'text').style.opacity).toBe('0.5');
    const beforePreview = textboxPreview(main, 'text');
    expect(alpha(beforePreview.style.color)).toBeCloseTo(0.8, 2);
    expect(alpha(beforePreview.style.background)).toBeCloseTo(0.6, 2);

    fireEvent.click(row(main, 'group', 'target'));
    fireEvent.click(ungroupButton(main));
    const after = await readScene();
    const member = sceneMember(after, 'text') as SceneLeaf;
    expect(member).toMatchObject({ groupId: null, opacity: 0.4 });
    expect(member.textBox?.textOpacity).toBeCloseTo(0.4, 6);
    expect(member.textBox?.bgOpacity).toBeCloseTo(0.3, 6);
    expect(member.textBox?.outlineOpacity).toBeCloseTo(0.2, 6);
    expect(shapeContent(main, 'text').style.opacity).toBe('1');
    const afterPreview = textboxPreview(main, 'text');
    expect(alpha(afterPreview.style.color)).toBeCloseTo(0.4, 2);
    expect(alpha(afterPreview.style.background)).toBeCloseTo(0.3, 2);
    expect(alpha(afterPreview.style.getPropertyValue('-webkit-text-stroke'))).toBeCloseTo(0.2, 2);
  });

  it('ungroups overlapping parent and child selections as one undoable action', async () => {
    const main = await mount(scene([leaf('member', { groupId: 'child', opacity: 0.8 })], [group('parent', { opacity: 0.5 }), group('child', { parentId: 'parent', opacity: 0.5 })]));
    const before = await readScene();
    fireEvent.click(row(main, 'group', 'parent'));
    fireEvent.click(row(main, 'group', 'child'), { ctrlKey: true });
    fireEvent.click(ungroupButton(main));
    const after = await readScene();
    expect(after.groups).toEqual([]);
    expect(sceneMember(after, 'member')).toMatchObject({ groupId: null, opacity: 0.2 });
    expect(undo(main)).toBeEnabled();
    fireEvent.click(undo(main));
    expect(await readScene()).toEqual(before);
    fireEvent.click(redo(main));
    expect(await readScene()).toEqual(after);
  });

  it('rejects manual ungroup of a locked group with a protected member', async () => {
    const initial = scene([leaf('protected', { groupId: 'target', locked: true })], [group('target')]);
    const main = await mount(initial);
    const before = await readScene();
    fireEvent.click(row(main, 'group', 'target'));
    fireEvent.click(ungroupButton(main));
    expect(await readScene()).toEqual(before);
    expect(undo(main)).toBeDisabled();
  });

  it('rejects manual ungroup of an explicitly locked group', async () => {
    const initial = scene([leaf('member', { groupId: 'target' })], [group('target', { locked: true })]);
    const main = await mount(initial);
    const before = await readScene();
    fireEvent.click(row(main, 'group', 'target'));
    fireEvent.click(ungroupButton(main));
    expect(await readScene()).toEqual(before);
    expect(undo(main)).toBeDisabled();
  });
  it('preserves a visible textbox background and outline when text alpha is zero', async () => {
    const main = await mount(scene([leaf('text', { type: 'textbox', groupId: 'target', opacity: 0, textBox: textBox({ textOpacity: 0 }) })], [group('target', { opacity: 0.5 })]));
    const beforePreview = textboxPreview(main, 'text');
    const beforeBackground = Number(shapeContent(main, 'text').style.opacity) * alpha(beforePreview.style.background);
    expect(alpha(beforePreview.style.color)).toBe(0);
    expect(beforeBackground).toBeCloseTo(0.3, 2);
    fireEvent.click(row(main, 'group', 'target'));
    fireEvent.click(ungroupButton(main));
    const member = sceneMember(await readScene(), 'text') as SceneLeaf;
    expect(member.opacity).toBe(0);
    expect(member.textBox?.textOpacity).toBe(0);
    expect(member.textBox?.bgOpacity).toBeCloseTo(0.3, 6);
    expect(member.textBox?.outlineOpacity).toBeCloseTo(0.2, 6);
    const afterPreview = textboxPreview(main, 'text');
    expect(shapeContent(main, 'text').style.opacity).toBe('1');
    expect(alpha(afterPreview.style.color)).toBe(0);
    expect(alpha(afterPreview.style.background)).toBeCloseTo(beforeBackground, 2);
  });

  it('rejects manual ungroup inside a locked ancestor without adding history', async () => {
    const initial = scene([leaf('member', { groupId: 'target' })], [group('ancestor', { locked: true }), group('target', { parentId: 'ancestor' })]);
    const main = await mount(initial);
    const before = await readScene();
    fireEvent.click(row(main, 'group', 'target'));
    fireEvent.click(ungroupButton(main));
    expect(await readScene()).toEqual(before);
    expect(undo(main)).toBeDisabled();
  });
});
