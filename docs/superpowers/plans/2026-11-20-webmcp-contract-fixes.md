# WebMCP 接口修复实施计划

> **执行状态：** 第1–3项已实施并完成验证；第4项已复现，接口语义待确认。本计划不包含提交或推送授权。

**目标：** 防止迟到的 WebMCP 写入跨越编辑会话，兑现新增图层的锁定参数，为智能对象提供可预测的更新契约，并验证组层序风险。基线：develop / 852674a。

**边界：** 无后端协议、新工具、批量选择 API 或 UI 布局改动。保留 WebMCP 可更新/删除锁定图层、单选 set_selection 和 set_elements 保留组的现有契约。不自动整理既有场景，不改无关素材和导出链路。

## 文件职责

| 文件 | 改动职责 |
| --- | --- |
| [webmcp.ts](../../../frontend/src/webmcp.ts) | 调用级写入检查、异步处理器接线；更新 schema、正数校验和工具说明 |
| [App.tsx](../../../frontend/src/App.tsx) | 编辑会话代次、导入提交前检查；创建时保留 locked；目标类型校验及批量提交 |
| [webmcpApp.test.tsx](../../../frontend/tests/webmcpApp.test.tsx) | 新增 App 集成测试：捕获实际注册定义，使用真实桥接和可控 fetch |
| [prefabTools.test.mjs](../../../frontend/tests/prefabTools.test.mjs) | 复用现有轻量注册桩，覆盖异步素材准备路径与工具 schema |
| [WebMCP 文档](../../webmcp.md) | 同步拒绝条件、锁定与智能对象字段契约 |

## 1. P1：拦住跨编辑会话的异步写入

- [x] 在新集成测试中复用 [智能对象测试](../../../frontend/tests/smartObjectApp.test.tsx) 与 [变换测试](../../../frontend/tests/transformModeApp.test.tsx) 的挂载方式。用可手动 resolve 的 fetch 响应复现：发起 import_source → 确认请求已挂起 → 进入智能对象编辑或开始变换预览 → 放行响应。断言返回失败，主场景、草稿/预览、选区、状态提示和历史不因导入改变。对象编辑中用退出后重新读取场景来判断主场景，不能把入口拒绝误当成数据未变。
- [x] 增加一项先进入再退出会话后才放行响应的用例，及一项未切换会话的正常导入对照。正常导入能提交且恰好一步撤销。
- [x] 在 App 维护 WebMCP 编辑会话代次：成功打开对象会话时递增；变换预览首次从 null 变为非 null 时递增，不在每次预览变化时递增。保留现有入口拒绝规则；每次工具调用捕获代次，并传递一个同步提交检查回调。检查代次仍相等、当前无会话、注册未被取消；失败返回明确可重试的错误，如 “Editor changed while the operation was pending; retry the tool”。代次变化后即使已回到主编辑器，旧请求也不自动重放。
- [x] 在 add_element、add_elements、set_elements、update_element、update_elements 的素材准备完成后、调用同步桥接前检查；在 importSource 内部读取响应并准备场景后、调用 commitScene 或更新选区/状态/安排 fit 定时器前检查。将检查传到真正提交的函数，不能仅在 await importSource 返回后检查；不修改通用 commitScene 对内部编辑的规则。不借机对普通同步修改加全局锁，也不改变只读工具的现有入口行为。
- [x] 以可控异步素材准备覆盖至少一个新增/替换和一个更新路径，确认跨会话失败不改变任何目标且不新增历史；检查其余异步写入口都在提交前接线。若注册明确已卸载，旧调用也不能提交。测试不使用任意延时。

## 2. P2：新增图层保留 locked

- [x] 先用 add_element、add_elements 和 set_elements 验证：传 locked:true 时，返回图元（批量开启 returnElements）和后续场景都保留 true；覆盖显式 false 与省略，二者不改变原有默认解锁语义。错误批次依旧不落盘。
- [x] 在三个工具共用的 [WebMCP 新增入口](../../../frontend/src/App.tsx) 复制显式 locked 布尔值，省略时不强制写默认字段。复用 createShape，并保留其手工创建行为：带锁普通图元收藏插入的副本仍可直接操作。独立复核发现共享创建函数曾导致该行为回归，已补失败回归后修正；AI 更新/删除仍绕过手工锁定。

## 3. P2：智能对象 scale 和类型相关错误

