import type { SceneDocument } from "./App";

/** 历史存档：整份场景快照，以 canvasId 作为身份，按最后修改时间排序。 */
export type SceneArchive = {
  id: string;
  /** 画布身份，用于判定「同一个存档」；名字只作显示。 */
  canvasId: string;
  name: string;
  savedAt: number;
  scene: SceneDocument;
};

/** 自动存档：每个画布固定一条，按 canvasId 覆盖。 */
export type AutoArchive = {
  canvasId: string;
  name: string;
  savedAt: number;
  scene: SceneDocument;
};

export type AutoSaveSettings = { enabled: boolean; intervalMs: number; restoreOnLoad: boolean };

const ARCHIVES_KEY = "miliastra-scene-archives";
const MAX_KEY = "miliastra-scene-archives-max";
const AUTOSAVE_KEY = "miliastra-canvas-autosaves";
const AUTOSAVE_SETTINGS_KEY = "miliastra-autosave-settings";

export const DEFAULT_ARCHIVE_MAX = 20;
export const DEFAULT_AUTO_SETTINGS: AutoSaveSettings = { enabled: true, intervalMs: 30_000, restoreOnLoad: true };
export const AUTO_INTERVAL_OPTIONS = [30_000, 60_000, 300_000] as const;

export function createCanvasId(): string {
  try { return crypto.randomUUID(); } catch { return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
}

const CURRENT_CANVAS_KEY = "miliastra-current-canvas-id";

/** 读取上次使用的画布身份；刷新后仍能找回该画布的自动存档与 [当前] 标记。 */
export function loadCurrentCanvasId(): string {
  let id = "";
  try { id = localStorage.getItem(CURRENT_CANVAS_KEY) || ""; } catch { /* ignore */ }
  if (!id) { id = createCanvasId(); persistCurrentCanvasId(id); }
  return id;
}

export function persistCurrentCanvasId(id: string) {
  try { localStorage.setItem(CURRENT_CANVAS_KEY, id); } catch { /* ignore */ }
}

function readJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 配额不足时仅会话内生效 */ }
}

export function loadArchives(): SceneArchive[] {
  const parsed = readJson(ARCHIVES_KEY);
  if (!Array.isArray(parsed)) return [];
  let changed = false;
  const list: SceneArchive[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<SceneArchive>;
    if (typeof raw.name !== "string" || typeof raw.savedAt !== "number" || !raw.scene || !Array.isArray((raw.scene as SceneDocument).elements)) continue;
    let canvasId = typeof raw.canvasId === "string" && raw.canvasId ? raw.canvasId : "";
    if (!canvasId) { canvasId = createCanvasId(); changed = true; }
    const id = typeof raw.id === "string" && raw.id ? raw.id : canvasId;
    list.push({ id, canvasId, name: raw.name, savedAt: raw.savedAt, scene: raw.scene as SceneDocument });
  }
  list.sort((a, b) => b.savedAt - a.savedAt);
  if (changed) persistArchives(list);
  return list;
}

export function persistArchives(list: SceneArchive[]) {
  writeJson(ARCHIVES_KEY, list);
}

export function loadArchiveMax(): number {
  const n = Math.round(Number(localStorage.getItem(MAX_KEY)));
  return Number.isFinite(n) && n >= 1 ? Math.min(50, n) : DEFAULT_ARCHIVE_MAX;
}

export function persistArchiveMax(n: number) {
  try { localStorage.setItem(MAX_KEY, String(Math.max(1, Math.min(50, Math.round(n))))); } catch { /* ignore */ }
}

export function pruneArchives(list: SceneArchive[], max: number): SceneArchive[] {
  const limit = Math.max(1, Math.min(50, Math.round(max)));
  return [...list].sort((a, b) => b.savedAt - a.savedAt).slice(0, limit);
}

/** 保存当前画布存档：同一 canvasId 更新内容与名字；新 canvasId 新增一条。 */
export function addArchive(scene: SceneDocument, name: string, savedAt: number, canvasId: string): SceneArchive[] {
  const list = loadArchives();
  const trimmedName = (name || "").trim() || "未命名";
  const existing = list.find((item) => item.canvasId === canvasId);
  const next = existing
    ? list.map((item) => (item.id === existing.id ? { ...item, name: trimmedName, scene, savedAt } : item))
    : [...list, { id: createCanvasId(), canvasId, name: trimmedName, savedAt, scene }];
  const pruned = pruneArchives(next, loadArchiveMax());
  persistArchives(pruned);
  return pruned;
}

