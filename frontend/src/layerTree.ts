import type { SceneDocument, SceneElement, SceneGroup } from "./App";
import { cloneSceneLayer, collectSceneIds, createSceneIdAllocator } from "./sceneLayer";

/**
 * 图层模块纯逻辑（无 React 依赖，便于 node --test 覆盖）。
 * zIndex 继续作为内部层序真源；visible / layerName / groupId / groups 为编辑器扩展数据。
 */

/** 补全并校验组列表：去重 id、丢弃悬空 parentId、补默认值。 */
export function normalizeGroups(groups?: (Partial<SceneGroup> & { id: string })[] | null): SceneGroup[] {
  const source = Array.isArray(groups) ? groups : [];
  const seen = new Set<string>();
  const collected: SceneGroup[] = [];
  for (const raw of source) {
    if (!raw || typeof raw.id !== "string" || !raw.id || seen.has(raw.id)) continue;
    seen.add(raw.id);
    collected.push({
      id: raw.id,
      name: typeof raw.name === "string" && raw.name ? raw.name : raw.id,
      parentId: typeof raw.parentId === "string" && raw.parentId ? raw.parentId : null,
      visible: raw.visible !== false,
      opacity: typeof raw.opacity === "number" && raw.opacity >= 0 && raw.opacity <= 1 ? raw.opacity : 1,
      ...(typeof raw.locked === "boolean" ? { locked: raw.locked } : {}),
      collapsed: raw.collapsed === true,
      order: typeof raw.order === "number" && Number.isFinite(raw.order) ? raw.order : collected.length
    });
  }
  const ids = new Set(collected.map(g => g.id));
  return collected.map(g => (g.parentId && ids.has(g.parentId) && g.parentId !== g.id ? g : { ...g, parentId: null }));
}

/** 补全元素图层字段默认值；未变化时保持原引用不变（利于历史 diff 与相等判断）。 */
export function normalizeElementsLayers(elements: SceneElement[]): SceneElement[] {
  return elements.map(element => {
    const visible = element.visible !== false;
    const layerName = typeof element.layerName === "string" ? element.layerName : "";
    const groupId = typeof element.groupId === "string" && element.groupId ? element.groupId : null;
    if (element.visible === visible && element.layerName === layerName && element.groupId === groupId) {
      return element;
    }
    return { ...element, visible, layerName, groupId };
  });
}

/** 元素的有效可见性：自身可见且所有祖先组可见。找不到的组视为可见。 */
export function effectiveVisible(element: SceneElement, groupsById: Map<string, SceneGroup>): boolean {
  if (element.visible === false) return false;
  let groupId: string | null = element.groupId ?? null;
  const seen = new Set<string>();
  while (groupId) {
    if (seen.has(groupId)) break;
    seen.add(groupId);
    const group = groupsById.get(groupId);
    if (!group) break;
    if (group.visible === false) return false;
    groupId = group.parentId ?? null;
  }
  return true;
}

/** 组及其全部后代组的 id（含自身）。 */

/** 图层/组锁定继承：自身或祖先链上任一组 locked === true 即视为锁定。手工编辑受保护，仍可见、可导出，并可在图层列表中选中以便解锁。 */
export function effectiveLocked(element: Pick<SceneElement, "locked" | "groupId">, groupsById: Map<string, SceneGroup>): boolean {
  if (element.locked === true) return true;
  let groupId: string | null = element.groupId ?? null;
  const seen = new Set<string>();
  while (groupId) {
    if (seen.has(groupId)) break;
    seen.add(groupId);
    const group = groupsById.get(groupId);
    if (!group) break;
    if (group.locked === true) return true;
    groupId = group.parentId ?? null;
  }
  return false;
}

/** 整组结构操作必须同时保护祖先锁、成员锁和锁定的空子组。 */
export function groupHasLockedContent(elements: SceneElement[], groups: SceneGroup[], groupId: string): boolean {
  const byId = new Map(groups.map(group => [group.id, group]));
  if (effectiveLocked({ groupId }, byId)) return true;
  const descendants = new Set(groupDescendantIds(groups, groupId));
  return groups.some(group => descendants.has(group.id) && group.locked === true) ||
    elements.some(element => !!element.groupId && descendants.has(element.groupId) && element.locked === true);
}
export function groupDescendantIds(groups: SceneGroup[], groupId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const group of groups) {
    const parent = group.parentId ?? null;
    if (!parent) continue;
    const list = childrenByParent.get(parent) ?? [];
    list.push(group.id);
    childrenByParent.set(parent, list);
  }
  const result: string[] = [];
  const stack = [groupId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    for (const child of childrenByParent.get(id) ?? []) stack.push(child);
  }
  return result;
}

function reindex(elements: SceneElement[]): SceneElement[] {
  return elements.map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
}

/** 导出用：仅保留有效可见元素，并按 zIndex 重新连续编号。 */
export function visibleForExport(elements: SceneElement[], groups: SceneGroup[]): SceneElement[] {
  const byId = new Map(groups.map(group => [group.id, group]));
  const visible = elements.filter(element => effectiveVisible(element, byId)).slice().sort((a, b) => a.zIndex - b.zIndex);
  return reindex(visible);
}

/** 单层 / 整组导出子集：只取目标（元素或组及其后代组）的有效可见成员，重新连续编号。 */
export function exportSubset(
  elements: SceneElement[],
  groups: SceneGroup[],
  target: { elementId?: string; groupId?: string }
): SceneElement[] {
  const byId = new Map(groups.map(group => [group.id, group]));
  let selected: Set<string>;
  if (target.groupId) {
    const groupIds = new Set(groupDescendantIds(groups, target.groupId));
    selected = new Set(elements.filter(element => element.groupId && groupIds.has(element.groupId)).map(element => element.id));
  } else if (target.elementId) {
    selected = new Set([target.elementId]);
  } else {
    selected = new Set();
  }
  const subset = elements
    .filter(element => selected.has(element.id) && effectiveVisible(element, byId))
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex);
  return reindex(subset);
}

/** Keep only the outer groups needed by the exported elements, including inherited group settings. */
export function sceneForLayerExport(scene: SceneDocument, elements: SceneElement[]): SceneDocument {
  const groups = scene.groups ?? [];
  const byId = new Map(groups.map(group => [group.id, group]));
  const retained = new Set<string>();
  for (const element of elements) {
    let id = element.groupId ?? null;
    while (id && !retained.has(id)) {
      const group = byId.get(id);
      if (!group) break;
      retained.add(id);
      id = group.parentId ?? null;
    }
  }
  return { ...scene, elements, groups: groups.filter(group => retained.has(group.id)) };
}

