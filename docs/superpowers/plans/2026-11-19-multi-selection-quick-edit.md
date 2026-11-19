# Multi-selection Quick Edit Implementation Plan

> **For agentic workers:** Execute the checked tasks in this session, preserving the current scene and transform transaction.

**Goal:** Add layer and lock actions to the multi-selection inspector, and a canvas context menu with selection count, batch fill, opacity, 10% scaling, layer order, locking and visibility.

**Architecture:** Preserve selection when a selected canvas layer receives a context menu event. Reuse applyElementUpdates for atomic batch appearance changes and the existing grouping/order/lock/visibility handlers. Share the action UI between the inspector and the multi-selection menu; retain single-layer geometry editing.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Ego Browser.

## Scope and decision

- The user confirmed whole-selection scaling about the common center. Enable the percentage buttons for editable selections. Use the projected bounding-box center of unlocked selected targets; scale their positions, spacing and sizes by one common factor. Preserve rotation, group structure and smart-object contents; change only smart-object shell position and scale. Respect the existing leaf minimum dimensions with a common constrained factor when shrinking, rather than clamping each layer separately.
- Locked layers keep their content and geometry. Color changes apply only to editable ordinary layers, including textbox text-color synchronization; smart-object shell opacity remains editable.
- Do not submit preview edits, change export/save formats, commit or push.

## Task 1: Regression coverage

**Files:** Create `frontend/tests/multiSelectionApp.test.tsx`.

- [x] Mount the app using the existing saved-scene and WebMCP test pattern; select two rows with Ctrl-click and context-menu the first selected canvas layer. Assert the count stays two and the menu has batch actions instead of width/rotation fields.
- [x] Use the native color and opacity inputs, check only selected editable targets changed, and verify one undo restores the original scene for each batch action.
- [x] Cover inspector grouping and locks, menu ordering/hiding, right-clicking an unselected layer, locked targets, textbox color synchronization and smart-object shells.

## Task 2: Shared selection actions

**Files:** Create `frontend/src/SelectionLayerActions.tsx`; modify `frontend/src/App.tsx` and `frontend/src/styles.css`.

- [x] Provide the existing `groupSelection`, `moveLayer`, `toggleLockSelection`, `lockOthers`, `unlockAll` callbacks to a compact/menu or inspector action block. The menu also calls `toggleSelectionVisible`.
- [x] Keep the inspector action block under the existing transform lock boundary.
- [x] Preserve a snapshot of selected IDs in QuickEditState when right-clicking an already-selected canvas element; right-clicking another element still opens the single-element menu.
- [x] Apply batch patches once using `applyElementUpdates(targets.map(element => ({ id: element.id, patch })))`, filtering locked targets and unsupported shell color fields.
- [x] Replace the multi-menu width/rotation section with the shared actions; keep the fill, percentage buttons and opacity controls. Show mixed values explicitly.
- [x] Measure the menu after layout and clamp actual width/height to a 12px viewport margin; use scoped overflow for tall menus.

## Task 3: Verification and documentation

**Files:** Update `docs/editor-interaction.md`; add Chinese/English mixed-value copy to `frontend/src/i18n.tsx`.

- [x] Resolve the scaling decision, implement it using the current geometry helpers, and add the corresponding geometry assertions before claiming completion.
- [x] Run `node node_modules/vitest/vitest.mjs run tests/multiSelectionApp.test.tsx tests/transformModeApp.test.tsx` in `frontend/`, then all Node logic tests, all UI tests, TypeScript `-b` and Vite build.
- [x] Verify the new inspector and menu in the existing browser page without importing a replacement scene. Back up all owned raw localStorage values first; after leaving the app, restore and compare every owned value and unchanged non-owned values. Close the test space independently.
- [x] Review the final diff, run `git diff --check`, and remove temporary browser files.

## Verification result

- All Node logic tests, 155 UI tests, TypeScript and Vite production build passed. The multi-selection suite contains 25 cases, including projected rotations, smart-object shells, lock filtering and a shared minimum-dimension constraint.
- Native batch color (including the existing default-preset color synchronization), opacity, inspector locking, menu hiding and grouping assertions passed; one undo restored the complete scene for every action. Chinese and English menu layouts fit the viewport; the English title uses the existing uppercase heading style.
- All 15 owned localStorage values were restored exactly after leaving the app; other values were unchanged. Test space 14 was closed independently and the temporary files were removed.
- The user confirmed scaling about the whole-selection center. Native verification with two existing rotated layers passed +10% followed by -10% (99% overall), preserving the common projected center, other layers, group structure and rotation. Each click had an independent undo/redo step.
- All 15 owned localStorage values were restored exactly after the scaling verification; other values were unchanged. Test space 17 was closed independently and its temporary files were removed. No commit or push was made.
