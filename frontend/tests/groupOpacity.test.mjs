import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { setGroupOpacity, effectiveGroupOpacity, bakeGroupOpacity } = await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const el = (id, zIndex, groupId = null, opacity = 1) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity, zIndex, isBackground: false, visible: true, layerName: '', groupId });
const grp = (id, parentId = null, opacity = 1) => ({ id, name: id, parentId, visible: true, opacity, collapsed: false, order: 0 });

test('effectiveGroupOpacity multiplies ancestor group opacities', () => {
  const groups = [grp('g1', null, 0.5), grp('g2', 'g1', 0.5)];
  const byId = new Map(groups.map(g => [g.id, g]));
  assert.equal(effectiveGroupOpacity(el('a', 0), byId), 1);
  assert.equal(effectiveGroupOpacity(el('b', 1, 'g1', 0.8), byId), 0.4); // 0.8*0.5
  assert.ok(Math.abs(effectiveGroupOpacity(el('c', 2, 'g2'), byId) - 0.25) < 1e-9);
});

test('bakeGroupOpacity folds group opacity into element opacity', () => {
  const elements = [el('a', 0, 'g1', 0.8), el('b', 1, null, 1)];
  const groups = [grp('g1', null, 0.5)];
  const out = bakeGroupOpacity(elements, groups);
  assert.ok(Math.abs(out[0].opacity - 0.4) < 1e-9);
  assert.equal(out[1], elements[1]);
});

test('setGroupOpacity clamps to 0..1 and only changes target', () => {
  const groups = [grp('g1'), grp('g2')];
  assert.equal(setGroupOpacity(groups, 'g1', 0.5).find(g => g.id === 'g1').opacity, 0.5);
  assert.equal(setGroupOpacity(groups, 'g1', 2).find(g => g.id === 'g1').opacity, 1);
  assert.equal(setGroupOpacity(groups, 'g1', -1).find(g => g.id === 'g1').opacity, 0);
  assert.equal(groups[0].opacity, 1);
});