/** Solo：仅目标元素可见，返回新元素数组与进入前的可见性快照。 */
export function soloVisibility(elements: SceneElement[], targetId: string): { elements: SceneElement[]; snapshot: Record<string, boolean> } {
  const snapshot: Record<string, boolean> = {};
  const next = elements.map(element => {
    snapshot[element.id] = element.visible !== false;
    return { ...element, visible: element.id === targetId };
  });
  return { elements: next, snapshot };
}

/** 退出 Solo：按快照恢复可见性。 */
export function restoreVisibility(elements: SceneElement[], snapshot: Record<string, boolean>): SceneElement[] {
  return elements.map(element => (element.id in snapshot ? { ...element, visible: snapshot[element.id] } : element));
}

/** 设置某图层的可见性；未命中保持原引用。 */
export function setLayerVisible(elements: SceneElement[], id: string, visible: boolean): SceneElement[] {
  return elements.map(element => (element.id === id ? { ...element, visible } : element));
}

/** 设置某图层的图层名；未命中保持原引用。 */
export function renameLayer(elements: SceneElement[], id: string, layerName: string): SceneElement[] {
  return elements.map(element => (element.id === id ? { ...element, layerName } : element));
}

export type GroupMutation = { elements: SceneElement[]; groups: SceneGroup[] };

export type LayerNodeRef = { kind: "group" | "element"; id: string };
export type LayerNodeTarget =
  | { kind: "group"; id: string; position: "above" | "below" | "into" }
  | { kind: "element"; id: string; position: "above" | "below" }
  | { kind: "root" };

type MutableLayerTree = {
  children: Map<string | null, LayerNodeRef[]>;
  parents: Map<string, string | null>;
  elements: Map<string, SceneElement>;
  groups: Map<string, SceneGroup>;
};
const nodeKey = (node: LayerNodeRef): string => node.kind + ":" + node.id;
// Tagged negative integers encode an empty group's boundary, not legacy sibling order.
const EMPTY_GROUP_ORDER_TAG = -1_000_000_000;
const emptyGroupAnchor = (group: SceneGroup): number => group.order <= EMPTY_GROUP_ORDER_TAG
  ? EMPTY_GROUP_ORDER_TAG - group.order - 0.5 : -1 - group.order;

/** Build low-to-high sibling lists without changing the persisted scene. Invalid cycles are noops. */
function mutableLayerTree(elements: SceneElement[], groups: SceneGroup[]): MutableLayerTree | null {
  const byElement = new Map(elements.map(element => [element.id, element]));
  const byGroup = new Map(groups.map(group => [group.id, group]));
  if (byElement.size !== elements.length || byGroup.size !== groups.length) return null;
  for (const group of groups) {
    const path = new Set<string>();
    let current: string | null = group.id;
    while (current && byGroup.has(current)) {
      if (path.has(current)) return null;
      path.add(current);
      current = byGroup.get(current)?.parentId ?? null;
    }
  }
  const children = new Map<string | null, LayerNodeRef[]>([[null, []]]);
  const parents = new Map<string, string | null>();
  const add = (node: LayerNodeRef, parentId: string | null) => {
    const parent = parentId && byGroup.has(parentId) ? parentId : null;
    parents.set(nodeKey(node), parent);
    const siblings = children.get(parent) ?? [];
    siblings.push(node);
    children.set(parent, siblings);
  };
  for (const element of elements) add({ kind: "element", id: element.id }, element.groupId ?? null);
  for (const group of groups) {
    add({ kind: "group", id: group.id }, group.parentId ?? null);
    if (!children.has(group.id)) children.set(group.id, []);
  }
  const tree = { children, parents, elements: byElement, groups: byGroup };
  const anchor = (node: LayerNodeRef): number => {
    if (node.kind === "element") return byElement.get(node.id)!.zIndex;
    const members = treeElementIds(tree, node);
    return members.length ? Math.max(...members.map(id => byElement.get(id)!.zIndex)) : emptyGroupAnchor(byGroup.get(node.id)!);
  };
  for (const [parent, siblings] of children) {
    // Reverse the stable tie order used by the high-to-low tree rows.
    children.set(parent, siblings.map((node, index) => ({ node, index, anchor: anchor(node) }))
      .sort((a, b) => a.anchor - b.anchor || b.index - a.index).map(item => item.node));
  }
  return tree;
}

function treeElementIds(tree: MutableLayerTree, node: LayerNodeRef): string[] {
  if (node.kind === "element") return [node.id];
  return (tree.children.get(node.id) ?? []).flatMap(child => treeElementIds(tree, child));
}

function detachTreeNode(tree: MutableLayerTree, node: LayerNodeRef): void {
  const parent = tree.parents.get(nodeKey(node)) ?? null;
  tree.children.set(parent, (tree.children.get(parent) ?? []).filter(child => nodeKey(child) !== nodeKey(node)));
}

/** Find the leaf boundary in this scope, climbing through empty ancestor groups when needed. */
function treeInsertIndex(tree: MutableLayerTree, rest: SceneElement[], parent: string | null, index: number, bias: "above" | "below"): number {
  const siblings = tree.children.get(parent) ?? [];
  const positions = new Map(rest.map((element, position) => [element.id, position]));
  const before = () => {
    for (let i = index; i < siblings.length; i++) {
      const indices = treeElementIds(tree, siblings[i]).map(id => positions.get(id)).filter((value): value is number => value !== undefined);
      if (indices.length) return Math.min(...indices);
    }
    return null;
  };
  const after = () => {
    for (let i = index - 1; i >= 0; i--) {
      const indices = treeElementIds(tree, siblings[i]).map(id => positions.get(id)).filter((value): value is number => value !== undefined);
      if (indices.length) return Math.max(...indices) + 1;
    }
    return null;
  };
  const boundary = bias === "above" ? after() ?? before() : before() ?? after();
  if (boundary !== null) return boundary;
  if (parent === null) return rest.length;
  const parentNode: LayerNodeRef = { kind: "group", id: parent };
  const grandparent = tree.parents.get(nodeKey(parentNode)) ?? null;
  const parentIndex = (tree.children.get(grandparent) ?? []).findIndex(node => nodeKey(node) === nodeKey(parentNode));
  return treeInsertIndex(tree, rest, grandparent, parentIndex + (bias === "above" ? 1 : 0), bias);
}

/** Compact affected ancestor scopes at their former top anchor, preserving every leaf's relative order. */
function compactTreeAncestors(tree: MutableLayerTree, sequence: SceneElement[], parent: string | null): SceneElement[] {
  let result = sequence;
  while (parent) {
    const ids = new Set(treeElementIds(tree, { kind: "group", id: parent }));
    const block = result.filter(element => ids.has(element.id));
    if (block.length) {
      let last = result.length - 1;
      while (last >= 0 && !ids.has(result[last].id)) last--;
      const rest = result.filter(element => !ids.has(element.id));
      const boundary = result.slice(0, last).filter(element => !ids.has(element.id)).length;
      result = [...rest.slice(0, boundary), ...block, ...rest.slice(boundary)];
    }
    parent = tree.parents.get("group:" + parent) ?? null;
  }
  return result;
}

