import type { SceneElement } from "./App";

/** 追加导入：把 incoming 元素接在现有元素之上，并重新分配 id（避免冲突）。 */
export function appendScene(currentElements: SceneElement[], incomingElements: SceneElement[], makeId: () => string): { elements: SceneElement[] } {
  const base = currentElements.reduce((max, element) => Math.max(max, element.zIndex + 1), 0);
  const appended = incomingElements.map((element, index) => ({
    ...structuredClone(element),
    id: makeId(),
    zIndex: base + index
  }));
  const elements = [...currentElements, ...appended]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
  return { elements };
}
