import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_PREFERENCE_KEYS,
  AppPreferenceSetParams,
  AppPreferences,
  DESK_LIGHT,
  DESK_LIGHT_SLIDERS,
  DeskLight,
  DeskLightPlant,
  DeskLightSet,
  deskLightToSet,
  deskLightValues,
} from "../src/shell";

// Item 583 (DESIGN.md §8 "Settings → Canvas") — the desk's light as one app preference: what the person set, row by
// row, and every other row at its rest.

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", name), "utf8"));
const RESTING = {
  plant: "monstera",
  mirror: false,
  softness: 1,
  shade: 0.7,
  tint: 0.2,
  size: 1,
  wind: 1,
};
const takes = (key: string, value: unknown) =>
  AppPreferenceSetParams.safeParse({ key, value }).success;

describe("the desk's light (583)", () => {
  it("is one key, on the desk's own section", () => {
    expect(APP_PREFERENCE_KEYS.DESK_LIGHT).toBe("desk.light");
  });

  it("names its plants by ids that are stored, so the list only ever grows at its end", () => {
    expect(DeskLightPlant.options).toEqual([
      "none",
      "monstera",
      "climbing-monstera",
      "fan-palm",
      "coconut-palm",
      "under-the-palm",
      "palm",
      "canopy",
    ]);
  });

  it("rests inside every slider's range, and a desk nobody touched wears the rests", () => {
    for (const row of DESK_LIGHT_SLIDERS) {
      const { min, max, rest } = DESK_LIGHT[row];
      expect(min, row).toBeLessThan(max);
      expect(rest, row).toBeGreaterThanOrEqual(min);
      expect(rest, row).toBeLessThanOrEqual(max);
    }
    expect(deskLightValues(undefined)).toEqual(RESTING);
    expect(deskLightValues({})).toEqual(RESTING);
  });

  it("reads an older daemon's snapshot as every row at its rest: the key is optional on the wire", () => {
    const read = AppPreferences.parse(fixture("app-preferences.older-daemon.json"));
    expect(read.deskLight).toBeUndefined();
    expect(deskLightValues(read.deskLight)).toEqual(RESTING);
  });

  it("carries what the person set in the snapshot, and fills the other rows", () => {
    const read = AppPreferences.parse(fixture("app-preferences.desk-light.json"));
    expect(read.deskLight).toEqual({ plant: "fan-palm", mirror: true, softness: 1.5, wind: 0 });
    expect(deskLightValues(read.deskLight)).toEqual({
      ...RESTING,
      plant: "fan-palm",
      mirror: true,
      softness: 1.5,
      wind: 0,
    });
  });

  it("reads a snapshot row by row: a row it cannot hold is dropped, the others and the snapshot stand", () => {
    const newer = {
      plant: "oak",
      mirror: "yes",
      softness: 9,
      shade: 0.6,
      tint: Number.NaN,
      glow: 3,
    };
    const read = DeskLight.parse(newer);
    expect(read.plant).toBeUndefined();
    expect(read.mirror).toBeUndefined();
    expect(read.softness).toBeUndefined();
    expect(read.tint).toBeUndefined();
    expect(read.shade).toBe(0.6);
    expect(deskLightValues(read)).toEqual({ ...RESTING, shade: 0.6 });
    const whole = AppPreferences.safeParse({
      ...(fixture("app-preferences.older-daemon.json") as object),
      deskLight: newer,
    });
    expect(whole.success).toBe(true);
  });

  it("is set as its rows, or null to clear them; the setter refuses what the light cannot hold", () => {
    const key = APP_PREFERENCE_KEYS.DESK_LIGHT;
    expect(takes(key, { plant: "palm" })).toBe(true);
    expect(
      takes(key, { mirror: true, softness: 0.5, shade: 0.9, tint: 0, size: 1.6, wind: 0 }),
    ).toBe(true);
    expect(takes(key, {})).toBe(true);
    expect(takes(key, null)).toBe(true);
    for (const bad of [
      true,
      3,
      "monstera",
      { plant: "oak" },
      { mirror: 1 },
      { softness: 2.01 },
      { shade: 0.5 },
      { wind: -0.1 },
      { glow: 3 },
      [],
    ]) {
      expect(takes(key, bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("widens nothing for the other keys: none of them takes the light's rows", () => {
    for (const other of [
      APP_PREFERENCE_KEYS.SHOW_TRAY,
      APP_PREFERENCE_KEYS.SOUNDS,
      APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE,
      APP_PREFERENCE_KEYS.SOUNDS_QUIET_UNTIL,
      APP_PREFERENCE_KEYS.COMMUNITY_PLUGINS,
    ]) {
      expect(takes(other, { mirror: true }), other).toBe(false);
      expect(takes(other, {}), other).toBe(false);
    }
  });

  it("stores only the rows off their rest, and nothing at all when every row rests", () => {
    expect(deskLightToSet(deskLightValues(undefined))).toBeNull();
    const worn = { ...deskLightValues(undefined), plant: "canopy" as const, shade: 0.6, wind: 0 };
    const set = deskLightToSet(worn);
    expect(set).toEqual({ plant: "canopy", shade: 0.6, wind: 0 });
    expect(DeskLightSet.safeParse(set).success).toBe(true);
    expect(deskLightValues(set ?? undefined)).toEqual(worn);
    // a row moved back to its rest leaves the stored value
    expect(deskLightToSet({ ...worn, plant: "monstera", shade: 0.7 })).toEqual({ wind: 0 });
  });
});
