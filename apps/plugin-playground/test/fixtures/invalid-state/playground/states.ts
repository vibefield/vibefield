// Deliberately wrong in four different ways, one per row.
export default {
  "vibefield.fixture-invalid.card": {
    // the only legal row — the control's control
    ok: { count: 5, label: "fine", rows: [{ id: "a" }] },
    // declared max is 10
    "over-max": { count: 99, label: "too big", rows: [] },
    // declared kind is number
    "wrong-kind": { count: "five", label: "not a number", rows: [] },
    // `kount` is not a declared prop; the engine would silently drop it and the
    // row would pass on default props, which is the worst possible answer
    typo: { kount: 5, label: "typo", rows: [] },
    // the json inner shape declares { id: string }
    "bad-json": { count: 1, label: "shape", rows: [{ id: 7 }] },
  },
};