/** Empty groups have no zIndex: persist integer leaf boundaries plus stable same-boundary order. */
function finishTreeMutation(tree: MutableLayerTree, elements: SceneElement[], groups: SceneGroup[], sequence: SceneElement[]): GroupMutation {
  const nextElements = reindex(sequence).map(element => {
    const parent = tree.parents.get(nodeKey({ kind: "element", id: element.id })) ?? null;
    return (element.groupId ?? null) === parent ? element : { ...element, groupId: parent };
  });
  const zs = new Map(nextElements.map(element => [element.id, element.zIndex]));
  const orders = new Map<string, number>();
  const emptyRuns: string[][] = [];
  for (const siblings of tree.children.values()) {
    const anchors = siblings.map(node => {
      const ids = treeElementIds(tree, node);
      return ids.length ? Math.max(...ids.map(id => zs.get(id)!)) : null;
    });
    for (let start = 0; start < siblings.length;) {
      if (anchors[start] !== null) { start++; continue; }
      let end = start;
      while (end < siblings.length && anchors[end] === null) end++;
      const low = start > 0 ? anchors[start - 1] : null;
      const high = end < siblings.length ? anchors[end] : null;
      const boundary = high !== null ? Math.ceil(high) : low !== null ? Math.floor(low) + 1 : 0;
      const run = siblings.slice(start, end).map(node => node.id);
      emptyRuns.push(run);
      for (const id of run) orders.set(id, EMPTY_GROUP_ORDER_TAG - boundary);
      start = end;
    }
  }
  const nextGroups = groups.map(group => {
    const parentId = tree.parents.get(nodeKey({ kind: "group", id: group.id })) ?? null;
    const order = orders.get(group.id) ?? group.order;
    return (group.parentId ?? null) === parentId && group.order === order ? group : { ...group, parentId, order };
  });
  for (const run of emptyRuns) {
    // groupTreeRows uses stable array order for identical anchors (high-to-low).
    const members = new Set(run);
    const slots = nextGroups.map((group, index) => members.has(group.id) ? index : -1).filter(index => index >= 0);
    const byId = new Map(nextGroups.map(group => [group.id, group]));
    [...run].reverse().forEach((id, index) => { nextGroups[slots[index]] = byId.get(id)!; });
  }
  return {
    elements: nextElements.length === elements.length && nextElements.every((element, index) => element === elements[index]) ? elements : nextElements,
    groups: nextGroups.length === groups.length && nextGroups.every((group, index) => group === groups[index]) ? groups : nextGroups
  };
}

/** Insert a new sibling without moving any existing leaves across one another. */
export function insertLayerAbove(elements: SceneElement[], groups: SceneGroup[], layer: SceneElement, targetId: string): GroupMutation | null {
  const tree = mutableLayerTree(elements, groups);
  if (!tree?.elements.has(targetId) || tree.elements.has(layer.id) || tree.groups.has(layer.id)) return null;
  const target: LayerNodeRef = { kind: "element", id: targetId };
  const node: LayerNodeRef = { kind: "element", id: layer.id };
  const parent = tree.parents.get(nodeKey(target)) ?? null;
  const siblings = tree.children.get(parent)!;
  siblings.splice(siblings.findIndex(candidate => nodeKey(candidate) === nodeKey(target)) + 1, 0, node);
  tree.parents.set(nodeKey(node), parent);
  tree.elements.set(layer.id, layer);
  const sequence = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  sequence.splice(sequence.findIndex(element => element.id === targetId) + 1, 0, layer);
  return finishTreeMutation(tree, elements, groups, sequence);
}

/** Wrap selected top-level roots; selected group descendants keep their existing hierarchy. */
export function groupSelection(elements: SceneElement[], groups: SceneGroup[], elementIds: string[], groupIds: string[], newGroupId: string, name?: string): GroupMutation & { existingGroupId?: string } {
  if (!newGroupId || elements.some(element => element.id === newGroupId) || groups.some(group => group.id === newGroupId)) return { elements, groups };
  const tree = mutableLayerTree(elements, groups);
  if (!tree) return { elements, groups };
  const selectedGroups = new Set(groupIds.filter(id => tree.groups.has(id)));
  const covered = new Set<string>();
  for (const id of selectedGroups) for (const descendant of groupDescendantIds(groups, id)) covered.add(descendant);
  const roots: LayerNodeRef[] = groups.filter(group => selectedGroups.has(group.id) && !covered.has(tree.parents.get("group:" + group.id) ?? ""))
    .map(group => ({ kind: "group", id: group.id }));
  const selectedElements = new Set(elementIds);
  roots.push(...elements.filter(element => selectedElements.has(element.id) && !(element.groupId && covered.has(element.groupId)))
    .map(element => ({ kind: "element" as const, id: element.id })));
  if (!roots.length) return { elements, groups };
  if (roots.length === 1 && roots[0].kind === "group") {
    return { elements, groups, existingGroupId: roots[0].id };
  }
  const ancestors = (node: LayerNodeRef): (string | null)[] => {
    const result: (string | null)[] = [];
    let parent = tree.parents.get(nodeKey(node)) ?? null;
    while (parent) { result.push(parent); parent = tree.parents.get("group:" + parent) ?? null; }
    return [...result, null];
  };
  const paths = roots.map(ancestors);
  const parent = paths[0].find(id => paths.every(path => path.includes(id))) ?? null;
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const chosen = new Set(roots.flatMap(node => treeElementIds(tree, node)));
  if (parent) {
    const complete = treeElementIds(tree, { kind: "group", id: parent }).every(id => chosen.has(id));
    const unselectedEmptyGroup = groupDescendantIds(groups, parent).some(id =>
      !(tree.children.get(id)?.length) && !covered.has(id));
    if (complete && !unselectedEmptyGroup) return { elements, groups, existingGroupId: parent };
  }
  const block = sorted.filter(element => chosen.has(element.id));
  const rest = sorted.filter(element => !chosen.has(element.id));
  const anchor = (node: LayerNodeRef): number => {
    const ids = treeElementIds(tree, node);
    return ids.length ? Math.min(...ids.map(id => tree.elements.get(id)!.zIndex)) : emptyGroupAnchor(tree.groups.get(node.id)!);
  };
  roots.sort((a, b) => anchor(a) - anchor(b));
  const earliest = anchor(roots[0]);
  const siblings = tree.children.get(parent) ?? [];
  const siblingIndex = siblings.findIndex(node => {
    const ids = treeElementIds(tree, node);
    return (ids.length ? Math.max(...ids.map(id => tree.elements.get(id)!.zIndex)) : emptyGroupAnchor(tree.groups.get(node.id)!)) >= earliest;
  });
  const preceding = siblings.slice(0, siblingIndex < 0 ? siblings.length : siblingIndex).filter(node => !roots.some(root => nodeKey(root) === nodeKey(node))).length;
  for (const node of roots) detachTreeNode(tree, node);
  const group: SceneGroup = { id: newGroupId, name: name && name.trim() ? name : newGroupId, parentId: parent, visible: true, opacity: 1, collapsed: false, order: 0 };
  tree.groups.set(newGroupId, group);
  tree.children.set(newGroupId, roots);
  tree.parents.set("group:" + newGroupId, parent);
  for (const node of roots) tree.parents.set(nodeKey(node), newGroupId);
  const nextSiblings = tree.children.get(parent) ?? [];
  nextSiblings.splice(preceding, 0, { kind: "group", id: newGroupId });
  tree.children.set(parent, nextSiblings);
  const insertAt = block.length ? rest.filter(element => element.zIndex < block[0].zIndex).length : rest.length;
  return finishTreeMutation(tree, elements, [...groups, group], compactTreeAncestors(tree, [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)], newGroupId));
}

