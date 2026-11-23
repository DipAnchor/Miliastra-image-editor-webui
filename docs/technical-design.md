# 维护说明

用户操作见 [使用指南](README.md)，AI 接入见 [WebMCP](webmcp.md)。本文只保留源码入口、兼容契约和验证边界。

## 结构与检查

| 模块 | 入口 |
|---|---|
| 页面、场景状态与历史 | `frontend/src/App.tsx` |
| 人类多选与键盘操作 | `editorSelection.ts`、`ShortcutHelp.tsx` |
| 显式变换控件、几何与事务 | [TransformControls.tsx](../frontend/src/TransformControls.tsx)、[transformGeometry.ts](../frontend/src/transformGeometry.ts)、[transformAffine.ts](../frontend/src/transformAffine.ts)、[transformSession.ts](../frontend/src/transformSession.ts) |
| 智能对象模型、复制与编辑事务 | [smartObjectModel.ts](../frontend/src/smartObjectModel.ts)、[smartObjects.ts](../frontend/src/smartObjects.ts)、[sceneLayer.ts](../frontend/src/sceneLayer.ts)、[smartObjectSession.ts](../frontend/src/smartObjectSession.ts)；界面 [SmartObjectControls.tsx](../frontend/src/SmartObjectControls.tsx) |
| 智能对象绘制展平与诊断 | [backend/app/smart_objects.py](../backend/app/smart_objects.py)，由 [main.py](../backend/app/main.py) 统一接入 |
| 页面 AI 工具 | [webmcp.ts](../frontend/src/webmcp.ts)；只读类型能力与共享校验定义 [elementCapabilities.ts](../frontend/src/elementCapabilities.ts) |
| 图层组树与批量建组事务 | [layerTree.ts](../frontend/src/layerTree.ts)、[layerGroupCreation.ts](../frontend/src/layerGroupCreation.ts)；App 桥接接入主历史 |
| 图片和元件目录 | 前端 `imageLibrary.ts` / `prefabLibrary.ts`；后端同名模块 |
| 图片类型与切片 | `imageStretch.ts`、`SlicedSprite.tsx`、`ImageAssetControls.tsx`；后端 `image_stretch.py` |
| 蒙版编辑与预览 | `LuaMaskInspector.tsx`、`MaskImagePicker.tsx`、`maskPreview.ts`、`maskGuides.ts`、`useMaskPreview.ts` |
| 场景模型、格式解析与 HTTP API | `backend/app/main.py` |
| Lua 数据回导与导出适配 | `backend/app/lua_scene.py`、`lua_mask.py` |
| 三轴投影 | 前端 `rotation.ts`、后端 `rotation.py` |

前端：在 `frontend/` 执行 `npm test`（纯逻辑，node --test）、`npm run test:ui`（组件级，vitest + jsdom）、`npm run build`。后端：在 `backend/` 的虚拟环境中执行 `python -m unittest discover -s tests -v`。`FENGARI_MODULE_PATH` 指向已安装的 Fengari 模块时，后端测试还会执行 Lua 控件契约检查；未配置时相关用例跳过。依赖清单见各目录，不要求外部知识库或模拟器源码。

前端构建含 TypeScript 检查，输出到 `backend/app/static/`；Vite 配置以 `frontend/vite.config.ts` 为准。Docker 自动构建前端，运行方式见 [部署](deploy.md)。

## 场景与格式契约

