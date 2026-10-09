// Playground states (plugin spec §24.2 "every state render fixture") — object type → state name → the props that state
// draws. The SDK's kind-conformance harness (`pnpm playground plugins/browser-pane`, and test/kind.test.ts) validates each
// state's props against the manifest's declared schema FIRST, then drives the kind through it in every mode it declares
// (idle, selected, held, open — it opens: ICE's pick-up) at every zoom the desk's LOD names. `--still` draws each one on
// Dawn by day and by night, at the row's size (a laptop's pane), held to test/still.golden.json.
//
// Authoring-time only: this directory never enters a `.vfplugin`, the same way `scripts/` and `test/` do not.
export default {
  "vibefield.browser-pane": {
    // a new pane on the sample page, low-iron glass, its page in the desk's scheme (light by day, dark by night)
    default: {},
    // smoked glass, its page fixed light (by night a bright page in a dark room: the glow, the spill, the edge light)
    smoke: { finish: "smoke", scheme: "light" },
    // bronze glass, its page fixed dark
    bronze: { finish: "bronze", scheme: "dark" },
    // a page the desk cannot show yet (PT-1 has the sample alone): the dark film, the head's prompt
    blank: { url: "about:blank" },
    // PT-2 — a web page: a LIVE face the host fills; in a still, the sample's own bytes through the live path (playground/live.ts)
    live: { url: "https://lumen.example/reader" },
  },
};
