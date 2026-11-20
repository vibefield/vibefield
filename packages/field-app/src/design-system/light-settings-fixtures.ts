import { type DeskLightValues, deskLightValues } from "@vibefield/contracts";

// Item 583 — Settings → Canvas's Light, the catalog's fixtures (docs/UI_SYSTEM.md): the section's rows in the states
// it can be in, for the shipping view to wear. A desk nobody touched; a person's own light; the bare mat; under the
// Moon (Shade and Tint rest); under Reduce motion (Wind rests); and a snapshot that cannot be written.

export const LIGHT_FIXTURE_STATES = [
  "rest",
  "chosen",
  "none",
  "moon",
  "reduced-motion",
  "read-only",
] as const;
export type LightFixtureState = (typeof LIGHT_FIXTURE_STATES)[number];

export interface LightFixture {
  readonly values: DeskLightValues;
  readonly theme: "light" | "dark";
  readonly reducedMotion: boolean;
  readonly writable: boolean;
}

const REST = deskLightValues(undefined);

export function lightSettingsFixture(state: LightFixtureState): LightFixture {
  const base: LightFixture = { values: REST, theme: "light", reducedMotion: false, writable: true };
  switch (state) {
    case "rest":
      return base;
    case "chosen":
      return {
        ...base,
        values: { ...REST, plant: "fan-palm", mirror: true, softness: 1.5, shade: 0.6, wind: 0.5 },
      };
    case "none":
      return { ...base, values: { ...REST, plant: "none" } };
    case "moon":
      return { ...base, theme: "dark" };
    case "reduced-motion":
      return { ...base, reducedMotion: true };
    case "read-only":
      return { ...base, writable: false };
  }
}
