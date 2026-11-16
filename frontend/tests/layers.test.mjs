import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const { normalizeElementsLayers, normalizeGroups, effectiveVisible } = await import(moduleUrl(compile('layerTree')));

const el = (id, extra = {}) => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex: 0, isBackground: false, ...extra });
const grp = (id, extra = {}) => ({ id, name: id, parentId: null, visible: true, opacity: 1, collapsed: false, order: 0, ...extra });

test('normalizeElementsLayers fills visible/layerName/groupId defaults', () => {
  const out = normalizeElementsLayers([el('a')]);
  assert.equal(out[0].visible, true);
  assert.equal(out[0].layerName, '');
  assert.equal(out[0].groupId, null);
});

test('normalizeElementsLayers preserves explicit values and object identity when already normalized', () => {
  const src = [el('a', { visible: false, layerName: 'X', groupId: 'g1' })];
  const out = normalizeElementsLayers(src);
  assert.equal(out[0].visible, false);
  assert.equal(out[0].layerName, 'X');
  assert.equal(out[0].groupId, 'g1');
  assert.equal(out[0], src[0]); // unchanged -> same reference
});

test('normalizeGroups fills defaults, drops duplicate ids and dangling parents', () => {
  const out = normalizeGroups([grp('g1', { parentId: 'nope' }), grp('g1'), grp('g2', { visible: false })]);
  assert.deepEqual(out.map(g => g.id), ['g1', 'g2']);
  assert.equal(out[0].parentId, null);
  assert.equal(out[1].visible, false);
  assert.equal(typeof out[0].order, 'number');
});

test('effectiveVisible inherits ancestor group visibility', () => {
  const byId = new Map(normalizeGroups([grp('g1'), grp('g2', { parentId: 'g1', visible: false })]).map(g => [g.id, g]));
  assert.equal(effectiveVisible(el('a'), byId), true);
  assert.equal(effectiveVisible(el('b', { groupId: 'g2' }), byId), false);
  assert.equal(effectiveVisible(el('c', { visible: false }), byId), false);
  assert.equal(effectiveVisible(el('d', { groupId: 'missing' }), byId), true);
});
