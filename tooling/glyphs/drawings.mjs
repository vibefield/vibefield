// The chrome glyph set — DESIGN.md §13. Every drawing sits in a 24-unit box with
// its optical centre at 12,12 and its live area between 2 and 22. Two
// constructions exist for every name; `picks.json` says which one ships:
//   instrument — one 2-unit stroke, round caps and joins (plus a few solid dots)
//   hardware   — one solid silhouette, `fill-rule: evenodd`, knocked detail as holes
// Both are plain geometry: no masks, filters or gradients, so the same drawing
// reaches the browser (`@vibefield/design-kit/glyphs`) and the phone (a template
// SVG in `FieldGlyphs.xcassets`) unchanged. Regenerate with `node tooling/glyphs/build.mjs`.

const f2 = (n) => (Math.round(n * 100) / 100).toString();
const rad = (d) => (d * Math.PI) / 180;
const pp = (cx, cy, r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];

/* ── instrument primitives: markup fragments ── */
export const P = (d) => `<path d="${d}"/>`;
export const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
export const R = (x, y, w, h, rx) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;

/* ── hardware primitives: path data, joined into ONE evenodd path ── */
const poly = (pts) => `M${pts.map((p) => `${f2(p[0])} ${f2(p[1])}`).join("L")}Z`;
export const rectPath = (x, y, w, h, r = 0) =>
  r <= 0
    ? `M${f2(x)} ${f2(y)}h${f2(w)}v${f2(h)}h${f2(-w)}Z`
    : `M${f2(x + r)} ${f2(y)}h${f2(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${f2(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}h${f2(-(w - 2 * r))}a${r} ${r} 0 0 1 ${-r} ${-r}v${f2(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
export const circlePath = (cx, cy, r) =>
  `M${f2(cx - r)} ${f2(cy)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
/** A bar from p1 to p2 with half-width hw and square ends. */
export const bar = (x1, y1, x2, y2, hw) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * hw;
  const ny = (dx / l) * hw;
  return poly([
    [x1 + nx, y1 + ny],
    [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny],
    [x1 - nx, y1 - ny],
  ]);
};
/** A capsule (a stroke with round caps) from p1 to p2, as an outline. */
export const capsule = (x1, y1, x2, y2, hw) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * hw;
  const ny = (dx / l) * hw;
  return `M${f2(x1 + nx)} ${f2(y1 + ny)}L${f2(x2 + nx)} ${f2(y2 + ny)}A${hw} ${hw} 0 0 0 ${f2(x2 - nx)} ${f2(y2 - ny)}L${f2(x1 - nx)} ${f2(y1 - ny)}A${hw} ${hw} 0 0 0 ${f2(x1 + nx)} ${f2(y1 + ny)}Z`;
};
/** Two crossed bars at ±45° as one outline (an X). */
export const xPoly = (cx, cy, L, hw) => {
  const s = Math.SQRT1_2;
  const arms = [
    [s, -s],
    [s, s],
    [-s, s],
    [-s, -s],
  ];
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const d = arms[i];
    const pv = arms[(i + 3) % 4];
    let bx = pv[0] + d[0];
    let by = pv[1] + d[1];
    const bl = Math.hypot(bx, by);
    bx /= bl;
    by /= bl;
    pts.push([cx + bx * hw * Math.SQRT2, cy + by * hw * Math.SQRT2]);
    const E = [cx + L * d[0], cy + L * d[1]];
    const n = [-d[1] * hw, d[0] * hw];
    pts.push([E[0] - n[0], E[1] - n[1]]);
    pts.push([E[0] + n[0], E[1] + n[1]]);
  }
  return poly(pts);
};
export const gearPath = (cx, cy, teeth, rOut, rIn, tipHalf, baseHalf) => {
  const pt = (r, deg) => pp(cx, cy, r, deg).map(f2);
  let d = "";
  const step = 360 / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = -90 + i * step;
    const p1 = pt(rIn, a - baseHalf);
    const p2 = pt(rOut, a - tipHalf);
    const p3 = pt(rOut, a + tipHalf);
    const p4 = pt(rIn, a + baseHalf);
    const p5 = pt(rIn, a + step - baseHalf);
    d +=
      (i === 0 ? `M${p1[0]} ${p1[1]}` : "") +
      `L${p2[0]} ${p2[1]}L${p3[0]} ${p3[1]}L${p4[0]} ${p4[1]}A${rIn} ${rIn} 0 0 1 ${p5[0]} ${p5[1]}`;
  }
  return `${d}Z`;
};

const GEAR = gearPath(12, 12, 8, 9.6, 7.4, 7, 12.5);
const FLAME =
  "M12.2 1.8C14.6 5.6 18 8.6 18 13.4a6 6 0 0 1-12 0c0-2.7 1.1-4.5 2.5-5.8.2 1.8 1 2.9 2.1 3.3C9.3 7.5 10.1 4.1 12.2 1.8Z";
const MOON = "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z";
const FOLDER = "M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z";
const CAMERA =
  "M8.5 5.5l1.3-2h4.4l1.3 2H19a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 19 19.5H5A2.5 2.5 0 0 1 2.5 17V8A2.5 2.5 0 0 1 5 5.5h3.5Z";
