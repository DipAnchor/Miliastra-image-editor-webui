# WebMCP / AI 接入

[使用指南](README.md) · [English overview](../README.md#use-with-ai--webmcp)

## 连接当前页面

1. 在支持页面 WebMCP 的浏览器／AI 集成中打开[在线编辑器](https://qx.070077.xyz/)或本地 `http://localhost:8439/`。
2. 让 AI 列出当前标签页提供的工具，确认能看到 `get_scene`、`search_assets`、`add_elements` 等。
3. 描述想做的画面、尺寸、是否保留已有内容和交付格式。AI 与你的手工操作共用当前画布及撤销历史。

页面使用 `document.modelContext.registerTool` 注册工具。仅安装通用 MCP 客户端不一定能发现它：浏览器集成需要提供这个接口并转发页面工具。本项目没有需要配置 `command` 或独立端口的 MCP 服务。

If tools are missing, check the browser integration, reload the editor after enabling it, and list the tools again. The editor still works manually without WebMCP. Tool calls below show **tool name + JSON arguments**; they are not browser-console globals.

## 建议工作流

1. 先用 `get_element_capabilities({})` 了解类型与格式能力，再用 `get_scene({"summary":true})` 查看当前画布、`list_elements` 定位已有图元。
2. 找素材：`list_asset_categories` → `list_asset_uses` / `search_assets` → `get_asset_info` / `preview_assets`。按返回 ID 使用素材。
3. 优先用 `add_elements` / `update_elements` / `remove_elements` 批量编辑，每批只产生一步撤销。
4. 拼搭定稿后，用 `get_scene({"includeLibrary":false})` 读取图元及 `groups`，再用 `create_layer_groups` 按部件一次创建命名嵌套组；一批对应一步撤销。
5. 检查画面。普通作品可用 `get_canvas_preview`；含元件、活动图元蒙版或羽化的作品请看网页画布，PNG 和 JPEG 预览都不支持这些效果。
6. `export_scene({"format":"json"})` 保存；需要游戏脚本时导出 Lua。

示例：调用 `add_elements`，参数如下：

```json
{
  "elements": [
    {"id":"panel","type":"rectangle","x":150,"y":150,"width":260,"height":180,"color":"#203b35","opacity":1},
    {"id":"title","type":"textbox","x":150,"y":130,"width":200,"height":50,"text":"星间来信","fontSize":32,"color":"#ffffff","opacity":1}
  ],
  "select": true
}
```

`x/y` 是画布左上坐标系中的图元中心，X 向右、Y 向下；`rotation` 逆时针为正。`zIndex` 越大越靠上。明确填写尺寸、颜色和透明度可避免图形库预设影响结果。

## 工具分组（26 个）

| 用途 | 工具 |
|---|---|
| 能力查询 | `get_element_capabilities` |
| 查看场景 | `get_scene`、`list_elements`、`get_canvas_preview` |
| 素材发现 | `list_asset_categories`、`list_asset_uses`、`search_assets`、`get_asset_info` |
| 看图与素材包 | `preview_assets`、`prepare_asset_pack` |
| 元件查询 | `get_prefab_info` |
| 编辑 | `add_element(s)`、`update_element(s)`、`remove_element(s)`、`set_elements` |
| 图层组织 | `create_layer_groups` |
| 画布与选择 | `set_canvas`、`set_selection`、`clear_canvas` |
| 导入导出 | `import_source`、`export_scene` |
| 历史 | `undo`、`redo` |

上表括号表示单项／批量工具，如 `add_element` 和 `add_elements`；实际参数以页面返回的 schema 为准。

## 一次创建命名嵌套组

`create_layer_groups` 只在当前画布插入新组，可挂在顶层或已有组下。先读取 `get_scene({"includeLibrary":false})`：完整响应包含 `groups` 与图元的 `groupId`，`summary:true` 只给出 `groupCount` 等摘要。新增图元后也可直接使用 `add_elements` 返回的 ID。名称只用于显示，引用始终使用 ID 或本批 `key`。

例如，现有顶层普通图元按从下到上的层序为 `body-base → horn-left → horn-right → eye-left → eye-right`，调用 `create_layer_groups`：

```json
{
  "groups": [
    {"key":"slime","name":"火史莱姆"},
    {"key":"body","name":"身体","parent":{"newGroupKey":"slime"},"elementIds":["body-base"]},
    {"key":"horns","name":"角","parent":{"newGroupKey":"slime"},"elementIds":["horn-left","horn-right"]},
    {"key":"eyes","name":"眼睛","parent":{"newGroupKey":"slime"},"elementIds":["eye-left","eye-right"]}
  ]
}
```

成功返回 `{ok:true,count:4,groups:[...]}`，`groups` 按输入顺序给出每组的 `key/id/name/parentId`；后续调用使用返回的真实 `id`。整棵树一次提交，`undo({})` 一步撤销本批全部组与成员归属，`redo({})` 恢复；当前图元和组选择保持不变。

| 参数 | 约束 |
|---|---|
| `groups` | 必填非空数组；整批成功或整批拒绝 |
| `key` | 必填非空字符串，批内唯一，仅用于本批引用，按精确字符串匹配 |
| `name` | 必填字符串，去除首尾空白后不能为空；允许重名 |
| `parent` | 省略为顶层；只能是 `{"groupId":"既有组 ID"}` 或 `{"newGroupKey":"本批 key"}` 之一；本批引用可指向数组后面的项，不得形成环 |
| `elementIds` | 可省略的普通图元 ID 数组；每个 ID 在本批只能直接分配一次。父组可只含新子组，但每棵新子树最终须有普通图元 |

工具严格校验参数类型和未知字段。成员须是目标新树接入的既有父级下的**直属普通图元**：顶层建树只收当前 `groupId` 为空的图元；在已有组下建树只收当前直接属于该组的图元。新树中的各层沿用同一接入父级检查，不把已有子组中的后代抽出。智能对象壳及其内部局部 ID 不作为成员；现有组的移动、重命名或删除也不在此工具范围内。

已有父组的用法如下；此时 `eye-left/right` 必须已直接属于 `existing-character-id`：

```json
{
  "groups": [
    {"key":"eyes","name":"眼睛","parent":{"groupId":"existing-character-id"},"elementIds":["eye-left","eye-right"]}
  ]
}
```

新组默认可见、透明度 1、展开；只改变所选图元的 `groupId`，保留几何、蒙版、背景标记、原 `zIndex` 和已有组状态。隐藏或半透明的已有父组可以使用，原有祖先的显隐与透明度继续生效；成员自身或祖先锁定时拒绝。

每个新组（包括每个新子组）的全部后代图元，都必须在原 `zIndex` 稳定排序后占**连续位置区间**，隐藏图层也参与检查；数值可以有间隔，例如 4、9、25。工具不会为了编组重排图元。若层序为 `eye-left → highlight → eye-right`，只收两眼会返回：

```json
{
  "ok": false,
  "code": "INTERLEAVED_LAYERS",
  "error": "Group eyes contains an interleaved layer: highlight",
  "groupKey": "eyes",
  "elementIds": ["eye-left","eye-right"],
  "blockingElementIds": ["highlight"]
}
```

失败不创建部分组，不改变场景、选择或撤销／重做历史。参数格式错误（如未知字段、空批次、错误类型、无效字符串或同时指定两种父引用）由执行解析器返回 `{ok:false,error}`，不带 `code`；先对照页面 schema 修正参数。通过参数解析后的语义校验返回首个诊断，按 `code` 和可选定位字段修正整批后再调用：

| `code` | 如何处理 |
|---|---|
| `INVALID_INPUT` | 场景或规划输入无效，例如已有场景 ID 重复；重新读取场景并检查源数据 |
| `DUPLICATE_KEY` / `DUPLICATE_MEMBER` | 更换重复 `key`，或让该图元只直接归属一个新组 |
| `UNKNOWN_PARENT` / `UNKNOWN_ELEMENT` | 重读完整场景，使用当前既有 ID 或本批真实 `key` |
| `PARENT_CYCLE` | 去掉自环或相互引用，整理为有根的组树 |
| `UNSUPPORTED_MEMBER` | 改用当前画布普通图元；智能对象内部组织请使用对象内容编辑入口 |
| `EMPTY_GROUP` | 为该新子树补充普通图元，或移除空组 |
| `PARENT_MISMATCH` | 对照 `expectedParentId/actualParentId`，按原直属父级拆分建树；不要借建组移动成员 |
| `LOCKED` | 核对成员与祖先锁定状态，由用户确认需要的解锁后再尝试 |
| `INTERLEAVED_LAYERS` | 查看 `blockingElementIds`；保留原分层或缩小分组范围。需要调整层序时先取得用户明确决定 |
| `EDITOR_BUSY` | 等画布拖动等手势结束，再读场景重试 |

对象内容、变换或蒙版草稿编辑中，以及调用已取消时，沿用工具的 `{ok:false,error}` 报错通道，不保证带上述 `code`。先完成或取消编辑，再读取场景决定是否重试。

## 图元能力表

创建、导入或选择导出格式前，先查询类型级能力：

```js
get_element_capabilities({})                    // 全部 11 种已知类型
get_element_capabilities({ type: "image" })     // 仅图片类型 + 全局规则
get_element_capabilities({ type: "smart-object" })
```

返回 `{ok,schemaVersion:1,scope:"type-level",coordinates,parameterLimits,features,elements}`。`elements` 按类型名索引；每项含 `creation`（是否可直接新增／必填字段）、`editing.fields`（有意义的更新字段）、`formats.import/export`、`preview` 和 `constraints`。不传 `type` 查询全表；未知类型、空字符串与额外参数返回错误。查询只读，不读取或修改场景、选区或历史，不请求素材。

先应用 `features` 的跨类型限制，再解释各类型的格式状态；字段范围描述 WebMCP 的输入约束，不是后端任意导入文件的通用大小限制：

| 状态 | 含义 |
|---|---|
| `supported` | 当前实现有支持路径，仍须阅读 notes；不表示无损回导或真机一致 |
| `conditional` | 依赖资源、数据结构或几何条件，执行前仍要校验 |
| `lossy` | 会丢失属性或以通用外观替代 |
| `omitted` | 该类型会被跳过，须检查导出警告和最终内容 |
| `unsupported` | 没有受支持路径，部分场景会整次拒绝导出 |
| `preserved-only` | 只保留配置／编辑元数据，不产生对应绘制 |
| `approximate` | 网页近似表现，不能作为设备渲染事实 |

| 图元范围 | 能力表明确的主要边界 |
|---|---|
| 椭圆、矩形 | 中心坐标与逆时针角度；普通 SVG 导入不保留基础图元 transform |
| 三角形 | 固定尖朝上的等腰几何，不是任意三个顶点 |
| 四角星、五角星 | 可导出可显示的 SVG polygon，但普通 polygon 回导会跳过；投影组元数据是另一条恢复路径 |
| 圆环 | 内外径比固定 0.8；SVG 导出省略并警告 |
| 文本框 | WebMCP 暴露 text/fontSize 子集；富文本、SVG/PNG 与网页表现有损；容器节点 GIA 不支持 |
| 图片 | 必须按具体 ID 查询素材；Stretch 由非零切片边界决定；容器节点 GIA 固定 Stretch，不保留 Basic 模式 |
| 元件 | 必须是有缩略图的目录 ID；JSON 保存配置，绘制仅支持 Lua |
| 智能对象 | 可发现但不能通过 add/set 工具直接创建；只更新外壳白名单；绘制先展平并继承叶限制 |
| other | 已知旧类型但禁止直接创建；JSON/Lua 仅保存元数据，CSS/SVG/PNG 退化为矩形，素材组 GIA 跳过 |

活动蒙版按 `enabled || enableSoftEdge` 判断；其存在或含元件时，绘制只支持 Lua，其他绘图出口会失败。关闭但保留的蒙版配置不触发此限制。JSON 保存配置。智能对象展平可能因混合轴旋转、拉伸图片缩放、蒙版变换或文本几何无法精确表达而失败；画框不裁剪内容，透明度逐叶烘焙与整组合成不同。

类型能力不等于某个资产或整个场景当前可导出：继续用 `get_asset_info` 查询具体图片、`get_prefab_info` 查询元件、`get_scene` 查询当前场景，并处理导出的警告／错误。手写 CSS/SVG 仅支持解析器子集，Lua 只解析受限数据表；完整 Lua 快照仅在实际绘图摘要匹配时恢复。能力表依据当前源码契约，不声称所有 GIA/Lua 或网页预览已通过真机验证。定义与实际校验共用[类型、范围和外壳字段](../frontend/src/elementCapabilities.ts)；更改能力时同步对应解析／导出分支与回归测试。

## 使用注意

- `set_elements` 替换全部图元；`import_source` 替换整个场景。只想局部调整时用 update。
- 图片用 `type:"image"` + `imageAssetId`；元件用 `type:"prefab"` + `prefabId`。它们都不是 Lua 的控件模板索引。
- 图片类型、三轴旋转和 `luaMask` 可通过新增／更新工具配置。蒙版字段部分更新会合并，`luaMask:null` 清除设置。
- `offsetX/offsetY` 是从图元中心沿画布轴的像素偏移，X 向右，Y 向下。`width/height` 是沿蒙版自身轴的非负像素值，`null` 跟随图元对应尺寸，0 得到空覆盖。`rotation` 是绕蒙版中心的独立旋转，接受有限度数，逆时针为正，旧文件省略时为 0。
- 活动蒙版的 `rotation` 对 360 取余后非零，且内容的 `rotationX` 或 `rotationY` 非零时，Lua 绘制会报错。JSON 可保存这种组合。
- `get_canvas_preview` 是导出渲染，不是网页画布截图。PNG 和 JPEG 都依赖 PNG 导出；含元件、启用图元蒙版或开启羽化的场景不支持这两种预览。默认返回 data URL；支持图片内容的客户端可传 `output:"image"`。预览不含选择框或蒙版辅助线。
- `preview_assets` 使用原图总览，最多 48 张；拉伸缩略图可从 `get_asset_info` 获取。`prepare_asset_pack` 仅返回下载请求，需再发起下载。
- `set_selection` 目前选择单个图元；批量编辑用 ID 列表，不依赖手工多选状态。
- 图层锁定（`locked`）用于减少编辑器里的手工误操作；`create_layer_groups` 也拒绝自身或祖先锁定的成员。已有字段编辑与删除契约保持不变：`add_element(s)`、`set_elements` 保留显式传入的 `locked:true/false`，省略时默认未锁定；`update_element(s)` 仍可修改锁定图层，`remove_element(s)` 仍可删除，`get_scene`/`list_elements` 返回锁定状态；更新 `locked` 可锁定或解锁。
- 智能对象更新使用 `scale`（有限且大于 0 的外壳等比倍率），普通图元用 `width/height`。智能对象还支持 `x/y`、`rotation`、`opacity`、`zIndex`、`name/layerName`、`visible` 和 `locked`；不支持的字段（如 `width/height`、`color`、`groupId`、X/Y 倾转）会明确失败，不会自动换算或静默忽略。`scale` 仅属于更新工具，新增工具不能创建智能对象。
- 批量更新先校验所有目标的字段组合，任一项不支持就整批失败，不增加撤销记录。合法同值更新才会返回 `ok:true,count:0`。
- 智能对象内部编辑、待应用的图元变换或蒙版编辑期间，主编辑器工具暂不可用。异步导入或素材准备期间如果进入这些会话，旧调用即使在退出后才完成，也会在写入前返回可重试错误；已取消或已注销的调用不能迟到提交。退出编辑后重新读取场景，再决定是否重试。
- 导出文本可选 `json/css/svg/lua`。GIA 用页面导出按钮或 HTTP API。保存、复制前读取最新场景，工具失败后先确认状态，避免重复添加。

### 通过工具更新图元与蒙版

WebMCP 的 `update_element` / `update_elements` 直接设置字段，不执行画布的「变换」操作。仅改图元的宽高或旋转，不会重算蒙版的偏移、旋转或显式宽高。偏移始终相对图元中心，`null` 宽高仍跟随图元；需要调整蒙版几何时，在同一次更新中传入图元和蒙版的目标值。

例如，已有 `panel` 图元时，调用 `update_elements`：

```json
{
  "updates": [
    {
      "id": "panel", "width": 300, "height": 180, "rotation": 30,
      "luaMask": { "enabled": true, "offsetX": 12, "offsetY": -8, "width": 160, "height": 100, "rotation": 30 }
    }
  ]
}
```

- `enabled || enableSoftEdge` 判定蒙版是否活动；完全关闭效果时，两个字段都设为 `false`。
- `reverseMaskArea` 仅反转旋转后的蒙版外框内的覆盖；框外仍裁切。
- Lua 支持旋转蒙版与内容 X/Y 倾转组合，按编辑器 Z-X-Y 约定补偿子控件姿态，回导保留原始角度；混合轴组合尚待真机验证。
- `softEdgeMode:"Pixel"` 使用 `softEdgeWidthX/Y`；`"Percentage"` 使用 `horizontalSoftRange/verticalSoftRange`。网页把百分比范围近似当成中心不透明区域的占比，不能当作原生公式；Lua 写入对应的原生参数。
- 编辑蒙版时，主画布与右侧范围预览显示草稿。草稿、辅助线和辅助预览开关仅供编辑器使用，WebMCP 不读写这些临时状态。退出编辑后，工具读取现有场景；只有应用过的几何和反转设置才会写入场景。详见[蒙版与羽化指南](lua-mask.md)。

## 可选技能

根据 AI 客户端的技能安装方式，加载仓库中的 [素材选择](../skills/miliastra-image-asset-selector/SKILL.md)、[CSS 生成](../skills/miliastra-image-css-builder/SKILL.md)或 [SVG 生成](../skills/miliastra-image-svg-builder/SKILL.md)。技能提供操作与格式约束；浏览器 WebMCP 接入仍需单独可用。
