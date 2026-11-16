import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { duplicateInPlace } = await import(moduleUrl(compile('layerTree')));
const el = (id, zIndex, extra = {}) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false, visible: true, layerName: '', groupId: null, ...extra });
const ids = list => list.map(e => e.id);

test('duplicateInPlace inserts clones directly above originals and keeps groupId', () => {
  let n = 0; const makeId = () => `c${++n}`;
  const elements = [el('a', 0), el('b', 1, { groupId: 'g1' }), el('c', 2, { groupId: 'g1' }), el('d', 3)];
  const out = duplicateInPlace(elements, ['b'], makeId, 0);
  assert.deepEqual(ids(out.elements), ['a', 'b', 'c1', 'c', 'd']);
  assert.deepEqual(out.elements.map(e => e.zIndex), [0, 1, 2, 3, 4]);
  assert.equal(out.clones[0].groupId, 'g1');
});

test('duplicateInPlace multi offsets clones and keeps relative order', () => {
  let n = 0; const makeId = () => `c${++n}`;
  const out = duplicateInPlace([el('a', 0), el('b', 1), el('c', 2)], ['b', 'c'], makeId, 10);
  assert.deepEqual(ids(out.elements), ['a', 'b', 'c1', 'c', 'c2']);
  assert.deepEqual(out.clones.map(e => [e.x, e.y]), [[10, 10], [10, 10]]);
});
