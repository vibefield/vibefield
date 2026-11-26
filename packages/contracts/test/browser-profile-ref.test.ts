import { describe, expect, it } from "vitest";
import {
  BROWSER_DESK_PROFILE_REF,
  BROWSER_PROFILE_REF_PATTERN,
  BROWSER_PROFILES_MAX,
  BrowserProfileRefSchema,
  isBrowserProfileRef,
  LiveSurfaceBrowserSourceV1,
} from "../src/live-surfaces";
import { PAGES_RUN_PROFILE_PREFIX } from "../src/pages";
import { BrowserDataClearResult } from "../src/shell";

// BP-D10 (2026-11-25) — a person's browser profile has one id shape: the desk's, or `p-` and 16 to 32 of [a-z0-9].
// Opaque, never a label, never a run's session.

const id = (length: number) => `p-${"a1".repeat(length).slice(0, length)}`;

describe("BP-D10 — a browser profile's id has one shape", () => {
  it("takes the desk's profile and a well-formed id at both length bounds", () => {
    for (const good of [BROWSER_DESK_PROFILE_REF, "desk", id(16), id(32), `p-${"0".repeat(20)}`]) {
      expect(isBrowserProfileRef(good), good).toBe(true);
      expect(BrowserProfileRefSchema.parse(good)).toBe(good);
    }
  });

  it("refuses every other shape: empty, a cased desk, a run's session, the bounds' neighbours, a path, a space, a look-alike", () => {
    for (const bad of [
      "",
      "Desk",
      "DESK",
      "desk ",
      " desk",
      "desk\n",
      "run:abc",
      `${PAGES_RUN_PROFILE_PREFIX}${id(16)}`,
      `${PAGES_RUN_PROFILE_PREFIX}desk`,
      "p-",
      id(15),
      id(33),
      `p-${"A".repeat(16)}`,
      `P-${"a".repeat(16)}`,
      `p-${"a".repeat(8)}/${"a".repeat(8)}`,
      `p-${"a".repeat(8)}\\${"a".repeat(8)}`,
      "../x",
      "..",
      `p-${"a".repeat(14)}..`,
      `p-${"a".repeat(8)} ${"a".repeat(8)}`,
      `p-${"a".repeat(16)}\t`,
      `p_${"a".repeat(16)}`,
      `p-${"a".repeat(15)}а`, // Cyrillic a
      "dеsk", // Cyrillic e
      `р-${"a".repeat(16)}`, // Cyrillic er, a look-alike p
      `p-${"a".repeat(15)}é`,
    ]) {
      expect(isBrowserProfileRef(bad), JSON.stringify(bad)).toBe(false);
      expect(BrowserProfileRefSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("can never begin with a run's session prefix, and the predicate keeps no state between calls", () => {
    expect(PAGES_RUN_PROFILE_PREFIX.length).toBeGreaterThan(0);
    expect(BROWSER_PROFILE_REF_PATTERN.flags).not.toContain("g");
    expect(BROWSER_PROFILE_REF_PATTERN.flags).not.toContain("y");
    for (let i = 0; i < 3; i += 1) expect(isBrowserProfileRef(id(20))).toBe(true);
    expect(isBrowserProfileRef(`${PAGES_RUN_PROFILE_PREFIX}x`)).toBe(false);
  });

  it("caps a person's list at 64, the most a Clear may say it cleared", () => {
    expect(BROWSER_PROFILES_MAX).toBe(64);
    expect(
      BrowserDataClearResult.safeParse({ profiles: BROWSER_PROFILES_MAX, pages: 0 }).success,
    ).toBe(true);
    expect(
      BrowserDataClearResult.safeParse({ profiles: BROWSER_PROFILES_MAX + 1, pages: 0 }).success,
    ).toBe(false);
  });

  it("leaves the wire's profile.ref as tolerant as before: a run's session, a probe's ref and a persistent ref of another shape all parse", () => {
    const source = {
      kind: "browser",
      initialUrl: "https://example.test/",
      logicalViewport: { width: 320, height: 180 },
    };
    for (const profile of [
      { mode: "memory", ref: "run:r1" },
      { mode: "memory", ref: "live-surfaces-browser-lab" },
      { mode: "persistent", ref: "desk" },
      { mode: "persistent", ref: "private profile name" },
    ])
      expect(LiveSurfaceBrowserSourceV1.safeParse({ ...source, profile }).success).toBe(true);
  });
});
