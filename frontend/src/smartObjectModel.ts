import type { SceneElement, SceneLeaf, SceneGroup } from "./App";

/** Persisted format shared with the backend schemaVersion 2 object model. */
export type SmartObjectContent = {
  frame: { width: number; height: number };
  elements: SceneLeaf[];
  groups: SceneGroup[];
};

/** Size is derived from content.frame × scale, never persisted on the shell. */
export type SmartObject = Pick<SceneLeaf,
  "id" | "name" | "layerName" | "x" | "y" | "rotation" | "opacity" |
  "zIndex" | "visible" | "locked" | "groupId"
> & {
  type: "smart-object";
  scale: number;
  content: SmartObjectContent;
};

export type SceneLayer = SceneElement;
export type SmartObjectDocument = { elements: SceneLayer[]; groups?: SceneGroup[] };
export type SmartObjectMutation = { elements: SceneLayer[]; groups: SceneGroup[] };
