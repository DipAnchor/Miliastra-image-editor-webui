import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { resolveCanvasSize } = await import(moduleUrl(compile('canvasSize')));

test('locked width keeps aspect ratio (square)', () => {
  assert.deepEqual(resolveCanvasSize({ width: 300, height: 300 }, 'width', 600, true), { width: 600, height: 600 });
});

test('locked height keeps aspect ratio', () => {
  assert.deepEqual(resolveCanvasSize({ width: 800, height: 400 }, 'height', 200, true), { width: 400, height: 200 });
});

test('locked non-square ratio follows edited side', () => {
  assert.deepEqual(resolveCanvasSize({ width: 900, height: 600 }, 'width', 300, true), { width: 300, height: 200 });
  assert.deepEqual(resolveCanvasSize({ width: 900, height: 600 }, 'height', 300, true), { width: 450, height: 300 });
});

test('unlocked changes only the edited side', () => {
  assert.deepEqual(resolveCanvasSize({ width: 300, height: 300 }, 'width', 500, false), { width: 500, height: 300 });
  assert.deepEqual(resolveCanvasSize({ width: 300, height: 300 }, 'height', 700, false), { width: 300, height: 700 });
});

test('clamps to 1..2048', () => {
  assert.deepEqual(resolveCanvasSize({ width: 300, height: 300 }, 'width', 5000, false), { width: 2048, height: 300 });
  assert.deepEqual(resolveCanvasSize({ width: 300, height: 300 }, 'width', 0, false), { width: 1, height: 300 });
});

test('locked derives and clamps the other side', () => {
  const s = resolveCanvasSize({ width: 300, height: 100 }, 'width', 2048, true);
  assert.equal(s.width, 2048);
  assert.ok(s.height >= 1 && s.height <= 2048);
});

// Regression: typing "1600" digit by digit must not collapse a 16:9 canvas to 1:1.
test('locked ratio stays fixed through an intermediate clamped keystroke', () => {
  const ratio = 1920 / 1080; // 16:9 captured when locking
  // First character "1" clamps the other side to 1 -> 1x1 canvas, but the fixed ratio is kept.
  const afterFirstDigit = resolveCanvasSize({ width: 1920, height: 1080 }, 'width', 1, true, ratio);
  assert.deepEqual(afterFirstDigit, { width: 1, height: 1 });
  // Following digits keep using the captured ratio, so the result is 1600x900 (not 1600x1600).
  const final = resolveCanvasSize({ width: 1, height: 1 }, 'width', 1600, true, ratio);
  assert.deepEqual(final, { width: 1600, height: 900 });
  // Whole typing sequence from the original canvas stays 16:9.
  let size = { width: 1920, height: 1080 };
  for (const digitValue of [1, 16, 160, 1600]) size = resolveCanvasSize(size, 'width', digitValue, true, ratio);
  assert.deepEqual(size, { width: 1600, height: 900 });
});

test('locked ratio for height editing also survives intermediate clamp', () => {
  const ratio = 1920 / 1080;
  let size = { width: 1920, height: 1080 };
  for (const digitValue of [1, 10, 100, 1080]) size = resolveCanvasSize(size, 'height', digitValue, true, ratio);
  assert.deepEqual(size, { width: 1920, height: 1080 });
});
