/**
 * DS (2026-10-31) — THE DURABLE STOP'S RULE (`agent-stop.ts`), pure: which runs fieldd can read, the one step a Stop
 * takes at its bound, and when a status is the Stop heard. The timers, the deliveries and the floor's ladder are
 * agent-runtime's, and their rows run on a real floor in `agent-session.test.ts`.
 */
import type { AgentStopState } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  afterEscalation,
  heardByStatus,
  nextStopStep,
  type StopFacts,
  stopReadable,
  TURN_OBSERVING_LEVELS,
} from "../src/agent-stop";

const SENT_AT = "2026-10-31T06:00:00.000Z";
const UNHEARD_AT = "2026-10-31T06:00:06.000Z";
const stop = (overrides: Partial<AgentStopState> = {}): AgentStopState => ({
  sentAt: SENT_AT,
  stage: "sent",
  ...overrides,
});

const READABLE_WORKING: StopFacts = { readable: true, known: true, working: true };
const READABLE_IDLE: StopFacts = { readable: true, known: true, working: false };
const READABLE_UNKNOWN: StopFacts = { readable: true, known: false, working: false };
const UNREADABLE: StopFacts = { readable: false, known: true, working: true };

describe("DS-D3 — which runs fieldd can read", () => {
  it("reads a run whose turns puppeteer witnesses: structured, native hooks or a native log", () => {
    expect([...TURN_OBSERVING_LEVELS].sort()).toEqual(["native-hooks", "native-log", "structured"]);
    for (const level of TURN_OBSERVING_LEVELS) expect(stopReadable(level)).toBe(true);
  });

  it("reads no other level: a status there is an absence of evidence, not the agent's word", () => {
    for (const level of ["process", "pty", "unknown", "", "Structured"]) {
      expect(stopReadable(level)).toBe(false);
    }
  });
});

describe("DS-D2/D3 — the one step a Stop takes at its bound", () => {
  it("sends a Stop not heard once more, whatever the run's status says", () => {
    for (const facts of [READABLE_WORKING, READABLE_IDLE, UNREADABLE]) {
      expect(nextStopStep(stop(), facts)).toBe("resend");
    }
  });

  it("ends a run still working after the re-send through the floor's ladder, when its status can be read", () => {
    expect(nextStopStep(stop({ stage: "resent" }), READABLE_WORKING)).toBe("terminate");
  });

  it("leaves a run whose status cannot be read to the person after the re-send: never ends it", () => {
    expect(nextStopStep(stop({ stage: "resent" }), UNREADABLE)).toBe("unheard");
    expect(
      nextStopStep(stop({ stage: "resent" }), { readable: false, known: true, working: false }),
    ).toBe("unheard");
    // a readable run whose status says nothing is not ended either: no word says it still works
    expect(nextStopStep(stop({ stage: "resent" }), READABLE_UNKNOWN)).toBe("unheard");
  });

  it("takes no step for a Stop heard, terminating, already unheard, or in a stage it does not know", () => {
    expect(nextStopStep(stop({ stage: "heard", heardBy: "exit" }), READABLE_WORKING)).toBe("none");
    expect(nextStopStep(stop({ stage: "terminating" }), READABLE_WORKING)).toBe("none");
    expect(nextStopStep(stop({ stage: "resent", unheardAt: UNHEARD_AT }), READABLE_WORKING)).toBe(
      "none",
    );
    expect(nextStopStep(stop({ stage: "paused" }), READABLE_WORKING)).toBe("none");
  });
});

describe("DS — a status is the Stop heard", () => {
  it("hears a readable status that left working, while the Stop is sent or sent again", () => {
    expect(heardByStatus(stop(), READABLE_IDLE)).toBe(true);
    expect(heardByStatus(stop({ stage: "resent" }), READABLE_IDLE)).toBe(true);
    expect(heardByStatus(stop(), READABLE_WORKING)).toBe(false);
  });

  it("never hears an unreadable status: only the exit can say", () => {
    expect(heardByStatus(stop(), { readable: false, known: true, working: false })).toBe(false);
  });

  it("never hears a status that says nothing: `unknown` is no evidence the turn stopped", () => {
    // before the review of 2026-10-31 a readable run whose mirror went missing read as heard at once
    expect(heardByStatus(stop(), READABLE_UNKNOWN)).toBe(false);
    expect(heardByStatus(stop({ stage: "resent" }), READABLE_UNKNOWN)).toBe(false);
  });

  it("hears a run blocked on the person: its status left working", () => {
    expect(heardByStatus(stop(), { readable: true, known: true, working: false })).toBe(true);
  });

  it("does not take a dying process's status for its word while the ladder ends it", () => {
    expect(heardByStatus(stop({ stage: "terminating" }), READABLE_IDLE)).toBe(false);
  });

  it("hears the status again once a ladder could not be placed: nothing is ending the run", () => {
    expect(
      heardByStatus(stop({ stage: "terminating", unheardAt: UNHEARD_AT }), READABLE_IDLE),
    ).toBe(true);
  });

  it("hears nothing twice", () => {
    expect(heardByStatus(stop({ stage: "heard", heardBy: "status" }), READABLE_IDLE)).toBe(false);
  });
});

describe("DS-D2/D3 — what is left once an escalation answered", () => {
  it("gives a re-sent Stop its own bound whatever its delivery answered — refused, accepted, or a delivery that threw", () => {
    expect(afterEscalation("resent", "answered")).toBe("rearm");
    // before DS's review a throwing re-send left the Stop at `resent` with no timer, forever
    expect(afterEscalation("resent", "threw")).toBe("rearm");
  });

  it("waits for the exit of a run whose ladder the floor placed: the exit is the Stop heard", () => {
    expect(afterEscalation("terminating", "placed")).toBe("await-exit");
  });

  it("leaves the Stop to the person when the ladder was not placed or threw: nothing is ending the run", () => {
    // before DS's review either left the Stop at `terminating`, "Ending the run" with nothing ending it
    expect(afterEscalation("terminating", "not-placed")).toBe("unheard");
    expect(afterEscalation("terminating", "threw")).toBe("unheard");
  });
});
