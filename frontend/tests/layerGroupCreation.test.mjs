import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = name => ts.transpileModule(readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const sceneLayer = moduleUrl(compile('sceneLayer'));
const layerTree = moduleUrl(compile('layerTree').replace('"./sceneLayer"', JSON.stringify(sceneLayer)));
const { planLayerGroupCreation, parseCreateLayerGroupsArgs } = await import(moduleUrl(compile('layerGroupCreation')
  .replace('"./sceneLayer"', JSON.stringify(sceneLayer)).replace('"./layerTree"', JSON.stringify(layerTree))));
const el = (id, zIndex, groupId = null, extra = {}) => ({ id, name: id, type: 'rectangle', x: 2, y: 3, width: 10,
  height: 12, rotation: 15, color: '#123456', opacity: 0.7, zIndex, isBackground: false, visible: true, groupId, ...extra });
const grp = (id, parentId = null, extra = {}) => ({ id, name: id, parentId, visible: true, opacity: 1, collapsed: false, order: 0, ...extra });
const input = (key, elementIds, extra = {}) => ({ key, name: key, elementIds, ...extra });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function rejected(elements, groups, batch, code, details = {}) {
  const before = structuredClone({ elements, groups, batch });
  let allocations = 0;
  const out = planLayerGroupCreation(elements, groups, batch, () => { allocations++; return 'new-' + allocations; });
  assert.equal(out.ok, false);
  assert.equal(out.code, code);
  assert.equal(typeof out.error, 'string');
  assert.ok(out.error.length > 0);
  for (const [key, value] of Object.entries(details)) assert.deepEqual(out[key], value, key);
  assert.equal(allocations, 0);
  assert.deepEqual({ elements, groups, batch }, before);
  assert.equal('next' in out, false);
  return out;
}

test('creates an out-of-order nested tree in input order without moving original zIndex or arrays', () => {
  const elements = [el('overlay', 90), el('body', 4), el('eye', 25), el('horn', 9)];
  const batch = [input('eyes', ['eye'], { parent: { newGroupKey: 'slime' }, name: '  眼睛  ' }), input('slime', ['body', 'horn'], { name: '火史莱姆' })];
  const before = structuredClone({ elements, batch });
  const generated = ['group-eyes', 'group-slime'];
  const out = planLayerGroupCreation(elements, [], batch, () => generated.shift());
  assert.equal(out.ok, true);
  assert.equal(out.count, 2);
  assert.deepEqual(out.groups, [
    { key: 'eyes', id: 'group-eyes', name: '眼睛', parentId: 'group-slime' },
    { key: 'slime', id: 'group-slime', name: '火史莱姆', parentId: null }
  ]);
  assert.deepEqual(out.next.groups, out.groups.map(({ key, ...group }) => ({ ...group, visible: true, opacity: 1, collapsed: false, order: 0 })));
  assert.deepEqual(out.next.elements.map(e => [e.id, e.zIndex, e.groupId]), [
    ['overlay', 90, null], ['body', 4, 'group-slime'], ['eye', 25, 'group-eyes'], ['horn', 9, 'group-slime']
  ]);
  assert.equal(out.next.elements[0], elements[0]);
  assert.notEqual(out.next.elements[1], elements[1]);
  assert.deepEqual({ elements, batch }, before);
  out.groups[0].name = 'response mutation';
  assert.equal(out.next.groups[0].name, '眼睛');
});

test('rejects an entire batch before ID allocation and reports blockers in drawing order including hidden layers', () => {
  rejected([el('b', 25), el('hidden', 9, null, { visible: false }), el('a', 4)], [],
    [input('safe', ['hidden']), input('eyes', ['a', 'b'])], 'INTERLEAVED_LAYERS',
    { groupKey: 'eyes', elementIds: ['a', 'b'], blockingElementIds: ['hidden'] });
  rejected([el('b', 30), el('gap2', 20), el('a', 0), el('gap1', 10)], [],
    [input('eyes', ['b', 'a'])], 'INTERLEAVED_LAYERS', { blockingElementIds: ['gap1', 'gap2'] });
});

test('checks each child interval even when its parent envelope is continuous', () => {
  rejected([el('a', 0), el('middle', 1), el('b', 2)], [], [
    input('root', ['middle']), input('eyes', ['a', 'b'], { parent: { newGroupKey: 'root' } })
  ], 'INTERLEAVED_LAYERS', { groupKey: 'eyes', blockingElementIds: ['middle'] });
});

test('preserves frozen existing ancestry, masks, rich text and geometry under hidden half-opacity parent', () => {
  const mask = { enabled: true, imageId: 100001, imageType: "basic", reverseMaskArea: true, rotation: 20, offsetX: 3, offsetY: 4, width: 8, height: 9,
    enableSoftEdge: true, softEdgeMode: "Pixel", softEdgeWidthX: 2, softEdgeWidthY: 3, horizontalSoftRange: 85, verticalSoftRange: 85 };
  const elements = freeze([el('a', -20, 'existing', { luaMask: mask, textBox: { text: 'rich', runs: [{ text: 'rich' }] }, isBackground: true }),
    el('b', 80, 'existing', { visible: false }), el('other', 90)]);
  const groups = freeze([grp('ancestor', null, { visible: false }), grp('existing', 'ancestor', { opacity: 0.5 }), grp('empty', null, { order: -1000000004 })]);
  const batch = freeze([{ key: 'root', name: '同名', parent: { groupId: 'existing' } }, input('child', ['a', 'b'], { name: '同名', parent: { newGroupKey: 'root' } })]);
  let i = 0;
  const out = planLayerGroupCreation(elements, groups, batch, () => 'new-' + ++i);
  assert.equal(out.ok, true);
  assert.deepEqual(out.next.groups.slice(0, 3), groups);
  for (let j = 0; j < groups.length; j++) assert.equal(out.next.groups[j], groups[j]);
  assert.deepEqual(out.next.elements[0], { ...elements[0], groupId: 'new-2' });
  assert.deepEqual(out.next.elements[1], { ...elements[1], groupId: 'new-2' });
  assert.equal(out.next.elements[2], elements[2]);
  assert.deepEqual(out.groups.map(g => g.parentId), ['existing', 'new-1']);
});

test('zIndex ties use stable original array order and zIndex gaps are allowed', () => {
  const elements = [el('a', 4), el('b', 4), el('outside', 4)];
  assert.equal(planLayerGroupCreation(elements, [], [input('g', ['a', 'b'])], () => 'g').ok, true);
  rejected(elements, [], [input('g', ['a', 'outside'])], 'INTERLEAVED_LAYERS', { blockingElementIds: ['b'] });
});

test('requires original direct parent membership instead of accepting any ancestor or sibling group', () => {
  const groups = [grp('parent'), grp('child', 'parent'), grp('sibling', 'parent')];
  for (const [element, parent, expected, actual] of [
    [el('a', 0, 'child'), { groupId: 'parent' }, 'parent', 'child'],
    [el('a', 0, 'child'), undefined, null, 'child'],
    [el('a', 0, 'child'), { groupId: 'sibling' }, 'sibling', 'child'],
    [el('a', 0), { groupId: 'parent' }, 'parent', null]
  ]) rejected([element], groups, [{ key: 'g', name: 'g', elementIds: ['a'], ...(parent ? { parent } : {}) }],
    'PARENT_MISMATCH', { groupKey: 'g', expectedParentId: expected, actualParentId: actual, elementIds: ['a'] });
});

test('refuses member and inherited locks while allowing unrelated locked content', () => {
  rejected([el('a', 0, null, { locked: true })], [], [input('g', ['a'])], 'LOCKED');
  for (const lockedId of ['parent', 'ancestor']) rejected([el('a', 0, 'parent')],
    [grp('ancestor', null, { locked: lockedId === 'ancestor' }), grp('parent', 'ancestor', { locked: lockedId === 'parent' })],
    [input('g', ['a'], { parent: { groupId: 'parent' } })], 'LOCKED');
  const out = planLayerGroupCreation([el('a', 0), el('locked', 1, null, { locked: true })], [grp('empty', null, { locked: true })], [input('g', ['a'])], () => 'new');
  assert.equal(out.ok, true);
});

test('rejects duplicate keys and repeated members both within and across groups', () => {
  rejected([el('a', 0)], [], [input('g', ['a']), input('g', [])], 'DUPLICATE_KEY', { groupKey: 'g' });
  rejected([el('a', 0)], [], [input('g', ['a', 'a'])], 'DUPLICATE_MEMBER', { groupKey: 'g', elementIds: ['a'] });
  rejected([el('a', 0)], [], [input('g', ['a']), input('h', ['a'])], 'DUPLICATE_MEMBER', { groupKey: 'h', elementIds: ['a'] });
});

test('rejects unknown references, parent cycles, and invalid existing parent chains', () => {
  rejected([], [], [input('g', ['missing'])], 'UNKNOWN_ELEMENT', { elementIds: ['missing'] });
  rejected([el('a', 0)], [], [input('g', ['a'], { parent: { groupId: 'missing' } })], 'UNKNOWN_PARENT');
  rejected([el('a', 0)], [], [input('g', ['a'], { parent: { newGroupKey: 'missing' } })], 'UNKNOWN_PARENT');
  rejected([el('a', 0)], [], [input('g', ['a'], { parent: { newGroupKey: 'g' } })], 'PARENT_CYCLE');
  rejected([el('a', 0)], [], [input('g', ['a'], { parent: { newGroupKey: 'h' } }), { key: 'h', name: 'h', parent: { newGroupKey: 'g' } }], 'PARENT_CYCLE');
  rejected([el('a', 0, 'p')], [grp('p', 'missing')], [input('g', ['a'], { parent: { groupId: 'p' } })], 'UNKNOWN_PARENT');
  rejected([el('a', 0, 'p')], [grp('p', 'q'), grp('q', 'p')], [input('g', ['a'], { parent: { groupId: 'p' } })], 'PARENT_CYCLE');
});

test('rejects every empty subtree before interval checking', () => {
  rejected([], [], [{ key: 'empty', name: 'empty' }], 'EMPTY_GROUP', { groupKey: 'empty' });
  rejected([el('a', 0), el('gap', 1), el('b', 2)], [], [input('root', ['a', 'b']), { key: 'empty-child', name: 'empty', parent: { newGroupKey: 'root' } }],
    'EMPTY_GROUP', { groupKey: 'empty-child' });
});

test('rejects smart-object shells and never resolves their local member IDs', () => {
  const shell = { ...el('shell', 0), type: 'smart-object', content: { frame: { width: 10, height: 10 }, elements: [el('local', 0)], groups: [grp('local-group')] }, scale: 1 };
  rejected([shell], [], [input('g', ['shell'])], 'UNSUPPORTED_MEMBER', { elementIds: ['shell'] });
  rejected([shell], [], [input('g', ['local'])], 'UNKNOWN_ELEMENT', { elementIds: ['local'] });
  rejected([shell], [], [input('g', [], { parent: { groupId: 'local-group' } })], 'UNKNOWN_PARENT');
  assert.throws(() => planLayerGroupCreation([shell, el('a', 1)], [], [input('g', ['a'])], () => 'local'), /duplicate|empty/);
});

test('ID allocator rejects scene collisions and repeated or empty generated IDs atomically', () => {
  const elements = [el('a', 0), el('b', 1)];
  const batch = [input('g', ['a']), input('h', ['b'])];
  const before = structuredClone(elements);
  for (const id of ['a', 'existing', '', 'same']) {
    assert.throws(() => planLayerGroupCreation(elements, [grp('existing')], batch, () => id), /duplicate|empty/);
    assert.deepEqual(elements, before);
  }
});

test('runtime parser accepts exact keys and IDs, trims only names, and returns detached inputs', () => {
  const args = freeze({ groups: [{ key: ' key ', name: '  名称  ', elementIds: [' id '], parent: { newGroupKey: ' root ' } }, { key: ' root ', name: '名称' }] });
  const parsed = parseCreateLayerGroupsArgs(args);
  assert.deepEqual(parsed, [{ key: ' key ', name: '名称', elementIds: [' id '], parent: { newGroupKey: ' root ' } }, { key: ' root ', name: '名称' }]);
  assert.notEqual(parsed, args.groups);
  assert.notEqual(parsed[0].parent, args.groups[0].parent);
  assert.notEqual(parsed[0].elementIds, args.groups[0].elementIds);
});

test('resolves several forward parent links and preserves whitespace in IDs and keys', () => {
  const batch = [input(' leaf ', [' a '], { parent: { newGroupKey: 'middle' } }),
    { key: 'middle', name: 'middle', parent: { newGroupKey: ' root ' } }, { key: ' root ', name: 'root' }];
  let i = 0;
  const out = planLayerGroupCreation([el(' a ', 0)], [], freeze(batch), () => 'id-' + ++i);
  assert.equal(out.ok, true);
  assert.deepEqual(out.groups.map(g => [g.key, g.parentId]), [[' leaf ', 'id-2'], ['middle', 'id-3'], [' root ', null]]);
  assert.equal(out.next.elements[0].groupId, 'id-1');
});

test('refuses ambiguous duplicate scene IDs without allocating or modifying the scene', () => {
  rejected([el('a', 0), el('a', 1)], [], [input('g', ['a'])], 'INVALID_INPUT');
  rejected([el('a', 0)], [grp('p'), grp('p')], [input('g', ['a'])], 'INVALID_INPUT');
});


const invalidArgs = [null, [], {}, { groups: [] }, { groups: 'bad' }, { groups: [null] }, { groups: [[]] },
  { groups: [{ key: 'g', name: 'g' }], unknown: true },
  ...[{ name: 'g' }, { key: '', name: 'g' }, { key: 2, name: 'g' }, { key: 'g' }, { key: 'g', name: ' ' },
    { key: 'g', name: 2 }, { key: 'g', name: 'g', unknown: true },
    ...[null, undefined, [], {}, { groupId: 'p', newGroupKey: 'k' }, { groupId: 'p', other: true }, { groupId: '' }, { newGroupKey: 2 }]
      .map(parent => ({ key: 'g', name: 'g', parent })),
    ...[null, undefined, 'a', [1], [''], new Array(1)].map(elementIds => ({ key: 'g', name: 'g', elementIds }))]
    .map(group => ({ groups: [group] }))];
for (const [index, args] of invalidArgs.entries()) test('runtime parser rejects malformed args #' + index, () => {
  assert.throws(() => parseCreateLayerGroupsArgs(args), Error);
  if (args && !Array.isArray(args) && Object.keys(args).length === 1 && 'groups' in args) {
    rejected([el('a', 0)], [], args.groups, 'INVALID_INPUT');
  }
});
