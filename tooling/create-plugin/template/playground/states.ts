// Playground states (plugin spec §24.2 "every widget state render fixture").
//
// `pnpm playground <dir>` renders each entry headlessly and answers pass/fail.
// Shape: widget type -> state name -> the props that state renders. Props are
// validated against the manifest's declared prop schema BEFORE anything mounts,
// so a typo here is reported as a broken fixture rather than a broken widget.
//
// Authoring-time only: this directory never enters a `.vfplugin`, the same way
// `scripts/` and `test/` do not.
export default {
  "{{widgetType}}": {
    // The first thing a fresh card shows: the empty-state affordance.
    empty: { text: "" },
    // Wrapping, a long unbroken run, and a hard newline in one fixture — the
    // three things that break a card's layout, all visible in one render.
    filled: {
      text: "A card long enough to wrap several times, with an unbreakablesequenceofcharacters and\na hard newline after it.",
    },
  },
};
