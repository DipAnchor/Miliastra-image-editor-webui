import type { SceneLeaf, SceneGroup } from "./App";
import type { SceneLayer, SmartObject, SmartObjectContent, SmartObjectDocument, SmartObjectMutation } from "./smartObjectModel";
import { rotationMatrix } from "./rotation";
import { selectionBounds } from "./editorSelection";
import { luaMaskActive, luaMaskOf, scaleLuaMask } from "./luaMask";

export type { SceneLayer, SmartObject, SmartObjectContent, SmartObjectDocument } from "./smartObjectModel";
export const isSmartObject = (element: SceneLayer): element is SmartObject => element.type === "smart-object";
const copy = <T>(value: T): T => structuredClone(value);
const finite = (value: number) => Number.isFinite(value);
const positive = (value: number) => finite(value) && value > 0;

/** Validate before applying drafts; no nested objects, escaping links or partial mutations. */
export function validateObjectContent(content: SmartObjectContent): void {
  if (!content || !positive(content.frame?.width) || !positive(content.frame?.height)) throw new Error("invalid object frame");
  if (!Array.isArray(content.elements) || !Array.isArray(content.groups) || content.elements.length > 10000 || content.groups.length > 10000) throw new Error("invalid object content size");
  const ids = new Set<string>();
  for (const item of [...content.elements, ...content.groups]) {
    if (!item.id || ids.has(item.id)) throw new Error("object content requires unique nonempty ids");
    ids.add(item.id);
  }
  const groups = new Map(content.groups.map(group => [group.id, group]));
  for (const element of content.elements) {
    if ((element.type as string) === "smart-object") throw new Error("nested smart objects are not supported");
    if (![element.x, element.y, element.width, element.height, element.rotation, element.rotationX ?? 0, element.rotationY ?? 0, element.opacity, element.zIndex].every(finite) || !positive(element.width) || !positive(element.height)) throw new Error(`${element.id}: invalid leaf geometry`);
    if (element.groupId != null && !groups.has(element.groupId)) throw new Error("object contains dangling groupId");
  }
  const resolved = new Set<string>();
  for (const group of content.groups) {
    if (!finite(group.opacity) || group.opacity < 0 || group.opacity > 1) throw new Error("invalid group opacity");
    const seen = new Set<string>();
    let parent: string | null = group.id;
    while (parent !== null && !resolved.has(parent)) {
      const current = groups.get(parent);
      if (!current || seen.has(parent)) throw new Error("object contains invalid group parent or cycle");
      seen.add(parent);
      parent = current.parentId;
    }
    for (const id of seen) resolved.add(id);
  }
}

export function validateSmartObject(object: SmartObject): void {
  const allowed = new Set(["id", "name", "layerName", "type", "x", "y", "rotation", "scale", "opacity", "zIndex", "visible", "locked", "groupId", "content"]);
  for (const key of Object.keys(object)) if (!allowed.has(key)) throw new Error(`unsupported object shell field: ${key}`);
  if (object.type !== "smart-object" || !object.id || !positive(object.scale)) throw new Error("object scale must be positive and finite");
  if (![object.x, object.y, object.rotation, object.opacity, object.zIndex].every(finite) || object.opacity < 0 || object.opacity > 1) throw new Error("invalid object shell geometry or opacity");
  validateObjectContent(object.content);
}

export function objectSize(object: SmartObject): { width: number; height: number } {
  validateSmartObject(object);
  return { width: object.content.frame.width * object.scale, height: object.content.frame.height * object.scale };
}

