import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { groupElements } = await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const el = (id, zIndex, groupId = null) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId });
const grp = (id, parentId = null, order = 0) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order });

test('nested grouping inherits common parent group', () => {
  const elements = [el('a', 0), el('b', 1, 'g1'), el('c', 2, 'g1'), el('d', 3)];
  const groups = [grp('g1')];
  const out = groupElements(elements, groups, ['b', 'c'], 'g2', '子组');
  const g2 = out.groups.find(g => g.id === 'g2');
  assert.equal(g2.parentId, 'g1');
  assert.equal(out.elements.find(e => e.id === 'b').groupId, 'g2');
});

test('top-level grouping keeps parentId null', () => {
  const out = groupElements([el('a', 0), el('b', 1)], [], ['a', 'b'], 'g9');
  assert.equal(out.groups[0].parentId, null);
});
