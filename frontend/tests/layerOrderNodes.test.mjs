import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = name => ts.transpileModule(readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { reorderLayerNodes, moveElementToLayerPosition, groupTreeRows } = await import(url(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(url(compile('sceneLayer'))))));
const el = (id, zIndex, groupId = null, extra = {}) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, groupId, ...extra });
const group = (id, parentId = null, extra = {}) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order: 0, ...extra });
const ids = out => out.elements.map(element => element.id);
const noop = (out, elements, groups) => { assert.equal(out.elements, elements); assert.equal(out.groups, groups); };
const ownership = out => Object.fromEntries(out.elements.map(element => [element.id, element.groupId]));

test('a leaf moves within its parent while root siblings remain outside the group', () => {
  const elements = [el('outside-low', 0), el('a', 1, 'g'), el('b', 2, 'g'), el('outside-high', 3)];
  const groups = [group('g')];
  const out = reorderLayerNodes(elements, groups, ['a'], [], 'top');
  assert.deepEqual(ids(out), ['outside-low', 'b', 'a', 'outside-high']);
  assert.deepEqual(ownership(out), ownership({ elements }));
  noop(reorderLayerNodes(out.elements, out.groups, ['a'], [], 'up'), out.elements, out.groups);
});

for (const direction of ['up', 'down', 'top', 'bottom']) test('mixed group and loose layer reorder as complete nodes: ' + direction, () => {
  const elements = [el('low', 0), el('a', 1, 'g'), el('b', 2, 'g'), el('loose', 3), el('high', 4)];
  const groups = [group('g', null, { opacity: 0.4 })];
  const before = structuredClone({ elements, groups });
  const out = reorderLayerNodes(elements, groups, ['a', 'b', 'loose'], ['g'], direction);
  assert.deepEqual(ids(out), direction === 'up' || direction === 'top' ? ['low', 'high', 'a', 'b', 'loose'] : ['a', 'b', 'loose', 'low', 'high']);
  assert.deepEqual(ownership(out), ownership({ elements }));
  assert.deepEqual(out.groups, groups);
  assert.deepEqual({ elements, groups }, before);
});

test('selected descendants are covered once by their selected ancestor group', () => {
  const elements = [el('a', 0, 'child'), el('b', 1, 'outer'), el('c', 2)];
  const groups = [group('outer'), group('child', 'outer')];
  const out = reorderLayerNodes(elements, groups, ['a', 'b'], ['outer', 'child'], 'top');
  assert.deepEqual(ids(out), ['c', 'a', 'b']);
  assert.deepEqual(out.groups, groups);
});

test('a blocked selected group does not fall back to moving its unlocked members', () => {
  const elements = [el('a', 0, 'g'), el('b', 1, 'g', { locked: true }), el('c', 2), el('d', 3)];
  const groups = [group('g')];
  noop(reorderLayerNodes(elements, groups, ['a', 'b'], ['g'], 'top'), elements, groups);
  const out = reorderLayerNodes(elements, groups, ['a', 'b', 'c'], ['g'], 'top');
  assert.deepEqual(ids(out), ['a', 'b', 'd', 'c']);
});

test('a locked empty descendant also protects the whole selected group', () => {
  const elements = [el('a', 0, 'g'), el('b', 1)];
  const groups = [group('g'), group('empty', 'g', { locked: true })];
  noop(reorderLayerNodes(elements, groups, ['a'], ['g'], 'top'), elements, groups);
});

test('empty groups persist their new relative position without inventing a leaf', () => {
  const elements = [el('a', 0), el('b', 1)];
  const groups = [group('empty')];
  const out = reorderLayerNodes(elements, groups, [], ['empty'], 'top');
  assert.deepEqual(ids(out), ['a', 'b']);
  assert.equal(out.groups.length, 1);
  assert.deepEqual(groupTreeRows(out.elements, out.groups).map(row => row.kind === 'group' ? row.group.id : row.element.id), ['empty', 'b', 'a']);
  noop(reorderLayerNodes(out.elements, out.groups, [], ['empty'], 'top'), out.elements, out.groups);
});

test('numeric layer requests skip complete sibling groups in the requested direction', () => {
  const elements = [el('low', 0), el('a', 1, 'g'), el('b', 2, 'g'), el('high', 3)];
  const groups = [group('g')];
  assert.deepEqual(ids(moveElementToLayerPosition(elements, groups, 'low', 2)), ['a', 'b', 'low', 'high']);
  assert.deepEqual(ids(moveElementToLayerPosition(elements, groups, 'high', 3)), ['low', 'high', 'a', 'b']);
});

test('numeric layer requests clamp to their own parent scope', () => {
  const elements = [el('low', 0), el('a', 1, 'g'), el('b', 2, 'g'), el('high', 3)];
  const groups = [group('g')];
  for (const out of [moveElementToLayerPosition(elements, groups, 'a', 999), moveElementToLayerPosition(elements, groups, 'b', -999)]) {
    assert.deepEqual(ids(out), ['low', 'b', 'a', 'high']);
    assert.deepEqual(ownership(out), ownership({ elements }));
  }
});

test('invalid inputs and locked targets preserve original arrays', () => {
  const elements = [el('a', 0, 'g')];
  const groups = [group('g', null, { locked: true })];
  for (const value of [1, 999, NaN, Infinity]) noop(moveElementToLayerPosition(elements, groups, 'a', value), elements, groups);
  noop(reorderLayerNodes(elements, groups, ['missing'], ['absent'], 'up'), elements, groups);
  const cyclic = [group('g', 'other'), group('other', 'g')];
  noop(reorderLayerNodes(elements, cyclic, ['a'], [], 'top'), elements, cyclic);
});
