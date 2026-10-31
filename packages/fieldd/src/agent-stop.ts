// ST (2026-10-31; James's `ds-marks` 05:36:54Z and `ds-marks-corrections` 05:53:50Z; `thinking-ar-durable-stop.md`) —
// A DURABLE STOP. A person's Stop is the run's own stop, delivered (`agent.interrupt`: the floor's interrupt, or the
// agent's declared turn stop), and it stays SENT until fieldd hears the run stop: its PTY exited, or its status left
// `working`. Not heard within `AGENT_STOP.HEARD_WITHIN_MS`, the same stop is sent once more (ST-D2). Still not heard,
// a run whose status fieldd can read is ended through the floor's own terminate ladder, and a run whose status cannot
// be read is left to the person (ST-D3, "Still running · End run"): an unreadable status cannot tell a turn that will
// not stop from one that already has, and ending a healthy agent's process is not what a Stop of its turn means.
// This module is the rule alone, pure; agent-runtime holds the timers, delivers and ends.

import type { AgentStopState } from "@vibefield/contracts";

/** The observation levels at which puppeteer witnesses an agent's turns, so `working` and `idle` are the agent's own
 * word rather than an absence of evidence: puppeteer-runtime 0.3.2's `TURN_OBSERVING_LEVELS` (`dist/agent.js:9`),
 * which it does not export. Named here once, beside the pin; the upstream ask is ST's views-SDK petition. */
export const TURN_OBSERVING_LEVELS: ReadonlySet<string> = new Set([
  "structured",
  "native-hooks",
  "native-log",
]);

/** ST-D3 — fieldd can tell "still working" from "stopped" for this run. */
export function stopReadable(observationLevel: string): boolean {
  return TURN_OBSERVING_LEVELS.has(observationLevel);
}

/** What a run's status says to a Stop: whether it can be read, whether it says anything (`unknown` is no word:
 * the mirror is gone or not yet heard), and whether it reads `working`. */
export interface StopFacts {
  readable: boolean;
  known: boolean;
  working: boolean;
}

/** What a Stop does when its bound passes and nothing has been heard. */
export type StopStep = "resend" | "terminate" | "unheard" | "none";

/** ST-D2/D3 — the one step a Stop takes at its bound. A `sent` Stop is sent once more. A `resent` one on a run that
 * reads `working` is ended through the floor's ladder; one whose status cannot be read is marked unheard and left to
 * the person. A `terminating` or `heard` Stop, or one already unheard, takes no step. */
export function nextStopStep(stop: AgentStopState, facts: StopFacts): StopStep {
  if (stop.stage === "heard" || stop.unheardAt !== undefined) return "none";
  if (stop.stage === "sent") return "resend";
  if (stop.stage === "resent") return facts.readable && facts.working ? "terminate" : "unheard";
  return "none";
}

/** ST — a Stop is heard by the run's status when the status can be read, says something, and no longer says
 * `working` (idle, or blocked on the person). An `unknown` status is no evidence the turn stopped (the review of
 * 2026-10-31). Not while the floor's ladder is ending the run: a dying process's status is no word of its own, and
 * its exit is the fact. A ladder that could not be placed (`unheardAt`) ends nothing, so the status is the run's word
 * again. */
export function heardByStatus(stop: AgentStopState, facts: StopFacts): boolean {
  if (stop.stage === "heard") return false;
  if (stop.stage === "terminating" && stop.unheardAt === undefined) return false;
  return facts.readable && facts.known && !facts.working;
}

/** How a Stop's escalation answered: a re-send's delivery answered (accepted or refused), the floor's ladder was
 * placed or not, or the act threw. */
export type EscalationOutcome = "answered" | "placed" | "not-placed" | "threw";

/** What is left to do once an escalation answered. */
export type AfterEscalation = "rearm" | "unheard" | "await-exit";

/** ST-D2/D3 — a re-sent Stop gets its own bound, whatever its delivery answered, so the next bound decides. A placed
 * ladder ends the run, and its exit is the Stop heard. A ladder not placed, or one that threw, ends nothing, so the
 * Stop is left to the person. */
export function afterEscalation(
  stage: "resent" | "terminating",
  outcome: EscalationOutcome,
): AfterEscalation {
  if (stage === "resent") return "rearm";
  return outcome === "placed" ? "await-exit" : "unheard";
}
