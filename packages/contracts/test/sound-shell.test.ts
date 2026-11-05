import { describe, expect, it } from "vitest";
import {
  APP_PREFERENCE_KEYS,
  AppPreferenceSetParams,
  AppPreferences,
  SOUND_ATTENTION,
  SoundAttention,
  SoundPlayerState,
  SoundPreviewParams,
  SoundPreviewResult,
} from "../src/shell";

// SD-2 (DESIGN.md §14 "Where it plays", §8 "Settings → Sound") — the wire under the desktop's sound: two preferences
// on the person's settings doc (Play sounds, Quiet), and the three shapes the window and main trade (where the
// window's agents are, a Play in Settings, the player's state).

const OLDER_SNAPSHOT = {
  showTray: true,
  backgroundShell: true,
  syncPosture: "automatic",
};

describe("the two sound preferences (SD-D19, SD-D22)", () => {
  it("are keyed on the desktop's own section", () => {
    expect(APP_PREFERENCE_KEYS.SOUNDS).toBe("desktop.sounds");
    expect(APP_PREFERENCE_KEYS.SOUNDS_QUIET_UNTIL).toBe("desktop.soundsQuietUntil");
  });
  it("read an older daemon's snapshot as on and never quiet: both are optional on the wire", () => {
    const read = AppPreferences.parse(OLDER_SNAPSHOT);
    expect(read.sounds).toBe(true);
    expect(read.soundsQuietUntil).toBeUndefined();
  });
  it("carry Quiet as the moment it ends, in epoch milliseconds", () => {
    const until = Date.UTC(2026, 10, 5, 16, 0);
    expect(
      AppPreferences.parse({ ...OLDER_SNAPSHOT, soundsQuietUntil: until }).soundsQuietUntil,
    ).toBe(until);
    for (const bad of [-1, 1.5, "tomorrow", Number.POSITIVE_INFINITY]) {
      expect(
        AppPreferences.safeParse({ ...OLDER_SNAPSHOT, soundsQuietUntil: bad }).success,
        String(bad),
      ).toBe(false);
    }
  });
  it("are set by key: Play sounds a switch, Quiet a moment or null to end it", () => {
    const ok = (key: string, value: unknown) =>
      AppPreferenceSetParams.safeParse({ key, value }).success;
    expect(ok(APP_PREFERENCE_KEYS.SOUNDS, false)).toBe(true);
    expect(ok(APP_PREFERENCE_KEYS.SOUNDS, 1)).toBe(false);
    expect(ok(APP_PREFERENCE_KEYS.SOUNDS, null)).toBe(false);
    expect(ok(APP_PREFERENCE_KEYS.SOUNDS_QUIET_UNTIL, Date.UTC(2026, 10, 6, 8))).toBe(true);
    expect(ok(APP_PREFERENCE_KEYS.SOUNDS_QUIET_UNTIL, null)).toBe(true);
    expect(ok(APP_PREFERENCE_KEYS.SOUNDS_QUIET_UNTIL, true)).toBe(false);
    expect(ok(APP_PREFERENCE_KEYS.SOUNDS_QUIET_UNTIL, -1)).toBe(false);
    expect(ok(APP_PREFERENCE_KEYS.SOUNDS_QUIET_UNTIL, 2.5)).toBe(false);
    expect(ok(APP_PREFERENCE_KEYS.SOUNDS_QUIET_UNTIL, "automatic")).toBe(false);
  });
  it("widen nothing for the other keys: a switch still takes a switch, and only a switch", () => {
    const ok = (key: string, value: unknown) =>
      AppPreferenceSetParams.safeParse({ key, value }).success;
    expect(ok(APP_PREFERENCE_KEYS.SHOW_TRAY, null)).toBe(false);
    expect(ok(APP_PREFERENCE_KEYS.SHOW_TRAY, 3)).toBe(false);
    expect(ok(APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE, 3)).toBe(false);
    expect(ok(APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE, null)).toBe(false);
  });
});

describe("the window's attention (SD-D11, SD-D12)", () => {
  it("names the floor session typed into and where each shown session sits, −1 (left) … 1 (right)", () => {
    expect(
      SoundAttention.safeParse({ focused: "sess-1", places: { "sess-1": -0.4, "sess-2": 0.6 } })
        .success,
    ).toBe(true);
    expect(SoundAttention.safeParse({ focused: null, places: {} }).success).toBe(true);
  });
  it("refuses a place off the window, an empty or overlong id, and more places than a window shows", () => {
    expect(SoundAttention.safeParse({ focused: null, places: { s: 1.2 } }).success).toBe(false);
    expect(SoundAttention.safeParse({ focused: "", places: {} }).success).toBe(false);
    expect(
      SoundAttention.safeParse({ focused: "x".repeat(SOUND_ATTENTION.MAX_ID + 1), places: {} })
        .success,
    ).toBe(false);
    const many = Object.fromEntries(
      Array.from({ length: SOUND_ATTENTION.MAX_PLACES + 1 }, (_, i) => [`s${i}`, 0]),
    );
    expect(SoundAttention.safeParse({ focused: null, places: many }).success).toBe(false);
    expect(SOUND_ATTENTION.MAX_PLACES).toBe(64);
  });
});

describe("a Play in Settings → Sound", () => {
  it("plays one of the family, never the mark (SD-D18: first launch and setup's end only)", () => {
    for (const cue of ["failed", "done", "question", "approval", "settle"]) {
      expect(SoundPreviewParams.safeParse({ cue }).success, cue).toBe(true);
    }
    expect(SoundPreviewParams.safeParse({ cue: "mark" }).success).toBe(false);
    expect(SoundPreviewParams.safeParse({ cue: "bell" }).success).toBe(false);
  });
  it("answers played, or why not", () => {
    expect(SoundPreviewResult.safeParse({ played: true }).success).toBe(true);
    for (const reason of ["off", "unavailable", "failed"]) {
      expect(SoundPreviewResult.safeParse({ played: false, reason }).success, reason).toBe(true);
    }
    expect(SoundPreviewResult.safeParse({ played: false, reason: "quiet" }).success).toBe(false);
  });
});

describe("the player's state (§8: never a switch that silently does nothing)", () => {
  it("is ready, or says which of three reasons it is not", () => {
    expect(SoundPlayerState.options).toEqual(["ready", "unsupported", "missing", "failed"]);
  });
});
