// C2 — the durable-ID ratification map (2026-07-23, James; plugin spec §21.2).
// THE ONLY home of the retired dev-era type strings: boards written before C2
// carry these ids; the doc-open migration rewrites them exactly once. Ids are
// forever — entries here are append-only history, never edited or reused.

/** old widget type → ratified widget type (PrefabId values + `${type}:props`
 * component-cell names both rename through this map). */
export const TYPE_RENAMES: Readonly<Record<string, string>> = {
  "note.card": "vibefield.note",
  "field.folder": "vibefield.field-tools.folder",
  "field.comment": "vibefield.field-tools.comment",
  "widgetlab.clock": "vibefield.widgetlab.clock",
  "widgetlab.battery": "vibefield.widgetlab.battery",
  "widgetlab.calendar": "vibefield.widgetlab.calendar",
  "widgetlab.weather": "vibefield.widgetlab.weather",
  "widgetlab.stocks": "vibefield.widgetlab.stocks",
  "widgetlab.fitness": "vibefield.widgetlab.fitness",
  "widgetlab.photos": "vibefield.widgetlab.photos",
  "widgetlab.todo": "vibefield.widgetlab.todo",
  "widgetlab.sphere": "vibefield.widgetlab.sphere",
  "widgetlab.crystal": "vibefield.widgetlab.crystal",
  "widgetlab.torus-knot": "vibefield.widgetlab.torus-knot",
  "widgetlab.cube": "vibefield.widgetlab.cube",
  "widgetlab.gold-knot": "vibefield.widgetlab.gold-knot",
  "widgetlab.shapes": "vibefield.widgetlab.shapes",
  "widgetlab.orbit-cube": "vibefield.widgetlab.orbit-cube",
  "widgetlab.signal": "vibefield.widgetlab.signal",
  "widgetlab.filter": "vibefield.widgetlab.filter",
  "widgetlab.scope": "vibefield.widgetlab.scope",
} as const;
