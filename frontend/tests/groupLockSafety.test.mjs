import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = name => ts.transpileModule(readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { normalizeGroups, groupHasLockedContent } = await import(moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(moduleUrl(compile('sceneLayer'))))));
const group = (id, parentId = null, extra = {}) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order: 0, ...extra });
const leaf = (id, groupId = null, extra = {}) => ({ id, name: id, type: 'rectangle', x: 20, y: 20, width: 10, height: 10, rotation: 0, color: '#000000', opacity: 1, zIndex: 0, isBackground: false, groupId, ...extra });

test('normalizing groups preserves explicit true/false locks without inventing absent or invalid fields', () => {
  const source = [group('locked', null, { locked: true }), group('unlocked', null, { locked: false }), group('absent'), group('invalid', null, { locked: 'true' })];
  const snapshot = structuredClone(source);
  const result = normalizeGroups(source);
  assert.equal(result[0].locked, true);
  assert.equal(result[1].locked, false);
  assert.equal(Object.hasOwn(result[2], 'locked'), false);
  assert.equal(Object.hasOwn(result[3], 'locked'), false);
  assert.deepEqual(source, snapshot);
});

test('an unlocked group, including an unlocked empty group, remains editable', () => {
  assert.equal(groupHasLockedContent([leaf('a', 'parent')], [group('parent'), group('empty', 'parent', { locked: false })], 'parent'), false);
  assert.equal(groupHasLockedContent([], [group('empty')], 'empty'), false);
});

test('a group inherits protection from its own lock and every ancestor', () => {
  const groups = [group('outer', null, { locked: true }), group('inner', 'outer')];
  assert.equal(groupHasLockedContent([], groups, 'outer'), true);
  assert.equal(groupHasLockedContent([], groups, 'inner'), true);
});

test('locked leaves and empty locked descendants protect their full ancestor structure', () => {
  const groups = [group('parent'), group('child', 'parent'), group('other')];
  const elements = [leaf('a', 'child', { locked: true }), leaf('b', 'other')];
  assert.equal(groupHasLockedContent(elements, groups, 'parent'), true);
  assert.equal(groupHasLockedContent(elements, groups, 'child'), true);
  assert.equal(groupHasLockedContent(elements, groups, 'other'), false);
  assert.equal(groupHasLockedContent([], [group('parent'), group('empty', 'parent', { locked: true })], 'parent'), true);
});

test('protection checks do not mutate source data and safely terminate on cyclic ancestry', () => {
  const groups = [group('a', 'b'), group('b', 'a')];
  const elements = [leaf('item', 'a')];
  const snapshot = structuredClone({ groups, elements });
  assert.equal(groupHasLockedContent(elements, groups, 'a'), false);
  assert.deepEqual({ groups, elements }, snapshot);
});