/** Lock outside the selection, never changing locks on selected leaves/subtrees or their ancestors. */
export function lockOtherLayers(elements: SceneElement[], groups: SceneGroup[], elementIds: string[], groupIds: string[]): GroupMutation {
  const byGroup = new Map(groups.map(group => [group.id, group]));
  const selectedElements = new Set(elementIds.filter(id => elements.some(element => element.id === id)));
  const selectedGroups = groupIds.filter(id => byGroup.has(id));
  if (!selectedElements.size && !selectedGroups.length) return { elements, groups };
  const descendants = new Set(selectedGroups.flatMap(id => groupDescendantIds(groups, id)));
  const protectedGroups = new Set(descendants);
  const protectPath = (id: string | null) => {
    const seen = new Set<string>();
    while (id && byGroup.has(id) && !seen.has(id)) { seen.add(id); protectedGroups.add(id); id = byGroup.get(id)?.parentId ?? null; }
  };
  for (const id of selectedGroups) protectPath(id);
  for (const element of elements) if (selectedElements.has(element.id)) protectPath(element.groupId ?? null);
  const nextElements = elements.map(element => selectedElements.has(element.id) || (element.groupId && descendants.has(element.groupId)) || element.locked === true ? element : { ...element, locked: true });
  const nextGroups = groups.map(group => protectedGroups.has(group.id) || group.locked === true ? group : { ...group, locked: true });
  return {
    elements: nextElements.every((element, index) => element === elements[index]) ? elements : nextElements,
    groups: nextGroups.every((group, index) => group === groups[index]) ? groups : nextGroups
  };
}

/** Move one node as a contiguous leaf block; above/below are visual (high/low z) positions. */
export function moveLayerNode(elements: SceneElement[], groups: SceneGroup[], drag: LayerNodeRef, target: LayerNodeTarget): GroupMutation {
  const tree = mutableLayerTree(elements, groups);
  if (!tree || !(drag.kind === "group" ? tree.groups : tree.elements).has(drag.id)) return { elements, groups };
  if (target.kind !== "root" && !(target.kind === "group" ? tree.groups : tree.elements).has(target.id)) return { elements, groups };
  if (target.kind !== "root" && nodeKey(drag) === nodeKey(target)) return { elements, groups };
  const movingIds = new Set(treeElementIds(tree, drag));
  if (drag.kind === "group" && target.kind !== "root") {
    const descendants = new Set(groupDescendantIds(groups, drag.id));
    if (target.kind === "group" ? descendants.has(target.id) : movingIds.has(target.id)) return { elements, groups };
  }
  detachTreeNode(tree, drag);
  const parent = target.kind === "root" ? null : target.kind === "group" && target.position === "into" ? target.id : tree.parents.get(nodeKey(target)) ?? null;
  const siblings = tree.children.get(parent) ?? [];
  const position = target.kind === "root" || target.position === "into" ? "above" : target.position;
  const insertIndex = target.kind === "root" || target.position === "into" ? siblings.length : siblings.findIndex(node => nodeKey(node) === nodeKey(target)) + (position === "above" ? 1 : 0);
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const block = sorted.filter(element => movingIds.has(element.id));
  const rest = sorted.filter(element => !movingIds.has(element.id));
  const insertAt = target.kind === "root" ? rest.length : treeInsertIndex(tree, rest, parent, insertIndex, position);
  siblings.splice(insertIndex, 0, drag);
  tree.children.set(parent, siblings);
  tree.parents.set(nodeKey(drag), parent);
  return finishTreeMutation(tree, elements, groups, compactTreeAncestors(tree, [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)], parent));
}

/** 将选中元素收进一个新顶层分组，并使其在层序中构成连续块。 */
export function groupElements(elements: SceneElement[], groups: SceneGroup[], ids: string[], newGroupId: string, name?: string): GroupMutation {
  const selected = new Set(ids);
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const chosen = sorted.filter((element) => selected.has(element.id));
  if (!chosen.length) return { elements, groups };
  const minZ = Math.min(...chosen.map((element) => element.zIndex));
  const rest = sorted.filter((element) => !selected.has(element.id));
  let position = 0;
  for (const element of rest) { if (element.zIndex < minZ) position += 1; }
  const block = chosen.map((element) => ({ ...element, groupId: newGroupId }));
  const merged = [...rest.slice(0, position), ...block, ...rest.slice(position)];
  const nextElements = merged.map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
  const parentIds = new Set(chosen.map((element) => element.groupId ?? null));
  const commonParent = parentIds.size === 1 ? (chosen[0].groupId ?? null) : null;
  const parentId = commonParent && groups.some((group) => group.id === commonParent) ? commonParent : null;
  const maxOrder = groups.filter((group) => (group.parentId ?? null) === parentId).reduce((max, group) => Math.max(max, group.order), -1);
  const group: SceneGroup = { id: newGroupId, name: name && name.trim() ? name : newGroupId, parentId, visible: true, opacity: 1, collapsed: false, order: maxOrder + 1 };
  return { elements: nextElements, groups: [...groups, group] };
}

