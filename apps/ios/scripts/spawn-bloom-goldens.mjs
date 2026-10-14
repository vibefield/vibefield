#!/usr/bin/env node
// PJ-7 — the spawn bloom's REFERENCE numbers for the phone (the IOS-6 rule:
// the reference first, then Swift). Runs puppeteer's own bloom geometry and
// targeting (`packages/views/src/views/swarm/bloom/{constants,geometry,
// targeting}.ts`, the module DESIGN.md §8 names as the numbers) over the
// phone's field — 402 × 874 pt with the bar's 93 pt band as chrome — and
// writes what they answer: where each ring's buds stand and where their words
// sit, at holds across the field, and what a pointer targets. The kit's
// `SpawnBloomGeometryTests` hold the Swift transcription to this file.
//
//   node apps/ios/scripts/spawn-bloom-goldens.mjs ../puppeteer \
//     > apps/ios/VibeFieldKit/Tests/FieldSwarmTests/Fixtures/spawn-bloom-geometry.lane.json
//
// Words are measured synthetically (characters × 0.6 em, as puppeteer's own
// audit rig does), so the numbers do not depend on a font's metrics; the
// Swift test measures the same way.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const checkout = process.argv[2];
if (!checkout) {
  console.error("usage: spawn-bloom-goldens.mjs <puppeteer checkout>");
  process.exit(2);
}
const source = join(checkout, "packages/views/src/views/swarm/bloom");
const revision = execSync(`git -C ${checkout} rev-parse --short HEAD`).toString().trim();

// the three modules, their `.js` specifiers pointed at the `.ts` beside them
const scratch = mkdtempSync(join(tmpdir(), "bloom-goldens-"));
for (const name of ["constants", "geometry", "targeting"]) {
  const text = readFileSync(join(source, `${name}.ts`), "utf8").replace(/from '\.\/(\w+)\.js'/g, "from './$1.ts'");
  writeFileSync(join(scratch, `${name}.ts`), text);
}
writeFileSync(join(scratch, "menu.ts"), "export {};\n");
const { BLOOM } = await import(join(scratch, "constants.ts"));
const geometry = await import(join(scratch, "geometry.ts"));
const { resolveTarget } = await import(join(scratch, "targeting.ts"));
rmSync(scratch, { recursive: true, force: true });

const field = { w: 402, h: 874 };
const chrome = [{ x: 0, y: 781, width: 402, height: 93 }];
const measure = (text, font) => text.length * Number(/(\d+(?:\.\d+)?)px/.exec(font)[1]) * 0.6;
const round = (v) => Math.round(v * 1e6) / 1e6;
const box = (b) => ({ x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h), align: b.align });

const menus = {
  two: [
    { name: "studio", sub: "2 RUNNING", profiles: 3 },
    { name: "laptop", sub: "ASLEEP · 2 H", profiles: 0 },
  ],
  three: [
    { name: "studio", sub: "2 RUNNING", profiles: 2 },
    { name: "laptop", sub: "IDLE", profiles: 3 },
    { name: "workstation", sub: "ASLEEP · 3 H", profiles: 0 },
  ],
};
const holds = [
  [201, 437],
  [201, 140],
  [40, 437],
  [362, 437],
  [201, 700],
  [40, 140],
  [362, 140],
  [60, 740],
];

/** Ring one, as puppeteer's `openLevel1` lays it: up first, the hub solid, and
 * each desktop that blooms needing room for its profiles onward. */
function ringOne(P, menu) {
  const hub = { x: P.x, y: P.y, r: BLOOM.hubR + 2 };
  return geometry.layoutArc({
    cx: P.x,
    cy: P.y,
    r: BLOOM.r1,
    d: BLOOM.bud1,
    step: BLOOM.step1,
    prefer: -90,
    labels: menu.map((m) => ({ name: m.name, sub: m.sub })),
    field,
    obstacles: chrome,
    discs: [hub],
    measure,
    also: (pts) => {
      let c = 0;
      pts.forEach((pt, j) => {
        const n = menu[j]?.profiles ?? 0;
        if (n < 2) return;
        const discs = [hub, ...pts.map((o) => ({ x: o.x, y: o.y, r: (BLOOM.bud1 * BLOOM.hot) / 2 }))];
        const room = {
          cx: pt.x, cy: pt.y, r: BLOOM.r2, d: BLOOM.bud2, step: BLOOM.step2, prefer: pt.a, field,
          obstacles: chrome, discs, segs: [{ a: P, b: pt }],
        };
        if (!geometry.arcFits(room, n, 90)) c += geometry.arcFits(room, n, 180) ? 20 : 40;
      });
      return c;
    },
  });
}

/** Ring two round the open desktop, as `openLevel2` lays it: along the
 * stroke, the hub, the open bud and its siblings solid, the siblings' words
 * as obstacles, and room left for the open desktop's own words. */
