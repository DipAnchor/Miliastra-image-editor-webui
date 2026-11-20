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
4. 检查画面。普通作品可用 `get_canvas_preview`；含元件或启用蒙版的作品请查看网页画布截图，该工具的 PNG 出口不支持这些效果。
5. `export_scene({"format":"json"})` 保存；需要游戏脚本时导出 Lua。

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

## 工具分组（25 个）

| 用途 | 工具 |
|---|---|
| 能力查询 | `get_element_capabilities` |
| 查看场景 | `get_scene`、`list_elements`、`get_canvas_preview` |
| 素材发现 | `list_asset_categories`、`list_asset_uses`、`search_assets`、`get_asset_info` |
| 看图与素材包 | `preview_assets`、`prepare_asset_pack` |
| 元件查询 | `get_prefab_info` |
| 编辑 | `add_element(s)`、`update_element(s)`、`remove_element(s)`、`set_elements` |
| 画布与选择 | `set_canvas`、`set_selection`、`clear_canvas` |
| 导入导出 | `import_source`、`export_scene` |
| 历史 | `undo`、`redo` |

上表括号表示单项／批量工具，如 `add_element` 和 `add_elements`；实际参数以页面返回的 schema 为准。

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
- 图片类型、三轴旋转和 `luaMask` 可通过新增／更新工具配置。蒙版字段部分更新会合并；`luaMask:null` 清除设置。
- `get_canvas_preview` 默认返回 data URL；支持图片内容的客户端可传 `output:"image"`。预览不含选择框。
- `preview_assets` 使用原图总览，最多 48 张；拉伸缩略图可从 `get_asset_info` 获取。`prepare_asset_pack` 仅返回下载请求，需再发起下载。
- `set_selection` 目前选择单个图元；批量编辑用 ID 列表，不依赖手工多选状态。
- 图层锁定（`locked`）只用于减少编辑器里的手工误操作，不影响任何 AI 工具。`add_element(s)`、`set_elements` 会保留显式传入的 `locked:true/false`；省略时保持默认未锁定。`update_element(s)` 仍可修改锁定图层，`remove_element(s)` 仍可删除，`get_scene`/`list_elements` 会返回锁定状态；更新 `locked` 可锁定或解锁。
- 智能对象更新使用 `scale`（有限且大于 0 的外壳等比倍率），普通图元用 `width/height`。智能对象还支持 `x/y`、`rotation`、`opacity`、`zIndex`、`name/layerName`、`visible` 和 `locked`；不支持的字段（如 `width/height`、`color`、`groupId`、X/Y 倾转）会明确失败，不会自动换算或静默忽略。`scale` 仅属于更新工具，新增工具不能创建智能对象。
- 批量更新先校验所有目标的字段组合，任一项不支持就整批失败，不增加撤销记录。合法同值更新才会返回 `ok:true,count:0`。
- 智能对象内部编辑和待应用的变换预览期间，主编辑器工具暂不可用。异步导入或素材准备期间如果进入这些会话，旧调用即使在退出后才完成，也会在写入前返回可重试错误；已取消或已注销的调用不能迟到提交。退出编辑后重新读取场景，再决定是否重试。
- 导出文本可选 `json/css/svg/lua`。GIA 用页面导出按钮或 HTTP API。保存、复制前读取最新场景，工具失败后先确认状态，避免重复添加。

## 可选技能

根据 AI 客户端的技能安装方式，加载仓库中的 [素材选择](../skills/miliastra-image-asset-selector/SKILL.md)、[CSS 生成](../skills/miliastra-image-css-builder/SKILL.md)或 [SVG 生成](../skills/miliastra-image-svg-builder/SKILL.md)。技能提供操作与格式约束；浏览器 WebMCP 接入仍需单独可用。