/** 解组：成员回到父级，子组提升到父级。 */
export function ungroupElements(elements: SceneElement[], groups: SceneGroup[], groupId: string): GroupMutation {
  const target = groups.find((group) => group.id === groupId);
  if (!target) return { elements, groups };
  const parent = target.parentId ?? null;
  const factor = target.opacity ?? 1;
  const visibility = target.visible === false ? { visible: false } : {};
  const nextElements = elements.map((element) => {
    if (element.groupId !== groupId) return element;
    if (element.type === "textbox" && element.textBox && factor !== 1) {
      const textBox = {
        ...element.textBox,
        textOpacity: (element.textBox.textOpacity ?? element.opacity) * factor,
        bgOpacity: (element.textBox.bgOpacity ?? 0) * factor,
        outlineOpacity: (element.textBox.outlineOpacity ?? 0.2) * factor
      };
      return { ...element, groupId: parent, ...visibility, opacity: textBox.textOpacity, textBox };
    }
    return { ...element, groupId: parent, ...visibility, ...(factor !== 1 ? { opacity: element.opacity * factor } : {}) };
  });
  const nextGroups = groups.filter((group) => group.id !== groupId).map((group) => group.parentId === groupId
    ? { ...group, parentId: parent, ...visibility, ...(factor !== 1 ? { opacity: (group.opacity ?? 1) * factor } : {}) }
    : group);
  return { elements: nextElements, groups: nextGroups };
}

/** 删除组及其所有子组和其中元素。 */
export function removeGroupWithChildren(elements: SceneElement[], groups: SceneGroup[], groupId: string): GroupMutation {
  const removedGroups = new Set(groupDescendantIds(groups, groupId));
  const nextElements = elements
    .filter((element) => !(element.groupId && removedGroups.has(element.groupId)))
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
  const nextGroups = groups.filter((group) => !removedGroups.has(group.id));
  return { elements: nextElements, groups: nextGroups };
}

export function setLayerLocked(elements: SceneElement[], id: string, locked: boolean): SceneElement[] {
  return elements.map(element => (element.id === id ? { ...element, locked } : element));
}
export function setGroupLocked(groups: SceneGroup[], id: string, locked: boolean): SceneGroup[] {
  return groups.map((group) => (group.id === id ? { ...group, locked } : group));
}

export function renameGroup(groups: SceneGroup[], id: string, name: string): SceneGroup[] {
  return groups.map((group) => (group.id === id ? { ...group, name } : group));
}

export function setGroupVisible(groups: SceneGroup[], id: string, visible: boolean): SceneGroup[] {
  return groups.map((group) => (group.id === id ? { ...group, visible } : group));
}

export function toggleGroupCollapsed(groups: SceneGroup[], id: string): SceneGroup[] {
  return groups.map((group) => (group.id === id ? { ...group, collapsed: !group.collapsed } : group));
}

export type LayerTreeRow =
  | { kind: "group"; group: SceneGroup; depth: number }
  | { kind: "element"; element: SceneElement; depth: number };

/** 生成图层列表的树形行（显示顺序：从上到下，组标题在其子项之前）。 */
export function groupTreeRows(elements: SceneElement[], groups: SceneGroup[]): LayerTreeRow[] {
  const groupIds = new Set(groups.map((group) => group.id));
  const childrenByParent = new Map<string, SceneGroup[]>();
  const topGroups: SceneGroup[] = [];
  for (const group of groups) {
    if (group.parentId && groupIds.has(group.parentId)) {
      const list = childrenByParent.get(group.parentId) ?? [];
      list.push(group);
      childrenByParent.set(group.parentId, list);
    } else {
      topGroups.push(group);
    }
  }
  const elementsByGroup = new Map<string, SceneElement[]>();
  const topElements: SceneElement[] = [];
  for (const element of elements) {
    if (element.groupId && groupIds.has(element.groupId)) {
      const list = elementsByGroup.get(element.groupId) ?? [];
      list.push(element);
      elementsByGroup.set(element.groupId, list);
    } else {
      topElements.push(element);
    }
  }
  const groupAnchor = (group: SceneGroup): number => {
    const ids = new Set(groupDescendantIds(groups, group.id));
    const zs = elements.filter((element) => element.groupId && ids.has(element.groupId)).map((element) => element.zIndex);
    return zs.length ? Math.max(...zs) : emptyGroupAnchor(group);
  };
  const rows: LayerTreeRow[] = [];
  const walkGroup = (group: SceneGroup, depth: number) => {
    rows.push({ kind: "group", group, depth });
    if (group.collapsed) return;
    const entries: { sort: number; make: () => void }[] = [];
    for (const element of elementsByGroup.get(group.id) ?? []) {
      entries.push({ sort: element.zIndex, make: () => { rows.push({ kind: "element", element, depth: depth + 1 }); } });
    }
    for (const child of childrenByParent.get(group.id) ?? []) {
      entries.push({ sort: groupAnchor(child), make: () => walkGroup(child, depth + 1) });
    }
    entries.sort((a, b) => b.sort - a.sort);
    for (const entry of entries) entry.make();
  };
  const topEntries: { sort: number; make: () => void }[] = [];
  for (const element of topElements) {
    topEntries.push({ sort: element.zIndex, make: () => { rows.push({ kind: "element", element, depth: 0 }); } });
  }
  for (const group of topGroups) {
    topEntries.push({ sort: groupAnchor(group), make: () => walkGroup(group, 0) });
  }
  topEntries.sort((a, b) => b.sort - a.sort);
  for (const entry of topEntries) entry.make();
  return rows;
}

/** 把组挂到目标组下（或 null 提到顶层）；拒绝成环与自引用。 */
export function reparentGroup(groups: SceneGroup[], groupId: string, targetGroupId: string | null): SceneGroup[] {
  if (targetGroupId) {
    if (targetGroupId === groupId) return groups;
    if (!groups.some((group) => group.id === targetGroupId)) return groups;
    const descendants = new Set(groupDescendantIds(groups, groupId));
    if (descendants.has(targetGroupId)) return groups;
  }
  return groups.map((group) => (group.id === groupId ? { ...group, parentId: targetGroupId } : group));
}

/** 拖入组：把元素放进目标组（或顶层），并置于该组最上层。 */
export function moveElementIntoGroup(elements: SceneElement[], groups: SceneGroup[], elementId: string, targetGroupId: string | null): SceneElement[] {
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const dragged = sorted.find((element) => element.id === elementId);
  if (!dragged) return elements;
  const validGroup = targetGroupId && groups.some((group) => group.id === targetGroupId) ? targetGroupId : null;
  const rest = sorted.filter((element) => element.id !== elementId);
  const members = rest.filter((element) => (element.groupId ?? null) === validGroup);
  let insertAt = rest.length;
  if (members.length) insertAt = rest.indexOf(members[members.length - 1]) + 1;
  const moved = { ...dragged, groupId: validGroup };
  const merged = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
  return merged.map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
}

