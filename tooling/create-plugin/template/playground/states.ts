// Playground states (plugin spec §24.2 "every state render fixture").
//
// Shape: object type -> state name -> the props that state draws. `pnpm playground <dir>`
// lists them today, refusing a type this manifest does not contribute; DK-7's
// kind harness will validate each state's props against the manifest's declared schema
// BEFORE drawing (a typo then reads as a broken fixture, not a broken kind), drive it
// through resolve/record/hit and hold a still of it to a golden — test/kind.test.ts runs
// them by hand until then, and validates nothing.
//
// Authoring-time only: this directory never enters a `.vfplugin`, the same way
// `scripts/` and `test/` do not.
export default {
  "{{widgetType}}": {
    // the default a new one is made with
    default: {},
    // a colour of its own
    coral: { color: "#e8765c" },
  },
};
