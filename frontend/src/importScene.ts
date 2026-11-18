import type { SceneElement, SceneGroup } from "./App";
import { cloneSceneLayers, collectSceneIds } from "./sceneLayer";

/** Append a whole scene above the destination, preserving groups and remapping every id. */
export function appendScene(
  currentElements: SceneElement[], incomingElements: SceneElement[], makeId: () => string,
  currentGroups: SceneGroup[] = [], incomingGroups: SceneGroup[] = []
): { elements: SceneElement[]; groups: SceneGroup[] } {
  const base = currentElements.reduce((max, element) => Math.max(max, element.zIndex + 1), 0);
  const ordered = [...incomingElements].sort((a, b) => a.zIndex - b.zIndex);
  const appended = cloneSceneLayers(ordered, incomingGroups, makeId, {
    occupiedIds: collectSceneIds(currentElements, currentGroups), startZ: base, preserveExternalGroups: false
  });
  const elements = [...currentElements, ...appended.elements]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
  return { elements, groups: [...currentGroups, ...appended.groups] };
}
