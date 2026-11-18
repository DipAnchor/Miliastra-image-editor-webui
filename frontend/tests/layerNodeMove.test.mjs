import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = name => ts.transpileModule(readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { moveLayerNode, groupTreeRows } = await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const el = (id, zIndex, groupId = null) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId });
const grp = (id, parentId = null, extra = {}) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order: 0, ...extra });
const ids = list => list.map(item => item.id);
const get = (list, id) => list.find(item => item.id === id);
const rows = out => groupTreeRows(out.elements, out.groups).map(row => row.kind === 'group' ? 'g:' + row.group.id : 'e:' + row.element.id);
const noop = (out, elements, groups) => { assert.equal(out.elements, elements); assert.equal(out.groups, groups); };
const group = id => ({ kind: 'group', id });
const element = id => ({ kind: 'element', id });
const into = id => ({ kind: 'group', id, position: 'into' });
const next = (kind, id, position) => ({ kind, id, position });

test('moveLayerNode group center nests the entire subtree above target children', () => {
  const elements = [el('a', 0, 'drag'), el('b', 1, 'child'), el('middle', 2), el('c', 3, 'target')];
  const groups = [grp('drag'), grp('child', 'drag'), grp('target')];
  const snapshot = structuredClone({ elements, groups });
  const out = moveLayerNode(elements, groups, group('drag'), into('target'));
  assert.equal(get(out.groups, 'drag').parentId, 'target');
  assert.equal(get(out.groups, 'child').parentId, 'drag');
  assert.deepEqual(ids(out.elements), ['middle', 'c', 'a', 'b']);
  assert.deepEqual(out.elements.map(e => e.zIndex), [0, 1, 2, 3]);
  assert.deepEqual({ elements, groups }, snapshot);
});

for (const position of ['above', 'below']) {
  test('moveLayerNode subgroup to parent ' + position + ' becomes a sibling, not a cycle', () => {
    const elements = [el('low', 0), el('a', 1, 'parent'), el('b', 2, 'child'), el('c', 3, 'grandchild'), el('high', 4)];
    const groups = [grp('parent'), grp('child', 'parent'), grp('grandchild', 'child')];
    const out = moveLayerNode(elements, groups, group('child'), next('group', 'parent', position));
    assert.equal(get(out.groups, 'child').parentId, null);
    assert.equal(get(out.groups, 'grandchild').parentId, 'child');
    assert.deepEqual(ids(out.elements), position === 'above' ? ['low', 'a', 'b', 'c', 'high'] : ['low', 'b', 'c', 'a', 'high']);
    const visible = rows(out);
    assert.equal(visible.indexOf('g:child') < visible.indexOf('g:parent'), position === 'above');
  });
}

test('moveLayerNode subgroup beside a nested leaf joins the leaf parent', () => {
  const elements = [el('a', 0, 'old'), el('b', 1, 'drag'), el('c', 2, 'deep'), el('target', 3, 'other'), el('top', 4)];
  const groups = [grp('old'), grp('drag', 'old'), grp('deep', 'drag'), grp('other')];
  const out = moveLayerNode(elements, groups, group('drag'), next('element', 'target', 'above'));
  assert.equal(get(out.groups, 'drag').parentId, 'other');
  assert.equal(get(out.groups, 'deep').parentId, 'drag');
  assert.deepEqual(ids(out.elements), ['a', 'target', 'b', 'c', 'top']);
});

test('moveLayerNode leaf distinguishes group center from either edge', () => {
  const elements = [el('drag', 0), el('a', 1, 'target'), el('b', 2, 'child'), el('top', 3)];
  const groups = [grp('target'), grp('child', 'target')];
  const centered = moveLayerNode(elements, groups, element('drag'), into('target'));
  assert.equal(get(centered.elements, 'drag').groupId, 'target');
  assert.deepEqual(ids(centered.elements), ['a', 'b', 'drag', 'top']);
  for (const position of ['above', 'below']) {
    const edged = moveLayerNode(elements, groups, element('drag'), next('group', 'target', position));
    assert.equal(get(edged.elements, 'drag').groupId, null);
    assert.deepEqual(ids(edged.elements), position === 'above' ? ['a', 'b', 'drag', 'top'] : ['drag', 'a', 'b', 'top']);
  }
});

test('moveLayerNode into an empty nested group stays inside its ancestor block', () => {
  const elements = [el('drag', 0), el('inside', 1, 'parent'), el('top', 2)];
  const groups = [grp('parent'), grp('empty', 'parent')];
  const out = moveLayerNode(elements, groups, element('drag'), into('empty'));
  assert.equal(get(out.elements, 'drag').groupId, 'empty');
  assert.deepEqual(ids(out.elements), ['drag', 'inside', 'top']);
});

