# 维护说明

用户操作见 [使用指南](README.md)，AI 接入见 [WebMCP](webmcp.md)。本文只保留源码入口、兼容契约和验证边界。

## 结构与检查

| 模块 | 入口 |
|---|---|
| 页面、场景状态与历史 | `frontend/src/App.tsx` |
| 人类多选与键盘操作 | `editorSelection.ts`、`ShortcutHelp.tsx` |
| 智能对象模型、复制与编辑事务 | [smartObjectModel.ts](../frontend/src/smartObjectModel.ts)、[smartObjects.ts](../frontend/src/smartObjects.ts)、[sceneLayer.ts](../frontend/src/sceneLayer.ts)、[smartObjectSession.ts](../frontend/src/smartObjectSession.ts)；界面 [SmartObjectControls.tsx](../frontend/src/SmartObjectControls.tsx) |
| 智能对象绘制展平与诊断 | [backend/app/smart_objects.py](../backend/app/smart_objects.py)，由 [main.py](../backend/app/main.py) 统一接入 |
| 页面 AI 工具 | `webmcp.ts` |
| 图片和元件目录 | 前端 `imageLibrary.ts` / `prefabLibrary.ts`；后端同名模块 |
| 图片类型与切片 | `imageStretch.ts`、`SlicedSprite.tsx`、`ImageAssetControls.tsx`；后端 `image_stretch.py` |
| 蒙版编辑与预览 | `LuaMaskInspector.tsx`、`MaskImagePicker.tsx`、`maskPreview.ts`、`maskGuides.ts`、`useMaskPreview.ts` |
| 场景模型、格式解析与 HTTP API | `backend/app/main.py` |
| Lua 数据回导与导出适配 | `backend/app/lua_scene.py`、`lua_mask.py` |
| 三轴投影 | 前端 `rotation.ts`、后端 `rotation.py` |

前端：在 `frontend/` 执行 `npm test`（纯逻辑，node --test）、`npm run test:ui`（组件级，vitest + jsdom）、`npm run build`。后端：在 `backend/` 的虚拟环境中执行 `python -m unittest discover -s tests -v`。`FENGARI_MODULE_PATH` 指向已安装的 Fengari 模块时，后端测试还会执行 Lua 控件契约检查；未配置时相关用例跳过。依赖清单见各目录，不要求外部知识库或模拟器源码。

前端构建含 TypeScript 检查，输出到 `backend/app/static/`；Vite 配置以 `frontend/vite.config.ts` 为准。Docker 自动构建前端，运行方式见 [部署](deploy.md)。

## 场景与格式契约

- 场景为 `{canvas,elements,meta,library,groups?,schemaVersion?}`。`x/y` 是图元中心，X 右、Y 下；`rotation` 是逆时针 Z，`rotationX/Y` 缺省 0。`zIndex` 大的在上，提交后连续编号。JSON 场景保存保留组、锁定状态与版本字段；旧文件缺省时按兼容默认值处理。
- 图片用 `imageAssetId`，元件用 `prefabId/prefabVariable`，文字设置在 `textBox`，图元蒙版在 `luaMask`。不要把这些 ID 与 Lua 控件模板索引混用。
- 查看背景不进场景，导出透明底；实底用矩形图元。`canvas.mask` 是 GIA 素材组遮罩，与 `luaMask` 分开。
- JSON 保留完整规范化场景。缺少画布的简化 JSON 根据内容拟合画布；不接受嵌套 `center/size` 替代扁平几何。
- CSS 画布支持 `-miliastra-canvas-size` 和 `-miliastra-canvas-fit: lock|expand|fit`。SVG 是有限子集，圆环导出省略并警告。详细生成约束留在对应 [CSS](../skills/miliastra-image-css-builder/SKILL.md) / [SVG](../skills/miliastra-image-svg-builder/SKILL.md) 技能。
- 含元件或活动 `luaMask` 的绘图出口只支持 Lua；JSON 始终可保存。浏览器辅助轮廓、候选蒙版、选择集合与撤销历史不序列化。
- 手工编辑与 WebMCP 共用 `commitScene`。批量修改先校验再原子提交，原值操作不创建历史。鼠标事务和方向键长按在结束时提交一次；历史保留最近 100 次编辑。
- `locked` 是编辑器内部字段：JSON 场景保存保留它，绘制型导出不把它转成运行时能力。锁定只限制编辑器里的人工操作（画布选中、属性修改、拖拽/缩放/旋转、删除、层级移动；锁定图层光标保持默认）；MCP 的 `update_element(s)`/`remove_element(s)` 无视锁定照常修改与删除，切分点在 `applyElementUpdates(..., {ignoreLock:true})` 仅由 WebMCP 桥接传入。

