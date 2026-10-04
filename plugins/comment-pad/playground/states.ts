// Playground states (plugin spec §24.2 "every state render fixture") — object type → state name → the props
// that state draws. The SDK's kind-conformance harness (`pnpm playground plugins/comment-pad`, and
// test/kind.test.ts) validates each state's props against the manifest's declared schema FIRST, then drives the
// kind through it in every mode it declares (idle, selected, held, contained — it provides `desk.containable`)
// at every zoom the desk's LOD names, WITH the product's palette (the pad's ink is the host's pens).
//
// Authoring-time only: this directory never enters a `.vfplugin`, the same way `scripts/` and `test/` do not.
export default {
  "vibefield.comment-pad": {
    // a new pad, blank
    default: {},
    // a pad with two comments on it
    written: { text: "check the seed\nthe calendar is one of six", pen: "ball" },
    // more lines than the pad holds: the writing runs past its foot and is clipped by the sheet
    long: {
      text: Array.from({ length: 24 }, (_, i) => `comment ${i + 1} on this board`).join("\n"),
      pen: "felt",
    },
    // its other dress: a red pen, a pink binding
    pink: { text: "red ink", pen: "red", accent: "pink" },
  },
};
