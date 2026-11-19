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
  it("keeps a tall export menu inside the viewport", () => {
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 320, height: 480 } as DOMRect);
    try {
      const { container } = wrap(<LayerContextMenu {...(makeProps({ x: window.innerWidth - 5, y: window.innerHeight - 5 }) as any)} />);
      const menu = container.querySelector<HTMLElement>(".layer-context-menu")!;
      expect(menu.style.left).toBe(Math.max(12, window.innerWidth - 332) + "px");
      expect(menu.style.top).toBe(Math.max(12, window.innerHeight - 492) + "px");
      expect(menu.querySelector(".layer-menu-export")).not.toBeNull();
    } finally { bounds.mockRestore(); }
  });
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
