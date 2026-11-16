import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nProvider } from "../src/i18n";
import { LayerContextMenu, type LayerMenuOption } from "../src/LayerContextMenu";

const options: LayerMenuOption[] = [{ key: "json", label: "JSON" }, { key: "lua", label: "Lua" }];
const makeProps = (over: Partial<Parameters<typeof LayerContextMenu>[0]> = {}) => ({
  x: 10, y: 10, title: "图层A", soloActive: false, options,
  onMove: vi.fn(), onToggleVisible: vi.fn(), onSolo: vi.fn(), onExport: vi.fn(), onClose: vi.fn(),
  ...over
});
const wrap = (ui: ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe("LayerContextMenu", () => {
  it("renders level, visibility and export chips", () => {
    const p = makeProps();
    wrap(<LayerContextMenu {...(p as any)} />);
    expect(screen.getByText("置顶")).toBeInTheDocument();
    expect(screen.getByText("上移一层")).toBeInTheDocument();
    expect(screen.getByText("只显示自己")).toBeInTheDocument();
    expect(screen.getByText("JSON")).toBeInTheDocument();
  });
  it("level chip calls onMove then closes", () => {
    const p = makeProps();
    wrap(<LayerContextMenu {...(p as any)} />);
    fireEvent.click(screen.getByText("置顶"));
    expect(p.onMove).toHaveBeenCalledWith("top");
    expect(p.onClose).toHaveBeenCalled();
  });
  it("export chip calls onExport with its key then closes", () => {
    const p = makeProps();
    wrap(<LayerContextMenu {...(p as any)} />);
    fireEvent.click(screen.getByText("Lua"));
    expect(p.onExport).toHaveBeenCalledWith("lua");
  });
  it("clicking the overlay closes the menu", () => {
    const p = makeProps();
    wrap(<LayerContextMenu {...(p as any)} />);
    fireEvent.click(screen.getByTestId("layer-menu-overlay"));
    expect(p.onClose).toHaveBeenCalled();
  });
});