export function packGroup(document: SmartObjectDocument, groupId: string, objectId: string): SmartObjectMutation {
  const groups = document.groups ?? [];
  if (!objectId || [...document.elements, ...groups].some(item => item.id === objectId)) throw new Error("invalid or duplicate object id");
  const target = groups.find(group => group.id === groupId);
  if (!target) throw new Error("group not found");
  const ids = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) { ids.add(group.id); changed = true; }
  }
  const belongs = (element: SceneLayer) => !!element.groupId && ids.has(element.groupId);
  const sorted = [...document.elements].sort((a, b) => a.zIndex - b.zIndex);
  const members = sorted.filter(belongs);
  if (!members.length) throw new Error("group is empty");
  if (members.some(isSmartObject)) throw new Error("nested smart objects are not supported");
  const leaves = members.filter((element): element is SceneLeaf => !isSmartObject(element));
  const first = sorted.findIndex(belongs);
  if (!sorted.slice(first, first + members.length).every(belongs)) throw new Error("group members must be contiguous");
  const bounds = selectionBounds(leaves)!;
  // Edge-on projections get a small legal frame centered on the unchanged geometry.
  const frame = { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
  const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
  const content: SmartObjectContent = {
    frame,
    elements: leaves.map((element, index) => ({ ...copy(element), x: element.x - cx + frame.width / 2, y: element.y - cy + frame.height / 2, zIndex: index })),
    // Transfer the converted group's compositing state to the shell exactly once.
    groups: groups.filter(group => ids.has(group.id)).map(group => group.id === groupId
      ? { ...copy(group), parentId: null, opacity: 1, visible: true, locked: false }
      : copy(group))
  };
  const shell: SmartObject = {
    id: objectId, name: target.name, type: "smart-object", x: cx, y: cy, rotation: 0,
    opacity: target.opacity, zIndex: first, visible: target.visible, locked: target.locked,
    groupId: target.parentId, scale: 1, content
  };
  validateSmartObject(shell);
  return {
    elements: [...sorted.slice(0, first), shell, ...sorted.slice(first + members.length)].map((element, index) => ({ ...element, zIndex: index })),
    groups: groups.filter(group => !ids.has(group.id))
  };
}

export function cloneObject(object: SmartObject, nextId: () => string): SmartObject {
  validateSmartObject(object);
  const clone = copy(object);
  const used = new Set([object.id, ...object.content.elements.map(item => item.id), ...object.content.groups.map(item => item.id)]);
  const allocate = () => {
    const id = nextId();
    if (!id || used.has(id)) throw new Error("id generator returned a duplicate or empty id");
    used.add(id);
    return id;
  };
  const groups = new Map(clone.content.groups.map(group => [group.id, allocate()]));
  clone.id = allocate();
  clone.content.groups = clone.content.groups.map(group => ({ ...group, id: groups.get(group.id)!, parentId: group.parentId ? groups.get(group.parentId)! : null }));
  clone.content.elements = clone.content.elements.map(element => ({ ...element, id: allocate(), groupId: element.groupId ? groups.get(element.groupId)! : null }));
  return clone;
}

function bakeLeaf(element: SceneLeaf, object: SmartObject): SceneLeaf {
  const scale = object.scale, path = `${object.id}/${element.id}`;
  const fail = (reason: string): never => { throw new Error(`${path}: ${reason}`); };
  const r = rotationMatrix({ rotation: object.rotation }), local = rotationMatrix(element);
  const rotation = element.rotation + object.rotation;
  const candidate = rotationMatrix({ ...element, rotation });
  const expected = [r.a * local.a + r.c * local.b, r.b * local.a + r.d * local.b,
    r.a * local.c + r.c * local.d, r.b * local.c + r.d * local.d];
  if (!finite(rotation) || !expected.every(finite) || !Object.values(candidate).every(finite)) fail("released rotation overflows finite geometry");
  if (Object.values(candidate).some((value, index) => Math.abs(value - expected[index]) > 1e-9)) fail("mixed-axis composition cannot be released exactly");
  // Unlike drawing export, this pure helper has no metadata to resolve an omitted imageType.
  if (scale !== 1 && element.type === "image" && element.imageType !== "basic") fail(element.imageType === "stretch"
    ? "stretch image scale cannot be released exactly" : "image scale requires an explicit basic imageType to be released exactly");
  if (luaMaskActive(element.luaMask) && (object.rotation % 360 !== 0 || (scale !== 1 && element.luaMask?.imageType !== "basic"))) fail("mask transform cannot be released exactly; scaling requires an explicit basic imageType");
  const width = element.width * scale, height = element.height * scale;
  if (![width, height].every(value => finite(value) && value >= 1)) fail("released dimensions would be clamped below one pixel or overflow");
  const x = element.x - object.content.frame.width / 2, y = element.y - object.content.frame.height / 2;
  const leaf: SceneLeaf = {
    ...copy(element), x: object.x + scale * (r.a * x + r.c * y), y: object.y + scale * (r.b * x + r.d * y),
    width, height, rotation
  };
  if (![leaf.x, leaf.y].every(finite)) fail("released world position overflows finite geometry");
  const settings = element.textBox ?? (element.type === "textbox" ? {
    text: "", fontSize: 20, minFontSize: 12, autoSize: true, textColor: element.color, textOpacity: element.opacity,
    bgColor: "#ffffff", bgOpacity: 0, outlineEnabled: true, outlineColor: "#333333", outlineOpacity: .2,
    alignH: "left" as const, alignV: "top" as const, anchorType: "center" as const, visible: true,
    scaleX: 1, scaleY: 1, anchorMinX: .5, anchorMinY: .5, anchorMaxX: .5, anchorMaxY: .5, pivotX: .5, pivotY: .5
  } : undefined);
  if (settings) {
    if ([settings.anchorMinX, settings.anchorMinY, settings.anchorMaxX, settings.anchorMaxY, settings.pivotX, settings.pivotY]
      .some(value => (value ?? .5) !== .5)) fail("custom text anchors/pivot cannot be rebased exactly from the fixed local frame");
    if (scale !== 1) {
      const scaleFont = (value: number, name: string) => {
        const scaled = value * scale;
        if (!finite(scaled) || scaled < 1 || Math.abs(scaled - Math.round(scaled)) > 1e-9) fail(`${name} font size must scale to a positive integer`);
        return Math.round(scaled);
      };
      leaf.textBox = { ...settings, fontSize: scaleFont(settings.fontSize ?? 20, "fontSize"), minFontSize: scaleFont(settings.minFontSize ?? 12, "minFontSize"),
        text: (settings.text ?? "").replace(/<size\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*>/gi, (_match, value: string) =>
          "<size=" + BigInt(scaleFont(Number(value), "rich-text")).toString() + ">") };
    }
  }
  if (scale !== 1 && element.luaMask) {
    const mask = scaleLuaMask(luaMaskOf(element.luaMask), scale);
    if ([mask.offsetX, mask.offsetY, mask.width, mask.height, mask.softEdgeWidthX, mask.softEdgeWidthY]
      .some(value => value !== null && !finite(value))) fail("released mask geometry overflows");
    leaf.luaMask = mask;
  }
  return leaf;
}

