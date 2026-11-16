# 图层模块增强 · 方案与规划

> 状态：**规划稿（未实施）** · 分支：feature/new-feature · 日期：2026-11-16
> 本文只描述需求、现状影响面、数据模型与分阶段规划，不代表已改动任何代码。

## 1. 目标与铁律

- 目标：参考 Photoshop 及主流图层机制（开源图像/像素编辑器），充实与优化本项目的图层模块：图层右键菜单、层级调整、单图层/整组导出、图层名、可见性/Solo、图层分组。
- **铁律**：所有最终导出必须适配「千星图片」格式（GIA 素材组、容器节点 GIA、Lua 等），不得破坏；编辑器相关的额外数据必须可保存（参考 PSD / OpenRaster(ORA) 及本项目原有的 SceneDocument JSON、Lua 快照、localStorage 机制）。

## 2. 需求清单（锁定）

### R1 图层右键菜单（作用于左侧「图层」列表项）
- **层级** 一行：置顶 / 上移一层 / 下移一层 / 置底（PS 式，用户界面不显示任何层级编号；精确位置用拖拽）。zIndex 仅内部使用。
- **导出**：支持单个图层导出，弹窗选择格式，可选项与原导出保持同步（同一份格式来源）。
- **改名**。
- **可见性** 子菜单：显示 / 隐藏；一键只显示自己（Solo，类似 Photoshop）。
- 预留其它菜单项，后续再调整。

### R2 图层名
- 保留原有「形状名称」(element.name) 的前提下，额外增加「图层名」(layerName)，右键菜单可改名。

### R3 可见性
- 图层可见/隐藏；一键只显示自己（Solo）；隐藏图层在画布与导出中的处理需一致。

### R4 图层分组（Photoshop 式）
- **必须**：组织结构类全部——编组 / 解组、嵌套分组、展开 / 折叠、重命名 / 删除、拖拽进出组与排序、组可见性。
- **组不透明度**：可做，但实现时须留意「组作用域」合成（组内重叠处不能简单乘系数）。
- **混合模式**：不做。
- **整组导出**：支持，格式弹窗与原导出一致；导出应用组不透明度（若已设），隐藏层/子组不参与。

### R5 铁律（见第 1 节）
- 千星导出适配 + 编辑器额外数据保存。

## 3. 现状与影响面（已通读核实）

### 3.1 数据模型
- 前端 SceneElement（frontend/src/App.tsx:157-186）：已有 id / name(形状名) / type / 几何 / color / opacity / zIndex / isBackground / textBox / imageAssetId / imageTint / imageType / prefabId / prefabVariable / luaMask。**无 visible、无 layerName、无 group**。
- SceneDocument（App.tsx:224-240）= canvas / elements / meta / library。
- 后端 SceneElementModel（backend/app/main.py:220-257）、SceneDocumentModel（267-270）为 pydantic BaseModel，**未声明 model_config → v2 默认 extra=ignore，未知字段静默丢弃**；真正决定字段存亡的是 normalize_scene（643-737）与 normalize_library（882-961）的**白名单重建**。

### 3.2 已有可复用的层级能力
- moveLayer(direction) 与 moveLayerToPosition(number)：App.tsx:1742-1765。
- 属性面板「层级」控制（数字输入 + 置顶/上移/下移/置底）：App.tsx:3036-3067。
- normalizeZIndex（App.tsx:4069）、reorderSelection（frontend/src/editorSelection.ts）。
- 「层级一行」的逻辑已存在，主要工作是搬到右键菜单并复用。

### 3.3 图层列表与右键
- 图层列表渲染为 button（App.tsx:2221-2245），**目前无右键菜单**、无可视性图标。
- 画布图元右键是 quick-edit-menu（App.tsx:3332-3372，填色/透明度/缩小放大/删除）。

### 3.4 导出链路
- 导出格式集中在 EXPORT_FORMATS（App.tsx:426-437）：gia / container-node / lua / css / svg / json，另加 png；downloadExport（1786-1820）统一发起。
- 后端各格式均按 zIndex 排序、逐层应用 opacity：JSON(484) / CSS(1590) / SVG(1674) / PNG(1925) / GIA(2007) / container-node(client_ui_export.py:202) / Lua(lua_scene.py:376)。
- **container-node 禁止生成 UIControlGroup(21) 包装层**（docs/technical-design.md）→ 组在容器节点导出中只能展平，不能变成语义组节点。
- **Lua 数据行格式不可改**：ELEMENTS 固定 18 列、TEXTBOXES、DRAW_ORDER 均有严格校验；快照 MILIASTRA_EDITOR_SCENE_V1 的 drawingHash 只覆盖 ELEMENTS/TEXTBOXES/DRAW_ORDER，新增 element 字段不改 hash，场景可原样回灌。

