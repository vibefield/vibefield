import type {
  MonitorSpawnFuel,
  MonitorSpawnFuelArc,
  MonitorSpawnFuelDrawing,
  MonitorSpawnFuelNotch,
  MonitorSpawnFuelTone,
} from "@vibefield/puppeteer-view-sdk";
import {
  agedWords,
  type BandsArc,
  type BandsGeometry,
  type BandsNotch,
  type BandsPaint,
  bandsGeometry,
  bandsLabel,
  bandsPlanWords,
  bandsReadingWords,
  decidingPlan,
  round2,
} from "./bands";
import { needsYou, type PlanMeter, type ProfileMeters } from "./meters";

// PU-R (UM-D7: the picks of 2026-11-09 and 2026-11-11, DESIGN.md §8 "Hold, reach, let go" and §9 "The spawn bloom's
// words") — A SPAWN BLOOM BUD'S FUEL, PURE: a profile's bud wears its Bands circle at the bud's own size, drawn here
// by the column's own geometry (`bandsGeometry`, nothing in its middle) and handed to the bloom as strokes
// (puppeteer-views' `MonitorSpawnFuel.drawn`), which paints them as handed. Nothing here draws SVG or names a colour:
// the bloom builds the paths and paints the two tones it is handed, its fuel ink and the swarm's orange. The sizes are
// the caller's (the bloom's `BLOOM.bud1` and `bud2`, 48 and 42), so this file holds no puppeteer value.
//
// b2 "dash", at its lean: a plan that needs you is the column's dashed thread, and so is each plan of a profile whose
// usage cannot be read (the retry's, at 38%: f2 "38"); a first read and a profile with no meters keep the plain bud, as
// nothing in the bloom breathes. None of the bloom's older one-arc fields is handed.

/** A circle of the stage's profiles column: a profile and its meters (`columnCircles`). */
export interface FuelCircle {
  set: { id: string };
  meters: ProfileMeters;
}

/** Each profile's fuel, by its set's id: one entry per circle the column draws (a draft with no circle has none). */
export function spawnFuelMap(
  circles: readonly FuelCircle[],
  sizes: readonly number[],
): ReadonlyMap<string, MonitorSpawnFuel> {
  return new Map(
    circles.map((circle) => [circle.set.id, spawnFuelOf(circle.meters.entries, sizes)] as const),
  );
}

/** One profile's fuel: its words, and its circle drawn at each size when it has one to draw. */
export function spawnFuelOf(
  entries: readonly PlanMeter[],
  sizes: readonly number[],
): MonitorSpawnFuel {
  const word = spawnWordOf(entries);
  const drawing = drawnOf(entries);
  if (drawing === undefined || sizes.length === 0) return { word };
  return {
    word,
    drawn: sizes.map((size) => drawnBands(bandsGeometry(size, drawing, { centre: "none" }))),
  };
}

/** What the bud draws (b2's lean), or nothing: a plan that reads or needs you is drawn as the column draws it; every
 * plan a first read is plain; with nothing on the circle, a profile whose usage cannot be read draws each such plan as
 * a retry, and one with no meters is plain. */
function drawnOf(entries: readonly PlanMeter[]): readonly PlanMeter[] | undefined {
  const onCircle = entries.filter((entry) => entry.kind !== "no-meter");
  if (onCircle.some((entry) => entry.kind === "reading" || entry.kind === "needs-you")) {
    return entries;
  }
  if (onCircle.length > 0) return undefined;
  if (!entries.some(unavailable)) return undefined;
  return entries.map((entry) => {
    if (!unavailable(entry)) return entry;
    const { kind: _kind, why: _why, ...base } = entry;
    return needsYou(base, "retry");
  });
}

const unavailable = (entry: PlanMeter): entry is Extract<PlanMeter, { kind: "no-meter" }> =>
  entry.kind === "no-meter" && entry.why === "unavailable";

/** The bud's line (§9 "The spawn bloom's words"): its deciding plan's reading, "Claude Max: 64% of 5 hours", with its
 * age when it says one ("…, as of 5m ago") and never a forecast or a reset; else the column's words for that plan;
 * with nothing on the circle, "usage unavailable" or "No meters". */
export function spawnWordOf(entries: readonly PlanMeter[]): string {
  const top = decidingPlan(entries.filter((entry) => entry.kind !== "no-meter"));
  if (top === undefined)
    return entries.some(unavailable) ? "usage unavailable" : bandsLabel(entries);
  if (top.kind !== "reading") return bandsPlanWords(top);
  const age = agedWords(top);
  return age === "" ? bandsReadingWords(top) : `${bandsReadingWords(top)}, ${age}`;
}

/** The bloom's tone for a paint, when it is one the bloom paints: its ink or the orange. At the bud's level no lit head
 * (`light`) is drawn and the attention ink marks only words and marks; a guard drops either all the same. */
function toneOf(paint: BandsPaint): { tone: MonitorSpawnFuelTone; percent: number } | undefined {
  return paint.tone === "ink" || paint.tone === "hot"
    ? { tone: paint.tone, percent: round2(paint.percent) }
    : undefined;
}

function arcOf(arc: BandsArc): MonitorSpawnFuelArc | undefined {
  // a first read's breath is the column's motion; the bloom has none, so its span stays empty
  if (arc.part === "breath") return undefined;
  const tone = toneOf(arc.paint);
  if (tone === undefined) return undefined;
  return {
    r: round2(arc.r),
    width: round2(arc.width),
    from: round2(arc.from),
    to: round2(arc.to),
    ...tone,
    opacity: round2(arc.opacity),
    cap: arc.cap,
    ...(arc.dash !== undefined
      ? { dash: [round2(arc.dash[0]), round2(arc.dash[1])] as const }
      : {}),
  };
}

function notchOf(notch: BandsNotch): MonitorSpawnFuelNotch | undefined {
  const tone = toneOf(notch.paint);
  if (tone === undefined) return undefined;
  return {
    x1: round2(notch.x1),
    y1: round2(notch.y1),
    x2: round2(notch.x2),
    y2: round2(notch.y2),
    width: round2(notch.width),
    ...tone,
    opacity: round2(notch.opacity),
  };
}

/** A Bands circle as the bloom takes it: its size, the arcs of every plan, then the notches of every plan, each in the
 * plans' order (the column draws a plan's arcs, then its notches; no two plans' strokes meet, so the picture is the
 * same). The empty ring and the hot dot are never handed: a bud with nothing to read is plain, and its top right is
 * the blocked dot. */
export function drawnBands(g: BandsGeometry): MonitorSpawnFuelDrawing {
  const arcs = g.plans.flatMap((plan) =>
    plan.arcs.flatMap((arc) => {
      const handed = arcOf(arc);
      return handed === undefined ? [] : [handed];
    }),
  );
  const notches = g.plans.flatMap((plan) =>
    plan.notches.flatMap((notch) => {
      const handed = notchOf(notch);
      return handed === undefined ? [] : [handed];
    }),
  );
  return { size: g.size, arcs, notches };
}
