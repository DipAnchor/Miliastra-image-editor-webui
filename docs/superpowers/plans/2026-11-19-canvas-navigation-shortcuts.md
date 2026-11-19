# Canvas Navigation and Shortcuts Implementation Plan

> **For agentic workers:** Implement the checked steps in order in this session; preserve the current transform transaction and the existing page scene.

**Goal:** Use the wheel for vertical scrolling, Ctrl+wheel for horizontal scrolling, Alt+wheel for cursor-centred zoom, Ctrl/⌘+Alt+T for transform mode, and four export buttons per menu row.

**Architecture:** Keep native vertical scrolling and the existing non-passive canvas listener. Reuse the current zoom anchor calculation and transform toggle, and scope menu sizing to the layer/group menus. No backend, export payload, save schema or history changes.

**Tech Stack:** React, TypeScript, CSS, Vitest/Testing Library, Node test runner, Ego Browser.

---

### Task 1: Wheel navigation and keyboard regression

**Files:** Modify `frontend/tests/canvasZoomApp.test.tsx` and `frontend/tests/transformModeApp.test.tsx`.

- [x] Add ordinary-wheel, Ctrl pixel/line/page scroll and Alt+Ctrl precedence cases; update existing zoom events to press Alt. Add ready-mode toggling, repeat/input/modal guards and pending-preview protection.
- [x] Run the two Vitest files and confirm failures on the old behavior.
- [x] In `frontend/src/App.tsx`, before the existing zoom calculation, use:

```ts
if (!event.altKey) {
  if (event.ctrlKey) {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientWidth : 1;
    stage.scrollLeft += event.deltaY * unit;
  }
  return;
}
```

- [x] After the existing shortcut input/gesture guards, before the general Alt rejection, use:

```ts
if (mod && event.altKey && !event.shiftKey && key === "t") {
  event.preventDefault();
  if (!event.repeat) setTransformMode(!transformModeRef.current);
  return;
}
```

### Task 2: Four-column layer and group export menus

**Files:** Modify `frontend/src/styles.css`, `frontend/src/LayerContextMenu.tsx`, `frontend/src/GroupContextMenu.tsx`; add viewport regressions in `frontend/tests/layerContextMenu.test.tsx` and `frontend/tests/groupContextMenu.test.tsx`.

- [x] Override the shared quick-menu width only on `.quick-edit-menu.layer-context-menu`: width 320px, max-width `calc(100vw - 24px)`, min-width 0; limit height to the viewport and scroll excess content.
- [x] Add `layer-menu-export` to the export row in both menu components and set `display: grid; grid-template-columns: repeat(4, max-content);`.
- [x] Replace the horizontal clamp in both components with `Math.max(12, Math.min(x + 12, window.innerWidth - 332))`; measure rendered height in a layout effect to keep translated menus 12px inside the viewport.

### Task 3: Shortcut help and user documentation

**Files:** Modify `frontend/src/ShortcutHelp.tsx`, `frontend/src/i18n.tsx`, `docs/editor-interaction.md`.

- [x] Add the following help entries, with matching Chinese and English translations:

```ts
["Mouse wheel", "selection.shortcut.wheelScroll"],
["Ctrl + Mouse wheel", "selection.shortcut.wheelHorizontal"],
["Alt + Mouse wheel", "selection.shortcut.wheelZoom"],
["Ctrl/⌘ + Alt + T", "selection.shortcut.transform"],
```

- [x] Describe vertical/horizontal view scrolling, preserve the existing cursor-zoom range, and document that a pending transform must be applied or cancelled before changing modes.

### Task 4: Verification

- [x] Re-run the focused UI tests and existing layer/group menu tests.
- [x] In `frontend/`, run all `tests/*.test.mjs` through `node --test`, run `node node_modules/vitest/vitest.mjs run`, then TypeScript `-b` and Vite `build` through their local Node entry points.
- [x] In the existing Vite page, verify real wheel movement, anchor-stable Alt zoom, Ctrl+Alt+T, shortcut rows, and four export buttons sharing each row; check menu bounds. Preserve the page scene and restore any changed storage from raw original values after leaving the app.
- [x] Run `git diff --check`, review the final diff and remove temporary verification files. Do not commit or push without a new user request.

Validation: all Node logic tests, UI tests, TypeScript checks and the Vite production build passed. Native browser checks covered vertical/horizontal wheel input, cursor-anchored Alt zoom, transform toggling and shortcut help. Chinese and English export rows contain four buttons; the final English menu stayed 12px above the viewport bottom. The saved scene was unchanged, all 15 owned storage keys were restored exactly, and the browser verification space was closed.
