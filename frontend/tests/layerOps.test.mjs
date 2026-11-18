import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const { visibleForExport, exportSubset, soloVisibility, restoreVisibility, groupDescendantIds } =
  await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));

const el = (id, zIndex, extra = {}) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId: null, ...extra });
const grp = (id, extra = {}) => ({ id, name: id, parentId: null, visible: true, opacity: 1, collapsed: false, order: 0, ...extra });
const ids = list => list.map(e => e.id);

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

test('solo shows only target then restore returns original visibility', () => {
  const elements = [el('a', 0), el('b', 1), el('c', 2, { visible: false })];
  const { elements: soloed, snapshot } = soloVisibility(elements, 'b');
  assert.deepEqual(soloed.map(e => [e.id, e.visible]), [['a', false], ['b', true], ['c', false]]);
  const restored = restoreVisibility(soloed, snapshot);
  assert.deepEqual(restored.map(e => [e.id, e.visible]), [['a', true], ['b', true], ['c', false]]);
});
