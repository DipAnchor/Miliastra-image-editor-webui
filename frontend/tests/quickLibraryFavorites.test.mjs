import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = (name) => ts.transpileModule(
  readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
).outputText;

const rotationUrl = moduleUrl(compile('rotation'));
const sceneUrl = moduleUrl(compile('sceneLayer'));
const selectionUrl = moduleUrl(compile('editorSelection').replace('"./rotation"', JSON.stringify(rotationUrl)).replace('"./sceneLayer"', JSON.stringify(sceneUrl)));
const maskUrl = moduleUrl(compile('luaMask'));
const objectsUrl = moduleUrl(compile('smartObjects').replace('"./rotation"', JSON.stringify(rotationUrl)).replace('"./editorSelection"', JSON.stringify(selectionUrl)).replace('"./luaMask"', JSON.stringify(maskUrl)));
const {
  CORE_SHAPE_TYPES,
  defaultQuickFavorites,
  favoriteKey,
  savedFavoriteKey,
  captureSavedFavorite,
  resolveSavedFavorite,
  favoritesHave,
  toggleQuickFavorite,
  sanitizeQuickFavorites
} = await import(moduleUrl(compile('quickLibraryFavorites').replace('"./smartObjects"', JSON.stringify(objectsUrl)).replace('"./luaMask"', JSON.stringify(maskUrl))));

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
  assert.equal(favoriteKey({ kind: 'saved', savedId: 's1', name: 'x' }), 'saved:legacy:["s1"]');
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
  assert.deepEqual(sanitizeQuickFavorites(raw).map(favoriteKey), ['asset:7', 'prefab:9', 'saved:legacy:["a"]']);
});

const leaf = (extra = {}) => ({
  id: 'leaf-a', name: 'Original', type: 'rectangle', x: 20, y: 30, width: 40, height: 50,
  rotation: 12, color: '#123456', opacity: .7, zIndex: 4, isBackground: false, ...extra
});
const group = (id, parentId = null, extra = {}) => ({
  id, name: id, parentId, visible: true, opacity: .8, collapsed: false, order: 0, ...extra
});
const object = () => ({
  id: 'shell', name: 'Object', type: 'smart-object', x: 100, y: 80, rotation: 30, scale: 1.5,
  opacity: .9, zIndex: 2, groupId: 'outside', visible: false, locked: true,
  content: { frame: { width: 100, height: 80 }, groups: [group('root'), group('sub', 'root')],
    elements: [leaf({ groupId: 'sub', textBox: { text: 'Frozen', fontSize: 24 }, luaMask: { enabled: true, imageId: 100001 } })] }
});
const rawFavorite = (element = leaf(), extra = {}) => ({
  kind: 'saved', savedId: 'saved-a', name: 'Frozen favorite', sourceCanvasId: 'canvas-a',
  snapshot: { version: 1, element }, ...extra
});
const normalizeSaved = value => {
  const result = sanitizeQuickFavorites([value]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'saved');
  return result[0];
};

test('saved favorite identities separate canvases, legacy ids and delimiter-shaped ids', () => {
  const a = rawFavorite();
  const b = { ...a, sourceCanvasId: 'canvas-b' };
  const legacy = { kind: 'saved', savedId: a.savedId, name: 'Legacy' };
  assert.equal(savedFavoriteKey(a), 'saved:["canvas-a","saved-a"]');
  assert.equal(savedFavoriteKey(legacy), 'saved:legacy:["saved-a"]');
  assert.equal(favoriteKey(a), savedFavoriteKey(a));
  assert.notEqual(favoriteKey(a), favoriteKey(b));
  assert.notEqual(favoriteKey(a), favoriteKey(legacy));
  assert.notEqual(savedFavoriteKey({ ...a, sourceCanvasId: 'a:b', savedId: 'c' }), savedFavoriteKey({ ...a, sourceCanvasId: 'a', savedId: 'b:c' }));
  assert.equal(sanitizeQuickFavorites([a, b, legacy, { ...a, name: 'Duplicate' }]).length, 3);
});

test('toggle removes only the same source identity and preserves another canvas favorite', () => {
  const a = rawFavorite();
  const b = { ...a, sourceCanvasId: 'canvas-b' };
  const added = toggleQuickFavorite(toggleQuickFavorite([], a), b);
  assert.equal(added.length, 2);
  assert.equal(favoritesHave(added, savedFavoriteKey(a)), true);
  assert.deepEqual(toggleQuickFavorite(added, { ...a, name: 'Renamed' }), [b]);
});

