# Element Capability Query Implementation Plan

> **For agentic workers:** Execute the authorized plan inline, with focused parallel read-only review and disjoint test work. Steps use checkbox tracking. Do not commit or push without a separate user request.

**Goal:** Let AI query actual type-level creation, editing, parameter, import/export and preview capabilities before composing a scene.

**Architecture:** Add a pure capability catalogue and a read-only `get_element_capabilities` WebMCP tool. Reuse the catalogue's creatable-type list, numeric limits and smart-object shell fields in existing tool schemas, parsers and the editor. Report conditional, lossy, omitted and preserved-only behavior explicitly; asset-specific modes continue to come from `get_asset_info`.

**Tech Stack:** TypeScript, existing WebMCP registration, Node test runner, Vitest and Vite.

---

### Task 1: Establish the contract and regression cases

**Files:** Create `frontend/tests/elementCapabilities.test.mjs`; modify `frontend/tests/prefabTools.test.mjs` and `frontend/tests/webmcpApp.test.tsx`.

- [x] Verify current parser, editor shell whitelist and backend format branches; record distinctions between hand-authored input and editor metadata round trips.
- [x] Add pure tests around `getElementCapabilities(type?: string)` returning `{ok:true,schemaVersion:1,scope:"type-level",coordinates,parameterLimits,features,elements}`. Omitted type or undefined returns all 11 known types; a valid type returns one keyed entry; empty strings and unknown/non-string values fail. Each entry has `creation`, `editing`, `formats`, `preview`, and `constraints`.
- [x] Add a registered-tool failure regression: `definitions.get("get_element_capabilities")` must exist, have `readOnlyHint:true`, expose a type enum and return a filtered report without calling editing or network functions. Check isolated results and invalid input.
- [x] Record real regression evidence: the registered-tool baseline failed for the missing tool before registration was implemented. The pure catalogue suite was added after implementation and passed; do not claim a preimplementation red run for that suite.

### Task 2: Implement the pure catalogue and query

**Files:** Create `frontend/src/elementCapabilities.ts`; modify `frontend/src/webmcp.ts` and `frontend/src/App.tsx`.

- [x] Export `CREATABLE_ELEMENT_TYPES`, `SMART_OBJECT_EDITABLE_FIELDS`, `ELEMENT_LIMITS` and `getElementCapabilities(type?: string)`. Use a fresh serializable report per call. Keep `smart-object` and `other` discoverable but uncreatable through add tools.
- [x] Define the 11 type records with meaningful update fields, create requirements, numeric constraints, import/export status and reasons. Document triangle orientation, ring ratio, metadata-dependent image stretch, Lua-only prefab/masks, object flattening, CSS/SVG subsets and absence of blanket device verification.
- [x] Register `get_element_capabilities` with optional `type`, `readOnlyHint:true` and a description that explains its type-level scope. Add discovery guidance to creation/import/export tool descriptions.
- [x] Replace duplicated type, numeric-limit and shell-whitelist values with imports while preserving existing accepted/rejected inputs and messages. Update the existing data-URL test loaders in `prefabTools.test.mjs` and `imageLibrary.test.mjs` for the new import.

### Task 3: Verify and document

**Files:** Modify `docs/webmcp.md`, `docs/technical-design.md`, and the three `skills/miliastra-image-*/SKILL.md` files.

- [x] Add examples `get_element_capabilities({})` and `get_element_capabilities({type:"image"})`, status meanings, query-first workflow and clear scene/asset/device evidence boundaries.
- [x] Add an App-level query regression proving scene, selection and undo history remain unchanged; compare advertised creation types and shell fields with actual tool behavior.
- [x] Run targeted pure/UI suites and complete Node/Vitest suites, TypeScript project checks, Vite production build and `git diff --check`. Use direct Node entrypoints equivalent to the package scripts; all pass, including 249 UI tests. Review the final diff.
- [x] Use the existing browser page with a temporary WebMCP registration host to execute actual tool definitions: 25 registrations, all 11 types, filtered/error/isolation checks, unchanged scene/selection/history. Restore all 15 owned localStorage raw values after leaving the app and verify unrelated keys unchanged. Independently close the test space and remove only the verified temporary directory. This checks page integration, not an external browser-forwarder or a game device.

**Boundary:** No new export protocol, no API behavior expansion, no format-parser fixes, no UI redesign, no new package dependencies and no automatic commit/push. A capability report is guidance, not per-scene validation or a claim of game-device verification.
