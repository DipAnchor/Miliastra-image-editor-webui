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
| 后端场景模型 | 增加 `SceneElement.visible/layerName/groupId`、`SceneDocument.groups`，并在 `normalize_scene`/`normalize_library` 白名单登记 |
| 图层模块（前端） | `layerTree.ts` 纯逻辑；图层右键菜单、图层名、可见性/Solo、分组（编组/解组、嵌套、拖拽、组可见性/Solo/不透明度）、Ctrl+D 原位复制、选中组连带选中子元素 |
| 导出 | 绘制类导出统一做「可见性过滤 + 组不透明度烘焙」；JSON 保留完整数据 |
| 导入 | 覆盖/追加弹窗、空内容提醒、模板格式自动识别 |
| 工程 | vitest + testing-library 组件测试；`.gitignore` 忽略 dev 脚本与静态构建产物；Vite `/api` 代理改 127.0.0.1 |

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
