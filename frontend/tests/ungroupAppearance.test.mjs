import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = (name) => ts.transpileModule(readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const { ungroupElements, effectiveGroupOpacity, effectiveVisible } = await import(
  moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer')))))
);

const leaf = (id, zIndex, groupId = null, extra = {}) => ({
  id, name: id, layerName: id, type: 'rectangle', x: 0, y: 0, width: 20, height: 20,
  rotation: 0, color: '#336699', opacity: 1, zIndex, isBackground: false, visible: true, groupId,
  ...extra
});
const group = (id, parentId = null, extra = {}) => ({
  id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order: 0, ...extra
});
const get = (items, id) => items.find(item => item.id === id);

// The target factor is baked into direct members while ancestor effects remain external.
test('ungroups direct leaves with target visibility and opacity, preserving source arrays', () => {
  const elements = [leaf('below', 0), leaf('member', 1, 'target', { opacity: 0.8 }), leaf('after', 2, 'other')];
  const groups = [group('target', null, { visible: true, opacity: 0.5 }), group('other')];
  const snapshot = structuredClone({ elements, groups });
  const out = ungroupElements(elements, groups, 'target');

  assert.deepEqual(out.elements.map(item => item.id), ['below', 'member', 'after']);
  assert.equal(get(out.elements, 'member').groupId, null);
  assert.equal(get(out.elements, 'member').opacity, 0.4);
  assert.deepEqual(get(out.elements, 'below'), elements[0]);
  assert.deepEqual(get(out.elements, 'after'), elements[2]);
  assert.deepEqual({ elements, groups }, snapshot);
});

test('promotes direct child groups and bakes their target factor without reordering siblings', () => {
  const elements = [leaf('inside', 0, 'child'), leaf('direct', 1, 'target'), leaf('outside', 2)];
  const groups = [
    group('target', 'outer', { opacity: 0.5 }),
    group('child', 'target', { opacity: 0.4, order: 4 }),
    group('outer', null, { opacity: 0.25 }),
    group('sibling', 'outer', { order: 9 })
  ];
  const out = ungroupElements(elements, groups, 'target');

  assert.equal(get(out.groups, 'child').parentId, 'outer');
  assert.equal(get(out.groups, 'child').opacity, 0.2);
  assert.equal(get(out.groups, 'child').order, 4);
  assert.equal(get(out.elements, 'direct').groupId, 'outer');
  assert.deepEqual(out.groups.map(item => item.id), ['child', 'outer', 'sibling']);
  assert.equal(get(out.elements, 'inside').groupId, 'child');
});

test('does not bake an ancestor opacity a second time', () => {
  const elements = [leaf('member', 0, 'target', { opacity: 0.8 })];
  const groups = [group('outer', null, { opacity: 0.25 }), group('target', 'outer', { opacity: 0.5 })];
  const out = ungroupElements(elements, groups, 'target');
  const byId = new Map(out.groups.map(item => [item.id, item]));

  assert.equal(get(out.elements, 'member').opacity, 0.4);
  assert.equal(effectiveGroupOpacity(get(out.elements, 'member'), byId), 0.1);
  assert.notEqual(get(out.elements, 'member').opacity, 0.1);
});

test('transfers hidden and zero-opacity target state to every direct member kind', () => {
  const elements = [leaf('leaf', 0, 'target', { opacity: 0.8 }), leaf('child-leaf', 1, 'child', { opacity: 0.7 })];
  const groups = [
    group('target', null, { visible: false, opacity: 0 }),
    group('child', 'target', { visible: true, opacity: 0.4 })
  ];
  const out = ungroupElements(elements, groups, 'target');
  const child = get(out.groups, 'child');
  const leafMember = get(out.elements, 'leaf');
  const byId = new Map(out.groups.map(item => [item.id, item]));

  assert.equal(leafMember.visible, false);
  assert.equal(leafMember.opacity, 0);
  assert.equal(child.visible, false);
  assert.equal(child.opacity, 0);
  assert.equal(effectiveVisible(get(out.elements, 'child-leaf'), byId), false);
  assert.equal(effectiveGroupOpacity(get(out.elements, 'child-leaf'), byId), 0);
});

test('keeps nested descendants attached while direct child carries target visibility and opacity', () => {
  const elements = [leaf('grandchild-leaf', 0, 'grandchild', { opacity: 0.9 })];
  const groups = [
    group('target', null, { visible: false, opacity: 0.6 }),
    group('child', 'target', { visible: true, opacity: 0.5 }),
    group('grandchild', 'child', { visible: true, opacity: 0.7 })
  ];
  const out = ungroupElements(elements, groups, 'target');
  const byId = new Map(out.groups.map(item => [item.id, item]));

  assert.equal(get(out.groups, 'child').parentId, null);
  assert.equal(get(out.groups, 'child').visible, false);
  assert.equal(get(out.groups, 'child').opacity, 0.3);
  assert.equal(get(out.groups, 'grandchild').parentId, 'child');
  assert.equal(get(out.elements, 'grandchild-leaf').opacity, 0.9);
  assert.equal(effectiveVisible(get(out.elements, 'grandchild-leaf'), byId), false);
});

test('bakes textbox text, background, outline alpha and makes element opacity equal text alpha', () => {
  const elements = [leaf('text', 0, 'target', {
    type: 'textbox', opacity: 0.9,
    textBox: {
      text: 'Alpha', fontSize: 20, autoSize: false, minFontSize: 12, textColor: '#fff', textOpacity: 0.6,
      bgColor: '#000', bgOpacity: 0.4, outlineEnabled: true, outlineColor: '#fff', outlineOpacity: 0.8,
      alignH: 'center', alignV: 'middle', anchorType: 'center', visible: true, scaleX: 1, scaleY: 1,
      anchorMinX: 0.5, anchorMinY: 0.5, anchorMaxX: 0.5, anchorMaxY: 0.5, pivotX: 0.5, pivotY: 0.5
    }
  })];
  const groups = [group('target', null, { opacity: 0.5 })];
  const out = ungroupElements(elements, groups, 'target');
  const text = get(out.elements, 'text');

  assert.equal(text.opacity, 0.3);
  assert.equal(text.textBox.textOpacity, 0.3);
  assert.equal(text.textBox.bgOpacity, 0.2);
  assert.equal(text.textBox.outlineOpacity, 0.4);
  assert.equal(text.textBox.text, 'Alpha');
});

test('keeps a zero shell opacity textbox drawable through its own text and background alpha', () => {
  const elements = [leaf('text', 0, 'target', {
    type: 'textbox', opacity: 0, textBox: {
      text: 'Visible background', fontSize: 20, autoSize: false, minFontSize: 12, textColor: '#fff', textOpacity: 0.8,
      bgColor: '#f00', bgOpacity: 0.6, outlineEnabled: false, outlineColor: '#000', outlineOpacity: 1,
      alignH: 'center', alignV: 'middle', anchorType: 'center', visible: true, scaleX: 1, scaleY: 1,
      anchorMinX: 0.5, anchorMinY: 0.5, anchorMaxX: 0.5, anchorMaxY: 0.5, pivotX: 0.5, pivotY: 0.5
    }
  })];
  const out = ungroupElements(elements, [group('target', null, { opacity: 0.5 })], 'target');
  const text = get(out.elements, 'text');

  assert.equal(text.opacity, 0.4);
  assert.equal(text.textBox.textOpacity, 0.4);
  assert.equal(text.textBox.bgOpacity, 0.3);
});

test('changes only a smart-object shell and never mutates its content document', () => {
  const content = {
    frame: { width: 40, height: 30 },
    elements: [leaf('inside', 0, null, { opacity: 0.7 })],
    groups: [group('inside-group', null, { opacity: 0.4 })]
  };
  const object = { id: 'object', name: 'Object', layerName: 'Object', type: 'smart-object', x: 0, y: 0,
    rotation: 0, scale: 1, opacity: 0.8, zIndex: 0, visible: true, groupId: 'target', content };
  const snapshot = structuredClone(content);
  const out = ungroupElements([object], [group('target', null, { opacity: 0.5 })], 'target');

  assert.equal(get(out.elements, 'object').groupId, null);
  assert.equal(get(out.elements, 'object').opacity, 0.4);
  assert.deepEqual(get(out.elements, 'object').content, snapshot);
  assert.deepEqual(content, snapshot);
});

test('leaves unselected data and layer order unchanged, and missing targets are identity noops', () => {
  const elements = [leaf('first', 0, 'target'), leaf('selected', 1, 'target', { opacity: 0.5 }), leaf('outside', 2, 'other')];
  const groups = [group('target', null, { opacity: 0.5 }), group('other', null, { order: 8 })];
  const out = ungroupElements(elements, groups, 'target');

  assert.deepEqual(out.elements.map(item => item.id), ['first', 'selected', 'outside']);
  assert.deepEqual(out.elements.map(item => item.zIndex), [0, 1, 2]);
  assert.deepEqual(get(out.elements, 'outside'), elements[2]);
  assert.deepEqual(get(out.groups, 'other'), groups[1]);
  assert.equal(ungroupElements(elements, groups, 'missing').elements, elements);
  assert.equal(ungroupElements(elements, groups, 'missing').groups, groups);
});