/** Reuse a complete single root; only wrap multiple roots or ungrouped contents. */
export function releaseObject(document: SmartObjectDocument, objectId: string): SmartObjectMutation & { releasedGroupId: string } {
  const object = document.elements.find(element => element.id === objectId);
  if (!object || !isSmartObject(object)) throw new Error("smart object not found");
  validateSmartObject(object);
  const outerGroups = document.groups ?? [];
  const used = new Set([...document.elements, ...outerGroups].map(item => item.id));
  for (const item of [...object.content.elements, ...object.content.groups]) {
    if (used.has(item.id)) throw new Error(`cannot release: duplicate id ${item.id}`);
    used.add(item.id);
  }
  const roots = object.content.groups.filter(group => group.parentId === null);
  // Validated group links form a forest: with one root, every grouped leaf belongs to it.
  const reusableRoot = roots.length === 1 && object.content.elements.every(element => element.groupId != null) ? roots[0] : null;
  const releasedGroupId = reusableRoot?.id ?? object.id;
  // Background is local to this shell, never a root-level background after release.
  const leaves = [...object.content.elements].sort((a, b) => a.zIndex - b.zIndex).map(element => ({
    ...bakeLeaf(element, object), isBackground: false, groupId: element.groupId ?? releasedGroupId
  }));
  const releasedGroup: SceneGroup = {
    ...(reusableRoot ? copy(reusableRoot) : {}),
    id: releasedGroupId, name: object.layerName?.trim() || object.name, parentId: object.groupId ?? null,
    opacity: object.opacity * (reusableRoot?.opacity ?? 1),
    visible: object.visible !== false && reusableRoot?.visible !== false,
    locked: object.locked === true || reusableRoot?.locked === true,
    collapsed: reusableRoot?.collapsed ?? false, order: object.zIndex
  };
  const groups = [...outerGroups, releasedGroup, ...object.content.groups
    .filter(group => group.id !== reusableRoot?.id)
    .map(group => ({ ...copy(group), parentId: group.parentId ?? releasedGroupId }))];
  const elements = [...document.elements].sort((a, b) => a.zIndex - b.zIndex);
  elements.splice(elements.indexOf(object), 1, ...leaves);
  return { elements: elements.map((element, index) => ({ ...element, zIndex: index })), groups, releasedGroupId };
}
