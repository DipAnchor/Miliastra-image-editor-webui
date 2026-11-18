import type { SceneElement, SceneGroup } from "./App";

/** Smart-object dimensions belong to the frame and scale, never to the shell. */
export function sceneLayerSize(element: SceneElement): { width: number; height: number } {
  return element.type === "smart-object"
    ? { width: element.content.frame.width * element.scale, height: element.content.frame.height * element.scale }
    : { width: element.width, height: element.height };
}

/** Include object-local ids and group links when reserving an existing scene. */
export function collectSceneIds(elements: readonly SceneElement[], groups: readonly SceneGroup[] = []): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    ids.add(group.id);
    if (group.parentId) ids.add(group.parentId);
  }
  for (const element of elements) {
    ids.add(element.id);
    if (element.groupId) ids.add(element.groupId);
    if (element.type === "smart-object") {
      for (const id of collectSceneIds(element.content.elements, element.content.groups)) ids.add(id);
    }
  }
  return ids;
}

/** A bad generator fails atomically instead of silently linking copies to originals. */
export function createSceneIdAllocator(makeId: () => string, occupiedIds: Iterable<string>): () => string {
  const used = new Set(occupiedIds);
  return () => {
    const id = makeId();
    if (!id || used.has(id)) throw new Error("id generator returned a duplicate or empty id");
    used.add(id);
    return id;
  };
}

/** Deep-clone one layer with a shared allocator; object content remains local. */
export function cloneSceneLayer<T extends SceneElement>(element: T, allocate: () => string): T {
  const clone = structuredClone(element);
  clone.id = allocate();
  if (clone.type === "smart-object") {
    const groupIds = new Map(clone.content.groups.map(group => [group.id, allocate()]));
    clone.content.groups = clone.content.groups.map(group => ({
      ...group, id: groupIds.get(group.id)!, parentId: group.parentId ? groupIds.get(group.parentId) ?? null : null
    }));
    clone.content.elements = clone.content.elements.map(leaf => ({
      ...leaf, id: allocate(), groupId: leaf.groupId ? groupIds.get(leaf.groupId) ?? null : leaf.groupId
    }));
  }
  return clone;
}

export type SceneCloneOptions = {
  occupiedIds?: Iterable<string>;
  offset?: number;
  startZ?: number;
  /** Keep links to existing destination groups for in-place copies; imports use false. */
  preserveExternalGroups?: boolean;
};

/** Clone a clipboard/import payload together so nested group membership survives. */
export function cloneSceneLayers(
  elements: readonly SceneElement[], groups: readonly SceneGroup[], makeId: () => string, options: SceneCloneOptions = {}
): { elements: SceneElement[]; groups: SceneGroup[] } {
  const used = collectSceneIds(elements, groups);
  for (const id of options.occupiedIds ?? []) used.add(id);
  const allocate = createSceneIdAllocator(makeId, used);
  const groupIds = new Map(groups.map(group => [group.id, allocate()]));
  const remapGroup = (id: string | null | undefined) => id ? groupIds.get(id) ?? (options.preserveExternalGroups === false ? null : id) : id;
  const ordered = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const clones = ordered.map((element, index) => {
    const clone = cloneSceneLayer(element, allocate);
    const groupId = remapGroup(element.groupId);
    if (groupId !== element.groupId) clone.groupId = groupId;
    clone.x += options.offset ?? 0;
    clone.y += options.offset ?? 0;
    if (options.startZ !== undefined) clone.zIndex = options.startZ + index;
    return clone;
  });
  return {
    elements: clones,
    groups: groups.map(group => ({ ...structuredClone(group), id: groupIds.get(group.id)!, parentId: remapGroup(group.parentId) ?? null }))
  };
}
