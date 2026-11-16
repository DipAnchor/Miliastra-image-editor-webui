import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = name => {
  let source = ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
  }).outputText;
  source = source.replace(/from "\.\/(\w+)"/g, (_, dependency) => `from ${JSON.stringify(moduleUrl(dependency))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
};
const { createMaskPreview } = await import(moduleUrl('maskPreview'));
const { luaMaskOf } = await import(moduleUrl('luaMask'));

// Deliberately not a Canvas rasterizer: inject sampled contour alpha to test the
// production final composition loop. Real contour drawing is checked in browser.
function render(value, angle, contourAlpha = 0, guides = false) {
  const saved = new Map();
  const previous = globalThis.document;
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0 };
    let pixels;
    const allocate = () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4) });
    const context = {
      save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, drawImage() {},
      beginPath() {}, ellipse() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, fillRect() {},
      createImageData: allocate,
      getImageData() {
        const result = allocate();
        for (let i = 3; i < result.data.length; i += 4) result.data[i] = contourAlpha;
        return result;
      },
      putImageData(value) { pixels = value.data.slice(); }
    };
    canvas.getContext = () => context;
    canvas.toDataURL = () => {
      const key = `sample-${saved.size}`;
      saved.set(`url("${key}")`, { data: pixels.slice(), width: canvas.width, height: canvas.height });
      return key;
    };
    return canvas;
  } };
  try {
    const result = createMaskPreview({ width: 24, height: 20, rotation: 0 }, value, undefined, guides, angle);
    return { result, visible: saved.get(result.image), hidden: saved.get(result.guides?.hiddenImage) };
  } finally { globalThis.document = previous; }
}

function inside(x, y, mask, angle) {
  const r = angle * Math.PI / 180, dx = x - mask.offsetX, dy = y - mask.offsetY;
  return Math.abs(Math.cos(r) * dx - Math.sin(r) * dy) < mask.width / 2 &&
    Math.abs(Math.sin(r) * dx + Math.cos(r) * dy) < mask.height / 2;
}

for (const angle of [0, 90, 180, -27]) {
  test(`reverse rectangle stays empty inside AND outside rotated bounds (${angle})`, () => {
    const mask = luaMaskOf({ enabled: true, reverseMaskArea: true, width: 12, height: 6, offsetX: 3, offsetY: -2 });
    const before = structuredClone(mask);
    const { visible } = render(mask, angle);
    assert.ok(visible.data.filter((_, i) => i % 4 === 3).every(a => a === 0));
    assert.deepEqual(mask, before);
  });
  for (const alpha of [0, 128, 255]) test(`contour sample ${alpha} reverses only within bounds (${angle})`, () => {
    const mask = luaMaskOf({ enabled: true, imageId: 100003, reverseMaskArea: true, width: 12, height: 6, offsetX: 3, offsetY: -2 });
    const { visible, hidden, result } = render(mask, angle, alpha, true);
    for (let py = 0; py < visible.height; py++) for (let px = 0; px < visible.width; px++) {
      const x = (px + .5) * result.width / visible.width - result.width / 2;
      const y = (py + .5) * result.height / visible.height - result.height / 2;
      const i = (py * visible.width + px) * 4 + 3;
      assert.equal(visible.data[i], inside(x, y, mask, angle) ? 255 - alpha : 0, `${x},${y}`);
      assert.equal(visible.data[i] + hidden.data[i], 255, 'guide is full final complement');
    }
  });
}
test('disjoint, covering and zero-size reverse rectangles remain empty', () => {
  for (const patch of [{ offsetX: 110 }, { width: 140, height: 140 }, { width: 0 }, { height: 0 }]) {
    const { visible } = render(luaMaskOf({ enabled: true, reverseMaskArea: true, width: 12, height: 6, ...patch }), -27);
    assert.ok(visible.data.filter((_, i) => i % 4 === 3).every(a => a === 0));
  }
});
test('forward contour samples are not inverted', () => {
  const { visible } = render(luaMaskOf({ enabled: true, imageId: 100003, width: 12, height: 6 }), 90, 128);
  assert.ok(visible.data.filter((_, i) => i % 4 === 3).every(a => a === 128));
});
test('soft reverse rectangle keeps inward approximation only inside hard bounds', () => {
  const mask = luaMaskOf({ enabled: true, reverseMaskArea: true, enableSoftEdge: true, softEdgeWidthX: 2, softEdgeWidthY: 2, width: 12, height: 6 });
  const { visible, result } = render(mask, 0);
  let fractional = false;
  for (let py = 0; py < visible.height; py++) for (let px = 0; px < visible.width; px++) {
    const x = (px + .5) * result.width / visible.width - result.width / 2;
    const y = (py + .5) * result.height / visible.height - result.height / 2;
    const a = visible.data[(py * visible.width + px) * 4 + 3];
    if (!inside(x, y, mask, 0)) assert.equal(a, 0);
    if (a > 0 && a < 255) fractional = true;
  }
  assert.ok(fractional, 'retains preview feather, not native shader evidence');
});
