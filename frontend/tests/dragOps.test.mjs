import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const { reparentGroup, moveElementIntoGroup, moveElementNextTo } = await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const el = (id, zIndex, groupId = null) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId });
const grp = (id, parentId = null) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order: 0 });
const ids = list => list.map(e => e.id);
const g = (id, list) => list.find(x => x.id === id);

test('moveElementIntoGroup joins target group and places on top of it', () => {
  const elements = [el('a', 0), el('b', 1, 'g1'), el('c', 2, 'g1')];
  const out = moveElementIntoGroup(elements, [grp('g1')], 'a', 'g1');
  assert.deepEqual(ids(out), ['b', 'c', 'a']);
  assert.equal(g('a', out).groupId, 'g1');
  assert.deepEqual(out.map(e => e.zIndex), [0, 1, 2]);
});

test('moveElementNextTo above places directly above target within its group', () => {
  const elements = [el('a', 0), el('b', 1), el('c', 2)];
  const out = moveElementNextTo(elements, [], 'a', 'b', 'above');
  assert.deepEqual(ids(out), ['b', 'a', 'c']);
});

test('reparentGroup nests group and rejects cycles/self', () => {
  const groups = [grp('g1'), grp('g2')];
  const nested = reparentGroup(groups, 'g2', 'g1');
  assert.equal(g('g2', nested).parentId, 'g1');
  // cycle: g1 -> g2 would be invalid because g2 now child of g1
  assert.equal(g('g2', reparentGroup(nested, 'g1', 'g2')).parentId, 'g1'); // unchanged
  assert.equal(g('g1', reparentGroup(nested, 'g1', 'g1')).parentId, null); // self rejected
  // detach to root
  assert.equal(g('g2', reparentGroup(nested, 'g2', null)).parentId, null);
});
