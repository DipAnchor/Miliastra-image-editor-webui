import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = name => ts.transpileModule(readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { groupSelection, lockOtherLayers, effectiveLocked, groupTreeRows } = await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const el = (id, zIndex, groupId = null, extra = {}) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId, ...extra });
const grp = (id, parentId = null, extra = {}) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order: 0, ...extra });
const ids = list => list.map(item => item.id);
const get = (list, id) => list.find(item => item.id === id);
const rows = out => groupTreeRows(out.elements, out.groups).map(row => row.kind === 'group' ? 'g:' + row.group.id : 'e:' + row.element.id);
const noop = (out, elements, groups) => { assert.equal(out.elements, elements); assert.equal(out.groups, groups); };

test('groupSelection wraps sibling groups without flattening descendants', () => {
  const elements = [el('a', 0, 'left'), el('b', 1, 'child'), el('gap', 2), el('c', 3, 'right')];
  const groups = [grp('left'), grp('child', 'left', { opacity: 0.4, collapsed: true }), grp('right')];
  const snapshot = structuredClone({ elements, groups });
  const out = groupSelection(elements, groups, [], ['left', 'right'], 'wrapper', 'Mixed');
  assert.equal(get(out.groups, 'wrapper').parentId, null);
  assert.equal(get(out.groups, 'wrapper').name, 'Mixed');
  assert.equal(get(out.groups, 'left').parentId, 'wrapper');
  assert.equal(get(out.groups, 'right').parentId, 'wrapper');
  assert.deepEqual(get(out.groups, 'child'), groups[1]);
  assert.deepEqual(out.elements.map(e => e.groupId), ['left', 'child', 'right', null]);
  assert.deepEqual(ids(out.elements), ['a', 'b', 'c', 'gap']);
  assert.deepEqual(out.elements.map(e => e.zIndex), [0, 1, 2, 3]);
  assert.deepEqual({ elements, groups }, snapshot);
});

test('groupSelection de-duplicates selected descendants and adds only loose leaves', () => {
  const elements = [el('a', 0, 'child'), el('b', 1, 'left'), el('loose', 2), el('other', 3)];
  const groups = [grp('left'), grp('child', 'left')];
  const out = groupSelection(elements, groups, ['a', 'loose', 'loose'], ['left', 'child', 'left'], 'wrapper');
  assert.equal(get(out.groups, 'left').parentId, 'wrapper');
  assert.equal(get(out.groups, 'child').parentId, 'left');
  assert.equal(get(out.elements, 'a').groupId, 'child');
  assert.equal(get(out.elements, 'loose').groupId, 'wrapper');
  assert.deepEqual(ids(out.elements), ['a', 'b', 'loose', 'other']);
});

test('groupSelection uses the shared parent or nearest common ancestor', () => {
  const elements = [el('a', 0, 'left'), el('b', 1, 'right'), el('direct', 2, 'outer')];
  const groups = [grp('outer'), grp('left', 'outer'), grp('right', 'outer')];
  const sibling = groupSelection(elements, groups, [], ['left', 'right'], 'siblings');
  assert.equal(get(sibling.groups, 'siblings').parentId, 'outer');
  const cousins = groupSelection(elements, groups, ['a', 'b'], [], 'leaves');
  assert.equal(get(cousins.groups, 'leaves').parentId, 'outer');
  assert.equal(get(cousins.elements, 'a').groupId, 'leaves');
  assert.equal(get(cousins.elements, 'b').groupId, 'leaves');
});

test('groupSelection retains valid empty groups, but empty/invalid/colliding requests are noops', () => {
  const elements = [el('a', 0)];
  const groups = [grp('empty')];
  const out = groupSelection(elements, groups, [], ['empty'], 'wrapper');
  assert.equal(get(out.groups, 'empty').parentId, 'wrapper');
  assert.ok(rows(out).includes('g:empty'));
  noop(groupSelection(elements, groups, [], [], 'x'), elements, groups);
  noop(groupSelection(elements, groups, ['missing'], ['absent'], 'x'), elements, groups);
  noop(groupSelection(elements, groups, ['a'], [], 'empty'), elements, groups);
  noop(groupSelection(elements, groups, ['a'], [], 'a'), elements, groups);
  noop(groupSelection(elements, groups, ['a'], [], ''), elements, groups);
});

test('groupSelection refuses a cyclic selected ancestry instead of creating another cycle', () => {
  const elements = [el('a', 0, 'one')];
  const groups = [grp('one', 'two'), grp('two', 'one')];
  noop(groupSelection(elements, groups, ['a'], [], 'wrapper'), elements, groups);
});

test('lockOtherLayers protects selected group subtrees and ancestor chains of every selection', () => {
  const groups = [grp('outer'), grp('selected', 'outer'), grp('child', 'selected'), grp('sibling', 'outer'), grp('other')];
  const elements = [el('a', 0, 'child'), el('b', 1, 'sibling'), el('c', 2, 'other'), el('root', 3)];
  const out = lockOtherLayers(elements, groups, ['b'], ['selected']);
  for (const id of ['outer', 'selected', 'child', 'sibling']) assert.equal(get(out.groups, id).locked, undefined, id);
  assert.equal(get(out.groups, 'other').locked, true);
  for (const id of ['a', 'b']) assert.equal(get(out.elements, id).locked, undefined, id);
  for (const id of ['c', 'root']) assert.equal(get(out.elements, id).locked, true, id);
  const byId = new Map(out.groups.map(g => [g.id, g]));
  assert.equal(effectiveLocked(get(out.elements, 'a'), byId), false);
  assert.equal(effectiveLocked(get(out.elements, 'b'), byId), false);
});

test('lockOtherLayers never unlocks existing locks and empty selection is an identity noop', () => {
  const elements = [el('a', 0, 'parent', { locked: true }), el('b', 1, null, { locked: true })];
  const groups = [grp('parent', null, { locked: true })];
  const out = lockOtherLayers(elements, groups, ['a'], []);
  assert.equal(get(out.elements, 'a'), elements[0]);
  assert.equal(get(out.elements, 'b'), elements[1]);
  assert.equal(get(out.groups, 'parent'), groups[0]);
  noop(lockOtherLayers(elements, groups, [], []), elements, groups);
  noop(lockOtherLayers(elements, groups, ['missing'], ['absent']), elements, groups);
});