/** 拖到某元素前/后：同组并把拖拽项放到目标相邻位置。 */
export function moveElementNextTo(elements: SceneElement[], _groups: SceneGroup[], dragId: string, targetId: string, position: "above" | "below"): SceneElement[] {
  if (dragId === targetId) return elements;
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const dragged = sorted.find((element) => element.id === dragId);
  const target = sorted.find((element) => element.id === targetId);
  if (!dragged || !target) return elements;
  const rest = sorted.filter((element) => element.id !== dragId);
  const targetIndex = rest.indexOf(target);
  const insertAt = position === "above" ? targetIndex + 1 : targetIndex;
  const moved = { ...dragged, groupId: target.groupId ?? null };
  const merged = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
  return merged.map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
}

/** Reorder complete selected nodes within their own parent scopes. */
export function reorderLayerNodes(elements: SceneElement[], groups: SceneGroup[], elementIds: readonly string[], groupIds: readonly string[], direction: "top" | "bottom" | "up" | "down"): GroupMutation {
  const tree = mutableLayerTree(elements, groups);
  if (!tree) return { elements, groups };
  const selectedGroups = new Set(groupIds.filter(id => tree.groups.has(id)));
  const covered = (node: LayerNodeRef) => {
    let parent = tree.parents.get(nodeKey(node)) ?? null;
    while (parent) {
      if (selectedGroups.has(parent)) return true;
      parent = tree.parents.get("group:" + parent) ?? null;
    }
    return false;
  };
  const chosen = new Set<string>();
  for (const id of selectedGroups) {
    const node: LayerNodeRef = { kind: "group", id };
    if (!covered(node) && !groupHasLockedContent(elements, groups, id)) chosen.add(nodeKey(node));
  }
  for (const id of elementIds) {
    const element = tree.elements.get(id);
    const node: LayerNodeRef = { kind: "element", id };
    // Covered members stay covered even when their selected group is locked.
    if (element && !covered(node) && !effectiveLocked(element, tree.groups)) chosen.add(nodeKey(node));
  }
  if (!chosen.size) return { elements, groups };
  const changed: (string | null)[] = [];
  for (const [parent, siblings] of tree.children) {
    const isSelected = (node: LayerNodeRef) => chosen.has(nodeKey(node));
    if (!siblings.some(isSelected)) continue;
    let ordered: LayerNodeRef[];
    if (direction === "top" || direction === "bottom") {
      const selected = siblings.filter(isSelected);
      const rest = siblings.filter(node => !isSelected(node));
      ordered = direction === "top" ? [...rest, ...selected] : [...selected, ...rest];
    } else {
      ordered = [...siblings];
      if (direction === "up") {
        for (let i = ordered.length - 2; i >= 0; i--) {
          if (isSelected(ordered[i]) && !isSelected(ordered[i + 1])) [ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]];
        }
      } else {
        for (let i = 1; i < ordered.length; i++) {
          if (isSelected(ordered[i]) && !isSelected(ordered[i - 1])) [ordered[i], ordered[i - 1]] = [ordered[i - 1], ordered[i]];
        }
      }
    }
    if (ordered.some((node, index) => nodeKey(node) !== nodeKey(siblings[index]))) {
      tree.children.set(parent, ordered);
      changed.push(parent);
    }
  }
  if (!changed.length) return { elements, groups };
  const depth = (parent: string | null) => {
    let value = 0;
    while (parent) { value++; parent = tree.parents.get("group:" + parent) ?? null; }
    return value;
  };
  let sequence = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  for (const parent of changed.sort((a, b) => depth(b) - depth(a))) {
    const siblings = tree.children.get(parent) ?? [];
    const members = siblings.map(node => new Set(treeElementIds(tree, node)));
    const scope = new Set(members.flatMap(ids => [...ids]));
    let last = sequence.length - 1;
    while (last >= 0 && !scope.has(sequence[last].id)) last--;
    if (last < 0) continue;
    const rest = sequence.filter(element => !scope.has(element.id));
    const boundary = sequence.slice(0, last + 1).filter(element => !scope.has(element.id)).length;
    // Keep each node's internal leaf order, including legacy scenes with gaps.
    const owner = new Map<string, number>();
    members.forEach((ids, index) => { for (const id of ids) owner.set(id, index); });
    const blocks: SceneElement[][] = members.map(() => []);
    for (const element of sequence) {
      const index = owner.get(element.id);
      if (index !== undefined) blocks[index].push(element);
    }
    const block = blocks.flat();
    sequence = [...rest.slice(0, boundary), ...block, ...rest.slice(boundary)];
    sequence = compactTreeAncestors(tree, sequence, parent ? tree.parents.get("group:" + parent) ?? null : null);
  }
  return finishTreeMutation(tree, elements, groups, sequence);
}

/** Keep the global layer number field inside its parent's legal sibling boundaries. */
export function moveElementToLayerPosition(elements: SceneElement[], groups: SceneGroup[], id: string, layerNumber: number): GroupMutation {
  if (!Number.isFinite(layerNumber)) return { elements, groups };
  const tree = mutableLayerTree(elements, groups);
  const element = tree?.elements.get(id);
  if (!tree || !element || effectiveLocked(element, tree.groups)) return { elements, groups };
  const sequence = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const current = sequence.findIndex(item => item.id === id);
  const requested = Math.max(0, Math.min(sequence.length - 1, Math.round(layerNumber) - 1));
  if (requested === current) return { elements, groups };
  const node: LayerNodeRef = { kind: "element", id };
  const parent = tree.parents.get(nodeKey(node)) ?? null;
  const siblings = tree.children.get(parent) ?? [];
  const restSiblings = siblings.filter(item => nodeKey(item) !== nodeKey(node));
  const rest = sequence.filter(item => item.id !== id);
  tree.children.set(parent, restSiblings);
  const goingUp = requested > current;
  const candidates = Array.from({ length: restSiblings.length + 1 }, (_, index) => ({
    index, boundary: treeInsertIndex(tree, rest, parent, index, goingUp ? "above" : "below")
  }));
  candidates.sort((a, b) => a.boundary - b.boundary || a.index - b.index);
  const target = goingUp
    ? candidates.find(item => item.boundary >= requested) ?? candidates[candidates.length - 1]
    : [...candidates].reverse().find(item => item.boundary <= requested) ?? candidates[0];
  const ordered = [...restSiblings.slice(0, target.index), node, ...restSiblings.slice(target.index)];
  if (ordered.every((item, index) => nodeKey(item) === nodeKey(siblings[index]))) return { elements, groups };
  tree.children.set(parent, ordered);
  const next = [...rest.slice(0, target.boundary), element, ...rest.slice(target.boundary)];
  return finishTreeMutation(tree, elements, groups, compactTreeAncestors(tree, next, parent));
}