### 3.5 保存机制
- Ctrl+S「保存并应用」= handleSaveAndApply（App.tsx:1317-1336）：把 orderedElements 写入 library.savedItems（收藏），**不是存盘**。
- 真正持久化：导出 JSON 文件（含 canvas/elements/meta/library）+ Lua 末尾快照 + 查看背景 localStorage（CANVAS_VIEW_BG_KEY）。
- 后端无 scene 数据库。

### 3.6 WebMCP / i18n / 样式
- WebMCP elementProperties 是字段白名单（frontend/src/webmcp.ts:160-201），parseElementFields 的 key 列表（281-）与 normalizeElementPatch 亦需同步。
- i18n translations 为 Record<Lang, TranslationValue>（frontend/src/i18n.tsx:41+），新增文案需 zh/en 同步。
- .menu / .menu-item 样式（styles.css:410-443）可复用于右键菜单；.layer-row-item 样式见 926-981。

### 3.7 影响点速查表

| 层面 | 文件:位置 | 需要改动 |
|---|---|---|
| 元素类型 | App.tsx:157-186 | 加 visible / layerName / groupId |
| 场景类型 | App.tsx:224-240 | 加 groups / schemaVersion |
| 默认值工厂 | App.tsx:1586-1650 createShape | 新字段默认 |
| 场景规范化 | App.tsx:3953 ensureSceneLibrary | 组与字段默认补齐 |
| 图层列表 | App.tsx:2221-2245 | 右键菜单、眼睛图标、组行、缩进折叠；移除层级编号 badge |
| 层级/可见/改名/导出动作 | App.tsx:1742-1765, 1786-1820 | 扩展/复用 |
| 历史 | App.tsx:857 commitScene | 新字段随结构化对象自动入历史 |
| WebMCP | webmcp.ts:160-201,281- | 字段白名单同步 |
| 后端模型 | main.py:220-257,267-270 | 加 visible/layerName/groupId、groups |
| 后端规范化 | main.py:643-737,882-961 | 白名单登记新字段 |
| 导出过滤 | 各 export endpoint | 隐藏层过滤（建议前置到前端） |
| i18n | i18n.tsx | 新增菜单/对话框文案 zh/en |
| 样式 | styles.css | 右键菜单、组行、眼睛图标 |

## 4. 数据模型设计（推荐）

### 4.1 原则
- **zIndex 仍作为全局层序真源**（导出链路几乎零改动）。
- 用 groupId 表达「元素属于哪个组」，用 groups 树表达组的嵌套、可见性、不透明度、折叠与同级顺序。
- **导出发送前在前端完成「可见性过滤」与「组不透明度烘焙」**，因此导出接口签名与后端 renderer 基本无需改动。
- 后端只需补模型字段与白名单，保证 JSON 往返保真。

### 4.2 前端类型（App.tsx）
~~~ts
export type SceneElement = {
  // ...现有字段保持不变
  layerName?: string;        // 图层名；空串回退到 name（形状名）
  visible?: boolean;         // 默认 true
  groupId?: string | null;   // 所属组；null/undefined 表示顶层
};

export type SceneGroup = {
  id: string;
  name: string;
  parentId: string | null;   // 嵌套组
  visible: boolean;          // 组可见性（对子元素继承）
  opacity: number;           // 0..1，组作用域合成
  collapsed: boolean;        // 展开/折叠（编辑器 UI 态）
  order: number;             // 同级顺序（小=靠下）
};

export type SceneDocument = {
  // canvas / elements / meta / library 保持不变
  groups?: SceneGroup[];
  schemaVersion?: number;    // 用于迁移
};
~~~

### 4.3 层序与分组共存
- 元素仍用 zIndex；约定「同一组的元素 zIndex 构成连续段」。
- 组在「同级」中的位置由 group.order 决定；顶层顺序 = 顶层元素(按 zIndex) 与顶层组(按 order) 混合排序后的结果。
- 编组 / 解组 / 拖拽时重算受影响元素的 zIndex（复用 normalizeZIndex 思路）并同步 groups.order，保证段连续。
- 渲染与导出继续按 zIndex 升序，天然得到正确层序；组只影响「可见性、折叠展示、组不透明度」等属性。

### 4.4 后端模型（main.py）
- SceneElementModel 增加：visible: bool = True、layerName: str = ""、groupId: str | None = None。
- SceneDocumentModel 增加：groups: list[SceneGroupModel] = []。
- normalize_scene 的两处元素构造（671-698、699-729）与 normalize_library（918-940）登记新字段；SceneDocumentModel 同步 groups。
- 目的：保证 /api/export/json 往返不丢字段（保真保存）。

### 4.5 持久化保证（组与图层数据）

