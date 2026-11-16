import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nProvider } from "../src/i18n";
import { RenameDialog } from "../src/RenameDialog";

const wrap = (ui: ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe("RenameDialog", () => {
  it("prefills current layer name and passes typed value to onConfirm", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    wrap(<RenameDialog initial="旧名字" onCancel={onCancel} onConfirm={onConfirm} />);
    const input = screen.getByLabelText("图层名") as HTMLInputElement;
    expect(input.value).toBe("旧名字");
    fireEvent.change(input, { target: { value: "新名字" } });
    fireEvent.click(screen.getByText("确定"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("新名字");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancel button invokes onCancel and not onConfirm", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    wrap(<RenameDialog initial="x" onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("关闭"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
