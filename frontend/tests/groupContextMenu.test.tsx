import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nProvider } from "../src/i18n";
import { GroupContextMenu } from "../src/GroupContextMenu";
import type { LayerMenuOption } from "../src/LayerContextMenu";

const options: LayerMenuOption[] = [{ key: "json", label: "JSON" }, { key: "lua", label: "Lua" }];
const makeProps = (over: Partial<Parameters<typeof GroupContextMenu>[0]> = {}) => ({
  x: 10, y: 10, title: "组一", visible: true, options,
  onMove: vi.fn(), onToggleVisible: vi.fn(), onUngroup: vi.fn(), onDelete: vi.fn(), onExport: vi.fn(), onClose: vi.fn(),
  ...over
});
const wrap = (ui: ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe("GroupContextMenu", () => {
  it("renders level, group actions and export options", () => {
    wrap(<GroupContextMenu {...(makeProps() as any)} />);
    expect(screen.getByText("置顶")).toBeInTheDocument();
    expect(screen.getByText("解组")).toBeInTheDocument();
    expect(screen.getByText("删除分组")).toBeInTheDocument();
    expect(screen.getByText("JSON")).toBeInTheDocument();
  });
  it("level chip calls onMove top", () => {
    const p = makeProps();
    wrap(<GroupContextMenu {...(p as any)} />);
    fireEvent.click(screen.getByText("置顶"));
    expect(p.onMove).toHaveBeenCalledWith("top");
  });
  it("ungroup chip calls onUngroup then closes", () => {
    const p = makeProps();
    wrap(<GroupContextMenu {...(p as any)} />);
    fireEvent.click(screen.getByText("解组"));
    expect(p.onUngroup).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
  });
  it("overlay click closes", () => {
    const p = makeProps();
    wrap(<GroupContextMenu {...(p as any)} />);
    fireEvent.click(screen.getByTestId("group-menu-overlay"));
    expect(p.onClose).toHaveBeenCalled();
  });
});
