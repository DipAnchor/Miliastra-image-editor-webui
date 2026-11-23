import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const { visibleForExport, exportSubset, sceneForLayerExport, soloVisibility, restoreVisibility, groupDescendantIds, groupTreeRows, insertLayerAbove } =
  await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));

const el = (id, zIndex, extra = {}) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId: null, ...extra });
const grp = (id, extra = {}) => ({ id, name: id, parentId: null, visible: true, opacity: 1, collapsed: false, order: 0, ...extra });
const ids = list => list.map(e => e.id);

test('insertLayerAbove preserves the stack and empty group positions without compacting ancestors', () => {
  const elements = [el('top', 8, { groupId: 'child' }), el('target', 1, { groupId: 'child' }), el('outside', 6)];
  const groups = [grp('parent'), grp('child', { parentId: 'parent' }), grp('empty', { parentId: 'child', order: 4 })];
  const rows = (els, gs) => groupTreeRows(els, gs).map(row => row.kind === 'group' ? row.group.id : row.element.id);
  const before = rows(elements, groups);
  const next = insertLayerAbove(elements, groups, el('new', 0), 'target');
  assert.deepEqual(ids(next.elements), ['target', 'new', 'outside', 'top']);
  assert.deepEqual(next.elements.map(e => e.zIndex), [0, 1, 2, 3]);
  assert.equal(next.elements[1].groupId, 'child');
  const expectedRows = [...before];
  expectedRows.splice(before.indexOf('target'), 0, 'new');
  assert.deepEqual(rows(next.elements, next.groups), expectedRows);
});

test('insertLayerAbove places a root sibling above a locked reference without copying lock or group', () => {
  const elements = [el('reference', 0, { locked: true }), el('top', 1)];
  const newLayer = el('new', 0);
  const next = insertLayerAbove(elements, [], newLayer, 'reference');
  assert.deepEqual(ids(next.elements), ['reference', 'new', 'top']);
  assert.equal(next.elements[0], elements[0]);
  assert.deepEqual(next.elements[1], { ...newLayer, zIndex: 1 });
});

test('visibleForExport drops hidden elements and hidden-group members, reindexes zIndex', () => {
  const elements = [el('a', 0), el('b', 1, { visible: false }), el('c', 2, { groupId: 'g1' }), el('d', 3)];
  const groups = [grp('g1', { visible: false })];
  const out = visibleForExport(elements, groups);
  assert.deepEqual(ids(out), ['a', 'd']);
  assert.deepEqual(out.map(e => e.zIndex), [0, 1]);
});

test('exportSubset of one element keeps only it and reindexes; hidden excluded', () => {
  const elements = [el('a', 0), el('b', 1), el('c', 2, { groupId: 'g1' })];
  const groups = [grp('g1', { visible: false })];
  assert.deepEqual(ids(exportSubset(elements, groups, { elementId: 'b' })), ['b']);
  assert.deepEqual(exportSubset(elements, groups, { elementId: 'b' }).map(e => e.zIndex), [0]);
  assert.deepEqual(ids(exportSubset(elements, groups, { elementId: 'c' })), []); // hidden group
});

test('exportSubset of a group includes nested descendants, visible only', () => {
  const elements = [
    el('out0', 0),
    el('g1a', 1, { groupId: 'g1' }),
    el('g2a', 2, { groupId: 'g2' }),
    el('g2b', 3, { groupId: 'g2', visible: false }),
    el('g1c', 4, { groupId: 'g1' }),
  ];
  const groups = [grp('g1'), grp('g2', { parentId: 'g1' })];
  const out = exportSubset(elements, groups, { groupId: 'g1' });
  assert.deepEqual(ids(out), ['g1a', 'g2a', 'g1c']);
  assert.deepEqual(out.map(e => e.zIndex), [0, 1, 2]);
  assert.deepEqual(groupDescendantIds(groups, 'g1').sort(), ['g1', 'g2']);
});

test('single layer export omits unrelated groups and keeps ordered ancestors with their properties', () => {
  const groups = [grp('other'), grp('child', { parentId: 'parent', opacity: 0.5 }), grp('parent', { locked: true }), grp('sibling', { parentId: 'parent' })];
  const scene = { elements: [el('top', 0), el('selected', 1, { groupId: 'child' }), el('outside', 2, { groupId: 'other' })], groups };
  const subset = exportSubset(scene.elements, groups, { elementId: 'selected' });
  assert.deepEqual(sceneForLayerExport(scene, subset), { ...scene, elements: subset, groups: [groups[1], groups[2]] });
  const top = exportSubset(scene.elements, groups, { elementId: 'top' });
  assert.deepEqual(sceneForLayerExport(scene, top).groups, []);
  assert.equal(scene.groups.length, 4);
});

test('group export keeps visible nested members and smart object content without unrelated outer branches', () => {
  const groups = [grp('outer'), grp('target', { parentId: 'outer' }), grp('nested', { parentId: 'target' }), grp('hidden', { parentId: 'target', visible: false }), grp('empty', { parentId: 'target' }), grp('unrelated')];
  const content = { elements: [el('inner', 0, { groupId: 'local' })], groups: [grp('local'), grp('local-empty')] };
  const object = el('object', 3, { type: 'smart-object', groupId: 'nested', content });
  const scene = { groups, elements: [el('outside', 0, { groupId: 'unrelated' }), el('visible', 1, { groupId: 'target' }), el('invisible', 2, { groupId: 'hidden' }), object] };
  const subset = exportSubset(scene.elements, groups, { groupId: 'target' });
  const out = sceneForLayerExport(scene, subset);
  assert.deepEqual(ids(out.elements), ['visible', 'object']);
  assert.deepEqual(out.groups, groups.slice(0, 3));
  assert.strictEqual(out.elements[1].content, content);
  const single = sceneForLayerExport(scene, exportSubset(scene.elements, groups, { elementId: 'object' }));
  assert.deepEqual(ids(single.elements), ['object']);
  assert.deepEqual(single.groups, groups.slice(0, 3));
  assert.strictEqual(single.elements[0].content, content);
});

test('solo shows only target then restore returns original visibility', () => {
  const elements = [el('a', 0), el('b', 1), el('c', 2, { visible: false })];
  const { elements: soloed, snapshot } = soloVisibility(elements, 'b');
  assert.deepEqual(soloed.map(e => [e.id, e.visible]), [['a', false], ['b', true], ['c', false]]);
  const restored = restoreVisibility(soloed, snapshot);
  assert.deepEqual(restored.map(e => [e.id, e.visible]), [['a', true], ['b', true], ['c', false]]);
});
