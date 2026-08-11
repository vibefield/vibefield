import { APP_PREFERENCE_KEYS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_PREFERENCES,
  effectiveAppPreferences,
  resolveSyncIntent,
} from "../src/app-preferences";

describe("app preferences", () => {
  it("owns one canonical set of effective defaults", () => {
    expect(effectiveAppPreferences({})).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it("accepts only booleans from the tolerant settings document", () => {
    expect(
      effectiveAppPreferences({
        [APP_PREFERENCE_KEYS.SHOW_TRAY]: false,
        [APP_PREFERENCE_KEYS.BACKGROUND_SHELL]: "not-a-boolean",
        futureKey: 42,
      }),
    ).toEqual({ showTray: false, backgroundShell: true, syncPosture: "automatic" });
  });

  it("reads the sync posture, and refuses a word that is not one", () => {
    expect(
      effectiveAppPreferences({ [APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE]: "opt-in" }).syncPosture,
    ).toBe("opt-in");
    // A settings document written by a newer build (or a corrupted one) must
    // not be able to move the posture somewhere neither side has a rule for.
    expect(
      effectiveAppPreferences({ [APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE]: "paranoid" }).syncPosture,
    ).toBe("automatic");
  });

  it("resolves intent: the doc answers for itself, silence defers to the posture", () => {
    // UA-6's whole zero-behavior-change claim rests on the last line here.
    expect(resolveSyncIntent("local", "automatic")).toBe("local");
    expect(resolveSyncIntent("sync", "opt-in")).toBe("sync");
    expect(resolveSyncIntent(undefined, "opt-in")).toBe("local");
    expect(resolveSyncIntent(undefined, "automatic")).toBe("sync");
  });
});
