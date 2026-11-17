/**
 * 空白画布右键「快捷图形库」的纯逻辑。
 *
 * 收藏是一项 ShapeType 列表，默认给出基础 6 图元 + 文本框（与 defaultBaseShapePresets 一致）。
 * 这里保持零依赖、可单测：只处理字符串数组的校验、默认值、增删，以及排列模式的规整。
 */

export const QUICK_SHAPE_TYPES = [
  "ellipse",
  "rectangle",
  "triangle",
  "four_point_star",
  "five_point_star",
  "ring",
  "textbox"
] as const;

export type QuickShapeType = (typeof QUICK_SHAPE_TYPES)[number];

export type QuickShapeLayout = "list" | "grid";

export const QUICK_SHAPES_STORAGE_KEY = "miliastra-quick-shape-favorites";
export const QUICK_SHAPES_LAYOUT_KEY = "miliastra-quick-shape-layout";

/** 默认收藏：基础 6 图元 + 文本框。 */
export const DEFAULT_FAVORITE_TYPES: QuickShapeType[] = [...QUICK_SHAPE_TYPES];

export function isQuickShapeType(value: unknown): value is QuickShapeType {
  return typeof value === "string" && (QUICK_SHAPE_TYPES as readonly string[]).includes(value);
}

/**
 * 规整收藏列表：非数组（缺失/损坏）回落到默认收藏；数组则只保留合法的已知类型并去重。
 * 注意：用户主动清空后保留空数组（不要重新塞回默认值），以便显示「暂无收藏」。
 */
export function sanitizeFavorites(raw: unknown): QuickShapeType[] {
  if (!Array.isArray(raw)) return [...DEFAULT_FAVORITE_TYPES];
  const seen = new Set<QuickShapeType>();
  const result: QuickShapeType[] = [];
  for (const value of raw) {
    if (isQuickShapeType(value) && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

/** 切换收藏：存在则移除，不存在则追加到末尾。返回新数组，不修改入参。 */
export function toggleFavorite(list: QuickShapeType[], type: QuickShapeType): QuickShapeType[] {
  return list.includes(type) ? list.filter((item) => item !== type) : [...list, type];
}

/** 规整排列模式：只有 "grid" 有意义，其余一律回落 "list"。 */
export function sanitizeLayout(raw: unknown): QuickShapeLayout {
  return raw === "grid" ? "grid" : "list";
}
