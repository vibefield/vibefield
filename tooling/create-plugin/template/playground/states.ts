// Playground states (plugin spec §24.2 "every state render fixture").
//
// Shape: object type -> state name -> the props that state draws. The SDK's kind-conformance
// harness — `pnpm playground <dir>`, and test/kind.test.ts — validates each state's props against the
// manifest's declared schema FIRST (a typo reads as a broken fixture, `state-invalid`, not a broken
// kind), then drives the kind through it in every mode it declares, at every zoom the desk's LOD
// names. Each state you add here is judged everywhere the harness runs.
//
// Authoring-time only: this directory never enters a `.vfplugin`, the same way
// `scripts/` and `test/` do not.
export default {
  "{{objectType}}": {
    // the default a new one is made with
    default: {},
    // a colour of its own
    coral: { color: "#e8765c" },
  },
};
