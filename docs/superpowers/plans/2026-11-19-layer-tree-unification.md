# 分组选择、锁定与拖拽统一修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 多组及组＋图层成组保留原树，锁定其他不间接锁住选中项，组和图层采用统一层级拖拽规则。

**Architecture:** 保留现有 `elements.zIndex`、`groupId` 和 `groups.parentId` 模型。在 `layerTree.ts` 提供纯函数 `groupSelection(elements, groups, elementIds, groupIds, newGroupId, name?)`、`lockOtherLayers(elements, groups, elementIds, groupIds)` 和 `moveLayerNode(elements, groups, drag, target)`；页面只负责选择同步、目标命中和一次撤销事务。

**Tech Stack:** React / TypeScript、Node test、Vitest / Testing Library、Ego Chromium。

---

用户已确认本方案并授权直接执行；并行纯逻辑与 App 测试，主代理集成。沿用当前分支，不自动提交或推送，不修改后端。

### Task 1: 纯树操作与锁定范围

**Files:** `frontend/src/layerTree.ts`、`frontend/tests/*.test.mjs`。

- [x] 补失败回归：多组选中、混合选择、祖先与后代重复选择、空组、跨父级、不可变输入。成组只把所选顶层根和额外图层挂到新组，保留内部结构，新组放在最近共同祖先内。
- [x] 锁定其他的保护集合包含选中图层、选中组全部后代以及其祖先链；其余项锁定，既有锁不被清除，空选择不操作。
- [x] 统一 `moveLayerNode`：组中部入组，上下边成为目标同级；图层上下边成为该图层同级；空白提升顶层。整子树移动，保持内部顺序、连续层序，空组可排序，拒绝自引用和循环。旧公开辅助函数兼容。
- [x] 定向 Node 回归先红后绿；深层子树、状态保留及整数空组层序往返检查通过。

### Task 2: 页面接线与集成回归

**Files:** `frontend/src/App.tsx`、`frontend/src/GroupContextMenu.tsx`、`frontend/tests/layerTreeApp.test.tsx`。

- [x] 双向 Ctrl / Shift 混选组与图层，切换组不覆盖额外图层；右键所选项不重置多选。成组后选中新组。
- [x] 组菜单补编组入口；锁定其他改调纯函数，统一拖拽命中规则和提示，取消拖拽清理状态。
- [x] 使用真实 App 和公共只读 `get_scene` 回归成组、锁定、组入组、子组出父级、图层旁移动、非法循环及撤销重做。
- [x] App 定向、`npm run test:all` 和 `npm run build` 全部通过，exit code 为 0。

### Task 3: 实际页面与收尾

**Files:** `docs/editor-interaction.md`、`docs/README.md`、本计划；临时浏览器脚本不保留。

- [x] 在已有开发页面验证两组与混选编组、锁定其他后自己仍可操作、同级组拖入、子组拖出及撤销重做；组／图层各边缘与取消路径另由 App 集成回归覆盖。先备份本 origin 的应用存储，结束逐项恢复，不清 cookie/cache。
- [x] 更新交互说明，检查最终 diff 与 `git diff --check`；恢复测试状态、关闭专用页面、删除本轮临时文件。
- [x] 报告已验证结果与限制，不提交、不推送。

## 验收记录

- 前端全量：228 项 Node 测试、82 项 UI 测试通过，TypeScript 与 Vite 构建通过；本轮 App 集成回归 24 项，树逻辑定向 35 项。
- 实际页面：多组及组＋图层收进新组且原子树保留，撤销／重做正确；组拖入同级组、子组拖到父组边缘成功；锁定其他后原组选中子图层可微调 1px。
- 测试后逐值恢复 15 项应用 localStorage，确认其他 key 不变，关闭专用页面并清理临时脚本。无后端改动，不重复后端回归。
- 额外发现但未扩入本轮：既有 `normalizeGroups` 未保留组的 `locked` 字段，保存并应用后的组锁定持久化需另行修复；不影响本轮现场操作与撤销回归。
