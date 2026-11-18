import type { SmartObjectContent, SmartObjectDocument } from "./smartObjectModel";
import { isSmartObject, validateObjectContent, validateSmartObject } from "./smartObjects";
import { selectionBounds } from "./editorSelection";
import { rotationMatrix } from "./rotation";

/** Only local content is editable; the main document and shell never enter draft history. */
export type SmartObjectSession = {
  objectId: string;
  saved: SmartObjectContent;
  draft: SmartObjectContent;
  past: SmartObjectContent[];
  future: SmartObjectContent[];
};

export type ObjectSessionResult<T extends SmartObjectDocument> = {
  scene: T;
  session: SmartObjectSession;
  changed: boolean;
  /** Local coordinate addition applied to the draft and every undo/redo snapshot. */
  rebase: { x: number; y: number };
};

const copy = <T>(value: T): T => structuredClone(value);
const HISTORY_LIMIT = 100;

// Persisted JSON values compare by value, not object identity or property insertion order.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter(key => left[key] !== undefined);
  return keys.length === Object.keys(right).filter(key => right[key] !== undefined).length
    && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]));
}

export const objectSessionDirty = (session: SmartObjectSession): boolean => !sameValue(session.saved, session.draft);

/** Rebase one complete local snapshot without aliasing or dropping persisted fields. */
export function rebaseObjectContent(
  content: SmartObjectContent, frame: SmartObjectContent["frame"], offset: { x: number; y: number }
): SmartObjectContent {
  if (![offset.x, offset.y].every(Number.isFinite)) throw new Error("object rebase offset must be finite");
  const rebased = copy(content);
  rebased.frame = copy(frame);
  for (const element of rebased.elements) {
    element.x += offset.x;
    element.y += offset.y;
  }
  validateObjectContent(rebased);
  return rebased;
}

export function startObjectSession(scene: SmartObjectDocument, objectId: string): SmartObjectSession {
  const object = scene.elements.find(element => element.id === objectId);
  if (!object || !isSmartObject(object)) throw new Error("smart object not found");
  validateSmartObject(object);
  return { objectId, saved: copy(object.content), draft: copy(object.content), past: [], future: [] };
}

export function changeObjectDraft(session: SmartObjectSession, content: SmartObjectContent): SmartObjectSession {
  validateObjectContent(content);
  if (!sameValue(content.frame, session.saved.frame)) throw new Error("the object frame is fixed during content editing");
  if (sameValue(session.draft, content)) return session;
  return { ...session, draft: copy(content), past: [...session.past, copy(session.draft)].slice(-HISTORY_LIMIT), future: [] };
}

export function undoObjectDraft(session: SmartObjectSession): SmartObjectSession {
  const content = session.past[session.past.length - 1];
  if (!content) return session;
  return { ...session, draft: copy(content), past: session.past.slice(0, -1), future: [copy(session.draft), ...session.future] };
}

export function redoObjectDraft(session: SmartObjectSession): SmartObjectSession {
  const content = session.future[0];
  if (!content) return session;
  return { ...session, draft: copy(content), past: [...session.past, copy(session.draft)].slice(-HISTORY_LIMIT), future: session.future.slice(1) };
}

/** Caller commits scene only when changed; each save then represents exactly one main undo step. */
export function applyObjectSession<T extends SmartObjectDocument>(scene: T, session: SmartObjectSession): ObjectSessionResult<T> {
  const object = scene.elements.find(element => element.id === session.objectId);
  if (!object || !isSmartObject(object)) throw new Error("the edited smart object no longer exists");
  validateSmartObject(object);
  validateObjectContent(session.draft);
  if (!sameValue(session.draft.frame, session.saved.frame)) throw new Error("the object frame is fixed during content editing");
  if (!sameValue(object.content, session.saved)) throw new Error("object content changed outside the current editing session");
  if (!objectSessionDirty(session)) return { scene, session, changed: false, rebase: { x: 0, y: 0 } };

  // Editing keeps one stable local frame. Only a changed save fits all leaves,
  // including hidden/locked ones, using the editor's projected control bounds.
  const bounds = selectionBounds(session.draft.elements);
  const frame = { ...session.draft.frame };
  const rebase = { x: 0, y: 0 };
  let x = object.x, y = object.y;
  if (bounds) {
    if (!Object.values(bounds).every(Number.isFinite)) throw new Error("object bounds must be finite");
    frame.width = Math.max(1, bounds.width);
    frame.height = Math.max(1, bounds.height);
    const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
    rebase.x = frame.width / 2 - cx;
    rebase.y = frame.height / 2 - cy;
    const dx = cx - session.draft.frame.width / 2, dy = cy - session.draft.frame.height / 2;
    const { a, b, c, d } = rotationMatrix(object);
    x += object.scale * (a * dx + c * dy);
    y += object.scale * (b * dx + d * dy);
  }
  if (![x, y, frame.width * object.scale, frame.height * object.scale].every(Number.isFinite)) {
    throw new Error("fitted object geometry must be finite");
  }
  const draft = rebaseObjectContent(session.draft, frame, rebase);
  const updated = { ...object, x, y, content: copy(draft) };
  validateSmartObject(updated);
  // Rebase every branch in the same transaction; preserving the history means
  // undo/redo still describes the same world geometry after the shell moves.
  const nextSession = {
    ...session, draft, saved: copy(draft),
    past: session.past.map(content => rebaseObjectContent(content, frame, rebase)),
    future: session.future.map(content => rebaseObjectContent(content, frame, rebase))
  };
  const next = { ...scene, elements: scene.elements.map(element => element.id === object.id ? updated : element) };
  return { scene: next, session: nextSession, changed: true, rebase };
}

export function finishObjectSession<T extends SmartObjectDocument>(scene: T, session: SmartObjectSession): {
  scene: T; session: null; changed: boolean;
} {
  const applied = applyObjectSession(scene, session);
  return { scene: applied.scene, session: null, changed: applied.changed };
}

/** Discard only the unsaved draft; never restore the document from an older snapshot. */
export function discardObjectSession<T extends SmartObjectDocument>(scene: T): {
  scene: T; session: null; changed: false;
} {
  return { scene, session: null, changed: false };
}
