# Repeat Grouping Guard

Goal: Stop repeated Group actions from adding redundant wrappers while preserving intentional subgroups and combinations of independent groups/layers.

- [x] Add failing pure and app regressions for an already-selected group and an existing group selected through all its members.
- [x] Guard the shared grouping operation before any mutation; preserve the original scene references for a repeated request and report the existing group.
- [x] Show localized already-grouped feedback without committing history. Keep partial selections, unselected empty groups and mixed grouping valid.
- [x] Run focused tests, all frontend logic/UI tests, TypeScript and Vite build; check the final diff.

Validation: All frontend logic tests, 145 UI tests, TypeScript and the Vite production build passed. Native browser checks repeated the group context-menu, canvas context-menu and sidebar Group actions three times each on the existing scene. All nine requests preserved the three-group hierarchy and complete scene, kept Undo disabled and displayed the localized feedback. All 15 owned localStorage values were restored and unrelated values were unchanged. Ctrl+G is not an existing grouping shortcut and is not claimed as coverage.

Existing nested groups remain intact. Whole-selection 10% scaling is tracked separately in the multi-selection quick-edit plan. Do not commit or push.
