import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import App, { type SceneDocument, type SceneElement, type SceneGroup, type SceneLeaf } from '../src/App';
import { I18nProvider, translations } from '../src/i18n';

type RegisteredTool = Parameters<NonNullable<Document['modelContext']>['registerTool']>[0];
type Node = { kind: 'group' | 'element'; id: string };
const registeredTools = new Map<string, RegisteredTool>();
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
const label = (key: string) => {
  const value = translations.zh[key];
  if (typeof value !== 'string') throw new Error('Expected a static translated label: ' + key);
  return value;
};
const leaf = (id: string, patch: Partial<SceneLeaf> = {}): SceneLeaf => ({
  id, name: id, layerName: id, type: 'rectangle', x: 50, y: 40, width: 40, height: 30,
  rotation: 0, color: '#c2410c', opacity: 1, zIndex: 0, isBackground: false, visible: true, groupId: null, ...patch
});
const group = (id: string, patch: Partial<SceneGroup> = {}): SceneGroup => ({ id, name: id, parentId: null, visible: true, opacity: 1, collapsed: false, order: 0, ...patch });
const scene = (elements: SceneElement[], groups: SceneGroup[] = []): SceneDocument => ({
  schemaVersion: 2, canvas: { width: 300, height: 240, background: 'transparent' }, elements, groups,
  meta: { sourceType: 'editor', sourceName: 'group-order-safety-test', warnings: [] },
  library: { activeCategory: 'basic-shape', categories: [{ key: 'basic-shape', label: '基础形状', supported: true }], baseShapePresets: [], savedItems: [] }
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('miliastra-editor-lang', 'zh');
  localStorage.setItem('miliastra-editor-tour-seen', '1');
  registeredTools.clear();
  Object.defineProperty(document, 'modelContext', { configurable: true, value: {
    registerTool: async (tool: RegisteredTool) => { registeredTools.set(tool.name, tool); }
  } });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  if (!window.PointerEvent) vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('/api/library/catalog')) return new Response(JSON.stringify({ images: {}, categories: {}, names: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    throw new Error('Unexpected network request in group-order App test: ' + url);
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
  if (!result || typeof result !== 'object' || !('elements' in result)) throw new Error('Main scene is unavailable');
  return result as SceneDocument;
}

async function mount(initial: SceneDocument): Promise<HTMLElement> {
  localStorage.setItem('miliastra-last-canvas', JSON.stringify({ name: 'Group order regression', scene: initial, savedAt: 1 }));
  localStorage.setItem('miliastra-restore-on-load', '1');
  const view = render(<I18nProvider><App /></I18nProvider>);
  const main = view.container.querySelector<HTMLElement>('.app-shell')!;
  await waitFor(async () => expect((await readScene()).elements).toHaveLength(initial.elements.length));
  return main;
}

function row(main: HTMLElement, node: Node): HTMLElement {
  const attribute = node.kind === 'group' ? 'data-group-id' : 'data-element-id';
  const element = main.querySelector<HTMLElement>('.layer-row-item[' + attribute + '=' + JSON.stringify(node.id) + ']');
  if (!element) throw new Error('Missing ' + node.kind + ' row: ' + node.id);
  return element;
}
function menu(main: HTMLElement, node: Node): HTMLElement {
  fireEvent.contextMenu(row(main, node), { clientX: 100, clientY: 100 });
  const result = main.querySelector<HTMLElement>('.layer-context-menu');
  if (!result) throw new Error('Layer context menu did not open');
  return result;
}
const orderedIds = (value: SceneDocument) => [...value.elements].sort((a, b) => a.zIndex - b.zIndex).map(element => element.id);
const undo = (main: HTMLElement) => within(main).getByTitle(label('topbar.undoShort')) as HTMLButtonElement;
const redo = (main: HTMLElement) => within(main).getByTitle(label('topbar.redoShort')) as HTMLButtonElement;
const groupById = (value: SceneDocument, id: string) => value.groups?.find(item => item.id === id);
const elementById = (value: SceneDocument, id: string) => value.elements.find(item => item.id === id);
async function expectUndoRedo(main: HTMLElement, before: SceneDocument, after: SceneDocument) {
  expect(undo(main)).toBeEnabled();
  fireEvent.click(undo(main));
  expect(await readScene()).toEqual(before);
  expect(undo(main)).toBeDisabled();
  fireEvent.click(redo(main));
  expect(await readScene()).toEqual(after);
}

const mixedScene = () => scene([
  leaf('a', { zIndex: 0, groupId: 'group-a' }), leaf('a-inner', { zIndex: 1, groupId: 'inner-a' }),
  leaf('loose-selected', { zIndex: 2 }), leaf('b', { zIndex: 3, groupId: 'group-b' }), leaf('root', { zIndex: 4 })
], [group('group-a'), group('inner-a', { parentId: 'group-a' }), group('group-b'), group('empty-root')]);

describe('App group and leaf layer order safety', () => {
  it('moves a nested subgroup to the top of its parent siblings with one undo and redo', async () => {
    const initial = scene([
      leaf('p-low', { zIndex: 0, groupId: 'parent' }), leaf('a', { zIndex: 1, groupId: 'child-a' }),
      leaf('b', { zIndex: 2, groupId: 'child-b' }), leaf('p-high', { zIndex: 3, groupId: 'parent' }), leaf('root', { zIndex: 4 })
    ], [group('parent'), group('empty-child', { parentId: 'parent', order: -1 }), group('child-a', { parentId: 'parent' }), group('child-b', { parentId: 'parent' })]);
    const main = await mount(initial), before = await readScene();
    fireEvent.click(row(main, { kind: 'group', id: 'child-a' }));
    const context = menu(main, { kind: 'group', id: 'child-a' });
    fireEvent.click(within(context).getByRole('button', { name: label('props.layerTop'), exact: true }));
    const after = await readScene();
    expect(orderedIds(after)).toEqual(['p-low', 'b', 'p-high', 'a', 'root']);
    expect(groupById(after, 'child-a')?.parentId).toBe('parent');
    expect(groupById(after, 'child-b')?.parentId).toBe('parent');
    expect(groupById(after, 'empty-child')?.parentId).toBe('parent');
    await expectUndoRedo(main, before, after);
  });

  it('moves a mixed selected group and loose leaf together without splitting the subtree', async () => {
    const main = await mount(mixedScene()), before = await readScene();
    fireEvent.click(row(main, { kind: 'group', id: 'group-a' }));
    fireEvent.click(row(main, { kind: 'element', id: 'loose-selected' }), { ctrlKey: true });
    const context = menu(main, { kind: 'group', id: 'group-a' });
    fireEvent.click(within(context).getByRole('button', { name: label('props.layerTop'), exact: true }));
    const after = await readScene();
    expect(orderedIds(after)).toEqual(['b', 'root', 'a', 'a-inner', 'loose-selected']);
    expect(after.groups?.map(item => [item.id, item.parentId])).toEqual(before.groups?.map(item => [item.id, item.parentId]));
    expect(Object.fromEntries(after.elements.map(item => [item.id, item.groupId]))).toEqual(Object.fromEntries(before.elements.map(item => [item.id, item.groupId])));
    expect(after.elements.map(item => item.id)).toHaveLength(new Set(after.elements.map(item => item.id)).size);
    await expectUndoRedo(main, before, after);
  });

  it('moves a selected leaf only among siblings in its parent scope', async () => {
    const initial = scene([
      leaf('p-one', { zIndex: 0, groupId: 'parent' }), leaf('p-two', { zIndex: 1, groupId: 'parent' }),
      leaf('child-leaf', { zIndex: 2, groupId: 'child' }), leaf('outside', { zIndex: 3 })
    ], [group('parent'), group('child', { parentId: 'parent' })]);
    const main = await mount(initial), before = await readScene();
    const context = menu(main, { kind: 'element', id: 'p-one' });
    fireEvent.click(within(context).getByRole('button', { name: label('props.layerTop'), exact: true }));
    const after = await readScene();
    expect(orderedIds(after)).toEqual(['p-two', 'child-leaf', 'p-one', 'outside']);
    expect(elementById(after, 'p-one')?.groupId).toBe('parent');
    expect(elementById(after, 'child-leaf')?.groupId).toBe('child');
    await expectUndoRedo(main, before, after);
  });

  it('clamps a global numeric layer index to the selected leaf parent boundary', async () => {
    const initial = scene([
      leaf('root-low', { zIndex: 0 }), leaf('selected', { zIndex: 1, groupId: 'parent' }),
      leaf('sibling', { zIndex: 2, groupId: 'parent' }), leaf('child-leaf', { zIndex: 3, groupId: 'child' }), leaf('root-high', { zIndex: 4 })
    ], [group('parent'), group('child', { parentId: 'parent' })]);
    const main = await mount(initial), before = await readScene();
    fireEvent.click(row(main, { kind: 'element', id: 'selected' }));
    const input = main.querySelector<HTMLInputElement>('input[title=' + JSON.stringify(label('props.layerNumberTitle')) + ']');
    if (!input) throw new Error('Layer index input is missing');
    fireEvent.change(input, { target: { value: '5' } });
    const after = await readScene();
    expect(orderedIds(after)).toEqual(['root-low', 'sibling', 'child-leaf', 'selected', 'root-high']);
    expect(elementById(after, 'selected')?.groupId).toBe('parent');
    await expectUndoRedo(main, before, after);
  });

  it('does not detach a locked group member during a group-level reorder', async () => {
    const initial = scene([
      leaf('locked-member', { zIndex: 0, groupId: 'locked-group', locked: true }),
      leaf('other', { zIndex: 1, groupId: 'other-group' })
    ], [group('locked-group'), group('other-group')]);
    const main = await mount(initial), before = await readScene();
    fireEvent.click(row(main, { kind: 'group', id: 'locked-group' }));
    const context = menu(main, { kind: 'group', id: 'locked-group' });
    fireEvent.click(within(context).getByRole('button', { name: label('props.layerTop'), exact: true }));
    expect(await readScene()).toEqual(before);
    expect(undo(main)).toBeDisabled();
    expect(elementById(await readScene(), 'locked-member')?.locked).toBe(true);
  });

  it('does not create history when the selected sibling is already at the requested boundary', async () => {
    const initial = scene([
      leaf('other', { zIndex: 0, groupId: 'other-group' }), leaf('top', { zIndex: 1, groupId: 'top-group' })
    ], [group('other-group'), group('top-group')]);
    const main = await mount(initial), before = await readScene();
    fireEvent.click(row(main, { kind: 'group', id: 'top-group' }));
    const context = menu(main, { kind: 'group', id: 'top-group' });
    fireEvent.click(within(context).getByRole('button', { name: label('props.layerTop'), exact: true }));
    expect(await readScene()).toEqual(before);
    expect(undo(main)).toBeDisabled();
  });

  it('de-duplicates overlapping parent and child group selections when moving the parent', async () => {
    const initial = scene([
      leaf('outside', { zIndex: 0 }), leaf('parent-leaf', { zIndex: 1, groupId: 'parent' }),
      leaf('child-leaf', { zIndex: 2, groupId: 'child' }), leaf('other', { zIndex: 3, groupId: 'other' })
    ], [group('parent'), group('child', { parentId: 'parent' }), group('other')]);
    const main = await mount(initial), before = await readScene();
    fireEvent.click(row(main, { kind: 'group', id: 'parent' }));
    fireEvent.click(row(main, { kind: 'group', id: 'child' }), { ctrlKey: true });
    const context = menu(main, { kind: 'group', id: 'parent' });
    fireEvent.click(within(context).getByRole('button', { name: label('props.layerTop'), exact: true }));
    const after = await readScene();
    expect(orderedIds(after)).toEqual(['outside', 'other', 'parent-leaf', 'child-leaf']);
    expect(after.elements.map(item => item.id)).toHaveLength(new Set(after.elements.map(item => item.id)).size);
    expect(groupById(after, 'child')?.parentId).toBe('parent');
    await expectUndoRedo(main, before, after);
  });
});
