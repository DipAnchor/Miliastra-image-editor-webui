import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = name => ts.transpileModule(readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const sceneUrl = url(compile('sceneLayer'));
const { cloneSceneLayers, collectSceneIds, sceneLayerSize } = await import(sceneUrl);
const withScene = name => compile(name).replace('"./sceneLayer"', JSON.stringify(sceneUrl));
const selectionUrl = url(withScene('editorSelection').replace('"./rotation"', JSON.stringify(url(compile('rotation')))));
const { selectionBounds, intersectsSelection, cloneSelection, translateSelection } = await import(selectionUrl);
const { normalizeElementsLayers, duplicateInPlace, duplicateGroups, groupTreeRows, visibleForExport, effectiveLocked, effectiveGroupOpacity } = await import(url(withScene('layerTree')));
const { appendScene } = await import(url(withScene('importScene')));
const leaf = (id, extra = {}) => ({ id, name: id, type: 'rectangle', x: 10, y: 20, width: 20, height: 10, rotation: 0, color: '#ffffff', opacity: 1, zIndex: 0, isBackground: false, ...extra });
const group = (id, parentId = null, extra = {}) => ({ id, name: id, parentId, opacity: 1, visible: true, collapsed: false, order: 0, ...extra });
const object = (id = 'obj', extra = {}) => ({
  id, name: id, type: 'smart-object', x: 100, y: 80, scale: 2, rotation: 0, opacity: .8, zIndex: 1,
  content: { frame: { width: 40, height: 20 }, groups: [group('inner-root'), group('inner-sub', 'inner-root')],
    elements: [leaf('inner-a', { groupId: 'inner-root', textBox: { text: 'original' } }), leaf('inner-b', { groupId: 'inner-sub', zIndex: 1, luaMask: { imageId: 100002 } })] }, ...extra
});
const generator = () => { let n = 0; return () => 'new-' + ++n; };
const assertFreshObject = (source, clone) => {
  const originals = collectSceneIds([source]);
  const copied = [clone.id, ...clone.content.groups.map(g => g.id), ...clone.content.elements.map(e => e.id)];
  assert.equal(new Set(copied).size, copied.length);
  assert.ok(copied.every(id => !originals.has(id)));
  assert.equal(clone.content.groups[1].parentId, clone.content.groups[0].id);
  assert.equal(clone.content.elements[0].groupId, clone.content.groups[0].id);
  assert.equal(clone.content.elements[1].groupId, clone.content.groups[1].id);
  assert.deepEqual(clone.content.frame, source.content.frame);
  assert.notEqual(clone.content.frame, source.content.frame);
  assert.notEqual(clone.content.elements[0].textBox, source.content.elements[0].textBox);
  assert.notEqual(clone.content.elements[1].luaMask, source.content.elements[1].luaMask);
  assert.equal('width' in clone, false);
  assert.equal('color' in clone, false);
};

test('object selection uses frame times scale, rotated shell bounds and SAT', () => {
  const obj = object();
  assert.deepEqual(sceneLayerSize(obj), { width: 80, height: 40 });
  assert.deepEqual(selectionBounds([obj]), { x: 60, y: 60, width: 80, height: 40 });
  assert.deepEqual(selectionBounds([{ ...obj, rotation: 90 }]), { x: 80, y: 40, width: 40, height: 80 });
  assert.equal(intersectsSelection(obj, { x: 59, y: 70, width: 2, height: 2 }), true);
  assert.equal(intersectsSelection(obj, { x: 55, y: 70, width: 2, height: 2 }), false);
  assert.ok(Object.values(selectionBounds([{ ...obj, rotation: 37 }])).every(Number.isFinite));
  const moved = translateSelection([obj], [obj.id], 4, -3)[0];
  assert.equal(moved.x, 104); assert.equal(moved.y, 77);
  assert.equal(moved.content, obj.content);
});

test('normalization only fills common fields, keeps content and does not pollute object shells', () => {
  const obj = object();
  const normalized = normalizeElementsLayers([obj])[0];
  assert.deepEqual(Object.keys(normalized).sort(), [...Object.keys(obj), 'visible', 'layerName', 'groupId'].sort());
  assert.equal(normalized.content, obj.content);
  assert.equal(normalized.visible, true); assert.equal(normalized.layerName, ''); assert.equal(normalized.groupId, null);
  assert.equal(normalizeElementsLayers([normalized])[0], normalized);
  assert.equal('width' in normalized, false); assert.equal('color' in normalized, false);
});

test('selection copy remaps all internal object ids and changes only shell geometry', () => {
  const source = object();
  const [copy] = cloneSelection([source], generator(), 20, 10);
  assertFreshObject(source, copy);
  assert.deepEqual([copy.x, copy.y, copy.zIndex], [110, 90, 20]);
  assert.deepEqual(copy.content.elements.map(e => [e.x, e.y]), source.content.elements.map(e => [e.x, e.y]));
  copy.content.elements[0].textBox.text = 'changed';
  assert.equal(source.content.elements[0].textBox.text, 'original');
});

test('in-place copy preserves outer membership and shares no object internals', () => {
  const source = object('obj', { groupId: 'outer' });
  const scene = [leaf('before'), source, leaf('after', { zIndex: 2 })];
  const output = duplicateInPlace(scene, [source.id], generator(), 5);
  const [clone] = output.clones;
  assertFreshObject(source, clone);
  assert.equal(clone.groupId, 'outer');
  assert.deepEqual(output.elements.map(e => e.id), ['before', 'obj', clone.id, 'after']);
  assert.deepEqual([clone.x, clone.y], [105, 85]);
  assert.deepEqual(output.elements.map(e => e.zIndex), [0, 1, 2, 3]);
});

test('group duplication remaps outer and internal hierarchy in one unique namespace', () => {
  const groups = [group('parent'), group('root', 'parent'), group('child', 'root')];
  const obj = object('obj', { groupId: 'child' });
  const plain = leaf('plain', { groupId: 'root' });
  const output = duplicateGroups([plain, obj], groups, ['root', 'child'], generator());
  const rootCopy = output.groupClones[0];
  const childCopy = output.groups.find(g => g.id !== 'child' && g.parentId === rootCopy.id);
  assert.equal(rootCopy.parentId, 'parent');
  assert.equal(rootCopy.name, 'root copy');
  assert.equal(output.groupClones.length, 1);
  assert.equal(output.clones.find(e => e.type === 'rectangle').groupId, rootCopy.id);
  const objCopy = output.clones.find(e => e.type === 'smart-object');
  assert.equal(objCopy.groupId, childCopy.id);
  assertFreshObject(obj, objCopy);
  const originalIds = collectSceneIds([plain, obj], groups);
  const copiedIds = [rootCopy.id, childCopy.id, ...collectSceneIds(output.clones)];
  assert.ok(copiedIds.every(id => !originalIds.has(id)));
  assert.equal(new Set([rootCopy.id, childCopy.id, objCopy.id, ...objCopy.content.groups.map(g => g.id), ...objCopy.content.elements.map(e => e.id), output.clones[0].id]).size, 8);
});

test('clipboard payload clones preserve nested groups across repeated pastes', () => {
  const obj = object('obj', { groupId: 'child' });
  const groups = [group('root'), group('child', 'root')];
  const first = cloneSceneLayers([obj], groups, generator(), { startZ: 5, offset: 10 });
  const second = cloneSceneLayers([obj], groups, (() => { let n = 30; return () => 'new-' + ++n; })(), { occupiedIds: collectSceneIds(first.elements, first.groups), preserveExternalGroups: false });
  for (const result of [first, second]) {
    assert.equal(result.groups[1].parentId, result.groups[0].id);
    assert.equal(result.elements[0].groupId, result.groups[1].id);
    assertFreshObject(obj, result.elements[0]);
  }
  const firstIds = collectSceneIds(first.elements, first.groups);
  assert.ok([...collectSceneIds(second.elements, second.groups)].every(id => !firstIds.has(id)));
});

test('append import preserves incoming z-order, nested groups and deep object content', () => {
  const currentGroups = [group('root')];
  const current = [leaf('existing', { groupId: 'root', zIndex: 3 })];
  const incoming = [object('obj', { groupId: 'child', zIndex: 10 }), leaf('imported', { groupId: 'root', zIndex: 2 })];
  const incomingGroups = [group('root'), group('child', 'root')];
  const output = appendScene(current, incoming, generator(), currentGroups, incomingGroups);
  const [newRoot, newChild] = output.groups.slice(1);
  assert.equal(output.groups[0], currentGroups[0]);
  assert.equal(newChild.parentId, newRoot.id);
  assert.equal(output.elements[1].type, 'rectangle');
  assert.equal(output.elements[1].groupId, newRoot.id);
  assert.equal(output.elements[2].groupId, newChild.id);
  assertFreshObject(incoming[0], output.elements[2]);
  assert.deepEqual(output.elements.map(e => e.zIndex), [0, 1, 2]);
  assert.equal(incoming[0].groupId, 'child');
});

test('append does not accidentally attach dangling incoming group links to existing groups', () => {
  const output = appendScene([], [leaf('a', { groupId: 'existing' })], generator(), [group('existing')]);
  assert.equal(output.elements[0].groupId, null);
});

test('all clone routes reject occupied, source-local, duplicate and empty ids atomically', () => {
  const obj = object();
  const before = structuredClone(obj);
  for (const makeId of [() => '', () => 'inner-a', () => 'same']) {
    assert.throws(() => cloneSelection([obj], makeId, 0), /duplicate or empty id/);
    assert.throws(() => duplicateInPlace([obj], ['obj'], makeId), /duplicate or empty id/);
    assert.throws(() => duplicateGroups([{ ...obj, groupId: 'root' }], [group('root')], ['root'], makeId), /duplicate or empty id/);
  }
  assert.throws(() => appendScene([leaf('existing')], [obj], () => 'existing'), /duplicate or empty id/);
  assert.throws(() => cloneSceneLayers([obj], [], () => 'occupied', { occupiedIds: ['occupied'] }), /duplicate or empty id/);
  assert.deepEqual(obj, before);
});

test('common visibility, locking, opacity and tree operations treat objects as one layer', () => {
  const groups = [group('root', null, { opacity: .5, locked: true }), group('child', 'root')];
  const obj = object('obj', { groupId: 'child' });
  const map = new Map(groups.map(g => [g.id, g]));
  assert.equal(effectiveLocked(obj, map), true);
  assert.equal(effectiveGroupOpacity(obj, map), .4);
  const rows = groupTreeRows([obj], groups);
  assert.deepEqual(rows.map(row => row.kind), ['group', 'group', 'element']);
  assert.equal(rows[2].element, obj);
  assert.equal(rows[2].depth, 2);
  assert.equal(visibleForExport([obj], groups).length, 1);
  assert.equal(visibleForExport([obj], [{ ...groups[0], visible: false }, groups[1]]).length, 0);
});

test('duplicate group roots are deduplicated and missing selections create no phantom groups', () => {
  const groups = [group('empty')];
  const output = duplicateGroups([], groups, ['empty', 'empty', 'missing'], generator());
  assert.equal(output.groups.length, 2);
  assert.equal(output.groupClones.length, 1);
  assert.equal(output.groupClones[0].name, 'empty copy');
  assert.equal(output.clones.length, 0);
  assert.equal(output.groupClones[0].parentId, null);
  assert.notEqual(output.groupClones[0], groups[0]);
});

test('group copies preserve z-order even when the source array is unsorted', () => {
  const groups = [group('root')];
  const elements = [leaf('upper', { zIndex: 2, groupId: 'root' }), leaf('outside', { zIndex: 0 }), leaf('lower', { zIndex: 1, groupId: 'root' })];
  const output = duplicateGroups(elements, groups, ['root'], generator());
  assert.deepEqual(output.clones.map(e => e.name), ['lower', 'upper']);
  assert.deepEqual(output.elements.map(e => e.name), ['outside', 'lower', 'upper', 'lower', 'upper']);
  const clipboard = cloneSceneLayers(elements, [], generator(), { startZ: 20 });
  assert.deepEqual(clipboard.elements.map(e => [e.name, e.zIndex]), [['outside', 20], ['lower', 21], ['upper', 22]]);
});

test('destination reservations include unselected elements and empty groups', () => {
  assert.throws(() => duplicateInPlace([leaf('chosen'), leaf('other')], ['chosen'], () => 'other'), /duplicate or empty id/);
  assert.throws(() => duplicateInPlace([leaf('chosen')], ['chosen'], () => 'empty', 0, [group('empty')]), /duplicate or empty id/);
  assert.throws(() => cloneSelection([leaf('chosen')], () => 'empty', 0, 0, ['empty']), /duplicate or empty id/);
  assert.throws(() => appendScene([], [leaf('chosen')], () => 'empty', [group('empty')]), /duplicate or empty id/);
});

test('ordinary leaf clones preserve optional-field absence and deep masks', () => {
  const source = leaf('plain', { luaMask: { imageId: 100002 }, textBox: { text: 'hello' } });
  const [copy] = cloneSelection([source], generator(), 7, 0);
  assert.equal(Object.hasOwn(copy, 'groupId'), false);
  assert.deepEqual({ ...copy, id: source.id, zIndex: source.zIndex }, source);
  assert.notEqual(copy.luaMask, source.luaMask);
  assert.notEqual(copy.textBox, source.textBox);
});
