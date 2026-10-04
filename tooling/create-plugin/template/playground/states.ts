// Playground states (plugin spec §24.2 "every state render fixture").
//
// Shape: object type -> state name -> the props that state draws. Props are validated
// against the manifest's declared prop schema BEFORE anything is drawn, so a typo here
// is reported as a broken fixture rather than a broken kind. `pnpm playground <dir>`
// lists them today; DK-7's kind harness drives each through resolve/record/hit and holds
// a still of it to a golden — and test/kind.test.ts runs them by hand until then.
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