function ringTwo(P, one, open, names) {
  const bud = one.items[open];
  const hot = (d) => (d * BLOOM.hot) / 2;
  const obstacles = chrome.slice();
  const discs = [{ x: P.x, y: P.y, r: BLOOM.hubR + 2 }, { x: bud.x, y: bud.y, r: hot(BLOOM.bud1) }];
  one.items.forEach((o, i) => {
    if (i === open) return;
    discs.push({ x: o.x, y: o.y, r: hot(BLOOM.bud1) });
    obstacles.push({ x: o.label.x, y: o.label.y, width: o.label.w, height: o.label.h });
  });
  const menu = one.menu[open];
  const sizes = [
    geometry.labelSize({ name: menu.name, sub: menu.sub }, measure),
    geometry.labelSize({ name: menu.name }, measure),
  ];
  return geometry.layoutArc({
    cx: bud.x, cy: bud.y, r: BLOOM.r2, d: BLOOM.bud2, step: BLOOM.step2, prefer: bud.a,
    labels: names.map((name) => ({ name, sub: "" })), field, obstacles, discs,
    segs: [{ a: P, b: { x: bud.x, y: bud.y } }],
    extra: { x: bud.x, y: bud.y, d: BLOOM.bud1, natural: bud.label, short: bud.short, sizes },
    measure,
  });
}

const layout = (l) => ({
  theta: round(l.theta),
  turn: l.turn,
  step: round(l.step),
  kept: l.kept,
  cost: round(l.cost),
  items: l.items.map((it) => ({ x: round(it.x), y: round(it.y), a: round(it.a), label: box(it.label), short: it.short })),
});

const rings = [];
for (const [menuName, menu] of Object.entries(menus)) {
  for (const [x, y] of holds) {
    const P = { x, y };
    const one = ringOne(P, menu);
    one.menu = menu;
    const entry = { menu: menuName, hold: P, one: layout(one), two: [] };
    menu.forEach((m, i) => {
      if (m.profiles < 2) return;
      const names = ["Default", "Work", "Personal"].slice(0, m.profiles);
      entry.two.push({ open: i, names, layout: layout(ringTwo(P, one, i, names)) });
    });
    rings.push(entry);
  }
}

// what a pointer targets, on the centre hold's three-desktop bloom: closed,
// then with the first desktop open and its ring settled
const P = { x: 201, y: 437 };
const one = ringOne(P, menus.three);
one.menu = menus.three;
const two = ringTwo(P, one, 0, ["Default", "Work"]);
const closed = { P, l1: one.items.map((it, i) => ({ a: it.a, item: { kind: "device", i } })), l1step: one.step, l2: [], l2step: BLOOM.step2, open: null };
const opened = {
  ...closed,
  l2: two.items.map((it, i) => ({ a: it.a, item: { kind: "profile", i } })),
  l2step: two.step,
  // the open desktop is the SAME item as its bud (targeting compares items by identity)
  open: { item: closed.l1[0].item, pos: { x: one.items[0].x, y: one.items[0].y }, readyAt: 0 },
};
const points = [];
for (const [dx, dy] of [[0, 0], [10, -10], [0, -40]]) points.push({ x: P.x + dx, y: P.y + dy });
for (const it of one.items) {
  for (const r of [BLOOM.r1 - BLOOM.reach, BLOOM.r1, BLOOM.r1 + 50, BLOOM.r1 + 80]) {
    points.push(geometry.polar(P.x, P.y, r, it.a));
  }
  points.push(geometry.polar(P.x, P.y, BLOOM.r1, it.a + 20));
}
points.push(geometry.polar(P.x, P.y, BLOOM.r1, 90));
for (const it of two.items) {
  points.push(geometry.polar(one.items[0].x, one.items[0].y, BLOOM.r2, it.a));
  points.push(geometry.polar(one.items[0].x, one.items[0].y, BLOOM.r2 + 30, it.a + 10));
}
const word = (r) => ({
  collapse: !!r.collapse,
  kind: r.t.kind,
  index: r.t.item?.i ?? null,
});
const targets = points.map((p) => ({
  // the point exactly as asked: a point on a spoke can tie two buds, and only the same bits break it the same way
  point: { x: p.x, y: p.y },
  closed: word(resolveTarget(closed, p, 10)),
  open: word(resolveTarget(opened, p, 10)),
}));

process.stdout.write(
  `${JSON.stringify(
    {
      "//": `PJ-7 — the spawn bloom's reference numbers on the phone's 402 × 874 pt field, from puppeteer ${revision}'s views/swarm/bloom (constants, geometry, targeting). Generated by apps/ios/scripts/spawn-bloom-goldens.mjs — regenerate, never edit.`,
      reference: revision,
      field,
      chrome,
      menus,
      rings,
      targets,
    },
    null,
    2,
  )}\n`,
);
