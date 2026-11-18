import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { reorderGroups } = await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const el = (id, zIndex, groupId = null) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId });
const grp = (id, parentId = null, order = 0) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order });
const ids = list => list.map(e => e.id);

test('reorderGroups top moves group block to top of top-level scope', () => {
  const elements = [el('a', 0), el('b', 1, 'g1'), el('c', 2, 'g1'), el('d', 3)];
  const groups = [grp('g1')];
  const out = reorderGroups(elements, groups, ['g1'], 'top');
  assert.deepEqual(ids(out), ['a', 'd', 'b', 'c']);
  assert.deepEqual(out.map(e => e.zIndex), [0, 1, 2, 3]);
});

test('reorderGroups bottom moves group block to bottom', () => {
  const elements = [el('a', 0), el('b', 1, 'g1'), el('c', 2, 'g1'), el('d', 3)];
  const groups = [grp('g1')];
  const out = reorderGroups(elements, groups, ['g1'], 'bottom');
  assert.deepEqual(ids(out), ['b', 'c', 'a', 'd']);
});
