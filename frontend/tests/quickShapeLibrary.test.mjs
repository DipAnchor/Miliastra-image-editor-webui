import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = (name) => ts.transpileModule(
  readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
).outputText;

const {
  QUICK_SHAPE_TYPES,
  DEFAULT_FAVORITE_TYPES,
  isQuickShapeType,
  sanitizeFavorites,
  toggleFavorite,
  sanitizeLayout
} = await import(moduleUrl(compile('quickShapeLibrary')));

test('default favorites are the 6 basic shapes plus textbox', () => {
  assert.deepEqual(DEFAULT_FAVORITE_TYPES, [
    'ellipse', 'rectangle', 'triangle', 'four_point_star', 'five_point_star', 'ring', 'textbox'
  ]);
  assert.deepEqual([...QUICK_SHAPE_TYPES], [...DEFAULT_FAVORITE_TYPES]);
});

test('sanitizeFavorites falls back to defaults when not an array', () => {
  assert.deepEqual(sanitizeFavorites(undefined), [...DEFAULT_FAVORITE_TYPES]);
  assert.deepEqual(sanitizeFavorites(null), [...DEFAULT_FAVORITE_TYPES]);
  assert.deepEqual(sanitizeFavorites('ring'), [...DEFAULT_FAVORITE_TYPES]);
});

test('sanitizeFavorites keeps empty array as intentional empty', () => {
  assert.deepEqual(sanitizeFavorites([]), []);
});

test('sanitizeFavorites drops unknown types and de-duplicates, preserving order', () => {
  assert.deepEqual(sanitizeFavorites(['ring', 'bogus', 'ellipse', 'ring', 42]), ['ring', 'ellipse']);
});

test('toggleFavorite adds to the end then removes', () => {
  const base = [...DEFAULT_FAVORITE_TYPES];
  const added = toggleFavorite(base, 'ring'); // already present -> removed
  assert.equal(added.includes('ring'), false);
  const withRing = toggleFavorite(added, 'ring');
  assert.deepEqual(withRing[withRing.length - 1], 'ring');
  // 不修改入参
  assert.deepEqual(base, [...DEFAULT_FAVORITE_TYPES]);
});

test('isQuickShapeType whitelist', () => {
  assert.equal(isQuickShapeType('textbox'), true);
  assert.equal(isQuickShapeType('image'), false);
  assert.equal(isQuickShapeType(123), false);
});

test('sanitizeLayout only accepts grid', () => {
  assert.equal(sanitizeLayout('grid'), 'grid');
  assert.equal(sanitizeLayout('list'), 'list');
  assert.equal(sanitizeLayout('nonsense'), 'list');
  assert.equal(sanitizeLayout(null), 'list');
});
