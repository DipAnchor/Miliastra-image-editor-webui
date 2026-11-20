import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("../src/svgExportWarnings.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { extractSvgExportWarnings } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
test("no protocol warnings means no messages", () => {
  assert.deepEqual(extractSvgExportWarnings('<svg><!-- another comment --></svg>'), []);
});
test("extracts all warnings, trims whitespace, deduplicates and retains order", () => {
  const text = '<svg><!-- Miliastra-Warning: Ring omitted -->' +
    '<!-- Miliastra-Warning:  Tint differs\nfrom source  -->' +
    '<!-- Miliastra-Warning: Ring omitted --><!-- Miliastra-Warning: \n --></svg>';
  assert.deepEqual(extractSvgExportWarnings(text), ['Ring omitted', 'Tint differs\nfrom source']);
});
test("does not mistake ordinary SVG text or comments for protocol warnings", () => {
  assert.deepEqual(extractSvgExportWarnings('<svg><text>Miliastra-Warning: not a comment</text><!-- Warning: other --></svg>'), []);
});
