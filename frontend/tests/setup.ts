import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// 固定测试语言，避免依赖运行环境的 navigator.language
try {
  localStorage.setItem("miliastra-editor-lang", "zh");
} catch {
  // ignore
}

// 每个用例后卸载组件，避免 DOM 累积导致查询到多个元素
afterEach(() => cleanup());

// jsdom 未实现 <dialog> 的模态方法，提供最小 polyfill
if (typeof HTMLDialogElement !== "undefined") {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  if (!proto.showModal) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (!proto.close) {
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
}
