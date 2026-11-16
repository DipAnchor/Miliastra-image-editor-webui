import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const { setLayerVisible, renameLayer } = await import(moduleUrl(compile('layerTree')));
const el = (id, extra = {}) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex: 0, isBackground: false, visible: true, layerName: '', groupId: null, ...extra });

test('setLayerVisible toggles only the target and keeps others identical by reference', () => {
  const src = [el('a'), el('b')];
  const out = setLayerVisible(src, 'b', false);
  assert.equal(out[0], src[0]);
  assert.equal(out[1].visible, false);
  assert.equal(src[1].visible, true); // immutable
});

test('renameLayer sets layerName on target only and trims using caller value', () => {
  const src = [el('a'), el('b', { layerName: 'old' })];
  const out = renameLayer(src, 'b', '新名字');
  assert.equal(out[1].layerName, '新名字');
  assert.equal(out[0], src[0]);
  assert.equal(src[1].layerName, 'old');
});
