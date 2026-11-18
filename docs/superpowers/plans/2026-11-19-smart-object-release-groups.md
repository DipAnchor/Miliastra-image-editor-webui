# Smart Object Release Group Reuse Implementation Plan

> **For agentic workers:** Follow the checked tasks in this session; no commit or push is authorized.

**Goal:** 解除智能对象时复用唯一完整根组，不因转换和解除增加层级。

**Architecture:** `releaseObject` 继续原子烘焙几何并检查 ID 冲突。有效内容只有一个根组且没有散落图元时，保留其 ID 和子组，合并外壳状态并返回 `releasedGroupId`；否则沿用新包装组。App 使用返回的组 ID 选择解除结果。

**Tech Stack:** TypeScript, React, Node test runner, Vitest, ego-browser.

---

### Task 1: Failure regressions

Files: `frontend/tests/smartObjects.test.mjs`, `frontend/tests/smartObjectApp.test.tsx`.

- [x] 修改旧的无条件包装断言；覆盖唯一完整根组、真实子组保留、多根组、单根加散落图元、无组与空内容、名称与状态合并、反复 pack/release 不加深、复制及 ID 冲突原子失败。
- [x] 旧实现 Node 定向 6 项失败，修复后 26 项通过。App 的单根／多根／散落入口回归验证结果选择、一次撤销／重做与世界几何不变。

### Task 2: Minimal release integration

Files: `frontend/src/smartObjects.ts`, `frontend/src/App.tsx`.

- [x] 使用 `roots.length === 1 && elements.every(element => element.groupId != null)` 判定可复用；现有内容验证保证每个有组图元都在该根组树下。
- [x] 根组使用外壳名称、父级与层序；`opacity = root.opacity * shell.opacity`、`visible = root.visible !== false && shell.visible !== false`、`locked = root.locked === true || shell.locked === true`。其他子组保持不变。包装分支行为保持。
- [x] 返回 `releasedGroupId`，App 解构后仅提交场景字段，并使用真实返回 ID 选择组。

### Task 3: Verification and docs

Files: `docs/README.md`, `docs/technical-design.md`, `docs/superpowers/plans/2026-11-18-smart-objects-ux-ui.md`, `HANDOFF.md`.

- [x] 前端全量 204 项 Node、52 项 UI（含 28 项 App）通过；`npm.cmd run build` TypeScript／Vite 通过，`git diff --check` 通过（仅已有换行提示）。后端及协议未修改。
- [x] 真实页面核验原组转换再解除后仅原组和真实子组、选中原组与一步 undo/redo；多根对象仍有收拢组。15 个应用存储键已恢复、其他键不变；专用页关闭、临时探针已清理。
- [x] 使用指南、技术说明、原规格与交接同步。不更改嵌套、几何烘焙限制、保存适配或导出协议，不提交／推送。
