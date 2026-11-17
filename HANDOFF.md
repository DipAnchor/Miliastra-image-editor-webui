# HANDOFF（会话交接，2026-11-17）

> 交接目标：把「千星图片编辑器」逐步演进为更接近 Photoshop 的**场景编辑器**。本文件给新会话作为入口，先读它，再读 `docs/fork.md`、`docs/layer-module-plan.md`、`docs/README.md`。

## 1. 仓库与分支

- 工作目录：`<repo-root>`
- 当前分支：**`develop`**，工作区干净；与 `origin/develop` 同步于 **`195ceeb`**。
- 远程：
  - `origin` = https://github.com/DipAnchor/Miliastra-image-editor-webui.git（本 fork，推送）
  - `upstream` = https://github.com/1475505/Miliastra-image-editor-webui.git（上游，只读同步）
- `main` 与 `upstream/main` 保持一致（`783d900`），**main 只做上游镜像，不提交功能**。
- `backup/all-changes`：拆分前的完整历史备份（仅本地，未推送）。
- 未创建 PR。

## 2. 环境与运行

- 前端依赖已装（`frontend/node_modules`）；后端已建 `backend/.venv`。
- 本地脚本（`.gitignore` 忽略，不在仓库）：
  - `dev.bat`：同时起前后端
  - `dev-backend.bat`：`.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`
  - `dev-frontend.bat`：`npm run dev`（Vite 默认 5173）
- Vite `/api` 代理指向 `http://127.0.0.1:8000`；生产 `start.bat` 构建到 `backend/app/static`，端口 8439。
- 新会话先检查 5173/8000 是否存活；不保证跨会话。
- **DSH 沙箱注意（本机）**：工作区在 G: 盘，`workspace-write` 曾因目录缺 WRITE_OWNER 导致 run_code 启动失败，已用 `diagnose-windows-sandbox-acl` 修复；若复发，按该技能说明处理或请用户切完全权限。`npm` / `node --test` / `vite build` 在受限沙箱下会因 esbuild/子进程管道报 EPERM，需直接调用 node 或一次完全权限执行。

## 3. 近期已完成（2026-11-17 会话，均已推送 origin/develop）

### 画布 PS 化
- 画布尺寸：空画布尺寸中间的 × 改为**锁按钮**（默认锁定），锁定按「锁住那一刻的比例」联动，解锁可自由填写；改分辨率后自动缩放到窗口内；**记住上次画布尺寸**（localStorage `miliastra-canvas-size`）。
- 右键快捷编辑：宽 W/高 H、旋转角度 Z / X / Y（含复位角度）、缩放 −/＋ 与不透明度同一行；面板收窄到 224px；颜色输入框对齐。
- 顶部工具条：吸附右侧新增「中心」开关（中心放缩 vs 左上角基准，Photoshop 同款）；另有「自由」开关（自由缩放 vs 保持比例）。
- 多选支持整体缩放/旋转。
- 顶栏新增「新建画布」按钮（有内容时确认，清空后重置历史）。

### 历史存档
- `frontend/src/archives.ts` / `ArchiveSettingsDialog.tsx` / `SaveAsDialog.tsx` / `ConfirmDialog.tsx`。
- 顶栏「历史存档」按钮 + 下拉：按最后修改时间倒序，当前存档行名前**红点**；支持打开 / 另存为 / 删除；最多保留 20（可设置）。
- 「保存并应用」生成存档；打开/另存为前确认；改名实时同步。
- 启动时可恢复上次编辑（设置中可关闭）；清空画布不保留快照；无自动存档 UI。

### 左栏结构（PS 化）
- 左栏顶部仅保留「图形库」标题（标题栏样式与图层板块一致）；**图层板块常驻左栏下方**。
- 图形库与图层之间的分隔条可拖动调整高度（localStorage `miliastra-layer-pane-height`）。
- 「导入」已从左侧面板拆出：**顶栏导出右侧的「导入」按钮**打开独立导入弹窗；原图层/空画布导入入口也打开同一弹窗。
- 图形库本身改为**紧凑单列列表**（基础形状图标+名称、图片素材缩略图+ID）；分类/用途下拉框、搜索框均 26px 紧凑化。

