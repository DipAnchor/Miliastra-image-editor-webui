# Smart Object Save-Time Auto Bounds Implementation Plan

> **For agentic workers:** Use the current session task board for disjoint session-geometry and App integration work. No commit or push is authorized.

**Goal:** 保存有变化的智能对象内容时自动适配画框，维持编辑后内容在主场景中的位置；编辑过程中不实时改变画框。

**Architecture:** 使用现有 selectionBounds（包含隐藏、锁定图层及文字缩放／旋转投影）计算局部包围框。保存时平移所有局部图层至新画框，并以外壳 rotation/scale 变换补偿壳位置；同步平移内部所有撤销／重做快照。空对象保留原画框；无改动保存不增加主历史。JSON 与导出坐标协议不变。

**Tech Stack:** React / TypeScript / Node test / Vitest。

---

### Task 1: Session geometry

**Files:** frontend/src/smartObjectSession.ts; frontend/tests/smartObjectSession.test.mjs

- [x] Write failing tests for shifted/expanded/shrunk bounds, rotated/scaled world-corner preservation, hidden/locked members, empty and edge-on content, repeat saves and undo/redo after rebasing.
- [x] Extend apply result with rebase offset and implement fit only on changed saves. Reject non-finite results atomically.
- [x] Run `node --test tests/smartObjectSession.test.mjs` from frontend; update old expectations to compare world geometry rather than obsolete local coordinates.

Geometry: newFrame=max(1,bounds size); center=bounds origin+bounds size/2; delta=newFrame/2-center; newLocal=oldLocal+delta; newShell=oldShell+scale*Rz*(center-oldFrame/2). All draft history snapshots get the same delta/newFrame.

### Task 2: App save integration

**Files:** frontend/src/App.tsx; frontend/tests/smartObjectApp.test.tsx

- [x] Return saved content plus local offset from parent save callback.
- [x] Replace child current scene and every child undo/redo snapshot with rebased coordinates without appending local history; preserve selection and use the rebased scene as the clean baseline.
- [x] Test expanded and contracted frames, immediate repeated saves, post-save undo/redo then save/discard, main one-step undo and name sync.

### Task 3: Explanation and verification

**Files:** frontend/src/i18n.tsx; frontend/src/SmartObjectControls.tsx; frontend/tests/SmartObjectControls.test.tsx; README.md; README.zh-CN.md; docs/README.md; docs/technical-design.md; HANDOFF.md; prior two smart-object plans

- [x] Replace fixed-forever language with stable-during-editing/save-time-fit; explain unchanged visual positions, changing transform center and empty/no-op behavior.
- [x] Run frontend `npm.cmd run test:all` and `npm.cmd run build`, backend existing full suite, `git diff --check`.
- [x] Verify actual page save/continue and undo; restore any browser local storage changed by testing and remove temporary probes.

### Acceptance results

- Frontend: 201 Node tests, 46 UI tests (22 App integration tests), TypeScript and Vite build passed.
- Backend: 242 tests, 239 passed and 3 environment-dependent tests skipped (two Lua VM tests without `FENGARI_MODULE_PATH`, one codec test without `UGC_GIA_CODEC`).
- Actual page: changed save fits 240×180 to 400×155 under 25° rotation / 125% scale; untouched leaf screen-position error <0.002px. Editing frame stays stable until save; save stays in the editor; internal undo/redo survives rebasing; no-op save/finish adds no main history; one main undo/redo restores both content and frame.
- Restored all 15 application storage keys, verified other keys unchanged, closed the dedicated browser page and removed temporary probes. No commit/push or in-game verification.
