import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { appendScene } = await import(moduleUrl(compile('importScene').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const el = (id, zIndex) => ({ id, name: id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex, isBackground: false });

test('appendScene appends incoming elements after current and reindexes', () => {
  let n = 0; const makeId = () => `n${++n}`;
  const out = appendScene([el('a', 0)], [el('x', 0)], makeId);
  assert.equal(out.elements.length, 2);
  assert.equal(out.elements[0].id, 'a');
  assert.notEqual(out.elements[1].id, 'x');
  assert.deepEqual(out.elements.map(e => e.zIndex), [0, 1]);
});