### 图层面板 PS 化
- 搜索（名称/ID）、折叠全部、不透明度滑块+数值、底部动作条：成组（支持单层）、解组、复制、删除。
- 行更紧凑（约 25px 行高、行间分隔线）；显示图标固定最左、层级缩进只作用于内容，避免界面跳动。
- 分组行：显示开关、折叠箭头、文件夹、组名、重命名。
- 选中分组按 Delete/Backspace 执行整组删除（含子组和图元）。
- 分组复制：整组复制（分组 + 子分组 + 图元），新组名追加 ` copy`。
- 拖拽/点击图形库新增图元时：若选中恰好一个分组，新图元创建到该分组内（顶部）。

### 导入 / 导出
- 导入格式自动识别（JSON/CSS/SVG/Lua）；覆盖/追加弹窗。
- 追加导入时，本次追加的图元自动归入新分组，组名 = `导入 + 识别名`（上传用文件名，粘贴用格式名）。
- 修复导出下载：`downloadExport` 曾重复嵌套声明导致点击无反应，已修复。

## 4. 核心架构（既有）

- 前端纯逻辑 `frontend/src/layerTree.ts`：可见性继承、Solo、分组 CRUD/树行、拖拽排序/改父组、组不透明度烘焙、原位复制、组内元素收集、整组复制 `duplicateGroups`。
- 元素模型 `SceneElement`：`visible/layerName/groupId`；`SceneDocument.groups`；后端 `normalize_scene`/`normalize_library` 白名单保证 JSON 往返。
- WebMCP 暴露 `visible/layerName/groupId`，`get_scene` 返回 `groups`。
- 所有绘制类导出统一「可见性过滤 + 组不透明度烘焙」；JSON 保留完整分组数据。
- 千星格式是铁律：GIA 素材组 / 容器节点 / Lua 数据行格式不得改；组结构导出时展平/烘焙。

## 5. 验证命令

```bash
# 前端
cd frontend
node --test tests/*.test.mjs   # 或在受限沙箱中按文件逐个 node tests/xxx.test.mjs
node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit
node node_modules/vite/bin/vite.js build

# 后端
cd backend
.venv/Scripts/python.exe -m unittest discover -s tests -v
```

> 受限 DSH 沙箱下 `npm test` / `node --test` / `vite build` 可能因管道/子进程 EPERM；本会话用直接 node 单文件跑测试，并在完全权限下执行 build。

## 6. 已知限制 / 待办

1. **追加导入不保留原分组结构**：`importScene.appendScene` 仍是元素级；当前会把追加的全部图元统一放进一个「导入xxx」分组，但原文件里的分组/嵌套关系不会还原。
2. **组不透明度导出为近似**：导出时把元素 opacity × 祖先组 opacity 烘进元素，组内重叠处与真实合成不同（见 `docs/layer-module-plan.md` D3）；画布预览同理。
3. **.ora（OpenRaster）导入导出未做**。
4. 多选分组时「拖入画布新增图元」目前只对**单选一个分组**生效；多选时不自动入组。
5. 自动存档已移除（保持手动「保存并应用」+ 启动恢复上次编辑）；若将来要恢复定时存档需重新设计配额/性能。

## 7. 关键决策摘要

- `zIndex` 仅内部排序/导出/API/MCP 使用，UI 不显示层级编号（PS 式）。
- 隐藏图层不参与绘制类导出，JSON 保留。
- 导入格式自动识别；导入方式弹窗选择「覆盖 / 追加」。
- 分组/图层名称 `layerName` 与形状名 `name` 分离。
- 仅用户明确要求时提交/推送；提交消息简短。

## 8. 新会话建议开场

1. `git switch develop && git status`，确认 `195ceeb` 或更新。
2. 读 `HANDOFF.md`、`docs/fork.md`、`docs/layer-module-plan.md`、`docs/README.md`。
3. 检查 5173/8000；跑前端测试/类型检查/build + 后端 unittest。
4. 优先级：先处理「追加导入保留分组」→ .ora / 组不透明度精确合成；其余按用户新需求。
5. 坚持 TDD：纯逻辑放 `layerTree.ts` 等模块先写测试；UI 用 vitest。
