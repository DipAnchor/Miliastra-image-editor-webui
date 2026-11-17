import type { SceneElement, SceneGroup } from "./App";

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
  const nextElements = elements.map((element) => (element.groupId === groupId ? { ...element, groupId: parent } : element));
  const nextGroups = groups.filter((group) => group.id !== groupId).map((group) => (group.parentId === groupId ? { ...group, parentId: parent } : group));
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
    return zs.length ? Math.max(...zs) : -1 - group.order;
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

/** 按顶层作用域重排分组块（top/bottom/up/down），返回重排后的 elements（zIndex 连续）。 */
export function reorderGroups(elements: SceneElement[], groups: SceneGroup[], groupIds: string[], direction: "top" | "bottom" | "up" | "down"): SceneElement[] {
  const selected = new Set(groupIds);
  const allGroupIds = new Set(groups.map((group) => group.id));
  const topGroups = groups.filter((group) => !group.parentId || !allGroupIds.has(group.parentId));
  const blocks: { groupId: string | null; elementIds: string[]; anchor: number }[] = [];
  for (const group of topGroups) {
    const ids = new Set(groupDescendantIds(groups, group.id));
    const members = elements.filter((element) => element.groupId && ids.has(element.groupId));
    blocks.push({ groupId: group.id, elementIds: members.map((element) => element.id), anchor: members.length ? Math.max(...members.map((element) => element.zIndex)) : -1 });
  }
  for (const element of elements.filter((item) => !(item.groupId && allGroupIds.has(item.groupId)))) {
    blocks.push({ groupId: null, elementIds: [element.id], anchor: element.zIndex });
  }
  blocks.sort((a, b) => a.anchor - b.anchor);
  const isSel = (block: { groupId: string | null }) => block.groupId !== null && selected.has(block.groupId);
  let ordered = blocks;
  if (direction === "top" || direction === "bottom") {
    const chosen = blocks.filter((block) => isSel(block));
    const rest = blocks.filter((block) => !isSel(block));
    ordered = direction === "top" ? [...rest, ...chosen] : [...chosen, ...rest];
  } else if (direction === "up") {
    ordered = [...blocks];
    for (let i = ordered.length - 2; i >= 0; i--) { if (isSel(ordered[i]) && !isSel(ordered[i + 1])) { const temp = ordered[i]; ordered[i] = ordered[i + 1]; ordered[i + 1] = temp; } }
  } else {
    ordered = [...blocks];
    for (let i = 1; i < ordered.length; i++) { if (isSel(ordered[i]) && !isSel(ordered[i - 1])) { const temp = ordered[i]; ordered[i] = ordered[i - 1]; ordered[i - 1] = temp; } }
  }
  const byId = new Map(elements.map((element) => [element.id, element]));
  const sequence: SceneElement[] = [];
  for (const block of ordered) {
    const members = block.elementIds.map((id) => byId.get(id)).filter((element): element is SceneElement => Boolean(element));
    members.sort((a, b) => a.zIndex - b.zIndex);
    sequence.push(...members);
  }
  const seen = new Set(sequence.map((element) => element.id));
  for (const element of [...elements].sort((a, b) => a.zIndex - b.zIndex)) { if (!seen.has(element.id)) sequence.push(element); }
  return sequence.map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
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
export function effectiveGroupOpacity(element: SceneElement, groupsById: Map<string, SceneGroup>): number {
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
export function duplicateInPlace(elements: SceneElement[], ids: string[], makeId: () => string, offset = 0): { elements: SceneElement[]; clones: SceneElement[] } {
  const chosen = new Set(ids);
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const result: SceneElement[] = [];
  const cloneIds = new Set<string>();
  for (const element of sorted) {
    result.push(element);
    if (chosen.has(element.id)) {
      const clone = { ...structuredClone(element), id: makeId() };
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
  const roots = groupIds.filter((id) => {
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
  const newGroupIdByOld = new Map<string, string>();
  for (const id of allOldGroupIds) newGroupIdByOld.set(id, makeId());
  const clonedGroups = groups
    .filter((group) => allOldGroupIds.has(group.id))
    .map((group) => {
      const isRoot = roots.includes(group.id);
      const oldParent = group.parentId ?? null;
      const parentId = oldParent && allOldGroupIds.has(oldParent) ? newGroupIdByOld.get(oldParent)! : oldParent;
      return { ...group, id: newGroupIdByOld.get(group.id)!, name: isRoot ? `${group.name}${nameSuffix}` : group.name, parentId, order: group.order + 0.5 };
    });
  const rootNewIds = new Set(roots.map((root) => newGroupIdByOld.get(root)!));
  const clonesByRoot = new Map<string, SceneElement[]>();
  for (const element of elements) {
    if (!element.groupId || !allOldGroupIds.has(element.groupId)) continue;
    const owner = rootSets.find((entry) => entry.ids.has(element.groupId!));
    if (!owner) continue;
    const clone: SceneElement = { ...structuredClone(element), id: makeId(), groupId: newGroupIdByOld.get(element.groupId)! };
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

