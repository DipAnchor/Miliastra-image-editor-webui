# 编辑器流程缺陷修复实施计划

**Goal:** 修复上手导入无入口、SVG 警告误报与漏报、独显状态脱离撤销历史、收藏跨作品失效四类问题，并为每类保留可重复的回归证据。

**Architecture:** 保持现有 React App、导入对话框、导出协议及作品文档边界。入口与 SVG 使用局部修复；独显作为编辑器历史元数据随场景一起撤销；已保存图元收藏改为全局独立快照。四批顺序实施、分别验收，不重写编辑器状态系统。

**Tech Stack:** React / TypeScript、现有 Node test runner / Vitest / Testing Library、原生浏览器交互验证；后端继续使用现有 FastAPI / Pillow 导出实现。

**状态与基线:** 已按用户继续实施的授权完成四类修复。基线 develop / 86b8df9；无新依赖、全局配置变更、提交或推送。第 3–6 节保留实施前设计清单，完成情况和验证边界见第 7–8 节。

## 1. 范围与证据边界

| 批次 | 已核实的问题 | 推荐修复 | 不纳入本批 |
| --- | --- | --- | --- |
| 1 / 入口 | 上手窗口点击导入仅关闭引导；顶栏正式导入入口正常 | 复用正式 ImportDialog，左栏保持素材库 | 左栏重设计、统一重构全部 tab 类型 |
| 2 / SVG | 预览只取第一条警告；下载弹窗与状态栏固定说圆环 | 提取所有警告，预览和下载使用各自响应中的完整提示 | 增加 SVG 支持类型、改变后端警告协议、换掉原生弹窗 |
| 3 / 独显 | Undo 恢复了画面，却未恢复“恢复显示”所用的快照 | 把场景与双独显快照组成同一历史项 | 重做通用撤销系统、改变单图层/组独显互斥语义 |
| 4 / 收藏 | 全局收藏只存 savedId，点击却只查当前作品的 savedItems | 收藏时保存独立快照，并记录作品来源 | 重做 savedItems ID、把全局收藏写进作品 JSON、统一普通叶与智能对象的锁定复制语义 |

证据区分：入口、收藏和独显均有原问题及回归证据。无警告、单染色、圆环与染色混合的真实 SVG 下载已验证；单圆环的独立原生文件补验受弹窗时序影响，详细范围见第 7 节。

## 2. 推荐的产品语义

1. 收藏采用“收藏当时的独立副本”。原已保存图元之后被修改、改名、删除或重存，已有收藏不自动跟随。用户已授权按此冻结语义继续实施。
2. 旧收藏缺少来源和内容时，不按当前作品、同名或同 ID 自动猜配；保留名称，标记内容不可恢复，仍可取消收藏。用户可以从明确的原图元重新收藏。
3. localStorage 写入失败时，操作可在当前会话生效，但必须明确提示“仅本会话有效，未能持久保存”；保留原持久值，不宣称已保存。后续成功写入才清除该提示。
4. 独显的“恢复显示”依据属于可撤销编辑状态，不进入作品 JSON、导出、收藏快照或跨启动恢复。

## 3. 批次一：上手导入复用正式入口

**文件**

- 修改 [App.tsx](../../../frontend/src/App.tsx)：WelcomeDialog 的 onStart 接线，基线约 5158–5166；closeTour 约 3270；正式 ImportDialog 挂载约 5139。
- 新增 frontend/tests/editorFlowApp.test.tsx：覆盖本计划的入口与 SVG 流程。测试外壳沿用 [baseShapeLibraryApp.test.tsx](../../../frontend/tests/baseShapeLibraryApp.test.tsx) 的真实 App / I18nProvider / 异步 WebMCP 注册模式，不注入私有 App 状态。

- [ ] 先写失败用例：显示上手窗口，点击 welcome.import 后，应出现 dialog.import-dialog，而不是只隐藏上手窗口。
- [ ] 同时断言：素材库仍可见；尚未提交导入时 scene、当前选择和 Undo/Redo 不变。
- [ ] 覆盖取消导入后留在正常素材库、welcome.library 仍正常、顶栏导入仍正常。
- [ ] 运行该文件，记录失败点必须是入口未打开，不把测试宿主或 API 模拟错误当成产品红基线。
- [ ] 只调整 onStart：