- 组的完整结构数据（id / parentId / order / name / visible / opacity / collapsed）与图元的 layerName / visible / groupId 都写入 SceneDocument，随场景 JSON 完整保存与导入，往返不丢。
- 后端 SceneElementModel / SceneDocumentModel 声明这些字段，并在 normalize_scene、normalize_library 白名单登记（阶段 0），保证 /api/export/json 保真（否则会被 pydantic 白名单静默丢弃）。
- Lua 快照 MILIASTRA_EDITOR_SCENE_V1 的 scene 为完整 model_dump，新增字段自动进快照；drawingHash 只覆盖 ELEMENTS/TEXTBOXES/DRAW_ORDER，不受影响，可原样回灌；不改这些数据行格式。
- 旧文件兼容：缺 groups 时按现有 elements 生成默认顶层结构（每个元素一个顶层层，order=zIndex），不报错。
- 注意：GIA / 容器节点 / Lua 等千星格式本身不承载「组结构」，导出时展平；组结构的持久化载体是内部场景 JSON。

## 5. 行为规格

### 5.1 层级（右键菜单）
- 用户界面不显示任何层级编号（列表 badge、属性面板数字输入一并移除）；zIndex 仅作内部排序键，用于导入导出 / API / MCP / 持久化。
- 置顶 / 置底：所选元素移动到最上 / 最下（多选整体移动，保持内部相对顺序）。
- 上移一层 / 下移一层：与相邻层交换。
- 精确位置：通过拖拽图层/组在列表中调整（替代数字输入）。
- 组内语义：若元素属于组，层级移动限制在组内（是否允许跨组待 D1 确认）。

### 5.2 可见性
- 显示 / 隐藏：切换 element.visible。
- Solo（一键只显示自己）：进入前快照所有节点 visible 到 editor.soloSnapshot，仅当前节点（及其组）可见；再次执行按快照恢复。
- effectiveVisible = 自身 visible 且所有祖先组 visible。

### 5.3 改名
- 修改 layerName；列表主名显示 layerName（空则回退 name 形状名），副行显示形状名/尺寸。
- 保留 name（形状名）不变，导出与 WebMCP 语义沿用 name。

### 5.4 导出（单层 / 整组）
- 右键「导出」→ 弹窗列出与 EXPORT_FORMATS 同步的格式。
- 单图层导出：构造只含该元素的子集 scene（zIndex 归一，坐标保持画布位置）→ 复用 downloadExport。
- 整组导出：构造只含该组可见成员（含子组）的子集 scene，按组合成；应用组不透明度。
- 默认保画布尺寸（透明边），可选「裁到内容」（D4）。

### 5.5 图层分组
- 编组：选中多个元素/组 → 生成 SceneGroup，元素 groupId 指向新组，zIndex 收敛为连续段。
- 解组：删除组、成员回到父级并保持相对层序。
- 嵌套：组可含子组（深度上限待 D6）。
- 展开/折叠：collapsed 切换；Ctrl/Alt 批量（参考 PS）。
- 重命名/删除：删除组可选「连内容一起删」或「只删组壳」。
- 拖拽：图层/组可拖入/拖出组、改变同级顺序。
- 组可见性：眼睛图标，一键隐藏整组（子元素继承隐藏）。
- 组不透明度：滑块；画布用组作用域渲染（父容器 opacity），导出按第 7 节策略处理。

## 6. 分阶段实施计划

### 阶段 0 · 契约与骨架（低风险，先落地）
- 前端：SceneElement 加 visible/layerName/groupId；新增 SceneGroup 类型；SceneDocument 加 groups/schemaVersion；createShape 与 ensureSceneLibrary 补默认；commitScene 历史自然覆盖。
- 后端：SceneElementModel / SceneDocumentModel 加字段；normalize_scene、normalize_library 白名单登记。
- i18n：新增文案 key 骨架（zh/en）。
- 测试：JSON 往返保真单测（新增字段保留）、旧文件缺省补默认。
- 验收：npm test / npm run build 通过；后端 unittest 通过；JSON 导出→导入后新字段不丢失。

### 阶段 1 · 右键菜单 + 层级 + 单层导出 + 图层名 + 可见性/Solo（不含分组）
- 图层列表项加 onContextMenu → 菜单组件（复用 .menu 样式）。
- 菜单项：层级（置顶/上移一层/下移一层/置底）、导出、改名、可见性（显示/隐藏/只显示自己）。
- 可见性：element.visible + 列表眼睛图标 + 画布不渲染隐藏元素 + 导出发送前过滤隐藏。
- Solo：editor.soloSnapshot 快照恢复。
- 改名：layerName，列表显示优先级。
- 导出：复用 EXPORT_FORMATS 的弹窗 + 单元素子集 scene。
- 测试：菜单交互、层级跳转、隐藏/显示、Solo 恢复、单层导出各格式、导出过滤隐藏。
- 验收：画布所见即所得；单层导出结果正确；隐藏层不进入导出（JSON 仍保留）。

