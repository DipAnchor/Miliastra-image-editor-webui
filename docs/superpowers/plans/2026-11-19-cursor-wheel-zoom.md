# Cursor-centered Wheel Zoom Implementation Plan

> **For agentic workers:** Execute the checked tasks in this session. No commit or push is authorized.

**Goal:** 普通滚轮在画布区域以鼠标光标为中心缩放，向上放大、向下缩小；不改作品或撤销记录。

**Architecture:** 沿用现有 DOM scale 与 stage 原生 scroll。新增纯函数规范化 WheelEvent 的 pixel/line/page 单位，指数缩放限定 25%–400%。仅 stage 使用 passive:false 原生监听；同步刷新缩放后，按缩放前后的 canvas DOM rect 补偿 stage scroll。滚轮跳过自动居中，工具栏／快捷键／适配保留原行为。sizer 在每侧增加一个视口的滚动余量，保证画布小于视口时仍可保持光标锚点；不裁剪对象溢出。内部编辑器复用相同逻辑，父场景 inert 时拒绝。

**Tech Stack:** TypeScript, React, Node test runner, Vitest, ego-browser.

---

### Task 1: Tests before implementation

- [x] 新增 `frontend/tests/canvasZoom.test.mjs`：方向、25%/400%、deltaMode、异常输入、比例连续与锚点坐标。
- [x] 新增 `frontend/tests/canvasZoomApp.test.tsx`：真实 App stage 监听、滚轮默认行为阻止、图层／属性／工具栏不缩放、输入／模态／拖拽隔离、快速连续滚轮、内部编辑器隔离、缩放不入撤销。
- [x] 运行定向测试建立失败基线。

### Task 2: Minimal integration

- [x] 新增 `frontend/src/canvasZoom.ts`：滚轮倍率与锚点 scroll 几何。
- [x] 修改 `frontend/src/App.tsx`：非 passive stage listener、同步 zoomRef、滚轮补偿与自动居中取消、sizer 滚动余量。不改变导出／场景协议或保存行为。
- [x] 同步 `docs/README.md` 与快捷键双语说明，明确普通滚轮与 Space/中键平移。

### Task 3: Verify and finish

- [x] 定向／前端全量回归与 TypeScript/Vite build、git diff --check。前端 208 项 Node 与 57 项 UI 回归通过，类型检查和生产构建通过。
- [x] 真实页面原生滚轮：300×240 小画布、1920×1080 大画布、已平移、连续反向、25%/400% 限值、内部编辑器、旁栏隔离。核算锚点误差小于 1.1 CSS px；内部 100%→127%，外部倍率、内部内容与保存状态不变。
- [x] 已恢复应用 localStorage（15 项应用 key，其他 key 不变），关闭专用测试页并清理探针；交接已更新。无后端变化，不重复后端全量，不自动提交。