const PUZZLE =
  "M7 7h2a2 2 0 0 1 4 0h2a2 2 0 0 1 2 2v2a2 2 0 0 1 0 4v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V9a2 2 0 0 1 2-2Z";
const MESSAGE = "M20 14a2 2 0 0 1-2 2H9l-4.5 3.5V6a2 2 0 0 1 2-2h11.5a2 2 0 0 1 2 2Z";
const LINK =
  "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.2 1.2M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.2-1.2";
const CUBE = "M12 2.8 20 7.2v9.6l-8 4.4-8-4.4V7.2Z";
const SPARK = "M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9Z";
const PAGE = "M6 3h8l4 4v14H6Z";
// Session Glyphs (30 Sep picks, T3 · the window): `terminal`'s window with its
// chevron, the frame opened at the lower right to hold the verb. Their
// Hardware records are the page's T4 column — the Hardware prompt's band,
// narrowed, with a solid verb beside it.
const WIN_OPEN = "M11.5 19H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3.5";
const WIN_CHEV = "M7 9.5l3 2.5-3 2.5";
const SOLID_CHEV = "M3 5l8.5 7L3 19v-4.3l4.6-2.7L3 9.3Z";
// jump-T3: the window's wall opened on the left for the arrow going in — a box
// with an arrow leaving it is already `outward`.
const WIN_GAP = "M3 10V8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2";
// Chrome on the Mat (2026-09-28, MC-D8): ICE's selection glyphs redrawn in the
// Instrument construction. The tape is a padlock, shut; the lift the same
// padlock opened. Their Hardware records are drawn here (none shipped).
const LOCK_BODY =
  "A2.5 2.5 0 0 1 20 12.5v6a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-6A2.5 2.5 0 0 1 6.5 10Z";

/**
 * name → { label, group, role, instrument: {s, f?, tf?}, hardware: {d} }
 *   instrument.s / .f: markup fragments (stroked / filled)
 *   hardware.d: one evenodd path — every subpath either a body or a hole
 */
