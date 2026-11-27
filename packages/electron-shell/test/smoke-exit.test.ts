import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  censusAtExit,
  exitSaid,
  PAGES_EXIT_HELD_MS,
  type PagesExitDeps,
} from "../src/testing/smoke-exit";

// Item 658 (2026-11-26): how the pages smoke leaves Electron. One physical run of the row said its
// verdict, asked Electron to exit, and Electron lived on for fifteen minutes. The product's own quit
// ends its pages' offscreen windows before it exits (its live-surface custody is disposed in the
// quit flow); the smokes skip that flow. So this smoke ends them the product's way, says what main
// still held at the exit by counts, and keeps a watch: an exit that is held is said in one line and
// main ends itself. EVERY ROW HERE RUNS THE WATCH ON A STAND-IN (2026-11-27): the exit returns at
// once and the timer is fired by hand. No row and no run shows that the timer fires while Electron
// is held at a real exit: it is a timer on main's loop, and fires only while that loop turns.

function stage(over: Partial<PagesExitDeps> = {}) {
  const lines: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const order: string[] = [];
  const deps: PagesExitDeps = {
    windows: () => [{ offscreen: false }],
    contents: () => 1,
    active: () => ["Timeout", "TCPSocketWrap", "Timeout"],
    say: (line) => {
      lines.push(line);
      order.push("say");
    },
    exit: vi.fn((code: number) => {
      order.push(`exit:${code}`);
    }),
    end: vi.fn(() => {
      order.push("end");
    }),
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      order.push("watch");
      return 0;
    },
    ...over,
  };
  const said = (prefix: string): Record<string, unknown> | null => {
    const line = lines.find((l) => l.startsWith(`${prefix} `));
    return line === undefined ? null : JSON.parse(line.slice(prefix.length + 1));
  };
  return { deps, lines, timers, order, said };
}

describe("what main still holds when the smoke asks Electron to exit", () => {
  it("is counted: its windows, how many of them are offscreen, and its pages", () => {
    const { deps } = stage({
      windows: () => [{ offscreen: false }, { offscreen: true }, { offscreen: true }],
      contents: () => 4,
    });
    expect(censusAtExit(deps)).toEqual({ windows: 3, offscreen: 2, contents: 4 });
  });

  it("is a count that could not be taken when Electron's own list throws: null, never a zero", () => {
    const thrower = stage({
      windows: () => {
        throw new Error("the app is quitting");
      },
      contents: () => {
        throw new Error("the app is quitting");
      },
    });
    expect(censusAtExit(thrower.deps)).toEqual({ windows: null, offscreen: null, contents: null });
  });
});

