import { describe, expect, it } from "vitest";
import { assertDataRootUsable } from "../src/paths";
import { SupervisorError } from "../src/types";

// 2026-08-05 regression (the live dev root): the guard measured only
// mgmt.sock — the SHORTEST socket name in LAYOUT — so a users/<fuid> root
// passed the check while field-native's bind of terminal-control.sock (12
// bytes longer) failed silently and the terminal plane crashed. The guard
// now walks every socket-bearing LAYOUT row at the true macOS limit
// (103 = sizeof sun_path − NUL); these fixtures pin the LONGEST-socket
// behavior byte-exactly.

/** A root of exactly `n` bytes. Socket suffixes under it, longest first:
 * /native/run/termframe.sock = 26 · /native/run/meshdata.sock = 25 ·
 * /native/run/termctl.sock = 24 · /native/run/mgmt.sock = 21. */
const rootOf = (n: number): string => `/tmp/${"x".repeat(n - 5)}`;

describe("the sun_path guard measures the LONGEST socket", () => {
  it("a root where ONLY the longest socket overflows refuses, naming it", () => {
    // 78 + 26 = 104 > 103 for termframe.sock; every other socket fits —
    // exactly the class of root the old shortest-name check waved through
    const root = rootOf(78);
    let caught: unknown = null;
    try {
      assertDataRootUsable(root);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SupervisorError);
    expect((caught as SupervisorError).kind).toBe("data-root-too-long");
    expect((caught as SupervisorError).message).toContain("termframe.sock");
  });

  it("a root at the exact ceiling for the longest socket passes", () => {
    expect(() => assertDataRootUsable(rootOf(77))).not.toThrow(); // termframe → 103
  });
});
