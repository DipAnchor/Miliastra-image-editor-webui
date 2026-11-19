# Transform Properties Preview Implementation Plan

**Goal:** Enable existing right-side transform and rotation inputs during a pending transform, with immediate preview and one Apply/Cancel transaction.

**Architecture:** Keep the committed scene and history untouched. Validate geometry-only edits against the current preview and selected session ids. Rebuild the transform box after single-layer numeric edits, mapping the pivot through its existing local coordinates. Route multi-selection position changes through moveTransformSession so a rotated group frame remains intact. Preserve the inputs' existing coordinate, anchor, aspect-ratio and angle-normalization semantics.

**Tech Stack:** React/TypeScript, existing transformSession geometry, Node tests, Vitest/Testing Library and Ego Browser.

Current uncommitted transform work is the required baseline; edit this workspace directly. Do not create a worktree, commit or push.

## Tasks

- [x] Add rebaseTransformSession(session, preview) in frontend/src/transformSession.ts. Preserve original/ids and unrelated scene references; recompute the box and pivot, and handle edge-on projections without NaN. Add tests to frontend/tests/transformSession.test.mjs for numeric position/size/XYZ rotation, continued pointer operations, smart-object scale and singular projections.
- [x] In frontend/src/App.tsx, read pending.preview in applyElementUpdates, allow only x/y/width/height/rotation/rotationX/rotationY/scale for locked targets, and call updateTransformPreview(rebaseTransformSession(...)) instead of commitScene. Keep ordinary edits unchanged. Route updateObjectShell and multi-selection position controls through this preview path.
- [x] Narrow inert boundaries in the right sidebar. Enable geometry inputs and view navigation; keep appearance, masks, canvas, structure and unrelated actions locked. Pass transformEditing to frontend/src/SmartObjectControls.tsx and disable name, contents, release and opacity while keeping shell geometry usable.
- [x] Extend frontend/tests/transformModeApp.test.tsx: edit X/Y/width/height/Z/XY rotations while pending; assert controls are usable, frame synchronization, Cancel rollback, Apply with one Undo/Redo, no-op history, mixed numeric/pointer edits, multi-selection and smart-object controls, unchanged non-transform behavior.
- [x] Update docs/editor-interaction.md and docs/technical-design.md with numeric preview behavior. Run targeted tests and the complete frontend test/build scripts through equivalent direct Node entrypoints; run git diff --check.
- [x] Use the existing local browser app to verify actual number-field focus/editing, continued handles, Apply/Cancel and Undo. Back up all origin localStorage values before fixtures; leave the app before restoring every owned key and verify unrelated keys unchanged. Finish the isolated browser space and remove only the temporary directory created for this task.

## Verification commands

~~~powershell
node --test tests/*.test.mjs
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
git diff --check
~~~

**Acceptance:** Numeric edits remain previews until Apply, Cancel restores the pre-transform scene, Apply adds one history entry, continued pointer gestures use the updated frame, and unrelated properties remain locked. No backend/export changes or persistence of pivot state.

**Verified:** All logic tests, 116 UI tests, TypeScript and production builds, and git diff --check passed. Native browser checks covered numeric X/Y/size/XYZ rotation, continued handle dragging, focused-input Enter, Cancel, Apply and one Undo/Redo. All 15 original owned localStorage keys were restored and unrelated keys were unchanged; the isolated browser space was closed and the temporary directory was removed. No commit or push.

The local npm/npx command wrappers did not run the requested scripts reliably in this tool environment, so verification used their equivalent direct Node entrypoints above.
