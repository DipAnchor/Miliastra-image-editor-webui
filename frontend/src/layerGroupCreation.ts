import type { SceneElement, SceneGroup } from "./App";
import { effectiveLocked, type GroupMutation } from "./layerTree";
import { collectSceneIds, createSceneIdAllocator } from "./sceneLayer";

export type LayerGroupParent = { groupId: string } | { newGroupKey: string };
export type CreateLayerGroupInput = {
  key: string;
  name: string;
  parent?: LayerGroupParent;
  elementIds?: string[];
};
export type CreatedLayerGroup = Pick<SceneGroup, "id" | "name" | "parentId"> & { key: string };
export type CreateLayerGroupFailure = {
  ok: false;
  error: string;
  code: "INVALID_INPUT" | "DUPLICATE_KEY" | "DUPLICATE_MEMBER" | "UNKNOWN_PARENT"
    | "PARENT_CYCLE" | "UNKNOWN_ELEMENT" | "UNSUPPORTED_MEMBER" | "EMPTY_GROUP"
    | "PARENT_MISMATCH" | "LOCKED" | "INTERLEAVED_LAYERS" | "EDITOR_BUSY";
  groupKey?: string;
  elementIds?: string[];
  blockingElementIds?: string[];
  expectedParentId?: string | null;
  actualParentId?: string | null;
};
export type CreateLayerGroupResult =
  | { ok: true; count: number; groups: CreatedLayerGroup[] }
  | CreateLayerGroupFailure;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const has = (record: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Parse the entire tool argument object. Only names are trimmed; IDs and keys are exact. */
export function parseCreateLayerGroupsArgs(args: unknown): CreateLayerGroupInput[] {
  if (!isRecord(args) || Object.keys(args).some(key => key !== "groups") || !has(args, "groups") ||
    !Array.isArray(args.groups) || args.groups.length === 0) {
    throw new Error("Expected a non-empty groups array and no unknown arguments");
  }
  const result: CreateLayerGroupInput[] = [];
  for (const raw of args.groups) {
    if (!isRecord(raw) || Object.keys(raw).some(key => !["key", "name", "parent", "elementIds"].includes(key)) ||
      !has(raw, "key") || !isId(raw.key) || !has(raw, "name") || typeof raw.name !== "string" || !raw.name.trim()) {
      throw new Error("Each group requires a non-empty key and name and no unknown fields");
    }
    const item: CreateLayerGroupInput = { key: raw.key, name: raw.name.trim() };
    if (has(raw, "parent")) {
      const parent = raw.parent;
      if (!isRecord(parent) || Object.keys(parent).length !== 1 ||
        !((has(parent, "groupId") && isId(parent.groupId)) || (has(parent, "newGroupKey") && isId(parent.newGroupKey)))) {
        throw new Error("Group parent must contain exactly one non-empty groupId or newGroupKey");
      }
      item.parent = has(parent, "groupId") ? { groupId: parent.groupId as string } : { newGroupKey: parent.newGroupKey as string };
    }
    if (has(raw, "elementIds")) {
      if (!Array.isArray(raw.elementIds)) throw new Error("Group elementIds must be an array of non-empty strings");
      const ids: string[] = [];
      for (const id of raw.elementIds) {
        if (!isId(id)) throw new Error("Group elementIds must be an array of non-empty strings");
        ids.push(id);
      }
      item.elementIds = ids;
    }
    result.push(item);
  }
  return result;
}

function failure(
  code: CreateLayerGroupFailure["code"], error: string,
  details: Omit<CreateLayerGroupFailure, "ok" | "code" | "error"> = {}
): CreateLayerGroupFailure {
  return { ok: false, code, error, ...details };
}

/** Build one atomic, neutral grouping transaction without changing input objects or zIndex. */
export function planLayerGroupCreation(
  elements: SceneElement[], groups: SceneGroup[], input: CreateLayerGroupInput[], makeId: () => string
): (Extract<CreateLayerGroupResult, { ok: true }> & { next: GroupMutation }) | CreateLayerGroupFailure {
  let batch: CreateLayerGroupInput[];
  try {
    batch = parseCreateLayerGroupsArgs({ groups: input });
  } catch (error) {
    return failure("INVALID_INPUT", error instanceof Error ? error.message : String(error));
  }
  const byKey = new Map<string, CreateLayerGroupInput>();
  for (const item of batch) {
    if (byKey.has(item.key)) return failure("DUPLICATE_KEY", "Duplicate group key: " + item.key, { groupKey: item.key });
    byKey.set(item.key, item);
  }
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const elementsById = new Map(elements.map(element => [element.id, element]));
  if (groupsById.size !== groups.length || elementsById.size !== elements.length) {
    return failure("INVALID_INPUT", "Scene contains duplicate element or group IDs");
  }

  // Resolve the existing parent where each new subtree attaches. The ordering also
  // gives a parent-before-child traversal, without recursion on untrusted batches.
  const anchors = new Map<string, string | null>();
  const parentFirst: CreateLayerGroupInput[] = [];
  for (const item of batch) {
    const path: CreateLayerGroupInput[] = [];
    const visiting = new Set<string>();
    let current = item;
    let anchor: string | null = null;
    while (true) {
      if (anchors.has(current.key)) {
        anchor = anchors.get(current.key)!;
        break;
      }
      if (visiting.has(current.key)) return failure("PARENT_CYCLE", "Group parent cycle at: " + current.key, { groupKey: item.key });
      visiting.add(current.key);
      path.push(current);
      if (!current.parent) break;
      if ("groupId" in current.parent) {
        anchor = current.parent.groupId;
        const seen = new Set<string>();
        let existingId: string | null = anchor;
        while (existingId !== null) {
          if (seen.has(existingId)) return failure("PARENT_CYCLE", "Existing parent cycle at: " + existingId, { groupKey: item.key });
          seen.add(existingId);
          const existing = groupsById.get(existingId);
          if (!existing) return failure("UNKNOWN_PARENT", "Unknown parent group: " + existingId, { groupKey: item.key });
          existingId = existing.parentId ?? null;
        }
        break;
      }
      const parent = byKey.get(current.parent.newGroupKey);
      if (!parent) return failure("UNKNOWN_PARENT", "Unknown new parent key: " + current.parent.newGroupKey, { groupKey: item.key });
      current = parent;
    }
    for (let i = path.length - 1; i >= 0; i--) {
      anchors.set(path[i].key, anchor);
      parentFirst.push(path[i]);
    }
  }

  const ownerByElement = new Map<string, string>();
  const descendants = new Map<string, Set<string>>();
  for (const item of batch) {
    const expectedParentId = anchors.get(item.key)!;
    const members = new Set<string>();
    descendants.set(item.key, members);
    for (const id of item.elementIds ?? []) {
      if (ownerByElement.has(id)) return failure("DUPLICATE_MEMBER", "Element is assigned more than once: " + id, { groupKey: item.key, elementIds: [id] });
      const element = elementsById.get(id);
      if (!element) return failure("UNKNOWN_ELEMENT", "Unknown canvas element: " + id, { groupKey: item.key, elementIds: [id] });
      if (element.type === "smart-object") return failure("UNSUPPORTED_MEMBER", "Smart-object members are unsupported: " + id, { groupKey: item.key, elementIds: [id] });
      const actualParentId = element.groupId ?? null;
      if (actualParentId !== expectedParentId) return failure("PARENT_MISMATCH", "Element has a different direct parent: " + id,
        { groupKey: item.key, elementIds: [id], expectedParentId, actualParentId });
      if (effectiveLocked(element, groupsById)) return failure("LOCKED", "Element or ancestor is locked: " + id, { groupKey: item.key, elementIds: [id] });
      ownerByElement.set(id, item.key);
      members.add(id);
    }
    if (effectiveLocked({ groupId: expectedParentId }, groupsById)) {
      return failure("LOCKED", "Target parent or ancestor is locked for group: " + item.key, { groupKey: item.key });
    }
  }

  for (let i = parentFirst.length - 1; i >= 0; i--) {
    const item = parentFirst[i];
    if (item.parent && "newGroupKey" in item.parent) {
      const parentMembers = descendants.get(item.parent.newGroupKey)!;
      for (const id of descendants.get(item.key)!) parentMembers.add(id);
    }
  }
  // Empty children must be diagnosed before interval conflicts elsewhere.
  for (const item of batch) {
    if (!descendants.get(item.key)!.size) return failure("EMPTY_GROUP", "Group subtree has no ordinary elements: " + item.key, { groupKey: item.key });
  }
  const byZ = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const ranks = new Map(byZ.map((element, index) => [element.id, index]));
  for (const item of batch) {
    const members = descendants.get(item.key)!;
    let first = byZ.length;
    let last = -1;
    for (const id of members) {
      const rank = ranks.get(id)!;
      first = Math.min(first, rank);
      last = Math.max(last, rank);
    }
    const interval = byZ.slice(first, last + 1);
    const blockers = interval.filter(element => !members.has(element.id)).map(element => element.id);
    if (blockers.length) return failure("INTERLEAVED_LAYERS", "Group " + item.key + " contains an interleaved layer: " + blockers.join(", "), {
      groupKey: item.key, elementIds: interval.filter(element => members.has(element.id)).map(element => element.id), blockingElementIds: blockers
    });
  }

  // Allocation starts only after every semantic check passed. Allocator errors
  // intentionally propagate to the caller's existing error channel.
  const allocate = createSceneIdAllocator(makeId, collectSceneIds(elements, groups));
  const newIds = new Map(batch.map(item => [item.key, allocate()]));
  const created: CreatedLayerGroup[] = batch.map(item => ({
    key: item.key, id: newIds.get(item.key)!, name: item.name,
    parentId: !item.parent ? null : "groupId" in item.parent ? item.parent.groupId : newIds.get(item.parent.newGroupKey)!
  }));
  return {
    ok: true, count: created.length, groups: created,
    next: {
      elements: elements.map(element => {
        const owner = ownerByElement.get(element.id);
        return owner === undefined ? element : { ...element, groupId: newIds.get(owner)! };
      }),
      groups: [...groups, ...created.map(({ key: _key, ...group }) => ({ ...group, visible: true, opacity: 1, collapsed: false, order: 0 }))]
    }
  };
}
