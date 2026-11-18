import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const { groupElements, ungroupElements, removeGroupWithChildren, renameGroup, setGroupVisible, toggleGroupCollapsed } =
  await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const el = (id, zIndex, extra = {}) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId: null, ...extra });
const ids = list => list.map(e => e.id);

test('groupElements makes the selection a contiguous block and assigns groupId', () => {
  const elements = [el('a', 0), el('b', 1), el('c', 2), el('d', 3)];
  const out = groupElements(elements, [], ['b', 'd'], 'g1', '组一');
  assert.deepEqual(ids(out.elements), ['a', 'b', 'd', 'c']);
  assert.deepEqual(out.elements.map(e => e.zIndex), [0, 1, 2, 3]);
  assert.equal(out.elements.find(e => e.id === 'b').groupId, 'g1');
  assert.equal(out.elements.find(e => e.id === 'd').groupId, 'g1');
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].id, 'g1');
  assert.equal(out.groups[0].name, '组一');
  assert.equal(out.groups[0].parentId, null);
});

test('ungroupElements dissolves group and restores member groupId to parent', () => {
  const grouped = groupElements([el('a', 0), el('b', 1), el('c', 2)], [], ['b'], 'g1').elements;
  const groups = [{ id: 'g1', name: 'g1', parentId: null, visible: true, opacity: 1, collapsed: false, order: 0 }];
  const out = ungroupElements(grouped, groups, 'g1');
  assert.deepEqual(out.groups, []);
  assert.equal(out.elements.find(e => e.id === 'b').groupId, null);
});

test('removeGroupWithChildren deletes subtree elements and descendant groups', () => {
  const elements = [el('a', 0), el('b', 1, { groupId: 'g1' }), el('c', 2, { groupId: 'g2' })];
  const groups = [
    { id: 'g1', name: 'g1', parentId: null, visible: true, opacity: 1, collapsed: false, order: 0 },
    { id: 'g2', name: 'g2', parentId: 'g1', visible: true, opacity: 1, collapsed: false, order: 0 }
  ];
  const out = removeGroupWithChildren(elements, groups, 'g1');
  assert.deepEqual(ids(out.elements), ['a']);
  assert.equal(out.elements[0].zIndex, 0);
  assert.deepEqual(out.groups, []);
});

test('renameGroup / setGroupVisible / toggleGroupCollapsed update only target', () => {
  const groups = [
    { id: 'g1', name: 'old', parentId: null, visible: true, opacity: 1, collapsed: false, order: 0 },
    { id: 'g2', name: 'keep', parentId: null, visible: true, opacity: 1, collapsed: false, order: 1 }
  ];
  assert.equal(renameGroup(groups, 'g1', '新组').find(g => g.id === 'g1').name, '新组');
  assert.equal(setGroupVisible(groups, 'g1', false).find(g => g.id === 'g1').visible, false);
  assert.equal(toggleGroupCollapsed(groups, 'g1').find(g => g.id === 'g1').collapsed, true);
  assert.equal(groups[0].name, 'old'); // immutable
});