~~~tsx
onStart={(tab) => {
  closeTour();
  setLeftTab("library");
  if (tab === "import") setImportOpen(true);
}}
~~~

- [ ] 运行专项回归；通过标准为正式对话框可继续完成现有支持的导入，取消不改作品。保留现有 closeTour 的已读标记行为。

## 4. 批次二：SVG 完整且准确地传达警告

**文件**

- 新增 frontend/src/svgExportWarnings.ts、frontend/tests/svgExportWarnings.test.mjs。
- 修改 [App.tsx](../../../frontend/src/App.tsx)：SVG 预览 effect 约 2011–2050，downloadSceneExport 约 3120–3158，代码区提示约 4797–4801，删除旧 extractSvgExportWarning 约 5944。
- 修改 [i18n.tsx](../../../frontend/src/i18n.tsx)：新增 statusbar.downloadedWithWarnings(name)，中文“已下载 {name}（请注意导出提示）”，英文“Downloaded {name} (see export warnings)”；替换当前下载流程中的固定圆环文案调用。
- 扩展本计划新增的 frontend/tests/editorFlowApp.test.tsx。

- [ ] 先为纯函数写失败测试：无警告、一个圆环、一个染色、两条不同提示、重复提示、空白提示、多行文本、非协议注释。重复按完整 trim 后文本去重，保留第一次出现顺序。
- [ ] 实现只解析现有协议的纯函数：

~~~ts
export function extractSvgExportWarnings(text: string): string[] {
  const warnings = Array.from(
    text.matchAll(/<!--\s*Miliastra-Warning:\s*([\s\S]*?)\s*-->/g),
    match => match[1].trim()
  ).filter(Boolean);
  return [...new Set(warnings)];
}
~~~

- [ ] 代码区不再维护独立的单条 warning state，改由 generatedSvg 派生完整 warnings；保留原缓存、AbortController、请求失效防护和数据导览锚点 svg-ring-warning。
- [ ] 渲染每条提示，保留后端提供的实际文本，不把染色警告改写成圆环警告。
- [ ] 下载函数只读取本次下载 blob 中的 warnings：有提示时原生 alert 展示 warnings.join("\n\n")；状态栏使用 statusbar.downloadedWithWarnings(name)。无提示仍走原普通下载状态。
- [ ] 下载局部/单图层 SVG 不得改写全场景代码区的 generatedSvg 或 warnings，避免两个不同响应互相污染。
- [ ] App 回归 mock 的是服务端响应，不 mock 解析函数：分别返回零条、染色一条、混合两条，检查预览、alert 参数、状态栏及下载触发次数；再覆盖先有提示后无提示、子集下载不污染预览。
- [ ] 保持文件名、MIME、创建和回收 object URL 的现有行为；不调整导出支持能力或后端注释协议。

**通过标准：** 零条不警告；单染色不出现固定圆环说明；混合两条均显示且顺序一致；下载内容与本次警告来自同一响应。

## 5. 批次三：独显快照与场景一起进入历史

**文件**

- 修改 [App.tsx](../../../frontend/src/App.tsx)：双独显 ref 约 701/703、historyRef 约 841、启动恢复约 863、commitHistory/commitScene 约 1336–1368、对象草稿重基约 1400–1420、图片归一历史映射约 1497、Undo/Redo 约 1505–1546、新建/打开约 2317–2360、元素独显约 2743、组独显约 2889、菜单判断位置。
- 扩展 [layerTreeApp.test.tsx](../../../frontend/tests/layerTreeApp.test.tsx)，并回归已有智能对象 App 测试。

- [ ] 先写原生流程对应的失败回归：A/B 初始可见 → 独显 A → Undo → 菜单不再误显示恢复状态 → 再次独显/恢复能回到原 A/B 可见性。
- [ ] 增加 Redo 后恢复显示、包含初始隐藏元素、组及嵌套组可见性、图层与组独显交错、Undo 后新编辑截断 Redo 的用例。
- [ ] 将场景历史项扩展为明确类型；快照克隆，不能共享可变引用：

