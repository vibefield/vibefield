import { APP_PREFERENCE_KEYS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_PREFERENCES, effectiveAppPreferences } from "../src/app-preferences";

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
    ).toEqual({ showTray: false, backgroundShell: true });
  });
});
