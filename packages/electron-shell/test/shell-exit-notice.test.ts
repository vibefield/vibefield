import { describe, expect, it } from "vitest";
import { shellExitNotice } from "../src/main/shell-exit-notice";

// AL-7 — the one notification an unplanned exit earns (DESIGN.md §9: what happened, when, what survived, in numbers;
// what to do next only when there is a report to read). A planned exit says nothing.

describe("the unplanned-exit notice's words (AL-7)", () => {
  const at = { at: 1_793_088_000_000 };

  it("names the time and the sessions that kept running", () => {
    expect(
      shellExitNotice(
        { planned: false, sessions: 3, ...at },
        { time: "10:42", crashReport: false },
      ),
    ).toEqual({
      title: "VibeField quit unexpectedly at 10:42",
      body: "3 terminal sessions kept running.",
    });
    expect(
      shellExitNotice({ planned: false, sessions: 1, ...at }, { time: "10:42", crashReport: false })
        ?.body,
    ).toBe("1 terminal session kept running.");
  });

  it("says when nothing was running, and when the count could not be read — never a zero it did not see", () => {
    expect(
      shellExitNotice({ planned: false, sessions: 0, ...at }, { time: "9:05", crashReport: false })
        ?.body,
    ).toBe("No terminal sessions were running.");
    expect(
      shellExitNotice(
        { planned: false, sessions: null, ...at },
        { time: "9:05", crashReport: false },
      )?.body,
    ).toBe("Its terminal service kept running.");
  });

  it("points at the crash report only when one belongs to this exit", () => {
    expect(
      shellExitNotice({ planned: false, sessions: 2, ...at }, { time: "10:42", crashReport: true })
        ?.body,
    ).toBe("2 terminal sessions kept running. Click to see the crash report.");
  });

  it("a planned exit earns no notice", () => {
    expect(
      shellExitNotice(
        { planned: true, why: "restart", sessions: 2, ...at },
        { time: "10:42", crashReport: true },
      ),
    ).toBeNull();
  });
});