~~~ts
type SoloHistoryState = {
  element: Record<string, boolean> | null;
  group: VisibilitySnapshot | null;
};
type SceneHistoryEntry = {
  scene: SceneDocument;
  solo: SoloHistoryState;
};
const emptySoloState = (): SoloHistoryState => ({ element: null, group: null });
function cloneSoloState(value: SoloHistoryState): SoloHistoryState {
  return {
    element: value.element ? { ...value.element } : null,
    group: value.group ? {
      elements: { ...value.group.elements },
      groups: { ...value.group.groups }
    } : null
  };
}
~~~

- [ ] 用 soloStateRef 保存当前双快照；historyRef 初始化为包含 scene 和空 solo 的 SceneHistoryEntry[]。
- [ ] commitHistory 构造同一个 { scene, solo: cloneSoloState(...) } 历史项；仅当 scene 和 solo 都相等时才 no-op。保留原 redo 截断和最多 101 个历史项的限制。
- [ ] commitScene 的提前返回同步比较 scene 与当前历史项的 solo，不能继续只比较 scene。单元素独显等“画面不变、恢复依据改变”的操作，也应成为可 Undo 的一步。
- [ ] 元素/组独显先更新对应 solo 字段，再调用 commitScene；菜单读取同一份当前 solo 状态。保持既有目标选择与独显切换规则。
- [ ] Undo/Redo 先克隆目标 entry.solo 回当前 ref，再恢复 entry.scene 和原有选择整理逻辑；不得只清空快照掩盖错误。
- [ ] 完成全部 historyRef 读写接线，而不只改 Undo/Redo：

| 入口 | 必须做的处理 |
| --- | --- |
| 初始、启动恢复、新建、打开存档 | 同时重置 live solo 和单根 history entry |
| 普通场景提交 | 自动附带当时 solo 的克隆 |
| 图片类型归一 | map(entry => ({ ...entry, scene: normalizeCachedImageTypes(entry.scene) })) |
| saveObjectDraft 历史坐标重基 | map(entry => ({ ...entry, scene: rebaseScene(entry.scene) }))，保留对应 solo |
| 对象编辑父场景保存 | 仍只增加一次原有主场景提交；不合并 SmartObjectSession 的本地 past/future |
| JSON、作品缓存和导出 | 仍只输出 SceneDocument，不输出历史外壳或 solo 元数据 |

- [ ] 回归单元素/空组的 solo-only 状态、历史上限、重新打开作品不继承旧 solo、智能对象保存后子编辑历史双向可用。

**通过标准：** 任意 Undo/Redo 后画面、菜单文字和下一次恢复的依据一致；独显不会越过作品边界；智能对象原有保存/取消/一次主撤销契约不变。

## 6. 批次四：收藏保存独立内容而非当前作品引用

**文件**

- 修改 [quickLibraryFavorites.ts](../../../frontend/src/quickLibraryFavorites.ts)：联合类型约 29–33、key 约 37–48、normalizeFavorite 约 69–102、sanitizeQuickFavorites。尽量保持纯逻辑；SceneElement 使用 type-only 引入。
- 修改 [App.tsx](../../../frontend/src/App.tsx)：全局收藏读写约 659–678、quickAddSaved/startSavedDrag 约 3449–3485、收藏 glyph/add/drag 及 savedCards 约 4910–4979。
- 复用 [sceneLayer.ts](../../../frontend/src/sceneLayer.ts) 的 cloneSceneLayer / 智能对象复制链路；需要时只修根 groupId 归属，不重写复制算法。
- 修改 [i18n.tsx](../../../frontend/src/i18n.tsx)：新增 quickLibrary.unresolvedFavorite（“原收藏未包含内容，请从原图元重新收藏” / “This favorite has no saved content. Add it again from the original item.”）及 quickLibrary.sessionOnly（“收藏仅本会话有效，未能持久保存” / “Favorites are available for this session only; changes could not be saved.”）。
- 扩展 [quickLibraryFavorites.test.mjs](../../../frontend/tests/quickLibraryFavorites.test.mjs)、[baseShapeLibraryApp.test.tsx](../../../frontend/tests/baseShapeLibraryApp.test.tsx)、[sceneLayer.test.mjs](../../../frontend/tests/sceneLayer.test.mjs)。

