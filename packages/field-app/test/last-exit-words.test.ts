import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ShellLastExit } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { lastExitWords } from "../src/panels/last-exit-words";

// AL-12 — Settings → Diagnostics' "Last exit", in DESIGN.md §9's "The quit's words": what happened and when, then what
// it ended or what kept running, in numbers; an unread count is never said as zero. The canon's own sentences are
// read from DESIGN.md, so the doc and the words move together.

const when = () => "on Oct 30 at 10:42";
const say = (record: ShellLastExit | null) => lastExitWords(record, when);
const design = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../DESIGN.md"),
  "utf8",
).replace(/\s+/g, " ");

describe("the last exit's words (AL-12)", () => {
  it("an exit that said no goodbye says what kept running, as the next launch's notice does", () => {
    expect(say({ planned: false, at: 1, sessions: 2 })).toBe(
      "VibeField quit unexpectedly on Oct 30 at 10:42. 2 terminal sessions kept running.",
    );
    expect(say({ planned: false, at: 1, sessions: 1 })).toBe(
      "VibeField quit unexpectedly on Oct 30 at 10:42. 1 terminal session kept running.",
    );
    expect(say({ planned: false, at: 1, sessions: 0 })).toBe(
      "VibeField quit unexpectedly on Oct 30 at 10:42. No terminal sessions were running.",
    );
  });

  it("a quit that stopped the floor says what it ended", () => {
    expect(say({ planned: true, stopped: "quit", at: 1, sessions: 2 })).toBe(
      "VibeField quit on Oct 30 at 10:42 and ended 2 terminal sessions.",
    );
    expect(say({ planned: true, stopped: "quit", at: 1, sessions: 0 })).toBe(
      "VibeField quit on Oct 30 at 10:42. No terminal sessions were running.",
    );
    expect(say({ planned: true, stopped: "update", at: 1, sessions: 1 })).toBe(
      "VibeField restarted to update on Oct 30 at 10:42 and ended 1 terminal session.",
    );
    expect(say({ planned: true, stopped: "logout", at: 1, sessions: 3 })).toBe(
      "VibeField quit as you logged out on Oct 30 at 10:42 and ended 3 terminal sessions.",
    );
  });

  it("a shell that left the floor running says so, and an unread count is never zero", () => {
    expect(say({ planned: true, why: "update", at: 1, sessions: 2 })).toBe(
      "VibeField restarted to update on Oct 30 at 10:42. 2 terminal sessions kept running.",
    );
    expect(say({ planned: true, why: "restart", at: 1, sessions: null })).toBe(
      "VibeField restarted on Oct 30 at 10:42. Its terminal service kept running.",
    );
    expect(say({ planned: true, why: "user-switch", at: 1, sessions: 1 })).toBe(
      "VibeField switched to another user on Oct 30 at 10:42. 1 terminal session kept running.",
    );
    expect(say({ planned: true, why: "quit", at: 1, sessions: 2 })).toBe(
      "VibeField quit on Oct 30 at 10:42. It couldn't check for running sessions, so its terminal service kept running.",
    );
    expect(say({ planned: false, at: 1, sessions: null })).not.toMatch(/\b0\b|No terminal/);
  });

  it("before any exit it says none is recorded", () => {
    expect(say(null)).toBe("No exit recorded yet.");
  });

  it("DESIGN.md's canon holds the same sentences", () => {
    for (const sentence of [
      say({ planned: false, at: 1, sessions: 2 }),
      say({ planned: true, stopped: "quit", at: 1, sessions: 2 }),
      say(null),
    ]) {
      expect(design).toContain(`"${sentence}"`);
    }
  });
});
