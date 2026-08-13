// Playground states (plugin spec §24.2). See plugins/note/playground/states.ts
// for the shape and the authoring-time rule.
export default {
  "vibefield.field-tools.folder": {
    default: { title: "Folder", accent: "#7B96FF" },
    // A folder's title is user-typed and unbounded; the card has to survive one
    // that does not fit its bar.
    "long-title": {
      title: "A folder whose title is far longer than its title bar can show",
      accent: "#7B96FF",
    },
    accented: { title: "Saved", accent: "#EC4899" },
  },
  "vibefield.field-tools.comment": {
    default: { title: "Comment", color: "#6366F1" },
    titled: { title: "Review notes", color: "#22C55E" },
  },
};
