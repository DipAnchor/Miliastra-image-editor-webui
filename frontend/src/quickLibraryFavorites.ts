import type { SceneElement } from "./App";
import { validateSmartObject } from "./smartObjects";
import { parseLuaMaskPatch } from "./luaMask";

/**
 * 快捷图形库收藏与持久化迁移；已保存图元收藏保存独立内容，不再引用当前作品。
 * App 仅用于类型，运行时验证使用纯模型模块。
 */

export type CoreShapeType =
  | "ellipse"
  | "rectangle"
  | "triangle"
  | "four_point_star"
  | "five_point_star"
  | "ring"
  | "textbox";

export const CORE_SHAPE_TYPES: CoreShapeType[] = [
  "ellipse",
  "rectangle",
  "triangle",
  "four_point_star",
  "five_point_star",
  "ring",
  "textbox"
];

export function isCoreShapeType(value: unknown): value is CoreShapeType {
  return typeof value === "string" && (CORE_SHAPE_TYPES as readonly string[]).includes(value);
}

export type SavedFavorite = {
  kind: "saved";
  savedId: string;
  name: string;
  sourceCanvasId?: string;
  snapshot?: { version: 1; element: SceneElement };
};

export type QuickFavorite =
  | { kind: "shape"; type: CoreShapeType }
  | { kind: "asset"; assetId: number; label?: string }
  | { kind: "prefab"; prefabId: number; name: string }
  | SavedFavorite;

export const QUICK_FAVORITES_STORAGE_KEY = "miliastra-quick-library-favorites";

export function favoriteKey(fav: QuickFavorite): string {
  switch (fav.kind) {
    case "shape":
      return `shape:${fav.type}`;
    case "asset":
      return `asset:${fav.assetId}`;
    case "prefab":
      return `prefab:${fav.prefabId}`;
    case "saved":
      return savedFavoriteKey(fav);
  }
}

