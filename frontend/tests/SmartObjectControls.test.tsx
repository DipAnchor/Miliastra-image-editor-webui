import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nProvider, useI18n } from "../src/i18n";
import { SmartObjectInspector, ObjectEditorBar } from "../src/SmartObjectControls";
import type { SmartObject } from "../src/smartObjectModel";
import type { SceneLeaf } from "../src/App";
import { LayerContextMenu } from "../src/LayerContextMenu";
import { GroupContextMenu } from "../src/GroupContextMenu";

const object: SmartObject = {
  id: "object-1", type: "smart-object", name: "组合", layerName: "我的对象",
  x: 120, y: 80, rotation: 30, zIndex: 3, scale: 1.5, opacity: 0.75, visible: true,
  content: { frame: { width: 100, height: 60 }, elements: [
    { id: "child-a" } as SceneLeaf, { id: "child-b" } as SceneLeaf
  ], groups: [] }
};
const inspectorProps = () => ({ object, onChange: vi.fn(), onEdit: vi.fn(), onRelease: vi.fn() });
const editorProps = () => ({ name: "我的对象", dirty: true, onSave: vi.fn(), onFinish: vi.fn(), onDiscard: vi.fn(), onClose: vi.fn() });
const layerProps = () => ({ x: 10, y: 10, title: "图层", soloActive: false, options: [],
  onCreateGroup: vi.fn(), onMove: vi.fn(), onToggleVisible: vi.fn(), onSolo: vi.fn(),
  onToggleLock: vi.fn(), onLockOthers: vi.fn(), onRestore: vi.fn(), onExport: vi.fn(), onClose: vi.fn() });
const groupProps = () => ({ ...layerProps(), visible: true, opacity: 1, onOpacity: vi.fn(), onUngroup: vi.fn(), onDelete: vi.fn() });
const wrap = (ui: ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);
function LanguageSwitch() {
  const { setLang } = useI18n();
  return <button onClick={() => setLang("en")}>English</button>;
}

describe("SmartObjectInspector", () => {
  it("shows the name, child count and read-only frame and derived dimensions", () => {
    wrap(<SmartObjectInspector {...inspectorProps()} />);
    expect(screen.getByRole("textbox", { name: "对象名称" })).toHaveValue("我的对象");
    expect(screen.getByText("2 个子图层")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "画框宽度" })).toHaveValue(100);
    expect(screen.getByRole("spinbutton", { name: "画框高度" })).toHaveValue(60);
    expect(screen.getByRole("spinbutton", { name: "显示宽度" })).toHaveValue(150);
    expect(screen.getByRole("spinbutton", { name: "显示高度" })).toHaveValue(90);
    expect(screen.getByText("内容画框（只读）")).toBeInTheDocument();
    expect(screen.getByText("有改动时保存会适配全部图层（含隐藏／锁定），编辑中不实时调整；空内容保留原画框，不裁剪溢出内容。")).toBeInTheDocument();
    expect(screen.getByText("显示尺寸由当前画框 × 缩放比例计算；保存适配可改变中心和外框，但保持内容的视觉位置、对象旋转和缩放。")).toBeInTheDocument();
    for (const name of ["画框宽度", "画框高度", "显示宽度", "显示高度"]) {
      expect(screen.getByRole("spinbutton", { name })).toHaveAttribute("readonly");
    }
  });

  it("emits only shell patches and converts percentage controls", () => {
    const p = inspectorProps();
    wrap(<SmartObjectInspector {...p} />);
    fireEvent.change(screen.getByRole("textbox", { name: "对象名称" }), { target: { value: "新名称" } });
    expect(p.onChange).toHaveBeenLastCalledWith({ layerName: "新名称" });
    for (const [name, value, patch] of [
      ["X", "-12.5", { x: -12.5 }], ["Y", "42", { y: 42 }],
      ["旋转角度 Z", "-45", { rotation: -45 }],
      ["等比缩放 (%)", "125", { scale: 1.25 }], ["不透明度 (%)", "60", { opacity: 0.6 }]
    ] as const) {
      fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });
      expect(p.onChange).toHaveBeenLastCalledWith(patch);
    }
    expect(object.content.frame).toEqual({ width: 100, height: 60 });
  });

  it("rejects empty, non-finite and non-positive scale and clamps opacity", () => {
    const p = inspectorProps();
    wrap(<SmartObjectInspector {...p} />);
    const scale = screen.getByRole("spinbutton", { name: "等比缩放 (%)" });
    for (const value of ["", "0", "-5", "Infinity"]) fireEvent.change(scale, { target: { value } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "X" }), { target: { value: "" } });
    expect(p.onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "不透明度 (%)" }), { target: { value: "101" } });
    expect(p.onChange).toHaveBeenLastCalledWith({ opacity: 1 });
    fireEvent.change(screen.getByRole("spinbutton", { name: "不透明度 (%)" }), { target: { value: "-1" } });
    expect(p.onChange).toHaveBeenLastCalledWith({ opacity: 0 });
  });

  it("refreshes read-only sizes from the current object and runs edit/release callbacks", () => {
    const p = inspectorProps();
    const view = wrap(<SmartObjectInspector {...p} />);
    view.rerender(<I18nProvider><SmartObjectInspector {...p} object={{ ...object, scale: 2 }} /></I18nProvider>);
    expect(screen.getByRole("spinbutton", { name: "显示宽度" })).toHaveValue(200);
    expect(screen.getByRole("spinbutton", { name: "显示高度" })).toHaveValue(120);
    fireEvent.click(screen.getByRole("button", { name: "编辑对象内容" }));
    fireEvent.click(screen.getByRole("button", { name: "解除为普通组" }));
    expect(p.onEdit).toHaveBeenCalledOnce();
    expect(p.onRelease).toHaveBeenCalledOnce();
    expect(p.onChange).not.toHaveBeenCalled();
  });
});