### 6.1 数据契约

~~~ts
export type SavedFavorite = {
  kind: "saved";
  savedId: string;
  name: string;
  sourceCanvasId?: string;
  snapshot?: { version: 1; element: SceneElement };
};
export function savedFavoriteKey(favorite: SavedFavorite): string {
  return favorite.sourceCanvasId === undefined
    ? "saved:legacy:" + JSON.stringify([favorite.savedId])
    : "saved:" + JSON.stringify([favorite.sourceCanvasId, favorite.savedId]);
}
export function captureSavedFavorite(
  item: { id: string; name: string; element: SceneElement },
  canvasId: string
): SavedFavorite {
  const element = structuredClone(item.element);
  element.groupId = null;
  return {
    kind: "saved", savedId: item.id, name: item.name, sourceCanvasId: canvasId,
    snapshot: { version: 1, element }
  };
}
export function resolveSavedFavorite(favorite: SavedFavorite): SceneElement | null {
  return favorite.snapshot?.version === 1
    ? structuredClone(favorite.snapshot.element) : null;
}
~~~

以上 resolve 的输入必须先经 normalizeFavorite 的运行时校验，不能直接信任任意 localStorage JSON。来源 ID 只用于收藏身份，不作为点击时重新查找内容的后门。

### 6.2 TDD 与接线

- [ ] 先写纯测试：不同 sourceCanvasId 下相同 savedId 不碰撞；相同来源可正常取消；空数组仍表示主动清空；旧 string[]、shape/asset/prefab 行为不变。
- [ ] 覆盖快照与原 savedItem 双向深隔离、未知 snapshot 版本、缺字段/非有限几何/坏对象、旧 saved 引用保留但 unresolved、读取结果不能反向修改持久对象。
- [ ] normalizeFavorite 校验版本和 SceneElement 判别：普通叶必需标识/类型/有限几何有效；智能对象的 frame、正 scale、内容及引用使用现有智能对象验证规则。无效快照不按 savedId 回退绑定当前作品，保留该收藏为不可恢复条目。若复用验证引入运行时依赖，同时更新 Node 测试的数据 URL 加载器；不得引入 App 的运行时循环依赖。
- [ ] 收藏时通过 captureSavedFavorite(item, 当前作品 ID) 建立快照；保留现有 per-scene savedItems 及 ID 生成方式。不同作品来自同一份 JSON 也能独立收藏。
- [ ] glyph、点击添加、拖动添加共享同一份解析结果，移除三处 savedItems.find 的隐式依赖。
- [ ] unresolved 卡保留名称和取消收藏按钮，添加按钮 disabled、不可拖动，并显示 quickLibrary.unresolvedFavorite。不要静默无反应，也不要自动删除。
- [ ] 添加产生新副本：根 groupId 为 null；不得挂到目标作品碰巧同 ID 的组。智能对象复用现有 addObjectCopy / cloneSceneLayer，壳、内部图元和组 ID 全部独立重映射，内部引用保持有效。
- [ ] 不在本批调整普通 saved leaf 的 locked 复制语义；快照不烘焙来源祖先组的隐藏/透明度/锁定状态。
- [ ] 把静默的收藏持久化 catch 改为显式更新入口统一写入并返回成功结果：会话态正常更新；setItem 失败保留原持久值，显示 quickLibrary.sessionOnly；后续真正写入成功再清除。移除会静默自动覆盖读取或迁移结果的持久化 effect。针对 quota、一般异常及初始加载/迁移失败分别测试，不以吞异常当成功。
- [ ] App 回归：A 收藏 → 新建/打开 B → 点击与拖入均插入 A 的冻结内容；A/B 同 savedId 各自可用；删除/修改 A 的 savedItem 不影响旧快照；旧 unresolved 不误配且可移除；场景新增仍只产生原有一次 Undo。
- [ ] 回归跨作品、JSON replace/append、作品导出与重新载入：全局收藏不被清空，也不混入作品 JSON。快照只保存 JSON 场景字段，不内嵌图片位图，外部 imageAssetId/prefabId 仍受原有资源可用性约束。

**通过标准：** 新收藏跨作品和重新启动仍可用；同 ID 不串作品；插入副本独立；旧数据不误绑、不静默丢弃；存储失败的用户反馈与实际持久状态一致。

