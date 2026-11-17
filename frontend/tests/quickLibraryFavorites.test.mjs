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
  CORE_SHAPE_TYPES,
  defaultQuickFavorites,
  favoriteKey,
  favoritesHave,
  toggleQuickFavorite,
  sanitizeQuickFavorites
} = await import(moduleUrl(compile('quickLibraryFavorites')));

test('default favorites are the 6 basic shapes plus textbox', () => {
  const favs = defaultQuickFavorites();
  assert.deepEqual(favs.map(favoriteKey), [
    'shape:ellipse','shape:rectangle','shape:triangle','shape:four_point_star','shape:five_point_star','shape:ring','shape:textbox'
  ]);
  assert.equal(CORE_SHAPE_TYPES.length, 7);
});

test('favoriteKey covers every kind', () => {
  assert.equal(favoriteKey({ kind: 'asset', assetId: 100001 }), 'asset:100001');
  assert.equal(favoriteKey({ kind: 'prefab', prefabId: 20001003, name: 'x' }), 'prefab:20001003');
  assert.equal(favoriteKey({ kind: 'saved', savedId: 's1', name: 'x' }), 'saved:s1');
});

test('toggle adds then removes by key', () => {
  let list = [];
  const fav = { kind: 'asset', assetId: 42 };
  list = toggleQuickFavorite(list, fav);
  assert.equal(list.length, 1);
  assert.equal(favoritesHave(list, 'asset:42'), true);
  list = toggleQuickFavorite(list, fav);
  assert.equal(list.length, 0);
});

test('sanitize migrates legacy string shape array', () => {
  assert.deepEqual(sanitizeQuickFavorites(['ring', 'ellipse', 'bogus']).map(favoriteKey), ['shape:ring', 'shape:ellipse']);
});

test('sanitize keeps empty array as intentional empty and falls back for non-array', () => {
  assert.deepEqual(sanitizeQuickFavorites([]), []);
  assert.deepEqual(sanitizeQuickFavorites(null).map(favoriteKey), defaultQuickFavorites().map(favoriteKey));
});

test('sanitize dedupes and drops invalid objects', () => {
  const raw = [
    { kind: 'asset', assetId: 7 },
    { kind: 'asset', assetId: 7 },
    { kind: 'asset', assetId: 'x' },
    { kind: 'prefab', prefabId: 9, name: 'P' },
    { kind: 'saved', savedId: 'a' },
    null,
    123
  ];
  assert.deepEqual(sanitizeQuickFavorites(raw).map(favoriteKey), ['asset:7', 'prefab:9', 'saved:a']);
});
