import { AgentRecordedLanesResult } from "@vibefield/contracts";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import type { BrowserWindow } from "electron";

// THE TIMELINE'S PAST in `pnpm smoke:godview` (TL, docket v9; the MV lead's
// asks for the combined gate, 2026-10-10). Two rungs on the two facts the
// monitor's marker states of the past the stage LENDS its view (`history`,
// `endedLanes` — the lent object's, never the view's DOM, MV-5's rule). A run
// has one configuration, so one of the two runs and the other says why not:
//
//   · THE RECORD (`timelinePast`) — the run has its real rosettad, and the
//     Jump rung before this one ran the person's seeded conversation HERE
//     (History's Resume: the typed stub, a session record of this runtime) and
//     ended it. fieldd's own door (`agent.recordedLanes`, asked over the
//     harness's client) lists that run as an ended lane of a `complete` past;
//     the timeline chosen on the bar, the stage lends it: `history: complete`,
//     `endedLanes ≥ 1`.
//   · NO RECORD (`timelineNoRecord`) — the run has no agent index
//     (`FIELDD_ROSETTAD_BIN` unset): the door refuses NOT_FOUND `no-record`, and
//     the timeline's stage lends nothing for as long as it is watched —
//     `history: absent`, no ended lane (TIMELINE SHAPES v2 item 9: no words
//     about a past, today's drawing exactly).
//
// Neither changes the theme or types into a pane. Both leave the swarm chosen
// again, as the spend rung does.
//
// Test-only by construction: this module rides the smoke bundle
// (dist/testing/smoke.cjs), which packaging omits.

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const DAY_MS = 24 * 60 * 60_000;
/** How long the no-record stage is watched: the door's refusal is one local
 * round trip, so a past that was going to be lent is lent well inside this. */
const NO_RECORD_WATCH_MS = 3_000;

/** The monitor's marker, as far as these rungs read it. */
interface PastMonitorFacts {
  viewId: string;
  history?: string;
  endedLanes?: number;
}

interface PastMonitorWatch {
  history(): readonly PastMonitorFacts[];
  until(
    predicate: (facts: PastMonitorFacts) => boolean,
    what: string,
    timeoutMs: number,
  ): Promise<PastMonitorFacts>;
}

export interface TimelinePastOptions {
  handle: FielddHandle;
  monitor: PastMonitorWatch;
  /** The person's seeded conversation, when the Jump rung ran it on this
   * desktop and ended it; undefined when it ran nothing (no person, no index). */
  ranHere: { nativeSessionId: string } | undefined;
}

export interface TimelinePastVerdicts {
  timelinePast: unknown;
  timelineNoRecord: unknown;
}

type DoorAnswer =
  | { record: true; past: AgentRecordedLanesResult }
  | { record: false; kind: string; state: string; words: string };

/** fieldd's own answer for the day, over the harness's client. */
async function askDoor(handle: FielddHandle): Promise<DoorAnswer> {
  const untilMs = Date.now();
  try {
    const answer = await handle.client.request("agent.recordedLanes", {
      sinceMs: untilMs - DAY_MS,
      untilMs,
    });
    return { record: true, past: AgentRecordedLanesResult.parse(answer) };
  } catch (error) {
    const refusal = error as { kind?: unknown; details?: { state?: unknown }; message?: unknown };
    if (refusal.kind !== "NOT_FOUND" || refusal.details?.state !== "no-record") throw error;
    return {
      record: false,
      kind: "NOT_FOUND",
      state: "no-record",
      words: String(refusal.message ?? ""),
    };
  }
}

async function chooseView(
  win: BrowserWindow,
  monitor: PastMonitorWatch,
  label: string,
  id: string,
): Promise<void> {
  // the stage mounts with Godview, a moment after the window's view says so
  const deadline = Date.now() + 20_000;
  let pressed = false;
  while (!pressed && Date.now() < deadline) {
    pressed = (await win.webContents.executeJavaScript(
      `(() => {
        const control = document.querySelector('[role="group"][aria-label="Monitor view"] button[aria-label=${JSON.stringify(`${label} view`)}]');
        if (!(control instanceof HTMLButtonElement)) return false;
        control.click();
        return true;
      })()`,
      true,
    )) as boolean;
    if (!pressed) await sleep(150);
  }
  if (!pressed) throw new Error(`the bar offers no ${label} view`);
  await monitor.until((facts) => facts.viewId === id, `the monitor to show ${id}`, 20_000);
}