export const DRAWINGS = {
  plus: {
    label: "Plus",
    group: "actions",
    role: "Objects — the composer's create on Canvas, the one bare plus on screen; New profile and Add artifact inside their sheets",
    instrument: { s: P("M12 5v14M5 12h14") },
    hardware: { d: "M10.5 4h3v6.5H20v3h-6.5V20h-3v-6.5H4v-3h6.5Z" },
  },
  close: {
    label: "Close",
    group: "actions",
    role: "Close settings, stop loading; the composer's plus turned 135°",
    instrument: { s: P("M6.5 6.5l11 11M17.5 6.5l-11 11") },
    hardware: { d: xPoly(12, 12, 7.6, 1.5) },
  },
  check: {
    label: "Check",
    group: "actions",
    role: "An agent row's done mark; the row paints it green (§2.5)",
    instrument: { s: P("M5 12.5l4.5 4.5L19 7.5") },
    hardware: { d: "M3.2 12.6l2.4-2.4 3.6 3.6 9.2-9.2 2.4 2.4L9.2 18.6Z" },
  },
  search: {
    label: "Search",
    group: "actions",
    role: "The command palette's field",
    instrument: { s: `${C(11, 11, 6.5)}${P("M15.8 15.8l4.7 4.7")}` },
    hardware: {
      d: `${circlePath(10.5, 10.5, 7.5)}${circlePath(10.5, 10.5, 4.3)}${bar(15.9, 15.9, 20.6, 20.6, 1.5)}`,
    },
  },
  pencil: {
    label: "Rename",
    group: "actions",
    role: "Rename this field, beside the doc name in the pill",
    instrument: { s: P("M5 19v-3.2L15.5 5.3l3.2 3.2L8.2 19H5ZM13.3 7.5l3.2 3.2") },
    hardware: {
      d: `M3.5 20.5l1.2-5L15.5 4.7a1.5 1.5 0 0 1 2.1 0l1.7 1.7a1.5 1.5 0 0 1 0 2.1L8.5 19.3Z${bar(13.5, 6.7, 17.3, 10.5, 0.7)}`,
    },
  },
  undo: {
    label: "Undo",
    group: "actions",
    role: "A plugin's settings history; redo is the same drawing flipped",
    instrument: { s: P("M8.5 6.5L4.5 10.5l4 4M4.5 10.5H14a5 5 0 0 1 5 5V18") },
    hardware: { d: "M11 12l8.5-6.5v13ZM2.5 12L11 5.5v13Z" },
  },
  reset: {
    label: "Reset",
    group: "actions",
    role: "Reset a profile to its default; reload a browser page",
    instrument: { s: P("M19 12a7 7 0 1 1-2.05-4.95M19 4.5V9h-4.5") },
    hardware: {
      d: "M19.79 16.5A9 9 0 1 1 19.79 7.5L16.76 9.25A5.5 5.5 0 1 0 16.76 14.75ZM15.5 9.97L21.05 6.77L19.9 11.1Z",
    },
  },
  outward: {
    label: "Open outside",
    group: "actions",
    role: "Open an agent's session in its own window",
    instrument: {
      s: P("M10 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3M14 4h6v6M20 4l-8 8"),
    },
    hardware: { d: "M12 3.5l8.5 8.5h-17ZM3.5 15h17v3.2h-17Z" },
  },
  link: {
    label: "Link",
    group: "actions",
    role: "Link Tailscale account… in the Me menu",
    instrument: { s: P(LINK) },
    hardware: { d: `M2.5 9.5h6v5h-6ZM8.5 10.5h9l3 1.5-3 1.5h-9Z${rectPath(15.3, 10.5, 1.2, 3)}` },
  },
  return: {
    label: "Return",
    group: "actions",
    role: "Enter on the composer and the keypad; a snippet that sends Enter",
    instrument: { s: P("M19 6v5a3 3 0 0 1-3 3H6M9.5 10.5L6 14l3.5 3.5") },
    hardware: { d: "M17.5 4h3v7.5a3 3 0 0 1-3 3H10.5V18L4 13l6.5-5v3.5h7Z" },
  },
  backspace: {
    label: "Backspace",
    group: "actions",
    role: "The keypad's delete key",
    instrument: {
      s: P("M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7 6-7ZM12 10l5 4M17 10l-5 4"),
    },
    hardware: {
      d: `M9 4.5h10.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-7-7.5Z${xPoly(14, 12, 3.2, 0.95)}`,
    },
  },
  ellipsis: {
    label: "More",
    group: "actions",
    role: "The rail's last key: the terminal keypad",
    instrument: { f: `${C(6, 12, 1.6)}${C(12, 12, 1.6)}${C(18, 12, 1.6)}` },
    hardware: {
      d: `${rectPath(3, 10.4, 3.3, 3.3, 0.7)}${rectPath(10.35, 10.4, 3.3, 3.3, 0.7)}${rectPath(17.7, 10.4, 3.3, 3.3, 0.7)}`,
    },
  },
  start: {
    label: "New terminal",
    group: "actions",
    role: "Godview's create in the composer: a session started, the window holding a plus",
    // spawn-T3: the verb is a plus in the window's open corner.
    instrument: { s: P(`${WIN_OPEN}${WIN_CHEV}M18 14.5v7M14.5 18h7`) },
    hardware: { d: `${SOLID_CHEV}M16 10.5h3v3h3v3h-3v3h-3v-3h-3v-3h3Z` },
  },
  resume: {
    label: "Resume",
    group: "actions",
    role: "History's create in the composer: a past session resumed, the window holding play",
    // resume-play-T3: the verb is play in the window's open corner.
    instrument: { s: P(`${WIN_OPEN}${WIN_CHEV}M15.5 14.5v7l6-3.5Z`) },
    hardware: { d: `${SOLID_CHEV}M14 9.5v11l8-5.5Z` },
  },
  jump: {
    label: "Jump to",
    group: "actions",
    role: "Go to a session that is running: a live row in History, a link in running text",
    // jump-T3: the arrow goes in through the window's opened wall.
    instrument: { s: P(`${WIN_GAP}M2.5 12h8M7.5 9l3 3-3 3M13.5 15.5h4`) },
    hardware: { d: `${SOLID_CHEV}M14.5 10.5h7v7H19v-2.7l-4.2 4.2-1.8-1.8 4.2-4.2H14.5Z` },
  },
  duplicate: {
    label: "Duplicate",
    group: "actions",
    role: "Duplicate on the desk's selection bar (⌘D); a taped selection does not offer it",
    instrument: {
      s: `${R(8.5, 8.5, 12, 12, 3)}${P("M15.5 8.5V6.5a3 3 0 0 0-3-3h-6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h2")}`,
    },
    hardware: {
      d: `M5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V7H7v8.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3Z${rectPath(8.5, 8.5, 12.5, 12.5, 2.5)}`,
    },
  },
  tape: {
    label: "Tape it down",
    group: "actions",
    role: "The desk's selection bar: tape the selection down where it lies (⇧⌘L)",
    instrument: { s: `${R(4.5, 10.5, 15, 10, 3)}${P("M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2")}` },
    hardware: {
      d: `M6.5 10V8a5.5 5.5 0 0 1 11 0v2${LOCK_BODY}M9 10V8a3 3 0 0 1 6 0v2Z${capsule(12, 14.4, 12, 16.6, 1.1)}`,
    },
  },
  lift: {
    label: "Lift the tape",
    group: "actions",
    role: "The tape button while the selection is taped: on, and lifting the tape",
    instrument: { s: `${R(4.5, 10.5, 15, 10, 3)}${P("M8 10.5V8a4 4 0 0 1 7.7-1.5M12 14.5v2")}` },
    hardware: {
      d: `M6.5 10V8a5.5 5.5 0 0 1 10.6-2.07L14.78 6.87A3 3 0 0 0 9 8v2h8.5${LOCK_BODY}${capsule(12, 14.4, 12, 16.6, 1.1)}`,
    },
  },
  trash: {
    label: "Delete",
    group: "actions",
    role: "Delete, at the far end of the desk's selection bar (⌫); red only while hovered",
    instrument: {
      s: P(
        "M4.5 6.5h15M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5M6.5 6.5l.9 12.2a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8l.9-12.2M10 10.5v6M14 10.5v6",
      ),
    },
    hardware: {
      d: `M9.5 5V3.8A1.3 1.3 0 0 1 10.8 2.5h2.4a1.3 1.3 0 0 1 1.3 1.3V5h4.8a1.2 1.2 0 0 1 0 2.4H4.7a1.2 1.2 0 0 1 0-2.4Z${rectPath(11.2, 3.7, 1.6, 1.3)}M5.6 8.7h12.8l-1 11a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8Z${capsule(10, 11.6, 10, 18.4, 0.85)}${capsule(14, 11.6, 14, 18.4, 0.85)}`,
    },
  },
  pen: {
    label: "Pen",
    group: "actions",
    role: "A held kind's pen as a mode (the calendar's): on is the inverted solid",
    instrument: {
      s: `${P("M5 19l1.2-4.2L15.6 5.4a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L9.2 17.8z")}${P("M13.5 7.5l3 3")}`,
    },
    // the barrel and the cap apart, the band between them knocked through
    hardware: {
      d: "M3.6 20.4 4.9 15.4 12.6 7.7 16.3 11.4 8.6 19.1ZM13.9 6.4 16.87 3.43A2.62 2.62 0 0 1 20.57 7.13L17.6 10.1Z",
    },
  },
  eraser: {
    label: "Eraser",
    group: "actions",
    role: "A held kind's eraser as a mode (the whiteboard's): on is the inverted solid",
    instrument: {
      s: `${P("M4.5 15.5l7-7a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8l-4 4H9.3l-4.8-4z")}${P("M9 19.5h11")}`,
    },
    // the rubber and the sleeve apart, standing on the line
    hardware: {
      d: `M4.5 14.5 8 11l7 7-.5.5H9.3ZM8.99 10.01 11.5 7.5a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8l-2.51 2.51Z${capsule(9.8, 20.4, 20, 20.4, 0.8)}`,
    },
  },
  today: {
    label: "Today",
    group: "actions",
    role: "The held calendar's Today: back to this month",
    instrument: {
      s: `${R(4.5, 6, 15, 13.5, 2.5)}${P("M4.5 10.5h15M8.5 4v3.5M15.5 4v3.5")}`,
      f: C(12, 15, 1.6),
    },
    // the page knocked out under a solid head, the rings through it, the day solid
    hardware: {
      d: `${rectPath(3.5, 5, 17, 16, 2.5)}${rectPath(5.5, 10, 13, 9, 1)}${circlePath(12, 14.5, 2)}${rectPath(7.4, 2.5, 2.2, 4.5, 1.1)}${rectPath(14.4, 2.5, 2.2, 4.5, 1.1)}`,
    },
  },
  // Godview round 3 (One Frame §23.2, ruled 2026-10-02): the wrapper around the
  // terminals wears the window's own pair, in the order windows keep them. The
  // page's paths were stand-ins (strokes of 1.7 and 1.9, 1-unit corners); these
  // are the set's law at the page's extent — 12 units about 12,12, so the three
  // weigh the same at 14 in a 30 × 24 control. Hardware records drawn, not shipped.
  minimize: {
    label: "Minimize",
    group: "actions",
    role: "Godview's terminals, put away — every session keeps running; the first of the Lip's two controls",
    instrument: { s: P("M6 12h12") },
    hardware: { d: "M5 10.5h14v3H5Z" },
  },
  maximize: {
    label: "Maximize",
    group: "actions",
    role: "Godview's terminals take the window; the second of the Lip's two controls",
    instrument: { s: R(6, 6, 12, 12, 3) },
    // a frame: the square solid, its middle knocked out
    hardware: { d: `${rectPath(5, 5, 14, 14, 3)}${rectPath(8, 8, 8, 8, 1)}` },
  },
  restore: {
    label: "Restore",
    group: "actions",
    role: "Maximized terminals back to their place: the square behind a square, standing where maximize stood",
    // the square in front, and the top and right of the one behind it — its
    // ends a stroke's width clear of the front square. Its squares are 8 units,
    // so the law's corner is kept IN PROPORTION: 3 on a 12-unit square is a
    // quarter of the side, and a quarter of 8 is 2 (ruled 2026-10-11 — at 3
    // the front square read, at 14, as a ring with a hook).
    instrument: { s: `${R(6, 10, 8, 8, 2)}${P("M10 6h6a2 2 0 0 1 2 2v6")}` },
    hardware: {
      d: `${rectPath(5, 9, 10, 10, 2.5)}${rectPath(7.8, 11.8, 4.4, 4.4, 0.6)}M9.5 5h7a2.5 2.5 0 0 1 2.5 2.5v7h-2.8V7.8H9.5Z`,
    },
  },
  chevron: {
    label: "Chevron",
    group: "navigation",
    role: "Right: a row that opens, the separator, forward. Turned: back, browse, a menu",
    instrument: { s: P("M9.5 6l6 6-6 6") },
    hardware: { d: "M8 4.5l9 7.5-9 7.5Z" },
  },
  arrow: {
    label: "Arrow",
    group: "navigation",
    role: "Send (up), and the four cursor keys on the rail and the keypad",
    instrument: { s: P("M12 19V5M6 11l6-6 6 6") },
    hardware: { d: "M12 3l7.5 8.5h-4.8V21h-5.4V11.5H4.5Z" },
  },
  gear: {
    label: "Settings",
    group: "objects",
    role: "Settings… in the Me menu; the Settings head tile without an account door",
    instrument: { s: `${P(GEAR)}${C(12, 12, 2.75)}` },
    hardware: {
      d: `${circlePath(12, 12, 8.5)}${capsule(12, 12, 12, 5.5, 1.1)}${rectPath(1, 11, 2.2, 2, 0.5)}${rectPath(20.8, 11, 2.2, 2, 0.5)}${rectPath(11, 20.8, 2, 2.2, 0.5)}`,
    },
  },
  person: {
    label: "Account",
    group: "objects",
    role: "The Account page in the Settings rail",
    instrument: { s: `${C(12, 8, 4)}${P("M4.5 20.5a7.5 7.5 0 0 1 15 0")}` },
    hardware: {
      d: `${rectPath(5, 3.5, 14, 17.5, 2.5)}${rectPath(9.5, 1.5, 5, 3, 1)}${circlePath(12, 10, 2.7)}${rectPath(8, 15.2, 8, 2.2, 1)}`,
    },
  },
  sliders: {
    label: "General",
    group: "objects",
    role: "General settings",
    instrument: { s: P("M4 7h16M4 12h16M4 17h16M9 4.5v5M15 9.5v5M8 14.5v5") },
    hardware: {
      d: `${rectPath(6, 3, 2, 5.5, 1)}${rectPath(6, 12.3, 2, 8.7, 1)}${rectPath(2.5, 8.5, 9, 3.8, 1.2)}${bar(4, 10.4, 10, 10.4, 0.55)}${rectPath(16, 3, 2, 10, 1)}${rectPath(16, 16.8, 2, 4.2, 1)}${rectPath(12.5, 13, 9, 3.8, 1.2)}${bar(14, 14.9, 20, 14.9, 0.55)}`,
    },
  },
  canvas: {
    label: "Canvas",
    group: "objects",
    role: "Canvas settings: the ground, its dots and needles",
    instrument: {
      s: R(3.5, 3.5, 17, 17, 3),
      f: `${C(9, 9, 1.4)}${C(15, 9, 1.4)}${C(9, 15, 1.4)}${C(15, 15, 1.4)}`,
    },
    hardware: {
      d: `${rectPath(2.5, 4, 19, 16, 2.5)}${[8, 12, 16].flatMap((y) => [6, 10, 14, 18].map((x) => circlePath(x, y, 1.1))).join("")}`,
    },
  },
  agents: {
    label: "Agents",
    group: "objects",
    role: "The Agents page and its head glyph",
    instrument: {
      s: `${C(12, 12, 3)}${C(12, 4.5, 2)}${C(5.5, 15.75, 2)}${C(18.5, 15.75, 2)}`,
    },
    hardware: {
      d: `${circlePath(12, 12.5, 3.6)}${circlePath(12, 12.5, 1.4)}${circlePath(12, 4.5, 2.4)}${circlePath(5, 17, 2.4)}${circlePath(19, 17, 2.4)}${bar(12, 8.9, 12, 6.9, 1)}${bar(9.1, 14.6, 7, 16, 1)}${bar(14.9, 14.6, 17, 16, 1)}`,
    },
  },
  profiles: {
    label: "Profiles",
    group: "objects",
    role: "Agent profiles: named presets, one folder each under the user",
    instrument: {
      s: `${R(3.5, 5.5, 17, 13, 2.5)}${P("M12.5 10.5h4.5M12.5 13.5h3")}`,
      f: C(8.5, 12, 2),
    },
    hardware: {
      d: `${rectPath(2.5, 5, 19, 14, 2)}${circlePath(8, 12.5, 2.4)}${circlePath(16, 12.5, 2.4)}${rectPath(6, 7, 12, 2.2, 0.6)}`,
    },
  },
  plugin: {
    label: "Plugins",
    group: "objects",
    role: "Plugins",
    instrument: { s: P(PUZZLE) },
    hardware: {
      d: `M6 10a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3a6 6 0 0 1-12 0Z${rectPath(8, 2.5, 2.2, 5.6, 1)}${rectPath(13.8, 2.5, 2.2, 5.6, 1)}${rectPath(11, 18.9, 2, 3.1, 1)}`,
    },
  },
  mesh: {
    label: "Mesh",
    group: "objects",
    role: "The tailnet: this device and its peers",
    instrument: {
      s: `${C(5.5, 6.5, 2.25)}${C(18.5, 8, 2.25)}${C(11, 18, 2.25)}${P("M7.73 6.76 16.27 7.74M6.47 8.53 10.03 15.97M17.15 9.8 12.35 16.2")}`,
    },
    hardware: {
      d: `${rectPath(11, 10.6, 2, 9.4, 1)}${rectPath(7, 20, 10, 2.2, 1)}${circlePath(12, 9, 1.7)}M12 4.8a4.2 4.2 0 0 1 3.44 1.79l-1.39 1a2.5 2.5 0 0 0-4.1 0l-1.39-1A4.2 4.2 0 0 1 12 4.8ZM12 1.4a7.6 7.6 0 0 1 6.22 3.24l-1.39 1a5.9 5.9 0 0 0-9.66 0l-1.39-1A7.6 7.6 0 0 1 12 1.4Z`,
    },
  },
  terminal: {
    label: "Terminal",
    group: "objects",
    role: "Terminal settings; Studio's command tile is the same window",
    instrument: { s: `${R(3, 5, 18, 14, 3)}${P("M7 9.5l3 2.5-3 2.5M12 15h4.5")}` },
    hardware: {
      d: `${rectPath(2.5, 3, 19, 15, 3)}${rectPath(5, 5.5, 14, 10, 1.5)}M9.5 18h5l1.5 3h-8Z${rectPath(6.5, 20.5, 11, 1.5, 0.7)}`,
    },
  },
  pulse: {
    label: "Diagnostics",
    group: "objects",
    role: "Diagnostics: the pulse",
    instrument: { s: P("M3.5 12h4l2.5-6 4 12 2.5-6h4") },
    hardware: {
      d: `M2.5 19a9.5 9.5 0 0 1 19 0Z${bar(12, 19, 16.8, 8.6, 0.7)}${rectPath(2.5, 19.5, 19, 2, 1)}`,
    },
  },
  code: {
    label: "Developer",
    group: "objects",
    role: "Developer settings",
    instrument: { s: P("M8.5 7L4 12l4.5 5M15.5 7l4.5 5-4.5 5M13.5 5l-3 14") },
    hardware: {
      d: `${rectPath(6.5, 5.5, 11, 13, 1.2)}${circlePath(9.3, 8.3, 1)}${[7.5, 10.3, 13.1, 15.9].map((y) => rectPath(3.5, y, 3, 1.6, 0.4) + rectPath(17.5, y, 3, 1.6, 0.4)).join("")}`,
    },
  },
  sun: {
    label: "Sun",
    group: "objects",
    role: "Theme toggle, shown while dark; the Appearance page",
    instrument: {
      s: `${C(12, 12, 4)}${P("M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8")}`,
    },
    hardware: {
      d: `${circlePath(12, 12, 4.5)}${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => capsule(...pp(12, 12, 7, a), ...pp(12, 12, 9.5, a), 1.25)).join("")}`,
    },
  },
  moon: {
    label: "Moon",
    group: "objects",
    role: "Theme toggle, shown while light",
    instrument: { s: P(MOON) },
    hardware: { d: MOON },
  },
  clipboard: {
    label: "Clipboard",
    group: "objects",
    role: "The left-edge notch; Clipboard history in the phone's plus menu",
    instrument: {
      s: `${R(8, 3, 8, 4, 1.2)}${P("M16 5h1.5A2.5 2.5 0 0 1 20 7.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-11A2.5 2.5 0 0 1 6.5 5H8M8.5 12h7M8.5 16h4.5")}`,
    },
    hardware: {
      d: `${rectPath(4, 4.5, 16, 17, 2.5)}${rectPath(9.5, 3.8, 5, 1.6, 0.6)}${capsule(8, 12, 16, 12, 1)}${capsule(8, 16, 13, 16, 1)}`,
    },
  },
  package: {
    label: "Package",
    group: "objects",
    role: "The right-edge notch, reserved for the Artifacts twin",
    instrument: { s: `${P(CUBE)}${P("M4.3 7.4 12 11.7l7.7-4.3M12 11.7v9.3M8 4.9l8 4.4")}` },
    hardware: {
      d: `${rectPath(3, 4, 18, 17, 1.5)}${bar(3, 9.7, 21, 9.7, 0.7)}${bar(3, 15.3, 21, 15.3, 0.7)}${bar(12, 4, 12, 21, 0.7)}`,
    },
  },
  capture: {
    label: "Capture",
    group: "objects",
    role: "The Snap tile and the empty still",
    instrument: { s: `${P(CAMERA)}${C(12, 12.5, 3.5)}` },
    hardware: {
      d: `${rectPath(2.5, 6, 19, 14, 2.5)}${rectPath(6, 3.5, 6, 3.5, 1)}${rectPath(15.5, 3.5, 4, 3.5, 1)}${circlePath(12, 13, 4.2)}${circlePath(12, 13, 2.1)}${rectPath(6, 17.6, 12, 1.1, 0.5)}`,
    },
  },
  panes: {
    label: "Godview",
    group: "objects",
    role: "The Godview toggle: the deck's own silhouette",
    instrument: { s: `${R(3, 4, 18, 16, 3)}${P("M10.5 4v16M10.5 12H21")}` },
    hardware: {
      d: `${circlePath(12, 12, 9)}${circlePath(12, 12, 6.15)}${circlePath(12, 12, 4.85)}${bar(12, 12, 18.5, 5.5, 0.65)}${circlePath(15.5, 14.5, 1.2)}`,
    },
  },
  history: {
    label: "History",
    group: "objects",
    role: "The views track's History cell: a clock turning back",
    // One Frame's `g-history` (§13 of the round): the dial as `globe`'s circle
    // (radius 8.4, live 2.6–21.4), opened at the upper left where the arrow
    // turns it back, and the hands at ten past.
    instrument: {
      s: `${P("M3.6 12a8.4 8.4 0 1 0 2.46-5.94")}${P("M3.4 4.4v3.8h3.8")}${P("M12 7.8v4.6l3 1.8")}`,
    },
    // `reset`'s ring and arrowhead turned to go back (mirrored), the hands a
    // body inside its counter.
    hardware: {
      d: "M4.21 16.5A9 9 0 1 0 4.21 7.5L7.24 9.25A5.5 5.5 0 1 1 7.24 14.75ZM8.5 9.97L2.95 6.77L4.1 11.1ZM11.1 8h1.8v3.6l2.6 1.5-.9 1.56-3.5-2.02Z",
    },
  },
  sidepanel: {
    label: "Artifacts",
    group: "objects",
    role: "The Artifact Hub toggle, outermost in the top-right cluster",
    instrument: { s: `${R(3, 5, 18, 14, 3)}${P("M15 5v14")}` },
    hardware: {
      d: `M5.5 3H16l4 4v12.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3Z${rectPath(7.5, 3, 8, 5.5, 0.8)}${rectPath(7, 13, 10, 6, 0.8)}${rectPath(13, 4, 2, 3.5, 0.5)}`,
    },
  },
  bug: {
    label: "Devtools",
    group: "objects",
    role: "ICE Devtools, a development-only button",
    instrument: {
      s: `${P("M9 3l1.5 2M15 3l-1.5 2M3.5 11H6M18 11h2.5M4.5 17.5l2-1.5M19.5 17.5l-2-1.5")}${R(6, 5, 12, 16, 6)}${P("M6 12h12M12 5v16")}`,
    },
    hardware: {
      d: `${circlePath(15.5, 8.5, 4.6)}${bar(13.2, 10.8, 4.6, 19.4, 1.5)}${bar(16.5, 7.5, 21, 3, 1.3)}`,
    },
  },
  globe: {
    label: "Proxy",
    group: "objects",
    role: "The Add-artifact choice: a local port, served on the tailnet",
    instrument: {
      s: `${C(12, 12, 8.5)}${P("M3.5 12h17M12 3.5a13 13 0 0 1 0 17M12 3.5a13 13 0 0 0 0 17")}`,
    },
    hardware: {
      d: `${rectPath(2.5, 13, 19, 7, 2)}${bar(7, 13, 5.5, 4, 0.9)}${bar(17, 13, 18.5, 4, 0.9)}${circlePath(5.5, 4, 1.2)}${circlePath(18.5, 4, 1.2)}${circlePath(7, 16.5, 1)}${circlePath(10.5, 16.5, 1)}${circlePath(14, 16.5, 1)}`,
    },
  },
  folder: {
    label: "Folder",
    group: "objects",
    role: "The folder choice, the folder card's bar, the swarm's project mark",
    instrument: { s: P(FOLDER) },
    hardware: {
      d: `M3 7a2 2 0 0 1 2-2h4.5l2 2H19a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z${bar(3, 10.5, 21, 10.5, 0.6)}`,
    },
  },
  keyboard: {
    label: "Keyboard",
    group: "objects",
    role: "The closed row's door back to the keyboard",
    instrument: {
      s: `${R(2.5, 6, 19, 12, 2.5)}${P("M6.5 10h.5M10 10h.5M13.5 10h.5M17 10h.5M6.5 14h.5M17 14h.5M10 14h4")}`,
    },
    hardware: {
      d: `${rectPath(2, 6, 20, 12, 2)}${[5, 8.5, 12, 15.5, 19].map((x) => rectPath(x - 0.8, 8.7, 2.6, 1.6, 0.8)).join("")}${rectPath(4.2, 11.7, 2.6, 1.6, 0.8)}${rectPath(18.2, 11.7, 2.6, 1.6, 0.8)}${rectPath(7.2, 14.4, 9.6, 1.6, 0.8)}`,
    },
  },
  mic: {
    label: "Dictation",
    group: "objects",
    role: "The dictation key",
    instrument: { s: `${R(9, 3, 6, 11, 3)}${P("M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6")}` },
    hardware: {
      d: `${rectPath(8.5, 2.5, 7, 12, 3.5)}${rectPath(11, 15, 2, 4, 0.8)}${rectPath(7.5, 19, 9, 2, 1)}M5.6 10a6.4 6.4 0 0 0 12.8 0h-1.4a5 5 0 0 1-10 0Z`,
    },
  },
  scantext: {
    label: "Scan text",
    group: "objects",
    role: "Scan text in the plus menu, and its unsupported state",
    instrument: {
      s: P(
        "M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M8 10h8M8 14h5",
      ),
    },
    hardware: {
      d: `M3 3h7v3H6v4H3ZM14 3h7v7h-3V6h-4ZM3 14h3v4h4v3H3ZM18 14h3v7h-7v-3h4Z${rectPath(8, 10.5, 8, 1.6, 0.8)}${rectPath(8, 13.4, 5, 1.6, 0.8)}`,
    },
  },
  snippets: {
    label: "Snippets",
    group: "objects",
    role: "Snippets in the plus menu",
    instrument: { s: P("M4 7h16M4 12h10M4 17h6M17 14v6M14 17h6") },
    hardware: {
      d: `M3 3.5h15l3 3v14H3Z${[
        [6, 8],
        [9.5, 8],
        [13, 8],
        [16.5, 8],
        [6, 13],
        [13, 13],
        [16.5, 13],
      ]
        .map(([x, y]) => rectPath(x, y, 1.4, 2.4, 0.3))
        .join("")}`,
    },
  },
  prompt: {
    label: "Prompt",
    group: "objects",
    role: "A peer's bare shell on the phone's field; the rail's terminal key",
    instrument: { s: P("M5 6.5l6.5 5.5L5 17.5M13.5 17.5h6") },
    hardware: { d: `M4 4.5l9.5 7.5L4 19.5V15l5-3-5-3Z${rectPath(13.5, 15.5, 7, 4, 0.6)}` },
  },
  message: {
    label: "Message",
    group: "signals",
    role: "The swarm's said-something mark",
    instrument: { s: P(MESSAGE) },
    hardware: {
      d: `${circlePath(12, 12, 9.5)}M7.5 8.5h9a1.2 1.2 0 0 1 1.2 1.2v4.6a1.2 1.2 0 0 1-1.2 1.2H10l-2.5 2v-2H7.5a1.2 1.2 0 0 1-1.2-1.2V9.7a1.2 1.2 0 0 1 1.2-1.2Z`,
    },
  },
  key: {
    label: "Permission",
    group: "signals",
    role: "The swarm's waiting-on-a-permission mark",
    instrument: { s: `${C(8, 8, 3.5)}${P("M10.5 10.5 19 19M15.5 15.5l2-2M13 13l2-2")}` },
    hardware: {
      d: `${circlePath(12, 12, 9.5)}${circlePath(9.3, 9.3, 2.7)}${circlePath(9.3, 9.3, 1)}${bar(11.2, 11.2, 17.2, 17.2, 0.95)}${bar(14.6, 14.6, 16.2, 13, 0.75)}`,
    },
  },
  question: {
    label: "Question",
    group: "signals",
    role: "The swarm's asked-you-something mark",
    instrument: {
      s: P("M9 9.5a3 3 0 1 1 4.2 2.7c-.8.4-1.2 1-1.2 1.8v.5"),
      f: C(12, 17.75, 1.35),
    },
    hardware: {
      d: `${circlePath(12, 12, 9.5)}M9 9.8a3 3 0 1 1 6 0c0 1.4-.9 2.1-1.5 2.5-.6.4-1 .8-1 1.6v.4h-2v-.4c0-1.6.9-2.3 1.6-2.8.6-.4 1-.8 1-1.3a1 1 0 0 0-2 0Z${circlePath(12, 17.3, 1.25)}`,
    },
  },
  exclaim: {
    label: "Failure",
    group: "signals",
    role: "The swarm's failed mark",
    instrument: { s: P("M12 5v9"), f: C(12, 18, 1.35) },
    hardware: {
      d: `${circlePath(12, 12, 9.5)}${capsule(12, 6.5, 12, 13.1, 1.15)}${circlePath(12, 16.9, 1.35)}`,
    },
  },
  flame: {
    label: "Burn",
    group: "signals",
    role: "The burn ladder's flame: filled when lit, outlined where there is no price",
    instrument: { s: P(FLAME), tf: "translate(0 1.4)" },
    hardware: { d: FLAME },
  },
  missing: {
    label: "Missing",
    group: "signals",
    role: "A glyph name the set does not hold — a kind's act or tool drawn as missing, and said once",
    // the desk's missing face as a mark: a card with two of its 45° hatches
    instrument: { s: `${R(4.5, 4.5, 15, 15, 3)}${P("M7.5 13.5l6-6M10.5 16.5l6-6")}` },
    hardware: {
      d: `${rectPath(3.5, 3.5, 17, 17, 3)}${capsule(7.5, 13.5, 13.5, 7.5, 1.1)}${capsule(10.5, 16.5, 16.5, 10.5, 1.1)}`,
    },
  },
  document: {
    label: "Document",
    group: "studio",
    role: "Studio catalog tile",
    instrument: { s: `${P(PAGE)}${P("M14 3v5h5M9 12h6M9 16h6")}` },
    hardware: {
      d: `M5 2.5h9l5 5v14H5Z${rectPath(13.3, 3.5, 1.4, 4.9, 0.7)}${rectPath(13.3, 7, 5.9, 1.4, 0.7)}${capsule(8, 12, 16, 12, 0.7)}${capsule(8, 15.5, 16, 15.5, 0.7)}${capsule(8, 19, 13, 19, 0.7)}`,
    },
  },
  layers: {
    label: "Layers",
    group: "studio",
    role: "Studio catalog tile",
    instrument: { s: P("M12 3l9 5-9 5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5") },
    hardware: {
      d: "M12 2.5l9.5 4.75L12 12 2.5 7.25ZM2.5 11.5l9.5 4.75 9.5-4.75v3.2L12 19.45 2.5 14.7Z",
    },
  },
  sparkle: {
    label: "Sparkle",
    group: "studio",
    role: "Studio's fallback tile",
    instrument: {
      s: `${P(SPARK)}${P("M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8Z")}`,
    },
    hardware: { d: `${SPARK}M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8Z` },
  },
};

export const GLYPH_NAMES = Object.keys(DRAWINGS);
