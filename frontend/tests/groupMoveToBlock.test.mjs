import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { moveGroupNextToElement } = await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const el = (id, zIndex, groupId = null) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId });
const grp = (id, parentId = null, order = 0) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order });
const ids = list => list.map(e => e.id);

test('group dragged above a top-level element block goes right above it', () => {
  const elements = [el('a', 0), el('b', 1, 'g1'), el('c', 2, 'g1'), el('d', 3, 'g2'), el('e', 4, 'g2')];
  const groups = [grp('g1'), grp('g2')];
  const out = moveGroupNextToElement(elements, groups, 'g2', 'a', 'above');
  assert.deepEqual(ids(out.elements), ['a', 'd', 'e', 'b', 'c']);
  assert.deepEqual(out.elements.map(e => e.zIndex), [0, 1, 2, 3, 4]);
});

test('group dragged below a top-level element block goes right below it', () => {
  const elements = [el('a', 0), el('b', 1, 'g1'), el('c', 2, 'g1'), el('d', 3, 'g2'), el('e', 4, 'g2')];
  const groups = [grp('g1'), grp('g2')];
  const out = moveGroupNextToElement(elements, groups, 'g2', 'a', 'below');
  assert.deepEqual(ids(out.elements), ['a', 'd', 'e', 'b', 'c'].slice(0, 1).length ? ['d', 'e', 'a', 'b', 'c'] : []);
});
