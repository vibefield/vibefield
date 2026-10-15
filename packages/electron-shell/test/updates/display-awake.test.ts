import { describe, expect, it } from "vitest";
import {
  PMSET_BOUND_MS,
  parseDisplayHeldAwake,
  readDisplayHeldAwake,
} from "../../src/main/updates/display-awake";

// WP12d (L3b-ii, build-wp12-updater.md §12 B4; EDP-34) — the safe window's display clause. The fixture is this Mac's
// own `pmset -g assertions` (2026-10-15 10:09 -0700), its system-wide section as printed: a browser's wake lock held
// `PreventUserIdleDisplaySleep` at 1, and powerd's display-off delay held `InternalPreventDisplaySleep` — which is NOT
// a process holding the screen, so it is not read.

const CAPTURED = `2026-10-15 10:09:52 -0700
Assertion status system-wide:
   BackgroundTask                 0
   ApplePushServiceTask           0
   UserIsActive                   1
   PreventUserIdleDisplaySleep    1
   SoftwareUpdateTask             0
   PreventSystemSleep             0
   ExternalMedia                  1
   InternalPreventDisplaySleep    1
   PreventUserIdleSystemSleep     1
   NetworkClientActive            0
Listed by owning process:
   pid 352(powerd): [0x001056fe0001885e] 00:12:47 PreventUserIdleSystemSleep named: "Powerd - Prevent sleep while display is on"
Kernel Assertions: 0x104=USB,MAGICWAKE
`;

describe("the display clause's reader (B4)", () => {
  it("reads this Mac's captured output: a process holds the display awake", () => {
    expect(parseDisplayHeldAwake(CAPTURED)).toBe(true);
  });

  it("a zero count is free — powerd's own display-off delay does not count", () => {
    const free = CAPTURED.replace(
      /PreventUserIdleDisplaySleep {4}1/,
      "PreventUserIdleDisplaySleep    0",
    );
    expect(free).toContain("InternalPreventDisplaySleep    1");
    expect(parseDisplayHeldAwake(free)).toBe(false);
  });

  it("only the system-wide section is read: a process line naming the assertion is not a count", () => {
    const listedOnly = `Assertion status system-wide:
   UserIsActive                   1
Listed by owning process:
   PreventUserIdleDisplaySleep    1
`;
    expect(parseDisplayHeldAwake(listedOnly)).toBe("unknown");
  });

  it("anything that is not a clean answer is unknown (closed)", () => {
    expect(parseDisplayHeldAwake("")).toBe("unknown");
    expect(parseDisplayHeldAwake("pmset: command not found")).toBe("unknown");
  });

  it("runs pmset bounded on macOS; anywhere else, or on a failure, unknown", async () => {
    const asked: Array<[string, readonly string[], number]> = [];
    expect(
      await readDisplayHeldAwake("darwin", async (file, args, bound) => {
        asked.push([file, args, bound]);
        return CAPTURED;
      }),
    ).toBe(true);
    expect(asked).toEqual([["/usr/bin/pmset", ["-g", "assertions"], PMSET_BOUND_MS]]);
    expect(
      await readDisplayHeldAwake("darwin", async () => {
        throw new Error("timed out");
      }),
    ).toBe("unknown");
    expect(
      await readDisplayHeldAwake("linux", async () => {
        throw new Error("never asked");
      }),
    ).toBe("unknown");
  });
});