/** 改名只改显示名，身份（canvasId）不变。 */
export function renameArchive(canvasId: string, name: string): SceneArchive[] {
  const trimmedName = (name || "").trim() || "未命名";
  const next = loadArchives().map((item) => (item.canvasId === canvasId ? { ...item, name: trimmedName } : item));
  persistArchives(next);
  return next;
}

export function removeArchive(id: string): SceneArchive[] {
  const next = loadArchives().filter((item) => item.id !== id);
  persistArchives(next);
  return next;
}

// ---- 自动存档 ----

function loadAutoList(): AutoArchive[] {
  const parsed = readJson(AUTOSAVE_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is AutoArchive => Boolean(item) && typeof item.canvasId === "string" && typeof item.savedAt === "number" && item.scene && Array.isArray((item.scene as SceneDocument).elements));
}

export function loadAutoArchive(canvasId: string): AutoArchive | null {
  return loadAutoList().find((item) => item.canvasId === canvasId) ?? null;
}

export function saveAutoArchive(record: AutoArchive) {
  const list = loadAutoList().filter((item) => item.canvasId !== record.canvasId);
  list.push(record);
  writeJson(AUTOSAVE_KEY, list);
}

export function removeAutoArchive(canvasId: string) {
  writeJson(AUTOSAVE_KEY, loadAutoList().filter((item) => item.canvasId !== canvasId));
}

export function loadAutoSettings(): AutoSaveSettings {
  const raw = readJson(AUTOSAVE_SETTINGS_KEY) as Partial<AutoSaveSettings> | null;
  const enabled = typeof raw?.enabled === "boolean" ? raw.enabled : DEFAULT_AUTO_SETTINGS.enabled;
  const restoreOnLoad = typeof raw?.restoreOnLoad === "boolean" ? raw.restoreOnLoad : DEFAULT_AUTO_SETTINGS.restoreOnLoad;
  const intervalMs = typeof raw?.intervalMs === "number" && raw.intervalMs >= 5_000 && raw.intervalMs <= 3_600_000
    ? raw.intervalMs
    : DEFAULT_AUTO_SETTINGS.intervalMs;
  return { enabled, intervalMs, restoreOnLoad };
}

export function saveAutoSettings(settings: AutoSaveSettings) {
  writeJson(AUTOSAVE_SETTINGS_KEY, settings);
}

const LAST_CANVAS_KEY = "miliastra-last-canvas";
export type LastCanvas = { canvasId?: string; name: string; scene: SceneDocument; savedAt: number };

export function loadLastCanvas(): LastCanvas | null {
  const raw = readJson(LAST_CANVAS_KEY) as LastCanvas | null;
  if (!raw || !raw.scene || !Array.isArray(raw.scene.elements) || raw.scene.elements.length === 0) return null;
  return { ...raw, canvasId: typeof raw.canvasId === "string" && raw.canvasId.trim() ? raw.canvasId : undefined };
}

export function saveLastCanvas(name: string, scene: SceneDocument, canvasId: string) {
  if (scene.elements.length === 0) { clearLastCanvas(); return; }
  writeJson(LAST_CANVAS_KEY, { canvasId, name, scene, savedAt: Date.now() });
}

export function clearLastCanvas() {
  try { localStorage.removeItem(LAST_CANVAS_KEY); } catch { /* ignore */ }
}

const RESTORE_ON_LOAD_KEY = "miliastra-restore-on-load";

export function loadRestoreOnLoad(): boolean {
  try {
    const raw = localStorage.getItem(RESTORE_ON_LOAD_KEY);
    return raw === null ? true : raw === "1";
  } catch { return true; }
}

export function persistRestoreOnLoad(value: boolean) {
  try { localStorage.setItem(RESTORE_ON_LOAD_KEY, value ? "1" : "0"); } catch { /* ignore */ }
}