- 场景为 `{canvas,elements,meta,library,groups?,schemaVersion?}`。`x/y` 是图元中心，X 右、Y 下；`rotation` 是逆时针 Z，`rotationX/Y` 缺省 0。`zIndex` 大的在上；增删与层序操作按原入口重新连续编号，纯结构建组保留原值。JSON 场景保存保留组、锁定状态与版本字段；旧文件缺省时按兼容默认值处理。
- 图片用 `imageAssetId`，元件用 `prefabId/prefabVariable`，文字设置在 `textBox`，图元蒙版在 `luaMask`。不要把这些 ID 与 Lua 控件模板索引混用。
- 查看背景不进场景，导出透明底；实底用矩形图元。`canvas.mask` 是 GIA 素材组遮罩，与 `luaMask` 分开。
- JSON 保留完整规范化场景。图层组的 `order` 保留整数和复制图层组产生的有限小数，不取整；这也适用于智能对象的内部组和 Lua 编辑快照。缺少画布的简化 JSON 根据内容拟合画布；不接受嵌套 `center/size` 替代扁平几何。
- CSS 画布支持 `-miliastra-canvas-size` 和 `-miliastra-canvas-fit: lock|expand|fit`。SVG 是有限子集，圆环导出省略并警告。详细生成约束留在对应 [CSS](../skills/miliastra-image-css-builder/SKILL.md) / [SVG](../skills/miliastra-image-svg-builder/SKILL.md) 技能。
- 含元件或活动 `luaMask` 的绘图出口只支持 Lua；JSON 始终可保存。浏览器辅助轮廓、候选蒙版、选择集合与撤销历史不序列化。
- `get_element_capabilities` 返回类型级可创建／可更新字段、WebMCP 数值范围、格式与预览状态。可创建类型、数值限制、智能对象外壳白名单与实际 schema／校验共用定义；每次返回独立数据，不依赖场景或网络。全局活动蒙版／元件限制优先于单类型状态，格式 notes 区分手写子集和编辑元数据回导；不是场景可导出证明或真机验收记录。详情见 [WebMCP 图元能力表](webmcp.md#图元能力表)。
- 手工编辑与 WebMCP 共用 `commitScene`。批量修改先校验再原子提交；场景与独显恢复状态均无变化时不创建历史。普通拖动和方向键长按在结束时提交一次；历史保留最近 100 次编辑。
- 显式变换模式中，单独移动仍写主场景，松手提交一次普通撤销，不打开变换预览。缩放、旋转或调整锚点使用独立预览场景，拖动达到 3 屏幕像素后锁定当前可见、未锁定的目标；已有预览中的移动也归入该预览。预览不写 `sceneRef`、自动保存或主历史；应用统一调用一次 `commitScene`，取消丢弃预览，无变化不增加历史。锚点只用于本次变换，不序列化。预览期间，属性更新仅允许当前目标的几何字段，复用原校验与角度归一化后写入预览，重新映射控制框和锚点；多选位置更新复用整体移动以保留已旋转的选框。其余人工场景编辑与 WebMCP 入口仍阻止，可继续缩放／平移视图及调整变换选项。
- 多选变换按选框轴组合每层可见投影：屏幕旋转左乘投影矩阵，不能只累加各层 Z；非均匀缩放将投影分解回已有 X/Y/Z 与尺寸，不新增仿射持久化字段。单层仍保持其倾转平面，智能对象始终正向等比。
- `locked` 是编辑器内部字段：JSON 场景保存保留它，绘制型导出不把它转成运行时能力。锁定限制编辑器里的人工操作（属性修改、拖拽、缩放、旋转、删除及层级移动）。画布按渲染层序从上往下跳过自身或祖先锁定的图层，并按实际内容命中，不使用选框作为点击区域。WebMCP 的 `create_layer_groups` 同样拒绝自身或祖先锁定的成员；已有 `update_element(s)`/`remove_element(s)` 仍无视锁定照常修改与删除，字段编辑切分点在 `applyElementUpdates(..., {ignoreLock:true})`，仅由 WebMCP 桥接传入。
- 独立蒙版编辑从图元「高级」进入，复用变换草稿但不新增子图层：主画布和右侧预览同步显示草稿，编辑期间其它图元、图层、属性和菜单只读；辅助预览开关只改显示，不重新编码蒙版 PNG。应用把区域反转与几何草稿一起写入并记一次撤销，取消丢弃草稿且不动场景与历史。普通变换中启用的蒙版随图形移动和 Z 旋转，缩放按本地比例更新尺寸并保留相对角度；无法精确表示的倾转投影保留上次有效预览。

## WebMCP 图层组事务

- `create_layer_groups` 用 `groups: [{key,name,parent?,elementIds?}]` 一批插入命名嵌套组；`parent` 省略为顶层，或仅包含既有 `groupId`／本批 `newGroupKey` 之一。本批引用可向前或向后，结果按输入顺序给出 `key/id/name/parentId`。名称去除首尾空白、允许重名；引用按精确字符串匹配。复用现有 `SceneGroup`，不新增场景 schema。完整参数与诊断见 [WebMCP](webmcp.md#一次创建命名嵌套组)。
- [layerGroupCreation.ts](../frontend/src/layerGroupCreation.ts) 负责严格运行时输入校验、父引用解析与候选场景构建。批内 key 与直接成员唯一，引用不得缺失或成环，每个新子树必须最终包含普通图元。成员仅来自当前画布，不收智能对象壳或内部局部 ID；其原 `groupId` 必须等于新树最终接入的既有父级。可在已有父组下插入新组，不移动既有子组或跨父级抽取后代，不负责已有组重命名、移动或删除。
- 建组复用 `effectiveLocked` 检查成员自身与祖先锁。隐藏、半透明父组仍可使用，因为新组为中性状态：`visible:true, opacity:1, collapsed:false, order:0`。已有组（含空组及其位置字段）原样保留，选中的普通图元只更新 `groupId`；原数组顺序、`zIndex`、几何、富文本、背景标记和蒙版字段保留。每个新组按全部后代图元在原 `zIndex` 稳定排序后的连续位置区间验证，隐藏成员和隐藏阻挡层也计入；数值有间隔合法，交错返回按绘制顺序排列的 `blockingElementIds`。这与会重排选中块的手工编组路径分开。
- 校验完成后才通过现有场景 ID 分配器生成 ID，并把候选交给 App。任一项失败整批拒绝，不分配部分组，不改变场景、图元／组选择、撤销历史或重做分支。WebMCP 参数解析异常沿用注册器的 `{ok:false,error}` 通道，不带语义 `code`；规划器返回结构化诊断。App 从最新 `sceneRef` 同步规划；手势中返回 `EDITOR_BUSY`，对象、变换和蒙版草稿编辑沿用桥接可用性检查，可能仅返回通用错误，已取消调用不得提交。成功前收结待记历史的键盘微调，再用一次 `commitScene` 提交整批；一次撤销恢复全部归属和组，重做恢复同批结果。返回的组映射经注册器深复制，与场景／历史隔离。
- 中性组插入保留原祖先链上的显隐、透明度和锁定语义。JSON 保存新组的名称、`parentId` 与图元 `groupId`，场景原 `schemaVersion` 不变；Lua 完整编辑快照也保留组。绘制出口仍按既有展平路径解析可见叶、有效透明度与原层序，GIA／Lua 的背景优先分支保持原约定，不增加运行时分组或改变两类 GIA 根资产协议。自动回归与真机结果分别报告，不以组树测试代替真机验收。

## 页面流程与临时历史

- 欢迎页的导入操作关闭上手引导后打开正式导入窗口，与工具栏共用文件解析、覆盖／追加、取消和迟到响应防护；素材库保持正常可用，打开或取消窗口不提交场景。
- SVG 代码预览从完整响应收集全部导出警告，并去重显示。下载只解析该次响应的警告；单图层／局部下载不改写全场景代码预览及其警告。后续无警告的响应应清除旧提示，不按文件中是否含圆环猜测警告内容。解析入口见 [svgExportWarnings.ts](../frontend/src/svgExportWarnings.ts)。
- 历史项同时保存场景与图层／组两份独显恢复状态；快照深复制，撤销／重做同步恢复画面、菜单及下一次恢复的依据。比较是否变化也必须包含独显状态，允许画面未变的独显操作单独成一步历史。新编辑截断重做分支。
- 独显恢复状态只在内存编辑历史中，不增加场景 schema，不写入 JSON、自动恢复缓存或本地存档；当前显隐值仍是正常场景字段。初始、启动恢复、新建及打开存档同时清空当前独显状态并建立单根历史；对象草稿与主场景仍各用原有历史边界。

## 跨作品收藏契约

- 作品内的 `library.savedItems` 与浏览器全局快捷收藏分开。全局收藏保留在 `miliastra-quick-library-favorites`，切换作品或 JSON 替换／追加不清空它，也不将其混入作品 JSON。模型与兼容入口见 [quickLibraryFavorites.ts](../frontend/src/quickLibraryFavorites.ts)。
- 已保存图元的收藏记录固定收藏时的 `name` 与 `snapshot: { version: 1, element }`，身份按 `sourceCanvasId + savedId` 区分。来源只用于识别收藏，不用于添加时重新查找内容；改名、改内容或删除源项都不改变已有快照，不按当前作品、同名或同 ID 补配。
- 读取收藏先做运行时校验，保留旧形状字符串、shape／asset／prefab 与主动清空数组的兼容。旧 saved 引用、未知版本或无效快照保留为不可恢复条目，展示名称和取消按钮，禁止添加与拖动；用户须从明确的原图元重新收藏。读取或迁移结果不自动覆盖原持久值。
- 缩略图、点击和拖入共享同一份已校验解析结果。收藏与原内容深隔离，添加再产生新副本：根 `groupId = null`，避免挂到目标作品碰巧同 ID 的组；智能对象壳、内部图元与组 ID 独立重映射，内部引用保持有效。沿用普通叶既有锁定复制语义，不烘焙来源祖先组的隐藏、透明度或锁定状态。
- 收藏快照只保存 JSON 场景字段，不内嵌位图或元件资源；`imageAssetId/prefabId` 的可用性仍受原资源服务约束。收藏不构成离线资源包。
- 持久化只由显式收藏更改触发。写入失败时会话态仍更新，保留原持久值，并明确提示「收藏仅本会话有效，未能持久保存」；只有后续真正写入成功才清除提示，不以吞异常表示保存成功。

## 智能对象契约

- `SceneElement = SceneLeaf | SmartObject`，对象判别值为 `type: "smart-object"`，含对象的场景使用 `schemaVersion: 2`。对象壳只存位置、Z、正数统一 `scale`、显隐／锁定／透明度及父组等状态；尺寸为 `content.frame × scale`，壳不另存可自由修改的宽高或 X/Y 倾转。`content` 只有当前 `frame`、普通叶 `elements` 和 `groups`，不复制全局库或元数据；首版不支持嵌套对象。画框尺寸只读，无手动尺寸入口。前后端校验 ID、有限几何、组引用及循环，拒绝非法对象，不降级为矩形。
- 普通组转换包含完整后代；普通多选要求同一父级且连续，不连续或跨父级须用户先显式编组，转换不暗中重排。初始画框依据全部叶（含隐藏／锁定层）的几何边界建立，不等于字形／羽化像素包围盒。编辑中画框稳定、不实时适配、不裁剪，溢出内容保留。复制、收藏复用和追加导入深复制对象及局部 ID／组引用，不共享可变内容。
- 内容编辑使用独立局部草稿与历史，主场景内容不进入草稿撤销。`Ctrl/⌘+S` 应用当前内容、更新保存基线并留在编辑态；仅 `changed` 才适配并调用 `commitScene`，每次变化一个主撤销，无变化不适配、不提交。完成只按同一规则应用最近保存后的新变化并退出；放弃仅丢弃未应用草稿，不恢复旧主场景。内部保存不触发整份作品收藏／存档。
- 保存适配用 `selectionBounds` 对全部普通叶（不按隐藏／锁定过滤）计算局部几何 AABB；空内容保留上次 `frame`。非空时 `newFrame = max(1, boundsSize)`（逐轴），局部平移 `offset = newFrame/2 - boundsCenter`，壳位置补偿 `newPosition = oldPosition + scale * Rscreen(Z) * (boundsCenter - oldFrame/2)`；`rotation/scale` 不变。该重基保持编辑后叶的世界几何位置，不保证壳中心或外框不变，也不改变导出协议。
- 保存后将 session 的 `draft/saved/past/future` 及内部编辑器历史以同一局部偏移重基并采用新画框；保留撤销／重做，不清空历史。`rebaseObjectContent(content, frame, offset)` 深复制内容并保留 ID、组、文字、倾转等其它字段；App 只重基内部历史，不把适配另拆成一次主撤销。
- 解除原子地把外层变换映射到叶子，结果普通组留在当前父级，保留内部组织和当前外观；失败不部分解除。唯一根组覆盖全部叶（无散落图元）时保留该根组 ID 与真正的子组，不额外包装；根组名称／父级／层序采用外壳值，透明度相乘、可见性取交集、锁定取并集，折叠状态保留。多个根组、散落叶或没有组时才用壳 ID 新建收拢组；`releaseObject` 返回 `releasedGroupId` 供 App 选择，不将该临时结果字段写入场景。内部背景仍局限于原对象层序，不可提升到全场景底层。
- JSON 保留完整规范化对象、局部组与隐藏／锁定状态。CSS、SVG、PNG、Lua、素材组 GIA、容器节点 GIA 共用后端绘制展平：按可见性筛选叶子，组合位置与投影、烘焙组／对象透明度，再沿用原有格式能力检查；不改千星绘图格式、不引入对象素材 ID 或额外运行时分组。`backgrounds_first` 仅用于 GIA／Lua／容器节点出口，CSS／SVG／PNG 保持 z 序；对象内部背景不提升到对象外。透明度仍是逐叶烘焙近似，不是先整体合成再乘 alpha。
- 单独导出的前端请求先按原有规则选取可见图元，再由 `sceneForLayerExport` 沿这些图元的 `groupId` 和 `parentId` 保留所需的外层组。父组属性和顺序原样保留，因此不会丢失继承的透明度或改变绘制展平结果；无关组不会进入 JSON 或 Lua 回导快照。智能对象的 `content` 不参与外层裁剪；整场景及 WebMCP 导出不走此子集逻辑。
- 外层变换不按内部含 X/Y 倾转预禁，但解除／绘制出口必须验证能否精确表示。当前诊断包括混合轴矩阵组合、拉伸／九宫格图片缩放、活动蒙版的外层旋转或非明确 Basic 的缩放、缩放后字号／富文本 size 非正整数、自定义文字 anchor/pivot 无法重定基、尺寸小于 1px 或几何溢出。前端解除没有素材元数据，缩放图片还要求明确 `imageType: "basic"`；后端先按素材解析缺省类型。失败给出对象／叶 ID 路径，保留 JSON，不静默舍入、清零倾转或丢内容。
- 本节描述代码契约，不代表页面交互或真机验收已通过。智能对象的 GIA／Lua 真机结果仍待验证；当前轮页面与全量回归由集成验收单独记录。

## Lua 兼容

上游导出器在 [vendor/primitive_shape](../backend/vendor/primitive_shape/PROVENANCE.md) 按原样保留；修改应用适配层，不修改来源文件或许可证。

支持 PALETTE/ELEMENTS、ROOT/ELEMENTS 和本编辑器 TEXTBOXES/DRAW_ORDER 等受限字面量，不执行上传代码。文件上限 10 MiB、表深度上限 64；拒绝非有限数、重复声明、无效引用及数据区表达式。

末尾 `MILIASTRA_EDITOR_SCENE_V1` 保存完整编辑快照（包括智能对象）及实际展平绘图数据的 `drawingHash`，不能用快照本身计算绘图摘要。模板索引更改不影响快照；绘图数据修改后回导会警告并重新解析当前记录，不能恢复陈旧对象／组元数据覆盖外部修改。`IMAGE_TYPES`、`ROTATIONS`、`IMAGE_MASKS/TEXT_MASKS` 参与摘要；新增默认字段时须保留旧摘要兼容。

文本框直接设置字号、自适应、颜色、描边、对齐和显隐；字号为整数。图片和文字使用独立模板。启用蒙版的文字也需要图片模板；蒙版父先子后创建。带蒙版路径防止 OnStart 重入，失败回收，宿主销毁时不重复销毁其子树。

## 渲染策略与证据边界

- 图片类型按素材边框判断：任一边界大于零可拉伸，无边框只支持基础。浏览器整数切片与 PNG 共用边界语义，缩略图不作绘图贴图。
- 图片原生 `imageType` 是条件能力，Lua 设置需兼容保护。模板实例化成功不表示图片绑定成功，蒙版读取来源和 ID 核对绑定。
- 正交投影采用 Z-X-Y（`Ry * Rx * Rz`）；单轴图片压缩/翻面有真机观察，混合轴及其它控件不据此宣称已通过。
- 矩形遮罩裁切后代、透明着色仍遮罩、Pixel 羽化向内有 MASK v1 真机观察。简单形状轮廓与反向区域、以及 0/90/180° 旋转矩形范围内的取反均有真机样本支持，矩形外保持裁切；`maskPreview.ts` 的最终 alpha 反向阶段据此限制在旋转矩形内，不再全缓冲取反，隐藏辅助图仍为最终可见 alpha 的全补集。非矩形轮廓、百分比、软边、半透明、嵌套、其它平台及精确合成仍待验证。辅助虚线来自原轮廓，非羽化等值线。
- 百分比网页过渡宽度为 `轴尺寸 × (1-clamp(range,0,100)/100)/2`，不回写原参数。不能当作原生公式。
- 预览缓冲最长边 2048、轮廓 1536、辅助轮廓提取 768。辅助轮廓先排除近透明噪声（全图峰值 1%，至少 alpha=1），分离连通图案，再按各图案自身峰值的 50% 插值；避免约半透明素材的 127/129 像素被固定 128 阈值割裂。此处理只用于辅助线，不改变实际蒙版 alpha。辅助描边、选框及手柄按视图缩放补偿屏幕尺寸。素材请求共享缓存、失败可重试，迟到结果不覆盖新选择。

### 必须保留的 GIA 差异

| 项目 | 依据／边界 |
|---|---|
| 文本框自适应 | 7.1.0 对照文件的 textbox(19) `506` 从 0 变 1，`503` 保持 1；原始消息在 `test_textbox_gia.py`。字号 `502`、最小字号 `507`、对齐 `508/509`；不要把 visible 写入 `506` |
| 拉伸类型 | 客户端 class=70 样本为 image_slot(84).field504；本项目旧素材组 class=15 尝试 image_settings(31).field5=1，**仍是未真机确认的映射** |
| 三轴 GIA | 四平台 RectTransform 508 写 XYZ；客户端单轴探针成功不替代旧素材组导出的真机验证 |

拉伸样本 SHA-256：`10f04eba8af9d18a3ada66e88f328e15bbccacf0567c4cf1070e76707fcaaf6b`；仓库模板：`212633c935566155ede68d5b9b4bb9feec1b5d98152c3646d91b5bad6f9fede3`。

### 客户端「容器节点」GIA

`/api/export/container-node` 由 `backend/app/client_ui_export.py` 生成控件模板，不复用素材组 `json_to_gia` 链路。根资产是 `UIControlTemplate(70)`（preset=25、中心锚点、画布像素宽高）；图元为其图片子控件 `which=15`，基础形状与图片素材直接引用 `100001`–`100006` 或自带素材 ID，sibling 按底→顶写入。禁止生成服务端 `UIControlGroup(21)` 包装层、preset=24 或根引用槽 62/82。画布矩形遮罩生成透明遮罩父图片并重算子控件相对位置；圆形遮罩、文本框、元件暂不导出。控件坐标为容器中心原点、Y 向上、Z 逆时针，旋转轴直接沿用场景值。四平台 RectTransform 同步写入 float32；根/新建子控件各自登记独立 Info.index。测试覆盖纯 Python 结构断言，并可在设置 `UGC_GIA_CODEC` 后用 ugc-tool 独立编解码器复核。

Lua API 核对来源为[官方页面](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhtakr07vej4)的本地加工快照，SHA-256 `4a43f93f2b322be8336ff33d9cb07b3bc3a8d4c8a931a45d18f90e4e64941bab`；原始快照标记 `2026-08-26T2213_rev223`。上述运行观察来自 MASK v1、ROTXY2；不是本项目每个新导出文件的真机验收。维护时按测试断言保留边界，不把浏览器或 VM 通过写成真机通过。

## 接口入口

`POST /api/import` 接收 `{sourceType,content,sourceName?}`，返回 `{scene,warnings}`。

`POST /api/export/{json|css|svg|lua|png|gia|container-node}` 接收 `{scene,giaGroupName?}`。`container-node` 返回客户端「容器节点」控件模板 GIA；`gia` 仍是素材组资产。普通场景可经 PNG 出口验证导入后的渲染；受限场景查看网页截图。

素材目录、元数据、PNG 代理、总览和 ZIP 由 `/api/library/*` 提供；元件目录和 ID 查询由 `/api/prefabs/*` 提供。具体使用见 [WebMCP](webmcp.md)、[图片源](image-library-upload.md)、[元件源](prefab-library-upload.md)。
