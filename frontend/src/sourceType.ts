export type DetectedSourceType = "json" | "css" | "svg" | "lua";

/** 根据文件名后缀优先、其次内容特征，自动识别模板格式。 */
export function detectSourceType(content: string, fileName?: string | null): DetectedSourceType | null {
  const name = (fileName ?? "").toLowerCase();
  const ext = /\.(json|css|svg|lua)$/.exec(name);
  if (ext) return ext[1] as DetectedSourceType;

  const text = (content ?? "").trim();
  if (!text) return null;

  if (text.startsWith("{") || text.startsWith("[")) {
    try { JSON.parse(text); return "json"; } catch { if (text.startsWith("{")) return "json"; }
  }
  if (/<svg[\s>]/i.test(text)) return "svg";
  if (/MILIASTRA_EDITOR_SCENE_V1/.test(text) || /\blocal\s+(ROOT|ELEMENTS|DRAW_ORDER|TEXTBOXES)\b/.test(text) || /\bELEMENTS\s*=/.test(text)) return "lua";
  if (/[.#][\w-]+\s*\{/.test(text) || /:root\s*\{/.test(text) || /@media|@keyframes/.test(text)) return "css";
  if (text.includes("{") && text.includes("}")) return "css";
  return null;
}
