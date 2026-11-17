import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
  clear: () => { store.clear(); },
};

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = (name) => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const {
  addArchive, loadArchives, renameArchive, removeArchive, pruneArchives,
  saveAutoArchive, loadAutoArchive, removeAutoArchive, loadCurrentCanvasId, persistCurrentCanvasId,
} = await import(moduleUrl(compile('archives')));

const scene = (mark) => ({ canvas: { width: 10, height: 10, background: '#000000' }, elements: [{ id: mark }], meta: { sourceType: 'editor', sourceName: mark, warnings: [] } });
const reset = () => { store.clear(); };

test('addArchive identifies archives by canvasId, updates name/time, keeps one row', () => {
  reset();
  addArchive(scene('v1'), '作品', 100, 'id-a');
  let list = loadArchives();
  assert.equal(list.length, 1);
  assert.equal(list[0].canvasId, 'id-a');
  addArchive(scene('v2'), '作品改名', 200, 'id-a');
  list = loadArchives();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, '作品改名');
  assert.equal(list[0].savedAt, 200);
  assert.equal(list[0].scene.elements[0].id, 'v2');
});

test('different canvasId creates a separate archive and sorts by last modified desc', () => {
  reset();
  addArchive(scene('a'), 'A', 100, 'id-a');
  addArchive(scene('b'), 'B', 300, 'id-b');
  const list = loadArchives();
  assert.deepEqual(list.map((item) => item.name), ['B', 'A']);
});

test('renameArchive changes display name but not identity', () => {
  reset();
  addArchive(scene('a'), 'A', 100, 'id-a');
  renameArchive('id-a', 'A-改名');
  const list = loadArchives();
  assert.equal(list[0].name, 'A-改名');
  assert.equal(list[0].canvasId, 'id-a');
});

test('removeArchive and pruneArchives', () => {
  reset();
  addArchive(scene('a'), 'A', 100, 'id-a');
  addArchive(scene('b'), 'B', 200, 'id-b');
  const removed = removeArchive(loadArchives()[0].id);
  assert.equal(removed.length, 1);
  assert.equal(pruneArchives(loadArchives().concat(loadArchives()), 1).length, 1);
});

test('auto archive is one record per canvasId and removable', () => {
  reset();
  saveAutoArchive({ canvasId: 'id-a', name: 'A', savedAt: 100, scene: scene('x') });
  saveAutoArchive({ canvasId: 'id-a', name: 'A2', savedAt: 200, scene: scene('y') });
  assert.equal(loadAutoArchive('id-a').savedAt, 200);
  saveAutoArchive({ canvasId: 'id-b', name: 'B', savedAt: 300, scene: scene('z') });
  assert.equal(loadAutoArchive('id-b').name, 'B');
  removeAutoArchive('id-a');
  assert.equal(loadAutoArchive('id-a'), null);
  assert.equal(loadAutoArchive('id-b').name, 'B');
});

test('current canvas id persists and is reused across loads', () => {
  reset();
  const id = loadCurrentCanvasId();
  assert.ok(id);
  assert.equal(loadCurrentCanvasId(), id);
  persistCurrentCanvasId('fixed-id');
  assert.equal(loadCurrentCanvasId(), 'fixed-id');
});
