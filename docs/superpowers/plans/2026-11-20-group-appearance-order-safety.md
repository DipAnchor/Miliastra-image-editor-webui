# 第二批：解组外观与组层序安全修复

> 执行方式：本会话直接实施；先失败回归，再局部修复、全量和真实浏览器验收。不自动提交或推送。

## 目标与边界

解组后保持当前可见外观；手工调序在同父级按完整节点移动，保持组块和归属。全局数字层级编号保持现有含义，但只能落在当前父级的合法兄弟节点边界。保留此前存档、选区、锁定和 WebMCP 安全修复。

本批不重设计界面，不改变 WebMCP 显式字段协议，不自动整理旧场景，也不把预览验证作为千星真机验证。上手导入、跨作品收藏、独显撤销和导出提示另批处理。

## Task 1：建立失败回归

- [x] `frontend/tests/ungroupAppearance.test.mjs`：直接成员与嵌套子组承接被移除组的隐藏和透明度；保留外祖先作用；覆盖文本、智能对象壳、空组和默认值。
- [x] `frontend/tests/ungroupAppearanceApp.test.tsx`：解组入口、批量解组、一步 Undo/Redo 和自身／祖先／成员锁。
- [x] `frontend/tests/groupOrderSafety.test.mjs`：嵌套组同级排序、完整节点内部次序、父级不变、边界无效时 no-op。
- [x] `frontend/tests/layerOrderNodes.test.mjs`：混选完整节点、祖先覆盖、锁定、空组和数字合法边界的 12 项纯逻辑回归。
- [x] `frontend/tests/groupOrderSafetyApp.test.tsx`：叶、组和混选调序、全局数字层级合法边界、空组、锁定与一步 Undo/Redo。
- [x] 纯逻辑用例确认真实红基线；页面测试最初受启动权限阻塞，恢复后排除夹具断言错误并确认绿基线。

## Task 2：局部实现

- [x] `frontend/src/layerTree.ts` 的 `ungroupElements` 只对直属叶与直属子组承接 target.opacity／visible；文本分别承接 text／bg／outlineOpacity 并同步别名 opacity，智能对象只改壳，不改内部内容。
- [x] `frontend/src/App.tsx` 的 `LayerVisual` 向下传递祖先透明度因子；文本外层不重复乘文字透明度，使文本、背景、描边与后端既有导出语义一致，并覆盖文字透明度为零而背景非零的情况。
- [x] `frontend/src/App.tsx` 的单组、选中成员与多组解组入口使用当前场景检查整组锁定，拒绝受保护的结构更改；有效批次只占一步历史。
- [x] `frontend/src/layerTree.ts` 新增返回完整 GroupMutation 的同级节点重排逻辑，复用现有树与空组 order 编码；覆盖祖先已选中的后代，稳定移动多选，保留节点内部次序。
- [x] 保留 `reorderGroups` 现有返回类型的兼容入口；页面层级入口统一使用完整 mutation 保存空组次序，并同时处理选中组和散层。
- [x] 数字层级仍按全局编号输入，按移动方向落在同父级合法边界，不拆开其他组、不改变 groupId／parentId。
- [x] 已在边界、无有效目标及无变化时保持 no-op，不增加撤销记录。

## Task 3：复核与自动验证

验证完成：解组纯逻辑红基线 8 失败／1 通过，旧组排序红基线 4 失败／2 通过；实现后全部 325 项 Node 与 248 项 UI 测试通过，类型检查、生产构建和差异格式检查通过。只读评审已完成。真实页面已通过解组外观、隐藏、祖先透明度、子组／混选／空组调序、数字合法边界、锁定保护和一步 Undo/Redo 验证。全部 15 个 owned 原始存储值在结束前恢复，非 owned 值也逐值一致。Windows 启动权限阻塞经限定仓库范围的一次授权诊断修复后解除，权限备份和恢复说明保留在仓库外；全量使用系统 npm.cmd 执行原项目脚本，未修改 Harness 的 npm 包装入口。

- [x] 运行新增回归及 layerTree、selectionSafety、lockSafety、multiSelection、smartObject 等相邻测试。
- [x] 审阅生产与测试差异，确认外祖先不重复烘焙、锁定不绕过、混选不漏项、未涉及内容不变。
- [x] 在 frontend 运行 `npm run test:all` 与 `npm run build`，并执行 `git diff --check`。

## Task 4：真实页面验收与清理

- [x] 复用当前开发页面；先备份该 origin 全部 localStorage 原值（含 /^miliastra[-:]/ 素材缓存）。
- [x] 原生操作验证隐藏组／半透明嵌套组解组后的外观、组／叶／混选调序、子组同级范围、数字层级、锁定与 Undo/Redo。
- [x] 先离开应用停止自动保存，再恢复全部 owned 原值并删除新增 owned 键；逐值核对，确认非 owned 数据不变。
- [x] 独立结束浏览器 task space，核实临时目录绝对路径且非 reparse 后清理；汇报实际结果和剩余限制。
