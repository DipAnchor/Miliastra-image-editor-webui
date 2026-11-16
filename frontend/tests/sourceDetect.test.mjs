import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { detectSourceType } = await import(moduleUrl(compile('sourceType')));

test('detect JSON object and array', () => {
  assert.equal(detectSourceType('{"canvas":{}}'), 'json');
  assert.equal(detectSourceType('[1,2]'), 'json');
});
test('detect SVG', () => {
  assert.equal(detectSourceType('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'svg');
});
test('detect Lua by marker or local tables', () => {
  assert.equal(detectSourceType('-- MILIASTRA_EDITOR_SCENE_V1 abc\nlocal ROOT = {}\nlocal ELEMENTS = {}'), 'lua');
  assert.equal(detectSourceType('local ROOT = {}\nlocal ELEMENTS = {}'), 'lua');
});
test('detect CSS', () => {
  assert.equal(detectSourceType('.shaper-container { position: relative; width: 10px; }'), 'css');
  assert.equal(detectSourceType(':root { --a: 1; }'), 'css');
});
test('file extension wins and empty/unknown are null', () => {
  assert.equal(detectSourceType('anything', 'a.svg'), 'svg');
  assert.equal(detectSourceType('local ROOT = {}', 'a.lua'), 'lua');
  assert.equal(detectSourceType('', 'a.json'), 'json');
  assert.equal(detectSourceType('hello world'), null);
});