test('moveLayerNode sorts empty groups around populated groups and leaves', () => {
  const elements = [el('a', 0, 'full'), el('leaf', 1)];
  const groups = [grp('empty'), grp('otherEmpty', null, { order: 1 }), grp('full')];
  const above = moveLayerNode(elements, groups, group('empty'), next('group', 'full', 'above'));
  assert.deepEqual(rows(above), ['e:leaf', 'g:empty', 'g:full', 'e:a', 'g:otherEmpty']);
  const nextToLeaf = moveLayerNode(above.elements, above.groups, group('otherEmpty'), next('element', 'leaf', 'above'));
  assert.deepEqual(rows(nextToLeaf), ['g:otherEmpty', 'e:leaf', 'g:empty', 'g:full', 'e:a']);
  const sortedEmpty = moveLayerNode([], [grp('one'), grp('two', null, { order: 1 })], group('two'), next('group', 'one', 'above'));
  assert.deepEqual(rows(sortedEmpty), ['g:two', 'g:one']);
});

test('moveLayerNode root detaches a complete subtree and places it on top', () => {
  const elements = [el('a', 0, 'parent'), el('b', 1, 'child'), el('top', 2)];
  const groups = [grp('parent'), grp('child', 'parent')];
  const out = moveLayerNode(elements, groups, group('child'), { kind: 'root' });
  assert.equal(get(out.groups, 'child').parentId, null);
  assert.deepEqual(ids(out.elements), ['a', 'top', 'b']);
});

test('moveLayerNode rejects self, descendant, stale, and cyclic targets with identity noops', () => {
  const elements = [el('a', 0, 'parent'), el('b', 1, 'child'), el('root', 2)];
  const groups = [grp('parent'), grp('child', 'parent')];
  for (const target of [into('parent'), into('child'), next('group', 'child', 'above'), next('element', 'b', 'below'), next('element', 'a', 'above')]) {
    noop(moveLayerNode(elements, groups, group('parent'), target), elements, groups);
  }
  noop(moveLayerNode(elements, groups, element('root'), next('element', 'root', 'above')), elements, groups);
  noop(moveLayerNode(elements, groups, group('missing'), { kind: 'root' }), elements, groups);
  noop(moveLayerNode(elements, groups, element('root'), into('missing')), elements, groups);
  const cyclic = [grp('one', 'two'), grp('two', 'one')];
  const cyclicElements = [el('c', 0, 'one')];
  noop(moveLayerNode(cyclicElements, cyclic, group('one'), { kind: 'root' }), cyclicElements, cyclic);
});

test('moveLayerNode compacts a target ancestor subtree that previously crossed outside siblings', () => {
  const elements = [el('a', 0, 'target'), el('outside', 1), el('b', 2, 'target'), el('drag', 3), el('top', 4)];
  const groups = [grp('target')];
  const out = moveLayerNode(elements, groups, element('drag'), into('target'));
  assert.deepEqual(ids(out.elements), ['outside', 'a', 'b', 'drag', 'top']);
});

test('moveLayerNode preserves several empty groups in one integer boundary across JSON roundtrip', () => {
  const elements = [el('a', 0), el('b', 1)];
  const groups = [grp('one'), grp('two'), grp('three')];
  let out = moveLayerNode(elements, groups, group('one'), next('element', 'a', 'above'));
  out = moveLayerNode(out.elements, out.groups, group('two'), next('group', 'one', 'above'));
  out = moveLayerNode(out.elements, out.groups, group('three'), next('group', 'one', 'below'));
  assert.deepEqual(rows(out), ['e:b', 'g:two', 'g:one', 'g:three', 'e:a']);
  for (const g of out.groups) assert.ok(Number.isSafeInteger(g.order), g.id);
  const restored = JSON.parse(JSON.stringify(out));
  assert.deepEqual(rows(restored), rows(out));
  const moved = moveLayerNode(restored.elements, restored.groups, group('one'), next('group', 'two', 'above'));
  assert.deepEqual(rows(moved), ['e:b', 'g:one', 'g:two', 'g:three', 'e:a']);
});

test('moveLayerNode moves a 256-level subtree without losing its parent chain', () => {
  const depth = 256;
  const groups = Array.from({ length: depth }, (_, index) => grp('g' + index, index ? 'g' + (index - 1) : null));
  const elements = [el('deep', 0, 'g' + (depth - 1)), el('target', 1)];
  const out = moveLayerNode(elements, groups, group('g0'), next('element', 'target', 'above'));
  assert.deepEqual(ids(out.elements), ['target', 'deep']);
  assert.equal(out.groups.length, depth);
  assert.equal(get(out.groups, 'g0').parentId, null);
  for (let i = 1; i < depth; i++) assert.equal(get(out.groups, 'g' + i).parentId, 'g' + (i - 1));
});

test('moveLayerNode preserves all pre-existing group flags while nesting', () => {
  const groups = [grp('drag', null, { locked: true, opacity: 0.35, visible: false, collapsed: true }), grp('child', 'drag', { locked: true, opacity: 0.6, visible: false, collapsed: true }), grp('target')];
  const elements = [el('a', 0, 'child'), el('b', 1, 'target')];
  const out = moveLayerNode(elements, groups, group('drag'), into('target'));
  assert.deepEqual(get(out.groups, 'drag'), { ...groups[0], parentId: 'target' });
  assert.equal(get(out.groups, 'child'), groups[1]);
  assert.equal(get(out.groups, 'target'), groups[2]);
});