describe("the exit", () => {
  const before = { windows: 3, offscreen: 2, contents: 3 };

  it("says one line of counts, arms its watch, and only then asks Electron to exit with the run's code", () => {
    for (const code of [0, 1, 2] as const) {
      const s = stage();
      exitSaid(code, s.deps, { before, surfaces: "closed" });
      expect(s.said("SMOKE_PAGES_EXIT")).toEqual({
        // what the product's own close of its pages was asked to end, and what main held after it
        before,
        surfaces: "closed",
        windows: 1,
        offscreen: 0,
        contents: 1,
      });
      expect(s.order).toEqual(["say", "watch", `exit:${code}`]);
      expect(s.timers.map((t) => t.ms)).toEqual([PAGES_EXIT_HELD_MS]);
      // Electron took the exit: the watch never ran, and main was not ended by its own hand
      expect(s.deps.end).not.toHaveBeenCalled();
    }
    // long enough for an exit that is only slow, short beside a gate's bound
    expect(PAGES_EXIT_HELD_MS).toBeGreaterThanOrEqual(5_000);
    expect(PAGES_EXIT_HELD_MS).toBeLessThanOrEqual(30_000);
  });

  it("says a close that threw, or that was never asked for, as it was", () => {
    for (const surfaces of ["threw", "none"] as const) {
      const s = stage();
      exitSaid(2, s.deps, { before, surfaces });
      expect(s.said("SMOKE_PAGES_EXIT")).toMatchObject({ surfaces });
    }
  });

  it("when the exit is HELD: one line, by counts and kinds alone, and main ends itself", () => {
    const s = stage({
      windows: () => [{ offscreen: true }],
      contents: () => 2,
    });
    exitSaid(0, s.deps, { before, surfaces: "closed" });
    expect(s.deps.exit).toHaveBeenCalledWith(0);
    // main still runs when the watch comes due: Electron did not take the exit
    s.timers[0]?.fn();
    expect(s.said("SMOKE_PAGES_EXIT_HELD")).toEqual({
      afterMs: PAGES_EXIT_HELD_MS,
      windows: 1,
      offscreen: 1,
      contents: 2,
      // what keeps node's loop alive, by kind and how many of each
      active: { TCPSocketWrap: 1, Timeout: 2 },
    });
    expect(s.order.slice(-2)).toEqual(["say", "end"]);
    expect(s.deps.end).toHaveBeenCalledTimes(1);
    // a held exit is never asked for a second time: the watch ends main, it does not ask again
    expect(s.deps.exit).toHaveBeenCalledTimes(1);
  });

  it("ends main though the line could not be said, and though a count threw", () => {
    const mute = stage({
      say: () => {
        throw new Error("EPIPE");
      },
    });
    expect(() => exitSaid(0, mute.deps, { before, surfaces: "closed" })).not.toThrow();
    expect(mute.deps.exit).toHaveBeenCalledWith(0);
    expect(() => mute.timers[0]?.fn()).not.toThrow();
    expect(mute.deps.end).toHaveBeenCalledTimes(1);
    const blind = stage({
      active: () => {
        throw new Error("no such list");
      },
    });
    exitSaid(0, blind.deps, { before, surfaces: "closed" });
    blind.timers[0]?.fn();
    expect(blind.said("SMOKE_PAGES_EXIT_HELD")).toMatchObject({ active: null });
    expect(blind.deps.end).toHaveBeenCalledTimes(1);
  });

  it("says no place, no pid and no address in either line: counts and kinds", () => {
    const s = stage({ active: () => ["PipeWrap", "ProcessWrap"] });
    exitSaid(1, s.deps, { before, surfaces: "closed" });
    s.timers[0]?.fn();
    for (const line of s.lines) {
      expect(line).not.toMatch(/\/|0x[0-9a-f]+|\bpid\b/u);
    }
  });
});

describe("the exit, held in the sources", () => {
  const root = new URL("../", import.meta.url);
  const text = (name: string): string => readFileSync(new URL(name, root), "utf8");

  it("the pages branch of the smoke leaves through it, after it has closed the pages' surfaces and torn the run down, and by no bare exit of its own", () => {
    const smoke = text("src/testing/smoke.ts");
    const at = smoke.indexOf("if (process.argv.includes(PAGES_WITNESS_FLAG)) {");
    const end = smoke.indexOf("\n  try {\n    const canvasReady", at);
    expect(at).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(at);
    const branch = smoke.slice(at, end);
    // the product's own close of its surfaces, then the teardown, then the exit that is said
    const close = branch.indexOf("opts.pages?.closeSurfaces()");
    const teardown = branch.indexOf("await teardown(");
    const exit = branch.indexOf("exitSaid(code, ");
    expect(close).toBeGreaterThan(0);
    expect(teardown).toBeGreaterThan(close);
    expect(exit).toBeGreaterThan(teardown);
    expect(branch).not.toContain("app.exit(code);");
    // main ends ITSELF, by its own pid, and nothing else
    expect(branch).toContain('end: () => process.kill(process.pid, "SIGKILL"),');
  });

  it("the door's close is the call the product's own quit makes of its live-surface custody", () => {
    const index = text("src/main/index.ts");
    // the product, in the state its quit flow disposes
    expect(index).toContain("  liveSurfaceAuthority?.dispose();\n  liveSurfaceAuthority = null;\n");
    // the smoke's door, handed only with the witness: the same call
    expect(index).toContain(
      "              closeSurfaces: () => {\n                liveSurfaceAuthority?.dispose();\n              },\n",
    );
    // and the quit flow disposes that state before it exits (lifecycle.ts)
    const lifecycle = text("src/main/lifecycle.ts");
    expect(lifecycle).toContain("const shellStopped = opts.disposeShell();");
    expect(lifecycle).toContain("exit: (code) => app.exit(code),");
  });
});