/** Compatibility wrapper; callers needing empty-group order also persist the full mutation. */
export function reorderGroups(elements: SceneElement[], groups: SceneGroup[], groupIds: string[], direction: "top" | "bottom" | "up" | "down"): SceneElement[] {
  return reorderLayerNodes(elements, groups, [], groupIds, direction).elements;
}

/** 把拖拽组放到目标组前/后（同级排序）；目标为嵌套组时仅调整父级。 */
export function moveGroupNextTo(elements: SceneElement[], groups: SceneGroup[], dragId: string, targetId: string, position: "before" | "after"): GroupMutation {
  if (dragId === targetId) return { elements, groups };
  const drag = groups.find((group) => group.id === dragId);
  const target = groups.find((group) => group.id === targetId);
  if (!drag || !target) return { elements, groups };
  if (target.parentId) {
    return { elements, groups: groups.map((group) => (group.id === dragId ? { ...group, parentId: target.parentId } : group)) };
  }
  const allGroupIds = new Set(groups.map((group) => group.id));
  const topGroups = groups.filter((group) => !group.parentId);
  const blocks: { groupId: string | null; ids: string[]; anchor: number }[] = [];
  for (const group of topGroups) {
    const ids = new Set(groupDescendantIds(groups, group.id));
    const members = elements.filter((element) => element.groupId && ids.has(element.groupId));
    blocks.push({ groupId: group.id, ids: members.map((element) => element.id), anchor: members.length ? Math.max(...members.map((element) => element.zIndex)) : -1 });
  }
  for (const element of elements.filter((item) => !(item.groupId && allGroupIds.has(item.groupId)))) {
    blocks.push({ groupId: null, ids: [element.id], anchor: element.zIndex });
  }
  blocks.sort((a, b) => a.anchor - b.anchor);
  const dragIndex = blocks.findIndex((block) => block.groupId === dragId);
  if (dragIndex < 0) return { elements, groups };
  const [dragBlock] = blocks.splice(dragIndex, 1);
  let insertIndex = blocks.findIndex((block) => block.groupId === targetId);
  if (insertIndex < 0) return { elements, groups };
  if (position === "after") insertIndex += 1;
  blocks.splice(insertIndex, 0, dragBlock);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const sequence: SceneElement[] = [];
  for (const block of blocks) {
    const members = block.ids.map((id) => byId.get(id)).filter((element): element is SceneElement => Boolean(element));
    members.sort((a, b) => a.zIndex - b.zIndex);
    sequence.push(...members);
  }
  const seen = new Set(sequence.map((element) => element.id));
  for (const element of [...elements].sort((a, b) => a.zIndex - b.zIndex)) { if (!seen.has(element.id)) sequence.push(element); }
  const nextElements = sequence.map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
  const nextGroups = groups.map((group) => (group.id === dragId ? { ...group, parentId: null } : group));
  return { elements: nextElements, groups: nextGroups };
}

export type VisibilitySnapshot = { elements: Record<string, boolean>; groups: Record<string, boolean> };

/** 记录当前元素/组的可见性快照。 */
export function captureVisibility(elements: SceneElement[], groups: SceneGroup[]): VisibilitySnapshot {
  const elementMap: Record<string, boolean> = {};
  for (const element of elements) elementMap[element.id] = element.visible !== false;
  const groupMap: Record<string, boolean> = {};
  for (const group of groups) groupMap[group.id] = group.visible !== false;
  return { elements: elementMap, groups: groupMap };
}

/** 按快照恢复元素/组的可见性。 */
export function restoreVisibilitySnapshot(elements: SceneElement[], groups: SceneGroup[], snapshot: VisibilitySnapshot): GroupMutation {
  return {
    elements: elements.map((element) => (element.id in snapshot.elements ? { ...element, visible: snapshot.elements[element.id] } : element)),
    groups: groups.map((group) => (group.id in snapshot.groups ? { ...group, visible: snapshot.groups[group.id] } : group))
  };
}

/** 组 Solo：仅目标组及其后代组内的元素可见，其余隐藏（祖先组保持可见以保证继承链）。 */
export function applyGroupSolo(elements: SceneElement[], groups: SceneGroup[], groupId: string): GroupMutation {
  const descendants = new Set(groupDescendantIds(groups, groupId));
  const byId = new Map(groups.map((group) => [group.id, group]));
  const path = new Set<string>();
  let current: string | null = groupId;
  while (current) { path.add(current); const group = byId.get(current); current = group ? group.parentId : null; }
  return {
    elements: elements.map((element) => ({ ...element, visible: Boolean(element.groupId && descendants.has(element.groupId)) })),
    groups: groups.map((group) => ({ ...group, visible: path.has(group.id) || descendants.has(group.id) }))
  };
}

/** 把拖拽组移动到某元素（或其顶层祖先组）的上/下位置（顶层作用域）。 */
export function moveGroupNextToElement(elements: SceneElement[], groups: SceneGroup[], dragGroupId: string, targetElementId: string, position: "above" | "below"): GroupMutation {
  const targetElement = elements.find((element) => element.id === targetElementId);
  if (!targetElement) return { elements, groups };
  const allGroupIds = new Set(groups.map((group) => group.id));
  let targetBlockKey: string | null = null;
  if (targetElement.groupId && allGroupIds.has(targetElement.groupId)) {
    let current: string | null = targetElement.groupId;
    while (current) { const group = groups.find((item) => item.id === current); if (!group) break; targetBlockKey = "g:" + current; current = group.parentId; }
  } else {
    targetBlockKey = "e:" + targetElement.id;
  }
  if (!targetBlockKey) return { elements, groups };
  const topGroups = groups.filter((group) => !group.parentId);
  const blocks: { key: string; ids: string[]; anchor: number }[] = [];
  for (const group of topGroups) {
    const ids = new Set(groupDescendantIds(groups, group.id));
    const members = elements.filter((element) => element.groupId && ids.has(element.groupId));
    blocks.push({ key: "g:" + group.id, ids: members.map((element) => element.id), anchor: members.length ? Math.max(...members.map((element) => element.zIndex)) : -1 });
  }
  for (const element of elements.filter((item) => !(item.groupId && allGroupIds.has(item.groupId)))) {
    blocks.push({ key: "e:" + element.id, ids: [element.id], anchor: element.zIndex });
  }
  blocks.sort((a, b) => a.anchor - b.anchor);
  const dragKey = "g:" + dragGroupId;
  const dragIndex = blocks.findIndex((block) => block.key === dragKey);
  if (dragIndex < 0) return { elements, groups };
  const [dragBlock] = blocks.splice(dragIndex, 1);
  let insertIndex = blocks.findIndex((block) => block.key === targetBlockKey);
  if (insertIndex < 0) return { elements, groups };
  if (position === "above") insertIndex += 1;
  blocks.splice(insertIndex, 0, dragBlock);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const sequence: SceneElement[] = [];
  for (const block of blocks) {
    const members = block.ids.map((id) => byId.get(id)).filter((element): element is SceneElement => Boolean(element));
    members.sort((a, b) => a.zIndex - b.zIndex);
    sequence.push(...members);
  }
  const seen = new Set(sequence.map((element) => element.id));
  for (const element of [...elements].sort((a, b) => a.zIndex - b.zIndex)) { if (!seen.has(element.id)) sequence.push(element); }
  const nextElements = sequence.map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
  const nextGroups = groups.map((group) => (group.id === dragGroupId ? { ...group, parentId: null } : group));
  return { elements: nextElements, groups: nextGroups };
}