/** The door's answer once it lists the run as an ended lane of a whole past;
 * a timeout says what the door last answered. */
async function untilEndedAtTheDoor(
  handle: FielddHandle,
  nativeSessionId: string,
): Promise<{ past: AgentRecordedLanesResult; lane: string }> {
  const deadline = Date.now() + 30_000;
  let last: AgentRecordedLanesResult | undefined;
  while (Date.now() < deadline) {
    const asked = await askDoor(handle);
    if (!asked.record) throw new Error(`the door stopped keeping a record: ${asked.words}`);
    last = asked.past;
    const lane = last.ended.find((ended) => ended.id.endsWith(`:${nativeSessionId}`));
    if (last.state === "complete" && lane !== undefined) return { past: last, lane: lane.id };
    await sleep(500);
  }
  throw new Error(
    `agent.recordedLanes never listed the run that ended here as a lane of a complete past: ${JSON.stringify(
      {
        state: last?.state,
        detail: last?.detail,
        fidelity: last?.fidelity,
        ended: last?.ended.map((lane) => lane.id),
        live: last?.live.map((lane) => lane.id),
      },
    )}`,
  );
}

/** Both rungs: the one this run's configuration can show, and the other's reason. */
export async function timelinePastRungs(
  win: BrowserWindow,
  opts: TimelinePastOptions,
): Promise<TimelinePastVerdicts> {
  const { handle, monitor } = opts;
  const asked = await askDoor(handle);
  // the swarm is chosen again whatever happens, and the rung's own failure is the one said
  let failure: unknown;
  let verdicts: TimelinePastVerdicts | undefined;
  try {
    if (!asked.record) {
      const from = monitor.history().length;
      await chooseView(win, monitor, "TIMELINE", "timeline");
      await sleep(NO_RECORD_WATCH_MS);
      const said = monitor
        .history()
        .slice(from)
        .filter((facts) => facts.viewId === "timeline");
      const lent = said.filter((facts) => facts.history !== "absent" || facts.endedLanes !== 0);
      if (said.length === 0 || lent.length > 0) {
        throw new Error(
          `a desktop that keeps no record lent its timeline a past: ${JSON.stringify(said)}`,
        );
      }
      verdicts = {
        timelineNoRecord: {
          door: { kind: asked.kind, state: asked.state, words: asked.words },
          history: "absent",
          endedLanes: 0,
          markers: said.length,
          watchedMs: NO_RECORD_WATCH_MS,
        },
        timelinePast: "unavailable: this desktop keeps no record of past runs (no agent index)",
      };
    } else {
      const timelineNoRecord =
        "unavailable: this desktop keeps a record, so its door never refuses `no-record` — the rung runs with FIELDD_ROSETTAD_BIN unset";
      if (opts.ranHere === undefined) {
        verdicts = {
          timelineNoRecord,
          timelinePast: {
            unavailable:
              "the Jump rung ran no seeded conversation here (no person, or the index was not opened)",
          },
        };
      } else {
        const door = await untilEndedAtTheDoor(handle, opts.ranHere.nativeSessionId);
        await chooseView(win, monitor, "TIMELINE", "timeline");
        const lent = await monitor.until(
          (facts) =>
            facts.viewId === "timeline" &&
            facts.history === "complete" &&
            (facts.endedLanes ?? 0) >= 1,
          "the timeline's stage to lend a complete past with the run that ended here",
          30_000,
        );
        verdicts = {
          timelineNoRecord,
          timelinePast: {
            door: {
              state: door.past.state,
              fidelity: door.past.fidelity,
              ended: door.past.ended.length,
              lane: door.lane,
            },
            history: lent.history,
            endedLanes: lent.endedLanes,
          },
        };
      }
    }
  } catch (error) {
    failure = error;
  }
  try {
    await chooseView(win, monitor, "SWARM", "swarm");
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
  if (verdicts === undefined) throw new Error("unreachable: the timeline rungs said nothing");
  return verdicts;
}
