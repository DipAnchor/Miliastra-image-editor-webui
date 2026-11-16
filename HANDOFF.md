# HANDOFF（会话交接，2026-11-17）

> 交接目标：把「千星图片编辑器」逐步演进为更接近 Photoshop 的**场景编辑器**。本文件给新会话作为入口，先读它，再读 `docs/fork.md`、`docs/layer-module-plan.md`。

## 1. 仓库与分支

- 工作目录：`<repo-root>`
- 当前分支：**`develop`**（工作区干净）
- 远程：
  - `origin` = https://github.com/DipAnchor/Miliastra-image-editor-webui.git（本 fork，推送）
  - `upstream` = https://github.com/1475505/Miliastra-image-editor-webui.git（上游，只读同步）
- `main` 与 `upstream/main` 一致（`783d900`），**main 只做上游镜像，不提交功能**。
- `develop`：集成分支，已合并以下 5 个分支（均已推送 origin）：
  1. `chore/frontend-test-setup`
  2. `chore/repo-hygiene`
  3. `fix/dev-proxy`
  4. `feat/layer-module`
  5. `feat/import-enhancements`
- `backup/all-changes`：拆分前的完整历史备份（**仅本地，未推送**）。
- 未创建任何 PR。

### 分支/PR 建议顺序
`chore/frontend-test-setup` →（`chore/repo-hygiene`、`fix/dev-proxy` 可任意）→ `feat/layer-module` / `feat/import-enhancements`（后两者相互独立）。

## 2. 环境与运行

- 前端依赖已装（`frontend/node_modules`）；后端已建 `backend/.venv`（uv 创建，后补装了 pip）。
- 开发脚本（**本地文件，已被 .gitignore 忽略，不在仓库里**）：
  - `dev.bat`：同时起后端 + 前端
  - `dev-backend.bat`：`.venv\\Scripts\\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`
  - `dev-frontend.bat`：`npm run dev`（Vite 5173）
- Vite `/api` 代理已改为 `http://127.0.0.1:8000`（避免 localhost 解析到 ::1 导致 502）。
- 生产模式：`start.bat`（构建到 `backend/app/static`，端口 8439）。
- 注意：后台进程不保证跨会话存活；新会话先检查 5173/8000，必要时跑 `dev-backend.bat`、`dev-frontend.bat`。

## 3. 已完成功能

### 图层模块（feat/layer-module）
- 前端纯逻辑 `frontend/src/layerTree.ts`：可见性继承、Solo、分组 CRUD、分组树行、拖拽排序/改父组、组不透明度烘焙、原位复制、组内元素收集等。
- 图层右键菜单（`LayerContextMenu`）：层级、可见性/只显示自己、导出此图层、创建分组；**无层级编号（PS 式）**。
- 分组右键菜单（`GroupContextMenu`）：解组/删除置顶、层级、可见性（显示隐藏、只显示本组）、不透明度（100/75/50/25/0%）、整组导出。
- 图层名（`layerName`，行内编辑图标改名，`RenameDialog`）；保留形状名 `name`。
- 分组：编组/解组、嵌套、展开折叠、组可见性、组 Solo、组不透明度、**拖拽**（组↔组、组↔图层、元素进出组；指针事件实现）；选中分组会同时选中组内全部元素（画布可整体拖动）。
- Ctrl+D / Alt 拖动复制：副本在原图层**紧邻上方**（保持组内原位），不再跳到最顶。
- 后端 `backend/app/main.py`：`SceneElement.visible/layerName/groupId`、`SceneDocument.groups`，`normalize_scene`/`normalize_library` 白名单登记（保证 JSON 往返持久化）。
- WebMCP：暴露 `visible/layerName/groupId`，`get_scene` 返回 `groups`。
- 导出：所有绘制类导出统一「可见性过滤 + 组不透明度烘焙」（PNG/GIA/容器节点/Lua/CSS/SVG、单层/整组、WebMCP、预览）；JSON 保留完整数据。

### 导入增强（feat/import-enhancements）
- 模板格式**自动识别**（`frontend/src/sourceType.ts`：后缀优先 + 内容特征 JSON/CSS/SVG/Lua）。
- 点击「导入」弹窗选择覆盖/追加（`ImportModeDialog`）；空内容会提醒，且**不再清空画布**。
- 追加逻辑 `frontend/src/importScene.ts`（当前为**元素级**，见待办）。

### 工程
- 前端测试基建：vitest + @testing-library/react + jsdom（`vitest.config.ts`、`tests/setup.ts`）。
- `.gitignore` 忽略 `dev*.bat` 与 `backend/app/static/` 构建产物。
- 文档：`docs/fork.md`（分叉/同步策略）、`docs/layer-module-plan.md`（方案与决策）。

## 4. 验证命令

```bash
# 前端（frontend/）
npm test           # 纯逻辑 node 测试：当前 99 passed
npm run test:ui    # 组件测试 vitest：当前 13 passed
npm run build      # tsc + vite build

# 后端（backend/）
.venv/Scripts/python.exe -m unittest discover -s tests -v   # 上次 219 passed（3 skip 需 Lua VM/FENGARI）
```

## 5. 已知限制 / 待办（重要）

1. **追加导入不保留导入的分组**（develop 集成后暴露）：
   - 现状：`importScene.appendScene` 只追加元素；`layerTree.appendScene` 在拆分中被留在导入分支之外，develop 的 `layerTree` 没有分组版 appendScene。
   - 影响：往画布「追加」一个带分组 JSON 时，分组结构会丢失（元素保留）。
   - 建议修复：把 group-aware merge（原 `layerTree.appendScene` 思路，`SceneGroup` + 元素 groupId 重映射）放回 `layerTree.ts`，`runImport` 的 append 分支改用它；补对应测试。
2. **组不透明度导出为近似**：导出时把「元素 opacity × 祖先组 opacity」烘焙进元素（组内元素重叠处与真实组合成不同）。见 `docs/layer-module-plan.md` D3。
3. **删除分组后元素选择可能残留**：`deleteSelectedGroups` 只清 `selectedGroupIds`，未 `selectIds([])`（图层分支拆分时简化掉的）；影响很小，可补。
4. **.ora 导入导出未做**（OpenRaster；如做需导入+导出同时实现）。
5. 组不透明度画布预览同样是"逐元素乘 opacity"的近似（重叠处不准）。

## 6. 关键决策摘要
- 层级：`zIndex` 仅内部排序/导出/API/MCP 使用；**用户界面不显示层级编号**（PS 式）。
- 隐藏图层不参与绘制类导出；JSON 保留。
- 千星格式是铁律：GIA 素材组/容器节点/Lua 数据行格式不得改；组结构在导出时展平/烘焙。
- 导入格式自动识别；导入方式弹窗选择。

## 7. 新会话建议开场
1. `git switch develop && git status`
2. 读 `HANDOFF.md`、`docs/fork.md`、`docs/layer-module-plan.md`
3. 跑前端 `npm test && npm run test:ui && npm run build` + 后端 unittest 确认环境
4. 优先级建议：**修复「追加导入丢失分组」** → 再考虑 .ora / 组不透明度精确合成
5. 保持 TDD：纯逻辑放 `layerTree.ts` 等模块先写测试；UI 组件测试用 vitest。
