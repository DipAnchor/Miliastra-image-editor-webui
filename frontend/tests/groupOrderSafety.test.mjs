import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = name => ts.transpileModule(readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { reorderGroups } = await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const el = (id, zIndex, groupId = null) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId });
const grp = (id, parentId = null) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order: 0 });
const ids = elements => elements.map(element => element.id);
const nestedFixture = () => ({
  elements: [el('root-low', 0), el('p-low', 1, 'parent'), el('a', 2, 'child-a'), el('a-inner', 3, 'grandchild-a'), el('p-high', 4, 'parent'), el('b', 5, 'child-b'), el('root-high', 6)],
  groups: [grp('parent'), grp('child-a', 'parent'), grp('grandchild-a', 'child-a'), grp('child-b', 'parent')]
});
const assertNestedMove = (direction, expected) => {
  const { elements, groups } = nestedFixture();
  const result = reorderGroups(elements, groups, ['child-a'], direction);
  assert.deepEqual(ids(result), expected);
  assert.deepEqual(result.filter(element => ['a', 'a-inner'].includes(element.id)).map(element => element.id), ['a', 'a-inner']);
  assert.deepEqual(result.map(element => element.zIndex), result.map((_, index) => index));
  assert.deepEqual(groups.map(group => group.parentId), [null, 'parent', 'child-a', 'parent']);
};

test('reorderGroups moves a nested group up one sibling without escaping its parent', () => {
  assertNestedMove('up', ['root-low', 'p-low', 'p-high', 'a', 'a-inner', 'b', 'root-high']);
});

test('reorderGroups moves a nested group down one sibling without escaping its parent', () => {
  assertNestedMove('down', ['root-low', 'a', 'a-inner', 'p-low', 'p-high', 'b', 'root-high']);
});

test('reorderGroups moves a nested group to the top of its parent scope only', () => {
  assertNestedMove('top', ['root-low', 'p-low', 'p-high', 'b', 'a', 'a-inner', 'root-high']);
});

test('reorderGroups moves a nested group to the bottom of its parent scope only', () => {
  assertNestedMove('bottom', ['root-low', 'a', 'a-inner', 'p-low', 'p-high', 'b', 'root-high']);
});

test('reorderGroups moves a root group as one complete nested subtree', () => {
  const elements = [el('root-low', 0), el('parent-leaf', 1, 'parent'), el('child-leaf', 2, 'child'), el('loose', 3), el('other', 4, 'other-group')];
  const groups = [grp('parent'), grp('child', 'parent'), grp('other-group')];
  const result = reorderGroups(elements, groups, ['parent'], 'top');
  assert.deepEqual(ids(result), ['root-low', 'loose', 'other', 'parent-leaf', 'child-leaf']);
  assert.equal(result.find(element => element.id === 'parent-leaf').groupId, 'parent');
  assert.equal(result.find(element => element.id === 'child-leaf').groupId, 'child');
  assert.deepEqual(groups.map(group => group.parentId), [null, 'parent', null]);
});

test('reorderGroups de-duplicates selected descendants covered by a selected parent', () => {
  const elements = [el('outside', 0), el('a', 1, 'parent'), el('b', 2, 'child-b'), el('c', 3, 'child-c'), el('other', 4, 'other')];
  const groups = [grp('parent'), grp('child-b', 'parent'), grp('child-c', 'parent'), grp('other')];
  const result = reorderGroups(elements, groups, ['parent', 'child-b'], 'top');
  assert.deepEqual(ids(result), ['outside', 'other', 'a', 'b', 'c']);
  assert.equal(new Set(ids(result)).size, elements.length);
  assert.deepEqual(Object.fromEntries(result.map(element => [element.id, element.groupId])), Object.fromEntries(elements.map(element => [element.id, element.groupId])));
});