describe("ObjectEditorBar", () => {
  it("exposes four distinct actions and dirty/saved state", () => {
    const p = editorProps();
    const view = wrap(<ObjectEditorBar {...p} />);
    expect(screen.getByText("我的对象")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("有未保存的修改");
    for (const [label, callback] of [["保存并继续编辑", p.onSave], ["完成编辑", p.onFinish],
      ["放弃本次修改", p.onDiscard], ["返回主画布", p.onClose]] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(callback).toHaveBeenCalledOnce();
    }
    view.rerender(<I18nProvider><ObjectEditorBar {...p} dirty={false} /></I18nProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("已保存");
  });
});

describe("optional object context menu actions", () => {
  it("hides missing layer actions and preserves create-group", () => {
    const p = layerProps();
    wrap(<LayerContextMenu {...p} />);
    for (const name of ["转换为智能对象", "编辑对象内容", "解除为普通组"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "编组" }));
    expect(p.onCreateGroup).toHaveBeenCalledOnce();
    expect(p.onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ["onConvertToObject", "转换为智能对象"], ["onEditObject", "编辑对象内容"],
    ["onReleaseObject", "解除为普通组"]
  ] as const)("runs layer %s and closes", (key, name) => {
    const p = layerProps(), action = vi.fn();
    wrap(<LayerContextMenu {...p} {...{ [key]: action }} />);
    fireEvent.click(screen.getByRole("button", { name }));
    expect(action).toHaveBeenCalledOnce();
    expect(p.onClose).toHaveBeenCalledOnce();
    expect(action.mock.invocationCallOrder[0]).toBeLessThan(p.onClose.mock.invocationCallOrder[0]);
  });

  it("hides a missing group action and runs it only when supplied", () => {
    const p = groupProps(), action = vi.fn();
    const view = wrap(<GroupContextMenu {...p} />);
    expect(screen.queryByRole("button", { name: "转换为智能对象" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "解组" })).toBeInTheDocument();
    view.rerender(<I18nProvider><GroupContextMenu {...p} onConvertToObject={action} /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "转换为智能对象" }));
    expect(action).toHaveBeenCalledOnce();
    expect(p.onClose).toHaveBeenCalledOnce();
  });
});

it("localizes controls, status and object menu actions in English", () => {
  wrap(<><LanguageSwitch /><SmartObjectInspector {...inspectorProps()} /><ObjectEditorBar {...editorProps()} />
    <LayerContextMenu {...layerProps()} onConvertToObject={vi.fn()} /></>);
  fireEvent.click(screen.getByRole("button", { name: "English" }));
  expect(screen.getByRole("textbox", { name: "Object name" })).toBeInTheDocument();
  expect(screen.getByText("2 child layers")).toBeInTheDocument();
  expect(screen.getByText("Content frame (read-only)")).toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: "Frame width" })).toHaveValue(100);
  expect(screen.getByRole("spinbutton", { name: "Frame height" })).toHaveValue(60);
  expect(screen.getByText("Saving changed contents fits all layers, including hidden and locked ones, not live while editing. Empty contents keep the previous frame; overflow is not clipped.")).toBeInTheDocument();
  expect(screen.getByText("Display size is the current frame × scale. Fitting on save may change the center and bounds, but preserves content placement, object rotation and scale.")).toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: "Uniform scale (%)" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save and keep editing" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  expect(screen.getByRole("button", { name: "Convert to Smart Object" })).toBeInTheDocument();
});
