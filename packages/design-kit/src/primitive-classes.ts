// The kit's control classes as plain names (item 570, 2026-11-19), in a module that reaches no .tsx, so a plugin that
// draws its own DOM reaches them through `@vibefield/plugin-sdk/ui-dom` without React. Their rules are primitives.css's,
// which primitives.tsx imports; primitives.tsx re-exports these names, so every importer reads them where it did.
export const uiLabelClass = "vf-ui-label";
export const uiFieldClass = "vf-ui-field";
export const uiButtonClass = "vf-ui-button";
export const uiIconButtonClass = "vf-ui-icon-button";
