// Playground states (plugin spec §24.2 "every widget state render fixture").
//
// `plugin-playground .` renders each entry headlessly and answers pass/fail.
// Shape: widget type -> state name -> the props that state renders. Props are
// validated against the manifest's declared prop schema BEFORE anything mounts,
// so a typo here is reported as a broken fixture rather than a broken widget.
//
// Authoring-time only: this directory never enters a `.vfplugin`, the same way
// `scripts/` and `test/` do not.
export default {
  "vibefield.note": {
    // The first thing a new note shows: the empty-state affordance.
    empty: { text: "", color: "#f6e7a9" },
    written: { text: "Ship the playground.", color: "#f6e7a9" },
    // Wrapping, long words, and a hard newline in one fixture.
    long: {
      text: "A note long enough to wrap several times, with an unbreakablesequenceofcharacters and\na hard newline after it.",
      color: "#f6e7a9",
    },
    // The sticky surface is author-chosen; a dark one proves the card chrome
    // does not assume the default yellow.
    tinted: { text: "Tinted surface", color: "#2b3a55" },
  },
};
