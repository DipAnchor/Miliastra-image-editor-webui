# WebMCP 图层组管理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**目标**　让 AI 在拼搭定稿后，根据部件归属把画布图元组织成可命名的嵌套图层组，例如「火史莱姆 → 身体／角／眼睛」。一次工具调用对应一步撤销。

**架构**　WebMCP 校验参数后，App 从当前场景调用纯函数生成一份候选组树。纯函数使用既有场景结构、锁定规则和 ID 分配器。通过校验的批次进入现有历史事务。

**技术栈**　React、TypeScript、浏览器 WebMCP、Node Test、Vitest、现有 FastAPI/Pillow 导出回归。

---

## 1. 首版范围与取舍

| 决策 | 建议 | 依据 |
|---|---|---|
| 批量失败语义 | 整批成功或整批拒绝 | 父子组互相依赖。一次调用和一次撤销使用同一个边界，调用方可以根据失败项修正整棵树。 |
| 既有分组 | 允许在既有组内新建子组。首版的结构操作为插入新组，成员是当前父级的直属普通图元。 | 插入中性组可直接保留原祖先链上的显隐、透明度与锁定规则。现有组改名、移组、删除需要各自的输入与验收契约。 |
| 交错图层 | 新组和每个新子组各自占绘制序列中的连续区间，包含隐藏成员。交错时返回阻挡图层 ID。 | 图层面板把组显示为连续子树，绘制以 zIndex 为序。把交错成员压成块会把画面层序与用户预期绑定在一次结构操作里。 |
| 命名与作用域 | 名称在创建时指定，允许重名，引用使用 ID。实例成员来自当前画布的普通图元。 | 内容局部 ID 属于智能对象内部；可由已有编辑器入口继续组织这些内容。 |

“连续”指按原 zIndex 稳定排序后的相邻位置，允许数值有间隔。旧组结构及其空组的位置字段保留。选中的普通图元只改变 groupId。新组 visible=true、opacity=1、collapsed=false，使用现有 SceneGroup 保存。被隐藏或处于半透明父组中的直属图元可建子组，因为原有祖先链仍在。新工具拒绝自身或祖先锁定的目标，已有 update_element(s) 继续执行自己的字段编辑契约。

