import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const asModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = (name, imports = {}) => {
  let source = ts.transpileModule(readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
  }).outputText;
  for (const [key, value] of Object.entries(imports)) source = source.replace('"./' + key + '"', JSON.stringify(value));
  return asModule(source);
};
const { pickCanvasLayer, primitiveContains } = await import(compile('canvasPicking', {
  layerTree: compile('layerTree', { sceneLayer: compile('sceneLayer') }),
  maskShapes: compile('maskShapes'), rotation: compile('rotation')
}));
const leaf = (id, patch = {}) => ({ id, type: 'rectangle', x: 50, y: 50, width: 80, height: 80,
  rotation: 0, opacity: 1, color: '#fff', ...patch });
const at = (elements, x, y, groups = new Map(), painted = () => true) =>
  pickCanvasLayer(elements, groups, { x, y }, painted)?.id ?? null;

test('skips self and ancestor locks without skipping the next visible unlocked layer', () => {
  const elements = [leaf('bottom'), leaf('sibling', { width: 28 }), leaf('nested-locked', { groupId: 'nested' }),
    leaf('self-locked', { locked: true }), leaf('hidden', { visible: false })];
  const groups = new Map([['root', { id: 'root', locked: true, opacity: 1 }],
    ['nested', { id: 'nested', parentId: 'root', opacity: 1 }]]);
  assert.equal(at(elements, 50, 50, groups), 'sibling');
  assert.equal(at(elements, 25, 50, groups), 'bottom');
  assert.equal(at(elements.slice(2), 50, 50, groups), null);
});

test('checks the contours of ellipses, rings, stars and rotated triangles', () => {
  for (const type of ['ellipse', 'four_point_star', 'five_point_star']) {
    assert.equal(primitiveContains(leaf('shape', { type }), { x: -37, y: -37 }), false);
    assert.equal(primitiveContains(leaf('shape', { type }), { x: 0, y: 0 }), true);
  }
  const bottom = leaf('bottom');
  const ring = leaf('ring', { type: 'ring' });
  assert.equal(at([bottom, ring], 50, 50), 'bottom');
  assert.equal(at([bottom, ring], 86, 50), 'ring');
  const triangle = leaf('triangle', { type: 'triangle', rotation: 90 });
  assert.equal(at([bottom, triangle], 75, 50), 'triangle');
  assert.equal(at([bottom, triangle], 25, 25), 'bottom');
});

test('falls through zero opacity, transparent fills and empty rendered coverage', () => {
  const elements = [leaf('bottom'), leaf('mask'), leaf('sprite', { type: 'image' }), leaf('empty', { color: '#fff0' }),
    leaf('hidden-fill', { opacity: 0 }), leaf('group-zero', { groupId: 'zero' })];
  const groups = new Map([['zero', { id: 'zero', opacity: 0 }]]);
  const paint = (element, _local, p) => element.id === 'bottom' || element.id === 'mask' && p.x < -10 || element.id === 'sprite' && p.x > 10;
  assert.equal(at(elements, 50, 50, groups, paint), 'bottom');
  assert.equal(at(elements, 30, 50, groups, paint), 'mask');
  assert.equal(at(elements, 70, 50, groups, paint), 'sprite');
});

test('projects through a rotated and scaled object shell but leaves gaps and hidden content open', () => {
  const object = { id: 'object', type: 'smart-object', x: 50, y: 50, rotation: 90, scale: 2, opacity: 1,
    content: { frame: { width: 60, height: 60 }, groups: [], elements: [
      leaf('inside', { x: 40, y: 30, width: 12, height: 10, locked: true }),
      leaf('hidden', { x: 30, y: 30, visible: false })
    ] } };
  assert.equal(at([leaf('bottom'), object], 50, 50), 'bottom');
  assert.equal(at([leaf('bottom'), object], 50, 30, new Map(), (layer, _local, _p, parent) => layer.id !== 'inside' || parent === 'object'), 'object');
  assert.equal(at([leaf('bottom'), { ...object, locked: true }], 50, 30), 'bottom');
});