/** 设置组不透明度（0..1）。 */
export function setGroupOpacity(groups: SceneGroup[], id: string, opacity: number): SceneGroup[] {
  const value = Math.max(0, Math.min(1, opacity));
  return groups.map((group) => (group.id === id ? { ...group, opacity: value } : group));
}

/** 元素最终不透明度 = 自身 opacity × 所有祖先组 opacity。 */
export function effectiveGroupOpacity(element: Pick<SceneElement, "opacity" | "groupId">, groupsById: Map<string, SceneGroup>): number {
  let product = element.opacity;
  let groupId: string | null = element.groupId ?? null;
  const seen = new Set<string>();
  while (groupId) {
    if (seen.has(groupId)) break;
    seen.add(groupId);
    const group = groupsById.get(groupId);
    if (!group) break;
    product *= group.opacity;
    groupId = group.parentId ?? null;
  }
  return product;
}

/** 按组不透明度把元素 opacity 烘焙为最终值（导出用；组内重叠处为近似）。 */
export function bakeGroupOpacity(elements: SceneElement[], groups: SceneGroup[]): SceneElement[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  return elements.map((element) => {
    const value = effectiveGroupOpacity(element, byId);
    return value === element.opacity ? element : { ...element, opacity: value };
  });
}

/** 收集这些分组（含嵌套子组）下所有元素的 id。 */
export function groupElementIds(elements: SceneElement[], groups: SceneGroup[], groupIds: string[]): string[] {
  const groupIdSet = new Set<string>();
  for (const groupId of groupIds) for (const id of groupDescendantIds(groups, groupId)) groupIdSet.add(id);
  if (!groupIdSet.size) return [];
  return elements.filter((element) => element.groupId && groupIdSet.has(element.groupId)).map((element) => element.id);
}

/** 原位复制：副本插到各自原图层正上方（保持 groupId），不跳到最顶。 */
export function duplicateInPlace(elements: SceneElement[], ids: string[], makeId: () => string, offset = 0, groups: readonly SceneGroup[] = []): { elements: SceneElement[]; clones: SceneElement[] } {
  const chosen = new Set(ids);
  const allocate = createSceneIdAllocator(makeId, collectSceneIds(elements, groups));
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const result: SceneElement[] = [];
  const cloneIds = new Set<string>();
  for (const element of sorted) {
    result.push(element);
    if (chosen.has(element.id)) {
      const clone = cloneSceneLayer(element, allocate);
      clone.x = element.x + offset;
      clone.y = element.y + offset;
      cloneIds.add(clone.id);
      result.push(clone);
    }
  }
  const finalElements = result.map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
  const clones = finalElements.filter((element) => cloneIds.has(element.id));
  return { elements: finalElements, clones };
}

/** 复制整棵分组：克隆分组及其中全部子组/图元，副本作为新分组放在原组上方，根组名追加 copy。 */
export type GroupDuplicate = { elements: SceneElement[]; groups: SceneGroup[]; clones: SceneElement[]; groupClones: SceneGroup[] };

export function duplicateGroups(
  elements: SceneElement[],
  groups: SceneGroup[],
  groupIds: string[],
  makeId: () => string,
  nameSuffix = " copy"
): GroupDuplicate {
  const selected = new Set(groupIds);
  if (!selected.size) return { elements, groups, clones: [], groupClones: [] };
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const roots = [...selected].filter((id) => {
    if (!groupById.has(id)) return false;
    let parent = groupById.get(id)?.parentId ?? null;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = groupById.get(parent)?.parentId ?? null;
    }
    return true;
  });
  const rootSets = roots.map((root) => ({ root, ids: new Set(groupDescendantIds(groups, root)) }));
  const allOldGroupIds = new Set<string>();
  for (const entry of rootSets) for (const id of entry.ids) allOldGroupIds.add(id);
  const allocate = createSceneIdAllocator(makeId, collectSceneIds(elements, groups));
  const newGroupIdByOld = new Map<string, string>();
  for (const id of allOldGroupIds) newGroupIdByOld.set(id, allocate());
  const clonedGroups = groups
    .filter((group) => allOldGroupIds.has(group.id))
    .map((group) => {
      const isRoot = roots.includes(group.id);
      const oldParent = group.parentId ?? null;
      const parentId = oldParent && allOldGroupIds.has(oldParent) ? newGroupIdByOld.get(oldParent)! : oldParent;
      return { ...structuredClone(group), id: newGroupIdByOld.get(group.id)!, name: isRoot ? `${group.name}${nameSuffix}` : group.name, parentId, order: group.order + 0.5 };
    });
  const rootNewIds = new Set(roots.map((root) => newGroupIdByOld.get(root)!));
  const clonesByRoot = new Map<string, SceneElement[]>();
  for (const element of [...elements].sort((a, b) => a.zIndex - b.zIndex)) {
    if (!element.groupId || !allOldGroupIds.has(element.groupId)) continue;
    const owner = rootSets.find((entry) => entry.ids.has(element.groupId!));
    if (!owner) continue;
    const clone: SceneElement = { ...cloneSceneLayer(element, allocate), groupId: newGroupIdByOld.get(element.groupId)! };
    const bucket = clonesByRoot.get(owner.root) ?? [];
    bucket.push(clone);
    clonesByRoot.set(owner.root, bucket);
  }
  let working = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  for (const entry of rootSets) {
    const bucket = clonesByRoot.get(entry.root) ?? [];
    if (!bucket.length) continue;
    const oldIds = new Set(working.filter((element) => element.groupId && entry.ids.has(element.groupId)).map((element) => element.id));
    let insertAt = 0;
    working.forEach((element, index) => { if (oldIds.has(element.id)) insertAt = index + 1; });
    working.splice(insertAt, 0, ...bucket);
  }
  const finalElements = working.map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
  const cloneIds = new Set([...clonesByRoot.values()].flat().map((element) => element.id));
  return {
    elements: finalElements,
    groups: [...groups, ...clonedGroups],
    clones: finalElements.filter((element) => cloneIds.has(element.id)),
    groupClones: clonedGroups.filter((group) => rootNewIds.has(group.id))
  };
}

