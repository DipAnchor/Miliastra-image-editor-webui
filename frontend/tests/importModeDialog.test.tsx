import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nProvider } from "../src/i18n";
import { ImportModeDialog } from "../src/ImportModeDialog";

const wrap = (ui: ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe("ImportModeDialog", () => {
  it("chooses replace or append and can cancel", () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    wrap(<ImportModeDialog onChoose={onChoose} onCancel={onCancel} />);
    expect(screen.getByText("导入方式")).toBeInTheDocument();
    fireEvent.click(screen.getByText("追加到当前画布"));
    expect(onChoose).toHaveBeenCalledWith("append");
    fireEvent.click(screen.getByText("覆盖当前画布"));
    expect(onChoose).toHaveBeenCalledWith("replace");
    fireEvent.click(screen.getByText("取消"));
    expect(onCancel).toHaveBeenCalled();
  });
});