## 智能对象契约

- `SceneElement = SceneLeaf | SmartObject`，对象判别值为 `type: "smart-object"`，含对象的场景使用 `schemaVersion: 2`。对象壳只存位置、Z、正数统一 `scale`、显隐／锁定／透明度及父组等状态；尺寸为 `content.frame × scale`，壳不另存可自由修改的宽高或 X/Y 倾转。`content` 只有当前 `frame`、普通叶 `elements` 和 `groups`，不复制全局库或元数据；首版不支持嵌套对象。画框尺寸只读，无手动尺寸入口。前后端校验 ID、有限几何、组引用及循环，拒绝非法对象，不降级为矩形。
- 普通组转换包含完整后代；普通多选要求同一父级且连续，不连续或跨父级须用户先显式编组，转换不暗中重排。初始画框依据全部叶（含隐藏／锁定层）的几何边界建立，不等于字形／羽化像素包围盒。编辑中画框稳定、不实时适配、不裁剪，溢出内容保留。复制、收藏复用和追加导入深复制对象及局部 ID／组引用，不共享可变内容。
- 内容编辑使用独立局部草稿与历史，主场景内容不进入草稿撤销。`Ctrl/⌘+S` 应用当前内容、更新保存基线并留在编辑态；仅 `changed` 才适配并调用 `commitScene`，每次变化一个主撤销，无变化不适配、不提交。完成只按同一规则应用最近保存后的新变化并退出；放弃仅丢弃未应用草稿，不恢复旧主场景。内部保存不触发整份作品收藏／存档。
- 保存适配用 `selectionBounds` 对全部普通叶（不按隐藏／锁定过滤）计算局部几何 AABB；空内容保留上次 `frame`。非空时 `newFrame = max(1, boundsSize)`（逐轴），局部平移 `offset = newFrame/2 - boundsCenter`，壳位置补偿 `newPosition = oldPosition + scale * Rscreen(Z) * (boundsCenter - oldFrame/2)`；`rotation/scale` 不变。该重基保持编辑后叶的世界几何位置，不保证壳中心或外框不变，也不改变导出协议。
- 保存后将 session 的 `draft/saved/past/future` 及内部编辑器历史以同一局部偏移重基并采用新画框；保留撤销／重做，不清空历史。`rebaseObjectContent(content, frame, offset)` 深复制内容并保留 ID、组、文字、倾转等其它字段；App 只重基内部历史，不把适配另拆成一次主撤销。
- 解除原子地把外层变换映射到叶子，结果普通组留在当前父级，保留内部组织和当前外观；失败不部分解除。唯一根组覆盖全部叶（无散落图元）时保留该根组 ID 与真正的子组，不额外包装；根组名称／父级／层序采用外壳值，透明度相乘、可见性取交集、锁定取并集，折叠状态保留。多个根组、散落叶或没有组时才用壳 ID 新建收拢组；`releaseObject` 返回 `releasedGroupId` 供 App 选择，不将该临时结果字段写入场景。内部背景仍局限于原对象层序，不可提升到全场景底层。
- JSON 保留完整规范化对象、局部组与隐藏／锁定状态。CSS、SVG、PNG、Lua、素材组 GIA、容器节点 GIA 共用后端绘制展平：按可见性筛选叶子，组合位置与投影、烘焙组／对象透明度，再沿用原有格式能力检查；不改千星绘图格式、不引入对象素材 ID 或额外运行时分组。`backgrounds_first` 仅用于 GIA／Lua／容器节点出口，CSS／SVG／PNG 保持 z 序；对象内部背景不提升到对象外。透明度仍是逐叶烘焙近似，不是先整体合成再乘 alpha。
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
