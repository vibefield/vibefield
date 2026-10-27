import { describe, expect, it } from "vitest";
import { shellExitNotice } from "../src/main/shell-exit-notice";

// AL-7 — the one notification an unplanned exit earns (DESIGN.md §9: what happened, when, what survived, in numbers;
// what to do next only when there is a report to read). A planned exit says nothing. AL-8a — a fieldd that crashed is
// said the same way, and a shell and a fieldd that both crashed get ONE notice.

describe("the unplanned-exit notice's words (AL-7)", () => {
  const at = { at: 1_793_088_000_000 };
  const time = (label: string) => () => label;

  it("names the time and the sessions that kept running", () => {
    expect(
      shellExitNotice({ planned: false, sessions: 3, ...at }, null, {
        time: time("10:42"),
        crashReport: false,
      }),
    ).toEqual({
      title: "VibeField quit unexpectedly at 10:42",
      body: "3 terminal sessions kept running.",
    });
    expect(
      shellExitNotice({ planned: false, sessions: 1, ...at }, null, {
        time: time("10:42"),
        crashReport: false,
      })?.body,
    ).toBe("1 terminal session kept running.");
  });

  it("says when nothing was running, and when the count could not be read — never a zero it did not see", () => {
    expect(
      shellExitNotice({ planned: false, sessions: 0, ...at }, null, {
        time: time("9:05"),
        crashReport: false,
      })?.body,
    ).toBe("No terminal sessions were running.");
    expect(
      shellExitNotice({ planned: false, sessions: null, ...at }, null, {
        time: time("9:05"),
        crashReport: false,
      })?.body,
    ).toBe("Its terminal service kept running.");
  });

  it("points at the crash report only when one belongs to this exit", () => {
    expect(
      shellExitNotice({ planned: false, sessions: 2, ...at }, null, {
        time: time("10:42"),
        crashReport: true,
      })?.body,
    ).toBe("2 terminal sessions kept running. Click to see the crash report.");
  });

  it("a planned exit earns no notice", () => {
    expect(
      shellExitNotice({ planned: true, why: "restart", sessions: 2, ...at }, null, {
        time: time("10:42"),
        crashReport: true,
      }),
    ).toBeNull();
    expect(shellExitNotice(null, null, { time: time("10:42"), crashReport: false })).toBeNull();
  });
});

describe("a crashed fieldd's notice (AL-8a)", () => {
  const managerExit = { at: 1_793_088_060_000, sessions: 2 };
  const time = (at: number) => (at === managerExit.at ? "10:43" : "10:42");

  it("names fieldd, its time and what kept running — and never offers a report it has none of", () => {
    expect(shellExitNotice(null, managerExit, { time, crashReport: true })).toEqual({
      title: "Fieldd stopped unexpectedly at 10:43",
      body: "2 terminal sessions kept running.",
    });
    expect(
      shellExitNotice(
        { planned: true, why: "quit", sessions: 0, at: 1 },
        { at: managerExit.at, sessions: null },
        { time, crashReport: false },
      )?.body,
    ).toBe("Its terminal service kept running.");
  });

  it("a shell and a fieldd that both crashed get ONE notice, the shell's, which says fieldd stopped too", () => {
    expect(
      shellExitNotice({ planned: false, sessions: 2, at: 1_793_088_000_000 }, managerExit, {
        time,
        crashReport: false,
      }),
    ).toEqual({
      title: "VibeField quit unexpectedly at 10:42",
      body: "2 terminal sessions kept running. Fieldd stopped too.",
    });
  });
});