- [x] 先覆盖真实注册的 update_element、update_elements：智能对象 scale 从 1 改到 2 时只改外壳，内容和 frame 不变；再次写 2 返回成功且 count:0。0、负数、非有限值以及普通图元上的 scale 要失败；普通图元的 width 和智能对象的 rotation 仍正常。混合批次中任一目标不支持请求字段时，不修改其它目标、不增加历史。
- [x] 将 scale 加到**仅更新**的 schema，描述为智能对象外壳正向等比倍率。仅在 parseUpdate 中解析，要求 number、有限且大于 0；不要让共享新增 schema 宣称支持 scale，也不要把 width/height 自动换算成 scale。复用现有 validateSmartObject 验证最终对象。
- [x] 在 WebMCP 桥接的全批校验阶段，根据目标类型校验 patch，再交给现有 applyElementUpdates；智能对象复用当前外壳可编辑字段集合，明确拒绝不支持的字段（如 width、height、color、groupId），不要返回虚假成功。将现有白名单提为共享常量或同一校验路径，避免工具校验与应用路径漂移；手工编辑行为不变。未知参数策略不做全局调整。groupId 的智能对象移动能力作为单独设计，不在本轮顺手开放。
- [x] 在注册描述与 WebMCP 文档注明：普通图元用 width/height，智能对象用 scale；合法同值请求才是正常的 count:0，不支持的目标/字段组合返回失败。

## 4. 层序风险：复现后再决定是否修复

- [x] 用独立夹具建立连续组 g（底到顶 a、b）与组外 c。分别通过 update_element 修改 a 的 zIndex 使其越过 c，以及对普通图元更新 groupId；对比 get_scene 的绘制顺序、图层顺序与 [打包连续性校验](../../../frontend/src/smartObjects.ts#L74)。另测不存在的 groupId 是否会形成悬空引用。报告实际结果，不把推测当成复现。
- [ ] 若证实有问题，单独确认接口语义后再改：推荐保留现有合法重排，拒绝因本次操作新增的非连续组或悬空归属，并在提交前基于整批最终状态检查；不静默重排外部图层，也不因不相关的旧坏数据拒绝颜色/透明度修改。若需要让组随成员整体移动，另定兼容规则和回归范围，不与前三项绑在一起上线。

本次复现结果：五项真实 App 注册工具集成检查通过。g(a,b)+c 中把 a 的 zIndex 改到 3，会得到 b,c,a 的绘制顺序，树仍把 a/b 放在同组，打包报 `group members must be contiguous`；给非相邻的组外图元设置 groupId 也能破坏连续性。`groupId:"missing"` 会保留悬空引用并在树中作为根显示。组内换序、跨整个组移动及相邻成员入组可保持合法；旧坏场景的不相关透明度修改仍成功。本轮仅确认问题，接口拒绝语义待用户决定。

## 5. 验收和交付

- [x] 每项先在旧实现观察对应失败，再在修复后运行定向测试。在 frontend 运行 `npx vitest run tests/webmcpApp.test.tsx tests/smartObjectApp.test.tsx tests/transformModeApp.test.tsx tests/layerTreeApp.test.tsx tests/multiSelectionApp.test.tsx`，及 `node --test tests/prefabTools.test.mjs`。
- [x] 运行 `npm run test:all`、`npm run build`；在仓库根运行 `git diff --check`。只修改前端时不把后端测试写成已执行。
- [x] 用支持 WebMCP 的现有浏览器页面分短调用验收：受控迟到导入在两种会话中均失败且不写入；正常导入、锁定新增、scale 与正常旋转成功；错误批次原子失败；JSON 导出和撤销重做仍正常。无需重跑全部 24 工具，但浏览器未覆盖的路径要明示。
- [x] 在修改前备份编辑器实际读写的 localStorage 原值，含素材缓存；先离开编辑器再逐键恢复并核对，最后结束测试空间。交付分别列明各项通过结果、层序结论与待办；仅在用户明确授权后提交或推送。

## 执行结果

- 三项确定修复均已实现。定向回归通过；最终完整前端脚本通过 293 项 Node 测试、182 项 UI 测试，类型检查和 Vite 构建通过，差异检查通过。运行环境的 npm/npx 包装入口未执行预期参数，验收使用本机已安装的 npm CLI 与 Vitest JS 入口执行相同脚本，未修改环境配置。
- 原生浏览器通过三个新增工具的锁定保真、智能对象 scale/同值 no-op、错误批次原子拒绝；通过对象编辑/退出和变换预览/退出四种迟到导入拒绝，画布、选区、提示与历史不变；正常导入、旋转、JSON 导出、撤销重做通过。
- 异步素材元数据、取消、注销与卸载由注册层 Node 和 App 集成回归覆盖；本轮未在原生浏览器逐一重测全部 24 工具，也未运行后端测试。
- 已离开编辑器后恢复全部 15 个实际归属的 localStorage 原始键值，核对其它键不变；测试空间已关闭，临时目录已清理。未提交或推送。
- 第4节的层序语义仍待单独确认，未包含在这三项修复中。
