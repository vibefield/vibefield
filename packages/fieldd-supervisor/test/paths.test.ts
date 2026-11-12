import { pipeEndpointFor, SOCKETS, unixEndpointFor } from "@vibefield/contracts";
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
 * /native/run/termctl.sock = 24 · /native/run/mgmt.sock = 21.
 * > Correction (2026-11-12, item 345): those are the bare LAYOUT names; the cells' are longer. The worst real suffix
 * > is /native/run/termframe.4294967295.sock = 37, so n ≤ 66 keeps today's path and n ≥ 67 takes the alias. */
const rootOf = (n: number): string => `/tmp/${"x".repeat(n - 5)}`;

// The platform is passed EXPLICITLY here, never left to the host: sun_path is a
// unix law (WIN-D1 — win32 endpoints are pipes, with no byte budget to blow), so
// on a Windows host the argument-less call takes the guard's early return and
// these rows would assert nothing while still reporting green. Naming the
// platform is what makes both arms provable from either machine — the same
// discipline the endpoint rows below already used.
const uid = process.getuid?.() ?? 0;

// Item 345 (2026-11-12): the guard measured LAYOUT's bare `termframe.sock` and called it "the LONGEST socket", but
// the cells bind `termframe.<N>.sock`. A root that passed it could hold no cell (the `fresh` dev root: 103 measured,
// 105 bound). The law now sends a root whose worst real path overflows through `/tmp/vf-<uid>/<scope>`, and the guard
// measures the worst endpoint the law binds (PLAN-345-r2).
describe("the sun_path guard measures the worst endpoint the law binds", () => {
  it("a root whose real worst overflows is usable: every socket rides the alias", () => {
    // was, until 2026-11-12: this 78-byte root refused, naming termframe.sock
    const root = rootOf(78);
    expect(() => assertDataRootUsable(root, "darwin")).not.toThrow();
    expect(nativeMgmtEndpoint(root, "darwin")).toBe(unixEndpointFor(uid, root, SOCKETS.MGMT));
    expect(nativeMgmtEndpoint(root, "darwin").startsWith(`/tmp/vf-${uid}/`)).toBe(true);
  });

  it("item 345's fresh shape (termframe.sock 103, termframe.1.sock 105) rides the alias, not a dead floor", () => {
    expect(nativeMgmtEndpoint(rootOf(77), "darwin").startsWith(`/tmp/vf-${uid}/`)).toBe(true);
  });

  it("the edge: a worst real path of 103 keeps today's path, 104 takes the alias", () => {
    expect(nativeMgmtEndpoint(rootOf(66), "darwin")).toBe(`${rootOf(66)}/native/run/mgmt.sock`);
    expect(nativeMgmtEndpoint(rootOf(67), "darwin").startsWith(`/tmp/vf-${uid}/`)).toBe(true);
  });

  it("a 255-byte root is usable", () => {
    expect(() => assertDataRootUsable(rootOf(255), "darwin")).not.toThrow();
  });

  it("refuses an alias home over budget, naming the longest cell file and its bytes", () => {
    let caught: unknown = null;
    try {
      assertDataRootUsable(rootOf(200), "darwin", { aliasParent: `/tmp/${"p".repeat(80)}` });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SupervisorError);
    expect((caught as SupervisorError).kind).toBe("data-root-too-long");
    expect((caught as SupervisorError).message).toContain("termframe.4294967295.sock");
  });

  it("the budget is a unix law — win32 endpoints are pipes, not paths (WIN-D1)", () => {
    // A stock Windows profile root already clears 103 bytes; enforcing the
    // budget there would refuse perfectly valid roots for a limit that has no
    // Windows analogue.
    expect(() => assertDataRootUsable(rootOf(400), "win32")).not.toThrow();
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
