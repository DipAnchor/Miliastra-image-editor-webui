# Basic shape library restoration

**Goal:** Restore the built-in shape cards when an automatically restored scene contains empty, missing or partial base-shape presets. Preserve the existing canvas, elements, groups, saved items and custom preset values.

**Architecture:** At the existing last-canvas restore boundary in frontend/src/App.tsx, fill library defaults and reuse normalizeBaseShapePresets. Use the same repaired scene for state, sceneRef and the initial history entry. Avoid normalizing or rewriting unrelated element/group data.

**Tech Stack:** React, TypeScript, Vitest/Testing Library, existing Ego Browser CLI.

- [x] Add frontend/tests/baseShapeLibraryApp.test.tsx to reproduce empty/missing presets, preserve custom preset dimensions/colors and existing data, test adding/undoing a shape, and verify the other-category and quick-library paths. Confirmed empty/partial preset failures before the fix.
- [x] Repair only the last-canvas restoration block; all four targeted regressions pass in the full suite.
- [x] Run all frontend logic/UI tests, TypeScript and production builds plus git diff --check. Verified the actual existing browser scene without injecting fixtures or changing its shapes; closed space 11 and removed temporary scripts/screenshots.

**Verification (frontend working directory):**

```powershell
node node_modules/vitest/vitest.mjs run tests/baseShapeLibraryApp.test.tsx
$logicTests = @(Get-ChildItem -LiteralPath tests -Filter "*.test.mjs" -File | ForEach-Object FullName)
node --test $logicTests
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
```

**Acceptance:** The built-in shapes and textbox return after restoration; existing custom presets remain effective when creating shapes; restoration itself adds no history; original scene content and saved items remain unchanged. No backend/export changes, commits or pushes.

**Results:** All Node logic tests, 120 UI tests, TypeScript and the Vite production build passed. The four new regressions cover empty/missing/partial presets, custom values, creating/undoing, autosave, other categories and the quick library. Native browser verification showed seven cards; elements, groups, canvas, metadata and saved items matched the pre-refresh scene. Browser space 11 was closed successfully and temporary verification files removed.
