# Fork 维护与上游同步

本仓库是 [1475505/Miliastra-image-editor-webui](https://github.com/1475505/Miliastra-image-editor-webui) 的下游分支，目标是逐渐演进为更接近 Photoshop 体验的**场景编辑器**。本文记录分支模型、与上游的差异以及同步上游的方式，避免长期分叉后无法合并。

## 远程与基线

| 远程 | 地址 | 用途 |
|---|---|---|
| `origin` | https://github.com/DipAnchor/Miliastra-image-editor-webui.git | 本 fork（推送功能分支） |
| `upstream` | https://github.com/1475505/Miliastra-image-editor-webui.git | 原上游（只读同步） |

`main` 与 `upstream/main` 保持一致：**main 只做上游镜像，不提交本仓库功能**。

## 分支模型

- `main`：上游镜像；只通过 fast-forward 跟进 `upstream/main`。
- `develop`：本 fork 的集成分支；所有功能分支合入这里。
- 功能分支：短生命周期，按功能拆分，例如
  - `feat/layer-module`
  - `feat/import-enhancements`
  - `chore/frontend-test-setup`
  - `chore/repo-hygiene`
  - `fix/dev-proxy`
- `backup/all-changes`：拆分前的完整历史备份（仅本地，不推送）。

## 同步上游（建议每 1–2 周一次）

```bash
git fetch upstream
# 1) 更新 main 镜像
git switch main
git merge --ff-only upstream/main
# 2) 把上游合入集成分支（不要 rebase 已发布分支）
git switch develop
git merge upstream/main
# 3) 解决冲突并验证
cd frontend && npm test && npm run build
cd ../backend && .venv/Scripts/python.exe -m unittest discover -s tests
```

原则：**小步高频**地合并上游，单独开「同步上游」PR（只含 merge，不含功能），便于审查和回滚。不要长时间不合并。

## 当前相对上游的差异

| 模块 | 差异 |
|---|---|
| 场景模型 | 图元增加 `visible/layerName/groupId/locked`，场景增加 `groups`（嵌套 `parentId`、组显隐与不透明度）；JSON 完整保留，旧文件按默认值兼容 |
| 图层与组 | `layerTree.ts` 纯逻辑；常驻图层树（可调高度、搜索、不透明度）、右键菜单、重命名、嵌套组、拖拽、组显隐／独显／不透明度、Ctrl+D 原位复制 |
| 锁定 | 图元与组锁定；画布不可选中、属性与拖动拦截；WebMCP 仍可显式修改（`ignoreLock`），与本分支新增的建组锁定检查分别处理 |
| 智能对象 | `smartObjects.ts`/`smartObjectModel.ts`：组合收为单层、内部不栅格化、草稿编辑与画框适配、解除为普通组 |
| 变换 | 中心／自由放缩、选框单轴手柄、多选整体缩放与旋转、显式变换模式与属性预览、以光标为中心滚轮缩放、三轴快捷编辑 |
| 蒙版 | 独立蒙版编辑与整体变换、反向范围按旋转矩形收边、辅助预览拖动性能 |
| 导出 | 绘制类导出统一「可见性过滤 + 组／对象透明度烘焙」；JSON 保留完整结构；导出下载修复 |
| 导入 | 覆盖／追加弹窗、空内容提醒、格式自动识别、追加自动归组 |
| 工作流 | 历史存档（本地快照、打开／另存为／删除、恢复上次编辑）、新建画布、空白画布快捷图形库、收藏 |
| WebMCP | 在上游工具集上增加图元能力表、锁定语义与批量图层组事务 `create_layer_groups`（26 工具） |
| 工程 | Vitest 组件测试、构建产物与本地脚本不入库、Vite `/api` 代理 127.0.0.1 |

基线：`main` 当前为上游镜像提交 `783d900`（2026-10-25），`develop` 相对其领先 60 个提交（不含合并）。提交数随开发变化，合并上游后请按提交历史复核本表。

## 兼容约束（同步时不能破坏）

- **千星导出是铁律**：GIA 素材组、容器节点 GIA、Lua 的数据行格式（ELEMENTS/TEXTBOXES/DRAW_ORDER）不得改动；新增字段不得写进这些数据行。
- JSON 场景保留完整数据（含 groups、隐藏图层、layerName）；新增字段需要默认值与向后兼容。
- 上游测试 + 本仓库测试都必须通过（前端 `npm test`、`npm run test:ui`、`npm run build`；后端 unittest）。

## 冲突热点与降低冲突的做法

- 最大热点是 `frontend/src/App.tsx`（单文件数千行）。**新功能尽量放独立模块**（如 `layerTree.ts`、`*ContextMenu.tsx`、`sourceType.ts`、`importScene.ts`），只对 App 做少量接线。
- 导出/导入适配器与内部场景模型分离，避免上游格式变化牵动 UI。
- 每个功能一个分支、小而快的 PR；先合 `chore/frontend-test-setup` 等基础分支，再合功能分支。

## 何时考虑硬分叉

出现以下情况可停止合并上游、独立发版，只按需 cherry-pick 上游 bugfix：
- 上游架构与产品目标（场景编辑器）根本冲突；
- 每次同步的冲突成本大于收益；
- 需要大改核心数据模型/渲染管线。

硬分叉时保留 LICENSE、PROVENANCE 与上游来源说明。
