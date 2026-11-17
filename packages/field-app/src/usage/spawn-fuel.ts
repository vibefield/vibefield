import type { MonitorSpawnFuel, MonitorSpawnFuelDrawing } from "@vibefield/puppeteer-view-sdk";
import type { BandsGeometry } from "./bands";
import type { PlanMeter, ProfileMeters } from "./meters";

// PU-R (UM-D7: the picks of 2026-11-09 and 2026-11-11, DESIGN.md §8 "Hold, reach, let go" and §9 "The spawn bloom's
// words") — A SPAWN BLOOM BUD'S FUEL, PURE. RED: the signatures alone, so the rows compile and fail; the green commit
// draws the circle and says the words.

/** A circle of the stage's profiles column: a profile and its meters (`columnCircles`). */
export interface FuelCircle {
  set: { id: string };
  meters: ProfileMeters;
}

/** Each profile's fuel, by its set's id. RED: none. */
export function spawnFuelMap(
  _circles: readonly FuelCircle[],
  _sizes: readonly number[],
): ReadonlyMap<string, MonitorSpawnFuel> {
  return new Map();
}

/** One profile's fuel. RED: nothing. */
export function spawnFuelOf(
  _entries: readonly PlanMeter[],
  _sizes: readonly number[],
): MonitorSpawnFuel {
  return {};
}

/** The bud's line. RED: none. */
export function spawnWordOf(_entries: readonly PlanMeter[]): string {
  return "";
}

/** A Bands circle as the bloom takes it. RED: no strokes. */
export function drawnBands(g: BandsGeometry): MonitorSpawnFuelDrawing {
  return { size: g.size, arcs: [], notches: [] };
}
