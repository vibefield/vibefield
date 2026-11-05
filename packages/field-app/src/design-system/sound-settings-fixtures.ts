import type { SoundSettingsModel } from "../panels/sound/SoundSettings";

// SD-2 — Settings → Sound's catalog fixtures (docs/UI_SYSTEM.md): the page's model in every state it can be in, for
// the shipping view to wear. Play sounds on, Quiet holding, off, and the player's three reasons it cannot play.

export const SOUND_FIXTURE_STATES = [
  "on",
  "quiet",
  "off",
  "unsupported",
  "missing",
  "failed",
] as const;
export type SoundFixtureState = (typeof SOUND_FIXTURE_STATES)[number];

export function soundSettingsFixture(state: SoundFixtureState): SoundSettingsModel {
  switch (state) {
    case "on":
      return { on: true, player: "ready" };
    case "quiet":
      return { on: true, player: "ready", quietUntilText: "8:00 AM" };
    case "off":
      return { on: false, player: "ready" };
    default:
      return { on: true, player: state };
  }
}
