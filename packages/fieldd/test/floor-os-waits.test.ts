// WG-E5's platform reads (draft/thinking-floor-wedge.md §4, §6; WG-D3: Linux
// procfs now) over a fake /proc tree: the reader counts the threads in
// uninterruptible wait and reads the process's page-ins, and says nothing
// rather than guess when the process or its files are gone. The supervisor's
// use of a reading is native-supervisor.test.ts's (the headless hold).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { platformOsWaits, readLinuxOsWaits } from "../src/floor-os-waits";

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

/** A `stat` line as the kernel writes it: `comm` in parentheses (here with a
 * space and a parenthesis of its own), then the state (field 3), and majflt
 * at field 12. */
function statLine(pid: number, state: string, majorFaults: number): string {
  const fields = [state, "1", pid, pid, "0", "-1", "4194560", "812", "0", majorFaults, "0"];
  return `${pid} (field (native)) ${fields.join(" ")} 3 1 0 0 20 0 9 0 1234 0 0\n`;
}

/** A fake /proc holding one process and its threads, each with its state. */
function fakeProc(pid: number, majorFaults: number, threads: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "vf-os-waits-"));
  roots.push(root);
  const base = join(root, String(pid));
  mkdirSync(join(base, "task"), { recursive: true });
  writeFileSync(join(base, "stat"), statLine(pid, "S", majorFaults));
  for (const [index, state] of threads.entries()) {
    const tid = pid + index;
    mkdirSync(join(base, "task", String(tid)));
    writeFileSync(join(base, "task", String(tid), "stat"), statLine(tid, state, 0));
  }
  return root;
}

describe("the floor's OS waits from Linux procfs (WG-E5, WG-D3)", () => {
  it("counts the threads in uninterruptible wait and reads the page-ins", () => {
    const root = fakeProc(4_242, 917, ["S", "D", "R", "D", "S"]);
    expect(readLinuxOsWaits(4_242, root)).toEqual({ uninterruptible: 2, majorFaults: 917 });
  });

  it("reads a deadlocked floor as no wait: every thread asleep, interruptibly", () => {
    const root = fakeProc(4_242, 12, ["S", "S", "S"]);
    expect(readLinuxOsWaits(4_242, root)).toEqual({ uninterruptible: 0, majorFaults: 12 });
  });

  it("says nothing for a process that is gone, or a stat it cannot read", () => {
    const root = fakeProc(4_242, 12, ["S"]);
    expect(readLinuxOsWaits(9_999, root)).toBeUndefined();
    writeFileSync(join(root, "4242", "stat"), "garbage\n");
    expect(readLinuxOsWaits(4_242, root)).toBeUndefined();
  });

  it("is the platform's reader on Linux alone; elsewhere the platform says nothing", () => {
    expect(platformOsWaits() === undefined).toBe(process.platform !== "linux");
  });
});
