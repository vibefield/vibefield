import { describe, expect, it } from "vitest";
import {
  APP_PREFERENCE_KEYS,
  APP_PREFERENCE_SET_EXPECTED,
  AppPreferenceKey,
  AppPreferenceSetParams,
  MeshSyncPosture,
} from "../src/shell";

// Item 436 — the preferences setter's refusal names every key it takes, with the kind of value
// its check holds each to, from the same list: a key added to `AppPreferenceKey` is in it that day.

/** The refusal read back: each key it names, and the kind it says for that key. */
function namedKinds(text: string): Map<string, string> {
  const body = text.replace(/^expected \{ key: /, "").replace(/ \}$/, "");
  const kinds = new Map<string, string>();
  for (const part of body.split(" | ")) {
    const at = part.lastIndexOf(" (");
    const kind = part.slice(at + 2, -1);
    for (const key of part.slice(0, at).split("|")) {
      expect(kinds.has(key)).toBe(false);
      kinds.set(key, kind);
    }
  }
  return kinds;
}

const takes = (key: string, value: unknown) =>
  AppPreferenceSetParams.safeParse({ key, value }).success;

describe("the preferences setter's refusal (item 436)", () => {
  it("names every key the setter takes, once, and no other", () => {
    const kinds = namedKinds(APP_PREFERENCE_SET_EXPECTED);
    expect([...kinds.keys()].sort()).toEqual([...AppPreferenceKey.options].sort());
    expect(kinds.get(APP_PREFERENCE_KEYS.COMMUNITY_PLUGINS)).toBe("boolean");
  });

  it("says for each key the kind of value the setter's own check takes", () => {
    for (const [key, kind] of namedKinds(APP_PREFERENCE_SET_EXPECTED)) {
      if (kind === "boolean") {
        expect([takes(key, true), takes(key, "automatic"), takes(key, null)]).toEqual([
          true,
          false,
          false,
        ]);
      } else if (kind === MeshSyncPosture.options.join("|")) {
        for (const posture of MeshSyncPosture.options) expect(takes(key, posture)).toBe(true);
        expect(takes(key, true)).toBe(false);
      } else {
        expect(kind).toBe("epoch ms or null");
        expect([takes(key, 0), takes(key, null), takes(key, true)]).toEqual([true, true, false]);
      }
    }
  });
});