场景模型与写入约定见[维护说明](../../technical-design.md)。手工编组会重排选中块，可以用现有测试确认该特性。新工具复用组树定义和锁定查询，组候选由同一个纯函数生成。参考 [groupSelection](../../../frontend/src/layerTree.ts#L331)、[图层列表](../../../frontend/src/layerTree.ts#L521)、[手动编组回归](../../../frontend/tests/layerTreeSelection.test.mjs#L15)。

## 2. 工具契约

工具名为 `create_layer_groups`。先通过 `get_scene({includeLibrary:false})` 读取场景与组。`add_elements` 返回的图元 ID 可直接用于分组。输入示例使用已有的三个部件 ID。

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

省略 `parent` 表示顶层。`{"parent":{"groupId":"existing-id"}}` 指定既有父组。`newGroupKey` 引用本批任意位置的 `key`，成功结果按输入顺序返回。`elementIds` 允许省略，使父组可以仅包含新子组。每棵新子树最终都要有普通图元。`key` 在批内唯一，每个元素 ID 只能直接分配一次。名称去除首尾空白，空名拒绝。ID 和 `key` 用精确字符串匹配。JSON Schema 与浏览器内的工具执行函数均校验未知字段、参数类型和父引用分支，并拒绝空批次。

```ts
export type LayerGroupParent = { groupId: string } | { newGroupKey: string };
export type CreateLayerGroupInput = {
  key: string;
  name: string;
  parent?: LayerGroupParent;
  elementIds?: string[];
};
export type CreatedLayerGroup = Pick<SceneGroup, "id" | "name" | "parentId"> & { key: string };
export type CreateLayerGroupFailure = {
  ok: false;
  error: string;
  code: "INVALID_INPUT" | "DUPLICATE_KEY" | "DUPLICATE_MEMBER" | "UNKNOWN_PARENT"
    | "PARENT_CYCLE" | "UNKNOWN_ELEMENT" | "UNSUPPORTED_MEMBER" | "EMPTY_GROUP"
    | "PARENT_MISMATCH" | "LOCKED" | "INTERLEAVED_LAYERS" | "EDITOR_BUSY";
  groupKey?: string;
  elementIds?: string[];
  blockingElementIds?: string[];
  expectedParentId?: string | null;
  actualParentId?: string | null;
};
export type CreateLayerGroupResult =
  | { ok: true; count: number; groups: CreatedLayerGroup[] }
  | CreateLayerGroupFailure;
```

交错时，假设当前绘制层序从下到上是 `eye-left → highlight → eye-right`，仅把两眼编成眼睛组会返回下面的结果。其他校验错误以及取消继续通过现有 WebMCP 的 `ok/error` 通道报告。批次校验返回第一个错误，调用方可以定位对应输入项。

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

父级冲突优先检查成员的原始 groupId 与目标树接入的既有父组 ID 是否相同。跨父级时返回原父级与目标父级，允许 AI 按实际父级拆批或保留该层当前归属。选择层序冲突修复方式时，AI 可保留分层、缩小分组范围，或等用户明确决定调整层序后再操作。

## 3. 实施任务

### 任务 1　实现纯分组事务

**文件**　新增 `frontend/src/layerGroupCreation.ts` 和 `frontend/tests/layerGroupCreation.test.mjs`。复用 [layerTree.ts](../../../frontend/src/layerTree.ts) 的有效状态查询和 [sceneLayer.ts](../../../frontend/src/sceneLayer.ts#L10) 的 ID 分配器。Node 测试按既有图层测试的 TypeScript 转译加载方式接入两个依赖。

- [ ] **写失败测试。** 四图元按 `body → horn → eye → overlay` 排列，批次先传 `eyes`、再传 `slime`，后者包含 body、horn。限定生成 ID 后验证结果、所有新父链和原 zIndex。另写一个包含可建组和冲突组的批次，断言冲突诊断、无 ID 分配和输入快照。

```js
const elements = [el('a', 4), el('gap', 9), el('b', 25)];
const before = structuredClone(elements);
const out = planLayerGroupCreation(elements, [], [
  { key: 'safe', name: '单层', elementIds: ['gap'] },
  { key: 'eyes', name: '双眼', elementIds: ['a', 'b'] },
], () => 'unexpected-allocation');
assert.equal(out.ok, false);
assert.equal(out.code, 'INTERLEAVED_LAYERS');
assert.deepEqual(out.blockingElementIds, ['gap']);
assert.deepEqual(elements, before);
```

- [ ] **运行红灯。** 从前端目录执行 `node --test tests/layerGroupCreation.test.mjs`。期望新函数缺失，接入后用同一测试验证断言。
- [ ] **实现校验与候选构建。** 以输入顺序建立 key 索引，解析本批父引用，检测环和既有父链中的无效引用，算出每组最终接入的既有父组或 null。索引元素 ID，校验成员类型、唯一性、groupId 和 `effectiveLocked`。由子向父收集后代元素的排序位置，对每个新组检查下面的区间。失败项按绘制顺序返回阻挡 ID。全部通过后才用 `createSceneIdAllocator(makeId, collectSceneIds(elements, groups))` 分配组 ID。为每个组建立 `{ id, name, parentId, visible: true, opacity: 1, collapsed: false, order: 0 }`，按输入顺序追加，按原数组顺序只复制被重新归组的图元。

```ts
const byZ = [...elements].sort((a, b) => a.zIndex - b.zIndex);
const members = new Set(descendantElementIds);
const covered = byZ.filter(element => members.has(element.id));
const ranks = new Map(byZ.map((element, index) => [element.id, index]));
const first = ranks.get(covered[0].id)!;
const last = ranks.get(covered[covered.length - 1].id)!;
const blockers = byZ.slice(first, last + 1).filter(element => !members.has(element.id));
```

排序索引在整批计算中共用。实际实现先处理空子树，再执行区间检查。纯函数签名使用 `planLayerGroupCreation(elements: SceneElement[], groups: SceneGroup[], input: CreateLayerGroupInput[], makeId: () => string): (Extract<CreateLayerGroupResult, { ok: true }> & { next: GroupMutation }) | CreateLayerGroupFailure`。已有图元数据和组对象保持原值。普通图元对象中的蒙版、富文本、背景标记和几何字段随对象展开保留。ID 分配异常沿用注册器的错误返回约定。
- [ ] **运行绿灯和兼容回归。** 添加成功用例覆盖当前父组不可见且 opacity 为 0.5、非连续数值 zIndex、冻结输入、F2 的活动蒙版字段。失败矩阵覆盖隐藏阻挡层、父包络连续但子组交错、跨父级、成员或祖先锁定、重复 key、重复成员、未知引用、自环与互环、空组、智能对象壳及内部 ID。执行 `node --test tests/layerGroupCreation.test.mjs tests/layerTreeSelection.test.mjs tests/layerNodeMove.test.mjs`，预期全部通过。

### 任务 2　注册工具并接入历史

**文件**　修改 [webmcp.ts](../../../frontend/src/webmcp.ts#L432)、[App.tsx](../../../frontend/src/App.tsx#L2218) 和 [webmcpApp.test.tsx](../../../frontend/tests/webmcpApp.test.tsx#L40)。

- [ ] **写失败测试。** 利用已有 `document.modelContext` 捕获真实注册定义。用已挂载 App 执行成功、失败、撤销与重做。

```ts
const { root } = await mount(scene([leaf('body'), leaf('eye', { zIndex: 1 })]));
const before = await readScene();
const result = await execute('create_layer_groups', { groups: [
  { key: 'slime', name: '火史莱姆', elementIds: ['body'] },
  { key: 'eyes', name: '眼睛', parent: { newGroupKey: 'slime' }, elementIds: ['eye'] },
] });
expect(result).toMatchObject({ ok: true, count: 2 });
const after = await readScene();
expect(after.groups).toHaveLength(2);
fireEvent.click(undo(root));
expect(await readScene()).toEqual(before);
expect(undo(root)).toBeDisabled();
fireEvent.click(redo(root));
expect(await readScene()).toEqual(after);
```

- [ ] **运行红灯。** 执行 `node node_modules/vitest/vitest.mjs run tests/webmcpApp.test.tsx`，期望显示新工具缺失。
- [ ] **接入桥接。** WebMCP 解析 `groups` 及互斥的两种 parent 结构，完成严格校验后调用 `assertCanWrite()`，再同步调用 `bridge.createLayerGroups(inputs)`。App 用 `sceneRef.current` 调纯函数。手势进行中返回 `EDITOR_BUSY`，以便对稳定的画布提交事务。编辑中的对象、蒙版及变换沿用桥接可用性检查。若键盘微调待写历史，仅在成功提交前用 `finishNudge()` 收结该次键盘编辑。建组返回分组映射，不携带候选场景。

```ts
const current = sceneRef.current;
const outcome = planLayerGroupCreation(current.elements, current.groups ?? [], inputs,
  () => crypto.randomUUID());
if (!outcome.ok) return outcome;
finishNudge();
const { next, ...result } = outcome;
commitScene({ ...current, ...next });
return result;
```

- [ ] **运行绿灯并扩充验收。** 同一个前端命令应通过。拒绝项要断言场景、选区、撤销历史与重做分支均保持原值。成功时两层组出现在图层面板，保持元素与组选择，连续调用与 `get_scene` 可读到最新组。覆盖 schema 与执行解析一致、已取消调用、对象编辑和已锁定的蒙版／变换草稿、显式锁定策略以及独显解除后原成员状态恢复。将“返回内容可修改且不污染历史”的断言复用于返回的组 ID 映射。保留 F1–F3 的既有蒙版入口与变换测试作为回归门。

### 任务 3　验证持久化与绘制兼容

**文件**　扩充 [test_layer_fields.py](../../../backend/tests/test_layer_fields.py#L56)，复用 [绘制展平](../../../backend/app/smart_objects.py#L141) 与 [现有绘制回归](../../../backend/tests/test_smart_object_drawing.py)。

- [ ] **用同一等价场景验证两种结果。** 构造原场景和仅增加中性组的候选场景。样本含隐藏的原父组、0.5 透明原父组、背景层和普通层。验证 JSON 导出再导入后，组名、parentId、groupId、原场景 schemaVersion 正确。比较普通和背景优先两条展平路径的 ID 顺序、几何、有效透明度和可见元素集合。

```py
for backgrounds_first in (False, True):
    with self.subTest(backgrounds_first=backgrounds_first):
        self.assertEqual(
            flatten_drawing_scene(before, backgrounds_first=backgrounds_first).elements,
            flatten_drawing_scene(after, backgrounds_first=backgrounds_first).elements,
        )
```

- [ ] **检查 Lua 和两类 GIA 的既有契约。** 运行相关后端套件。Lua 绘制数据和 JSON 场景快照分别断言，快照应记录新分组。两类 GIA 继续检查背景优先与各自根资产类型，报告 `FENGARI_MODULE_PATH` 或 `UGC_GIA_CODEC` 缺失导致的实际跳过项。
- [ ] **运行后端回归。** 从后端目录执行 `.\.venv\Scripts\python.exe -m unittest discover -s tests -v`，检查退出码和跳过原因。

### 任务 4　说明与页面验收

**文件**　更新 [WebMCP 文档](../../webmcp.md#L36) 的工具数 25 → 26、工作流、调用示例和错误对照，在[使用指南](../../README.md)补充 AI 建组入口，在[维护说明](../../technical-design.md)记录组树事务和绘制约束。实施时保留这两处现有蒙版补充 [WebMCP 文档](../../webmcp.md#L111) 与 [工具描述](../../../frontend/src/webmcp.ts#L790)。

- [ ] **逐项核对源码、文档与测试。** `get_scene` 的完整响应包含 groups，摘要包含 groupCount。文档示例的眼睛、角和身体各自连续，父组涵盖连续的全部部件。名称显示和引用使用的是不同字段。
- [ ] **运行前端全量、生产构建与差异检查。** 从前端目录运行下面的命令，分别检查退出码。在仓库根目录运行 `git diff --check`。

```powershell
$testFiles = @(Get-ChildItem tests -Filter *.test.mjs | ForEach-Object { $_.FullName })
node --test @testFiles
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
```

- [ ] **在浏览器验收。** 用已有编辑器地址和隔离测试页面。注册工具后添加一个重叠着色的火史莱姆样本，记录建组前后画布截图及组树。检查图层面板嵌套、一步撤销和重做、JSON 重新导入。加一个交错样本验证组树与画布保持原样且错误包含阻挡 ID。覆盖 F1 的编辑和预览入口、F2 的蒙版参数与导出边界、F3 的组内普通变换。带活动蒙版的样本直接看浏览器画布。若使用现有浏览器存储，完整保留并核对 `/^miliastra[-:]/` 应用数据。
- [ ] **验收结果按 R12 记录。** 写明自动回归结果、浏览器观察结果，以及所执行的游戏编辑器／真机检查。F2 现有 Lua 样例的真机证据仍以[蒙版验收说明](../../../workspace/mask-runtime-test/README.md)为准。代码通过后更新功能卡片。提交与推送遵守仓库授权规则。
