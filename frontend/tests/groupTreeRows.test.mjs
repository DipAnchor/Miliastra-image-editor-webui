import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const { groupTreeRows } = await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const el = (id, zIndex, groupId = null) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId });
const grp = (id, parentId = null, extra = {}) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order: 0, ...extra });
const sig = rows => rows.map(r => r.kind === 'group' ? `G:${r.group.id}@${r.depth}` : `E:${r.element.id}@${r.depth}`);

test('groupTreeRows returns top-to-bottom tree with group headers before children', () => {
  const elements = [el('a', 0), el('b', 1, 'g1'), el('c', 2, 'g2'), el('d', 3)];
  const groups = [grp('g1'), grp('g2', 'g1')];
  assert.deepEqual(sig(groupTreeRows(elements, groups)), ['E:d@0', 'G:g1@0', 'G:g2@1', 'E:c@2', 'E:b@1', 'E:a@0']);
});

test('collapsed group hides its descendants', () => {
  const elements = [el('a', 0), el('b', 1, 'g1'), el('c', 2, 'g2'), el('d', 3)];
  const groups = [grp('g1', null, { collapsed: true }), grp('g2', 'g1')];
  assert.deepEqual(sig(groupTreeRows(elements, groups)), ['E:d@0', 'G:g1@0', 'E:a@0']);
});