test('capture freezes all leaf payloads independently and only detaches the root group', () => {
  const source = { id: 'saved-a', name: 'Frozen name', element: leaf({ type: 'textbox', groupId: 'source-group', locked: true, visible: false,
    textBox: { text: 'Original text', fontSize: 30, scaleX: -1 }, luaMask: { enabled: true, imageId: 100001, offsetX: 7 } }) };
  const before = structuredClone(source);
  const favorite = captureSavedFavorite(source, 'canvas-a');
  assert.deepEqual(source, before);
  assert.equal(favorite.sourceCanvasId, 'canvas-a');
  assert.equal(favorite.snapshot.version, 1);
  assert.deepEqual(favorite.snapshot.element, { ...before.element, groupId: null });
  source.name = 'New name'; source.element.textBox.text = 'Changed source'; source.element.luaMask.offsetX = 90;
  assert.equal(favorite.name, 'Frozen name');
  assert.equal(favorite.snapshot.element.textBox.text, 'Original text');
  favorite.snapshot.element.luaMask.imageId = 100002;
  assert.equal(source.element.luaMask.imageId, 100001);
});

test('normalized snapshots and every resolve result own their nested data', () => {
  const raw = rawFavorite(leaf({ groupId: 'source-group', textBox: { text: 'Stored' }, luaMask: { imageId: 100001 } }));
  const before = structuredClone(raw);
  const normalized = normalizeSaved(raw);
  assert.deepEqual(raw, before);
  assert.equal(normalized.snapshot.element.groupId, null);
  raw.snapshot.element.textBox.text = 'Changed raw';
  assert.equal(normalized.snapshot.element.textBox.text, 'Stored');
  const first = resolveSavedFavorite(normalized), second = resolveSavedFavorite(normalized);
  first.textBox.text = 'Changed result'; first.luaMask.imageId = 100006;
  assert.equal(second.textBox.text, 'Stored'); assert.equal(second.luaMask.imageId, 100001);
  normalized.snapshot.element.textBox.text = 'Changed favorite';
  assert.equal(second.textBox.text, 'Stored');
});

test('legacy saved references retain their names and stay unresolved without guessed source', () => {
  const favorite = normalizeSaved({ kind: 'saved', savedId: 'same-id', name: 'Keep me' });
  assert.deepEqual(favorite, { kind: 'saved', savedId: 'same-id', name: 'Keep me' });
  assert.equal(resolveSavedFavorite(favorite), null);
  assert.deepEqual(toggleQuickFavorite([favorite], favorite), []);
});

test('missing or invalid source metadata cannot promote a legacy entry to a usable snapshot', () => {
  for (const sourceCanvasId of [undefined, null, '', 42, {}, []]) {
    assert.equal(resolveSavedFavorite(rawFavorite(leaf(), { sourceCanvasId })), null);
    const normalized = normalizeSaved(rawFavorite(leaf(), { sourceCanvasId }));
    assert.equal('sourceCanvasId' in normalized, false);
    assert.equal('snapshot' in normalized, false);
    assert.equal(resolveSavedFavorite(normalized), null);
  }
});

test('capture refuses malformed current items atomically and keeps the source unchanged', () => {
  for (const element of [leaf({ width: 0 }), leaf({ textBox: { text: 9 } }), { ...object(), scale: -1 }]) {
    const source = { id: 'saved-a', name: 'Original', element };
    const before = structuredClone(source);
    assert.throws(() => captureSavedFavorite(source, 'canvas-a'), /invalid saved favorite/);
    assert.deepEqual(source, before);
  }
  assert.throws(() => captureSavedFavorite({ id: '', name: 'Item', element: leaf() }, 'canvas-a'), /invalid saved favorite/);
  assert.throws(() => captureSavedFavorite({ id: 'saved-a', name: 'Item', element: leaf() }, ''), /invalid saved favorite/);
});

test('unknown, missing and malformed snapshots retain an unresolved favorite identity', () => {
  for (const snapshot of [undefined, null, [], {}, { version: 2, element: leaf() }, { version: '1', element: leaf() }, { version: 1 }, { version: 1, element: null }]) {
    const favorite = normalizeSaved(rawFavorite(leaf(), { snapshot }));
    assert.equal(favorite.name, 'Frozen favorite'); assert.equal(favorite.sourceCanvasId, 'canvas-a');
    assert.equal('snapshot' in favorite, false);
    assert.equal(resolveSavedFavorite(favorite), null);
  }
});

