import { describe, expect, it } from "vitest";
import { COMMAND_FAILED, typedExitOf } from "../src/agent-typed-run";

// Q06 — a typed run's end as its shell reaped it (`TerminalCommandFinished`):
// the words fieldd stamps and hands puppeteer. The pid watch's own end (no
// code, no signal, `process-exited`) is the third case, and nothing is
// invented for it.

describe("a typed run's exit, from its shell's report (Q06)", () => {
  it("0 is the clean end, in the floor's word; any other status is the process's failure, carried as its code", () => {
    expect(typedExitOf({ exitCode: 0 })).toEqual({
      exitCode: 0,
      signal: null,
      reason: "completed",
    });
    expect(typedExitOf({ exitCode: 1 })).toEqual({
      exitCode: 1,
      signal: null,
      reason: COMMAND_FAILED,
    });
    // a shell reports a signal as 128 + its number; a program's own exit(137)
    // reads the same, so it is never decoded into a signal
    expect(typedExitOf({ exitCode: 137 })).toEqual({
      exitCode: 137,
      signal: null,
      reason: COMMAND_FAILED,
    });
    // the one word a typed run's row is held by (`holdExited`): never the
    // watch's, which a vanished pid stamps on every typed run's end
    expect(COMMAND_FAILED).not.toBe("process-exited");
  });
});