## 7. 验证顺序与命令

每批先写能复现本批问题的测试，运行看到预期失败，再实施最小修改并运行专项。不要因测试宿主或选择器出错而声称已取得红基线。使用现有工具和直接 Node 入口，避免先前 npx 只输出 CMD 横幅却未执行测试的情况。

在 frontend 目录，按对应批次运行（新增文件随实施建立）：

~~~powershell
node --test tests/svgExportWarnings.test.mjs
node node_modules/vitest/vitest.mjs run tests/editorFlowApp.test.tsx
node node_modules/vitest/vitest.mjs run tests/layerTreeApp.test.tsx
node --test tests/quickLibraryFavorites.test.mjs tests/sceneLayer.test.mjs
node node_modules/vitest/vitest.mjs run tests/baseShapeLibraryApp.test.tsx
~~~

全部批次完成后运行一次完整前端检查，每步非零即停止并调查：

~~~powershell
$testFiles = Get-ChildItem tests -Filter '*.test.mjs' | ForEach-Object { $_.FullName }
node --test @testFiles
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node node_modules/vitest/vitest.mjs run
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node node_modules/typescript/bin/tsc -b
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node node_modules/vite/bin/vite.js build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git diff --check
exit $LASTEXITCODE
~~~

后端本计划不修改；SVG 协议与作品 library 的既有回归可用已配置虚拟环境，在 backend 执行 python -m unittest discover -s tests -v。环境开关造成的跳过须如实记录，不临时安装新测试依赖。

### 真实页面验收

- [x] 使用既有服务验收；操作前备份全部 15 个应用 localStorage 原值和 sessionStorage，含连字符和冒号素材缓存键。
- [x] 原生验证上手导入可打开正式窗口，取消后作品不变；本轮未逐项重走所有文件导入格式。
- [x] SVG 原生验证：混合圆环/染色的预览、真实 alert 与下载文件完全一致；单染色及无警告下载同样通过。三份文件分别为 809、693、228 字节。
- [x] 原生验证元素独显 → Undo → Redo → Undo → 再独显/恢复，场景和菜单一致。组、隐藏内容、快照单独变化与跨作品重置由 App 回归覆盖。
- [x] 原生验证 A 收藏后新建 B，点击和真实拖入均插入冻结内容：ID 独立、根 groupId=null、几何/颜色/透明度保真，旋转按模 360 比较。来源改删、同 ID、智能对象、旧收藏及存储异常由自动回归覆盖。
- [x] 离开 App 停止自动保存后恢复全部 owned 原始存储、删除新增 owned 键；15 个原值、非 owned 和 sessionStorage 全量逐值一致。注入已不存在，测试 space 独立关闭，临时文件已清理。
- [x] 明确边界：单圆环独立原生文件补验未完成，下载监听与原生弹窗确认发生时序超时；该场景自动回归、单圆环提示和混合场景中的圆环警告已验证。未把工具时序失败认定为应用导出故障。

### 自动检查结果

- 354 项 Node 测试、285 项 UI 测试、TypeScript、Vite 构建和 git diff --check 通过。
- 专项覆盖 SVG 提取与下载、上手入口、独显历史、冻结收藏存取及跨作品副本。夹具、Blob.text 测试宿主及选择器错误未作为产品红基线。
- 本轮无后端业务改动，未重复运行后端全量；外部浏览器转发链路与真机能力不在本轮验收范围。

## 8. 文档与收尾

- [x] 同步 [使用指南](../../README.md)：上手导入、SVG 完整提示、收藏冻结及旧收藏缺少来源的处理。
- [x] 同步 [维护说明](../../technical-design.md)：SceneHistoryEntry 仅为内存历史；收藏快照独立于作品 library / JSON，资源仍依赖外部素材。
- [x] 复核实现与测试；未改后端 vendor、生成 assets、机器配置、凭据或无关用户改动。
- [x] 用户已授权继续实施，包括冻结收藏语义；本轮未提交或推送。

四类原问题已修复并完成上述验收。第 3–6 节保留实施前详细设计清单，实际验证范围以第 7–8 节记录为准；未逐项完成的原生边界不宣称通过。
