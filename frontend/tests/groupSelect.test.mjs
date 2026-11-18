import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { groupElementIds } = await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const el = (id, zIndex, groupId = null) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId });
const grp = (id, parentId = null) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order: 0 });

test('groupElementIds collects direct and nested descendants', () => {
  const elements = [el('a', 0), el('b', 1, 'g1'), el('c', 2, 'g2'), el('d', 3, 'g3')];
  const groups = [grp('g1'), grp('g2', 'g1'), grp('g3')];
  assert.deepEqual(groupElementIds(elements, groups, ['g1']).sort(), ['b', 'c']);
  assert.deepEqual(groupElementIds(elements, groups, ['g1', 'g3']).sort(), ['b', 'c', 'd']);
  assert.deepEqual(groupElementIds(elements, groups, []), []);
});