test('invalid leaf snapshots reject bad discriminants, required fields and nonfinite geometry', () => {
  for (const patch of [
    { id: '' }, { id: 5 }, { name: null }, { type: 'unknown' }, { type: undefined }, { color: null }, { isBackground: 'false' },
    { x: NaN }, { y: Infinity }, { width: 0 }, { height: -1 }, { width: '40' }, { rotation: undefined },
    { rotationX: Infinity }, { rotationY: '30' }, { opacity: -1 }, { opacity: 1.1 }, { zIndex: Infinity },
    { groupId: 4 }, { visible: 'true' }, { locked: 1 }, { textBox: [] }, { textBox: { fontSize: Infinity } },
    { textBox: { text: 4 } }, { luaMask: { imageId: 'bad' } }, { imageAssetId: Infinity }, { prefabId: 'bad' }
  ]) {
    const favorite = normalizeSaved(rawFavorite(leaf(patch)));
    assert.equal(resolveSavedFavorite(favorite), null, JSON.stringify(patch));
  }
});

test('smart object snapshots preserve nested content, visibility, masks and group references', () => {
  const source = { id: 'saved-object', name: 'Frozen object', element: object() };
  const original = structuredClone(source);
  const favorite = captureSavedFavorite(source, 'canvas-a');
  const normalized = normalizeSaved(JSON.parse(JSON.stringify(favorite)));
  const copy = resolveSavedFavorite(normalized);
  assert.deepEqual(copy, { ...original.element, groupId: null });
  assert.equal(copy.content.elements[0].groupId, 'sub');
  assert.equal(copy.content.groups[1].parentId, 'root');
  copy.content.groups[0].name = 'Changed group'; copy.content.elements[0].textBox.text = 'Changed text';
  source.element.content.frame.width = 999;
  assert.equal(favorite.snapshot.element.content.groups[0].name, 'root');
  assert.equal(favorite.snapshot.element.content.elements[0].textBox.text, 'Frozen');
  assert.equal(normalized.snapshot.element.content.frame.width, 100);
  assert.deepEqual(original.element.content.groups, source.element.content.groups);
});

test('invalid smart objects never become usable snapshots', () => {
  const mutations = [
    value => { value.scale = 0; }, value => { value.scale = Infinity; },
    value => { value.content.frame.width = 0; }, value => { value.content.frame.height = NaN; },
    value => { value.content.elements[0].width = Infinity; },
    value => { value.content.elements[0].type = 'unknown'; },
    value => { value.content.elements[0].groupId = 'missing'; },
    value => { value.content.groups[0].parentId = 'sub'; },
    value => { value.content.groups[1].parentId = 'missing'; },
    value => { value.content.elements[0].id = 'root'; },
    value => { value.content.groups[0].id = 4; },
    value => { value.content.groups[0].order = Infinity; },
    value => { value.content.elements.push(object()); },
    value => { value.width = 100; }, value => { value.content.groups = null; }
  ];
  for (const mutate of mutations) {
    const value = object(); mutate(value);
    const favorite = normalizeSaved(rawFavorite(value));
    assert.equal(resolveSavedFavorite(favorite), null);
  }
});

test('persisted malformed objects cannot poison another valid favorite or leave shared references', () => {
  const cyclic = leaf(); cyclic.extra = cyclic;
  const invalid = [leaf({ textBox: { text: () => 'bad' } }), leaf({ extra: 1n }), cyclic];
  for (const element of invalid) {
    const values = sanitizeQuickFavorites([rawFavorite(element), rawFavorite(leaf(), { savedId: 'valid' })]);
    assert.equal(values.length, 2);
    assert.equal(resolveSavedFavorite(values[0]), null);
    assert.equal(resolveSavedFavorite(values[1]).id, 'leaf-a');
  }
});

test('JSON round trips keep supported leaf types and resource references without embedding resources', () => {
  for (const type of [...CORE_SHAPE_TYPES, 'image', 'prefab', 'other']) {
    const favorite = captureSavedFavorite({ id: 'item', name: type, element: leaf({ type, imageAssetId: 100002, prefabId: 20001003, imageType: 'stretch' }) }, 'canvas');
    const result = resolveSavedFavorite(normalizeSaved(JSON.parse(JSON.stringify(favorite))));
    assert.equal(result.type, type); assert.equal(result.imageAssetId, 100002); assert.equal(result.prefabId, 20001003);
  }
});