### 阶段 2 · 图层分组（组织功能 + 组可见性 + 整组导出）
- 组数据模型与树；图层列表改为可缩进的树（元素 + 组行）。
- 编组/解组、嵌套、展开/折叠、重命名/删除、拖拽进出组与排序。
- 组可见性继承；整组导出（按组合成）。
- 导出适配：GIA / 容器节点 / Lua 展平组；CSS/SVG 视需要展平或嵌套。
- 测试：编组/解组往返、嵌套层序、拖拽、组隐藏继承、整组导出与单层/整体结果一致。
- 验收：组结构不破坏各导出的千星格式；整组导出正确。

### 阶段 3 · 进阶（按需）
- 组不透明度：画布组作用域渲染 + 导出策略（烘焙近似 / 后端离屏合成精确 / 忽略并警告三选一，见 D3）。
- 可选 .ora 兼容导出（互操作出口，内部仍以 JSON 为准）。
- 拖拽落点高亮细化、组批量展开快捷键、WebMCP 暴露组/可见性/图层名。

## 7. 千星导出适配矩阵

| 导出格式 | 隐藏图层 | 图层分组 | 组不透明度 | 单层/整组导出 |
|---|---|---|---|---|
| JSON | 全保真保留 | 全保真保留（groups/groupId/layerName） | 保留原值 | 子集 scene |
| PNG | 过滤隐藏 | 展平（视觉一致） | 需离屏合成（后端增强）或忽略+警告 | 子集 scene，保画布 |
| GIA 素材组 | 过滤隐藏 | 展平（资产列表无组语义） | 烘焙到子层或忽略+警告 | 子集 scene |
| 容器节点 GIA | 过滤隐藏 | 展平（**禁止 UIControlGroup**） | 只能烘焙到子控件/忽略 | 子集 scene；textbox/prefab 仍不支持 |
| Lua | 行保留 + SetVisible(false) 或同步缩表 DRAW_ORDER | 展平 | 烘到 ELEMENTS 末列 opacity 或忽略 | 子集 scene |
| CSS / SVG | 过滤隐藏 | 可嵌套（CSS 父容器 / SVG g）或展平 | CSS 父 opacity 天然支持 | 子集 scene |

> 铁律：无论采用哪种「组不透明度」策略，导出文件的千星结构（GIA/容器节点/Lua 数据行）不得被破坏；JSON 始终完整保留分组与图层名。

## 8. 风险与待确认决策

- **D1 层序模型**：沿用 zIndex 全局真源 + groupId 段归属 + groups 树（推荐，导出零改、风险低），还是改为每 parent 下的 order 树（更贴近 PS，但需重写渲染/导出排序）。**推荐前者**。
- **D2 隐藏图层导出**：不导出（所见即所得，推荐），还是仍导出并在数据里标 invisible。
- **D3 组不透明度导出（已定）**：采用**前端烘焙近似**——导出前把 `元素 opacity × 所有祖先组 opacity` 烘进元素 opacity，适用于 PNG / GIA 素材组 / 容器节点 / Lua / CSS / SVG，以及单层、整组、WebMCP 导出与预览；JSON 保留组的原始 opacity。**组内元素重叠处与真实「组先整体合成再乘组不透明度」不同，属已知近似**；如需精确需后端离屏合成。
- **D4 单层/整组导出范围**：保画布尺寸（推荐，与整体 PNG 一致）还是裁到内容边界。
- **D5 图层名与形状名的列表显示**：主名图层名、副行形状名（推荐）；还是反过来。
- **D6 嵌套深度上限**：建议 UI 3–5 层、硬限 8–16。
- **D7 层级编号（已定）**：用户侧彻底隐藏编号（PS 式），只保留置顶/上移/下移/置底 + 拖拽；zIndex 仅内部用于导入导出 / API / MCP / 持久化。

## 9. 验收与测试

- 前端：frontend 下 npm test、npm run build（含类型检查）。
- 后端：backend 虚拟环境 python -m unittest discover -s tests -v。
- 页面实操核对交互；demo/demo.css 导入回归。
- 关键回归：JSON 往返保真（新字段不丢）、隐藏层导出过滤、单层/整组导出各格式、组可见性继承、Solo 恢复、GIA / 容器节点 / Lua 导出不被组结构破坏、旧文件导入安全降级。

## 10. 明确不做（本期）
- 图层混合模式（用户明确不做）。
- 组蒙版、组图层样式/效果、剪贴蒙版、智能对象。
- 组颜色标签、组搜索/筛选、组缩略图（暂缓）。
