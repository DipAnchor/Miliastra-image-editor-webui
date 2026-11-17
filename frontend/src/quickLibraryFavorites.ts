/**
 * 快捷图形库的通用收藏模型：形状 / 图片素材 / 元件 / 已保存图元 都能收藏。
 * 自包含、零依赖，便于单测与持久化迁移（旧的“形状字符串数组”会被识别）。
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

export type QuickFavorite =
  | { kind: "shape"; type: CoreShapeType }
  | { kind: "asset"; assetId: number; label?: string }
  | { kind: "prefab"; prefabId: number; name: string }
  | { kind: "saved"; savedId: string; name: string };

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
      return `saved:${fav.savedId}`;
  }
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
    case "saved":
      return typeof v.savedId === "string"
        ? { kind: "saved", savedId: v.savedId, name: typeof v.name === "string" ? v.name : v.savedId }
        : null;
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
