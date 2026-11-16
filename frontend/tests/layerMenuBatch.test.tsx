import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nProvider } from "../src/i18n";
import { LayerContextMenu } from "../src/LayerContextMenu";

const options = [{ key: "json", label: "JSON" }];
const base = (over: Record<string, unknown> = {}) => ({
  x: 10, y: 10, title: "图层A", soloActive: false, options,
  onMove: vi.fn(), onToggleVisible: vi.fn(), onSolo: vi.fn(), onRename: vi.fn(), onExport: vi.fn(), onClose: vi.fn(),
  ...over
});
const wrap = (ui: ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe("LayerContextMenu batch", () => {
  it("shows create-group chip and calls onCreateGroup", () => {
    const onCreateGroup = vi.fn();
    const p = base({ onCreateGroup });
    wrap(<LayerContextMenu {...(p as any)} />);
    fireEvent.click(screen.getByText("编组"));
    expect(onCreateGroup).toHaveBeenCalled();
  });
  it("hides solo and rename when multiple selected", () => {
    const p = base({ onCreateGroup: vi.fn(), selectionCount: 3 });
    wrap(<LayerContextMenu {...(p as any)} />);
    expect(screen.queryByText("只显示自己")).toBeNull();
    expect(screen.queryByText("改名")).toBeNull();
  });
});
