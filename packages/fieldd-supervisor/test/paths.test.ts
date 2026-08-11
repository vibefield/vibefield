import { pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { assertDataRootUsable, nativeMgmtEndpoint, nativeSocketPath } from "../src/paths";
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

// WIN-D1 — the supervisor's half of the endpoint-resolution law. fieldd derives
// the same name from the same root in fieldd/src/boot-env.ts; the two must not
// drift, so both suites assert against the contracts derivation rather than
// against a literal.
describe("nativeMgmtEndpoint resolves per platform, not per filesystem", () => {
  it("joins the LAYOUT path on unix — byte-for-byte the pre-Windows behavior", () => {
    expect(nativeMgmtEndpoint("/data/vf", "darwin")).toBe("/data/vf/native/run/mgmt.sock");
  });

  it("derives the scoped pipe name on win32, where no socket file exists", () => {
    const root = "C:\\Users\\me\\AppData\\Roaming\\VibeField";
    expect(nativeMgmtEndpoint(root, "win32")).toBe(pipeEndpointFor(root, SOCKETS.MGMT));
  });

  it("still answers to its pre-pipe name, which is now an alias", () => {
    expect(nativeSocketPath("/data/vf", "darwin")).toBe(nativeMgmtEndpoint("/data/vf", "darwin"));
  });
});