/** Source ids distinguish independently saved items; legacy ids never bind to a canvas. */
export function savedFavoriteKey(favorite: SavedFavorite): string {
  return favorite.sourceCanvasId === undefined
    ? "saved:legacy:" + JSON.stringify([favorite.savedId])
    : "saved:" + JSON.stringify([favorite.sourceCanvasId, favorite.savedId]);
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const optionalFields = (value: Record<string, unknown>, keys: string[], valid: (field: unknown) => boolean) =>
  keys.every(key => value[key] === undefined || valid(value[key]));
const isString = (value: unknown) => typeof value === "string";
const isBoolean = (value: unknown) => typeof value === "boolean";
const opacity = (value: unknown) => finite(value) && value >= 0 && value <= 1;

/** Reject values that JSON would corrupt, and cyclic/non-scene objects, before cloning. */
function isJsonData(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!Array.isArray(value) && !isRecord(value)) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(item => isJsonData(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function validCommon(value: Record<string, unknown>): boolean {
  return identifier(value.id) && typeof value.name === "string"
    && [value.x, value.y, value.rotation, value.zIndex].every(finite) && opacity(value.opacity)
    && optionalFields(value, ["visible", "locked"], isBoolean)
    && optionalFields(value, ["layerName"], isString)
    && (value.groupId == null || identifier(value.groupId));
}

function validTextBox(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return optionalFields(value, ["text", "textColor", "bgColor", "outlineColor"], isString)
    && optionalFields(value, ["autoSize", "outlineEnabled", "visible"], isBoolean)
    && optionalFields(value, ["fontSize", "minFontSize", "scaleX", "scaleY", "anchorMinX", "anchorMinY", "anchorMaxX", "anchorMaxY", "pivotX", "pivotY"], finite)
    && optionalFields(value, ["textOpacity", "bgOpacity", "outlineOpacity"], opacity)
    && optionalFields(value, ["alignH"], field => ["left", "center", "right"].includes(field as string))
    && optionalFields(value, ["alignV"], field => ["top", "middle", "bottom"].includes(field as string))
    && optionalFields(value, ["anchorType"], field => field === "center" || field === "custom");
}

function validLeaf(value: unknown): boolean {
  if (!isRecord(value) || !validCommon(value)) return false;
  return (isCoreShapeType(value.type) || value.type === "image" || value.type === "prefab" || value.type === "other")
    && finite(value.width) && value.width > 0 && finite(value.height) && value.height > 0
    && typeof value.color === "string" && typeof value.isBackground === "boolean"
    && optionalFields(value, ["rotationX", "rotationY", "imageAssetId", "prefabId"], finite)
    && optionalFields(value, ["imageTint"], isBoolean)
    && optionalFields(value, ["prefabVariable"], isString)
    && optionalFields(value, ["imageType"], field => field === "basic" || field === "stretch")
    && (value.textBox === undefined || validTextBox(value.textBox))
    && (value.luaMask === undefined || (parseLuaMaskPatch(value.luaMask), true));
}

function validGroup(value: unknown): boolean {
  return isRecord(value) && identifier(value.id) && typeof value.name === "string"
    && (value.parentId === null || identifier(value.parentId))
    && typeof value.visible === "boolean" && typeof value.collapsed === "boolean"
    && opacity(value.opacity) && finite(value.order) && optionalFields(value, ["locked"], isBoolean);
}

/** Validate untrusted persisted data, deep-clone it, and detach only its outer membership. */
function cloneFavoriteElement(value: unknown): SceneElement | null {
  try {
    if (!isRecord(value) || !isJsonData(value) || !validCommon(value)) return null;
    if (value.type === "smart-object") {
      const content = value.content;
      if (!isRecord(content) || !Array.isArray(content.elements) || !Array.isArray(content.groups)
        || content.elements.length > 10000 || content.groups.length > 10000
        || !content.elements.every(validLeaf) || !content.groups.every(validGroup)) return null;
      validateSmartObject(value as unknown as Extract<SceneElement, { type: "smart-object" }>);
    } else if (!validLeaf(value)) return null;
    const element = structuredClone(value) as SceneElement;
    element.groupId = null;
    return element;
  } catch {
    return null;
  }
}

/** Freeze the saved item now; future source edits and inserts must not share any nested state. */
export function captureSavedFavorite(
  item: { id: string; name: string; element: SceneElement }, canvasId: string
): SavedFavorite {
  const element = cloneFavoriteElement(item.element);
  if (!identifier(item.id) || typeof item.name !== "string" || !identifier(canvasId) || !element) {
    throw new Error("invalid saved favorite");
  }
  return {
    kind: "saved", savedId: item.id, name: item.name, sourceCanvasId: canvasId,
    snapshot: { version: 1, element }
  };
}

/** No savedItems lookup: unresolved entries stay removable, and every result is independent. */
export function resolveSavedFavorite(favorite: SavedFavorite): SceneElement | null {
  return identifier(favorite.sourceCanvasId) && favorite.snapshot?.version === 1 ? cloneFavoriteElement(favorite.snapshot.element) : null;
}

export function favoritesHave(list: QuickFavorite[], key: string): boolean {
  return list.some((item) => favoriteKey(item) === key);
}

export function toggleQuickFavorite(list: QuickFavorite[], fav: QuickFavorite): QuickFavorite[] {
  const key = favoriteKey(fav);
  return list.some((item) => favoriteKey(item) === key)
    ? list.filter((item) => favoriteKey(item) !== key)
    : [...list, fav];
}

/** 默认收藏：基础 6 图元 + 文本框。 */
export function defaultQuickFavorites(): QuickFavorite[] {
  return CORE_SHAPE_TYPES.map((type) => ({ kind: "shape" as const, type }));
}

function normalizeFavorite(value: unknown): QuickFavorite | null {
  if (typeof value === "string") {
    // 旧版仅存形状字符串
    return isCoreShapeType(value) ? { kind: "shape", type: value } : null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case "shape":
      return isCoreShapeType(v.type) ? { kind: "shape", type: v.type } : null;
    case "asset":
      return typeof v.assetId === "number" && Number.isFinite(v.assetId)
        ? { kind: "asset", assetId: v.assetId, ...(typeof v.label === "string" ? { label: v.label } : {}) }
        : null;
    case "prefab":
      return typeof v.prefabId === "number" && Number.isFinite(v.prefabId)
        ? { kind: "prefab", prefabId: v.prefabId, name: typeof v.name === "string" ? v.name : `Prefab ${v.prefabId}` }
        : null;
    case "saved": {
      if (!identifier(v.savedId)) return null;
      const favorite: SavedFavorite = {
        kind: "saved", savedId: v.savedId, name: typeof v.name === "string" ? v.name : v.savedId
      };
      if (identifier(v.sourceCanvasId)) favorite.sourceCanvasId = v.sourceCanvasId;
      // Bad or future snapshots keep the entry, never fall back to a coincidental savedId.
      if (favorite.sourceCanvasId !== undefined && isRecord(v.snapshot) && v.snapshot.version === 1) {
        const element = cloneFavoriteElement(v.snapshot.element);
        if (element) favorite.snapshot = { version: 1, element };
      }
      return favorite;
    }
    default:
      return null;
  }
}

/**
 * 规整收藏列表：非数组回落到默认；数组保留合法项并按 key 去重。
 * 支持旧版 string[] 迁移。空数组视为用户主动清空，保留为空。
 */
export function sanitizeQuickFavorites(raw: unknown): QuickFavorite[] {
  if (!Array.isArray(raw)) return defaultQuickFavorites();
  const seen = new Set<string>();
  const result: QuickFavorite[] = [];
  for (const value of raw) {
    const fav = normalizeFavorite(value);
    if (!fav) continue;
    const key = favoriteKey(fav);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fav);
  }
  return result;
}
