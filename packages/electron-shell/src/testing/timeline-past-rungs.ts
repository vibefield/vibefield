import { AgentRecordedLanesResult, IndexSessionsResult } from "@vibefield/contracts";
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
// And a third, on THE RECORD's run alone (TV-8, RULED 2026-10-11; DESIGN.md §8
// "Godview's timeline"): AN ENDED LANE OPENS ITS SESSION IN HISTORY
// (`timelineOpensEnded`), in the real app, by the pointer —
//
//   · History's room is put off the run's session first (its project's row
//     chosen again, which lets go of the session), so that the room standing
//     ON it afterwards is the press's doing and nothing an earlier rung left;
//   · back in Godview, the timeline lent its past: with the pointer off the
//     lanes the view's root says nothing, and resting on the ended lane it
//     says `data-opens="true"` and the lanes wear a control's cursor — the
//     view was lent the host's `openEnded` when it mounted;
//   · a press there (trusted input into this window's page, never the OS's)
//     leaves Godview for History, and History's room is on that run's session
//     — rosetta's id for the lane's native one, as fieldd's own lookup lists
//     it — its reply rendered;
//   · ⌘2 back to Godview, so the rungs after find the window where they did.
//
// Where the past rung lends a past, a lane that is not drawn, not reachable or
// not opened FAILS the run. On a run that can have no ended lane (no agent
// index, or nothing staged) the fact says why, as its two neighbours do.
//
// None changes the theme or types into a pane. All leave the swarm chosen
// again, as the spend rung does.
//
// Test-only by construction: this module rides the smoke bundle
// (dist/testing/smoke.cjs), which packaging omits.

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const DAY_MS = 24 * 60 * 60_000;
/** How long the no-record stage is watched: the door's refusal is one local
 * round trip, so a past that was going to be lent is lent well inside this. */
const NO_RECORD_WATCH_MS = 3_000;

/** The window's view as the frame draws it (the views track's `data-view`). */
const VIEW_NOW = `(document.querySelector(".vf-views-line")?.getAttribute("data-view") ?? "absent")`;
const HISTORY_ROOM = `document.querySelector('[data-cover-view="history"] .vf-history .ah-frame')`;
/** The timeline as the stage mounts it: the view's own root. */
const TIMELINE = `document.querySelector(".vf-godview-monitor-stage .vf-monitor-timeline")`;
/** What the status line says now: a refusal's words, for a failure's. */
const STATUS_LINE = `(document.querySelector(".vf-status-line__text")?.textContent ?? "nothing")`;

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
   * desktop and ended it — and words only its reply says, which History's
   * reader shows once the session is opened; undefined when it ran nothing
   * (no person, no index). */
  ranHere: { nativeSessionId: string; said: string } | undefined;
  /** ⌘2 / ⌘3, the road a person takes (the smoke's `pressViewKey`). */
  pressViewKey: (view: "godview" | "history") => void;
}

export interface TimelinePastVerdicts {
  timelinePast: unknown;
  timelineNoRecord: unknown;
  /** TV-8 — the ended lane pressed and its session opened in History. */
  timelineOpensEnded: unknown;
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

async function untilValue(
  win: BrowserWindow,
  label: string,
  expression: string,
  timeoutMs: number,
  accept: (value: string) => boolean,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = "";
  while (Date.now() < deadline) {
    seen = String(await win.webContents.executeJavaScript(expression));
    if (accept(seen)) return seen;
    await sleep(150);
  }
  throw new Error(`${label} did not happen within ${timeoutMs}ms (${seen})`);
}

/** History's room as the window draws it: the project and the session it is
 * on (the rows' own keys: rosetta's ids), and whether it shows `said`. */
interface RoomNow {
  room: boolean;
  project?: string | null;
  session?: string | null;
  says?: boolean;
}

const roomNow = (said: string): string => `(() => {
  const room = ${HISTORY_ROOM};
  if (!room) return JSON.stringify({ room: false });
  const key = (node) => node?.getAttribute("data-motion-key") ?? null;
  return JSON.stringify({
    room: true,
    project: key(room.querySelector(".ah-project-list-item.is-selected")),
    session: key(room.querySelector(".ah-session-list-item.is-selected")),
    says: (room.textContent ?? "").replace(/\\s+/g, " ").includes(${JSON.stringify(said)}),
  });
})()`;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The timeline as drawn: what its root says of the pointed lane, the lanes'
 * cursor, where the lanes and the axis above them are, each ended run's name
 * row, and the reader's controls that open one. */
interface LanesNow {
  view: boolean;
  opens?: string | null;
  cursor?: string | null;
  body?: Box | null;
  axis?: Box | null;
  ended?: Box[];
  readerOpens?: number;
}

const LANES_NOW = `(() => {
  const view = ${TIMELINE};
  if (!view) return JSON.stringify({ view: false });
  const box = (node) => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  const body = view.querySelector(".vf-monitor-timeline-body");
  return JSON.stringify({
    view: true,
    opens: view.getAttribute("data-opens"),
    cursor: body ? getComputedStyle(body).cursor : null,
    body: box(body),
    axis: box(view.querySelector(".vf-monitor-timeline-axis")),
    ended: [...view.querySelectorAll(".vf-monitor-timeline-name.is-ended")].map(box),
    readerOpens: [...view.querySelectorAll(".vf-monitor-timeline-agents li button")]
      .filter((button) => (button.textContent ?? "").endsWith(", opens in History")).length,
  });
})()`;

/** rosetta's session for a native id, as fieldd's own lookup lists it — the
 * thread's root before a delegated child, the row a reader navigates to (the
 * host's own rule, `open-ended-lane.ts`). */
async function recordedSession(handle: FielddHandle, nativeSessionId: string): Promise<string> {
  const rows = IndexSessionsResult.parse(
    await handle.client.request("index.sessions", { nativeSessionIds: [nativeSessionId] }),
  ).rows.filter((row) => row.nativeSessionId === nativeSessionId);
  const session = rows.find((row) => row.rootSessionId === row.sessionId) ?? rows[0];
  if (session === undefined) {
    throw new Error(
      `index.sessions lists no session for the run that ended here (${nativeSessionId})`,
    );
  }
  return session.sessionId;
}

interface OpensEndedOptions {
  /** the ended lane's `past:` id, as the door lists it */
  lane: string;
  /** rosetta's session for it: what History's room must be on */
  session: string;
  said: string;
  pressViewKey: TimelinePastOptions["pressViewKey"];
}

async function toView(
  win: BrowserWindow,
  opts: Pick<OpensEndedOptions, "pressViewKey">,
  view: "godview" | "history",
): Promise<void> {
  opts.pressViewKey(view);
  await untilValue(win, `⌘ to ${view}`, VIEW_NOW, 10_000, (now) => now === view);
}

/** TV-8, before the timeline is chosen: History's room is put OFF the run's
 * session — its project's row chosen again, which lets go of the session (the
 * room's own rule) — so the room standing on it later is the press's doing.
 * The window is back in Godview after. */
async function leaveTheSession(win: BrowserWindow, opts: OpensEndedOptions): Promise<RoomNow> {
  await toView(win, opts, "history");
  await untilValue(
    win,
    "History's room to let go of the run's session",
    `(() => {
      const room = ${HISTORY_ROOM};
      if (!room) return "no room";
      if (!room.querySelector(".ah-session-list-item.is-selected")) return "left";
      const project = room.querySelector(".ah-project-list-item.is-selected");
      if (!project) {
        // PJ-4 (H5): a project in a folded section (Temporary) is drawn once its fold is open
        const fold = room.querySelector('.ah-fold[aria-expanded="false"]');
        if (!fold) return "a session chosen under no project";
        fold.click();
        return "fold";
      }
      // a project row with a host act (H4) is a box: its covering button chooses
      (project.querySelector(".ah-project-list-item__hit") ?? project).click();
      return "project";
    })()`,
    30_000,
    (answer) => answer === "left",
  );
  const before = JSON.parse(
    String(await win.webContents.executeJavaScript(roomNow(opts.said))),
  ) as RoomNow;
  if (!before.room || before.session !== null) {
    throw new Error(`History's room still stands on a session: ${JSON.stringify(before)}`);
  }
  await toView(win, opts, "godview");
  return before;
}

/** TV-8, the timeline chosen and its past lent: the pointer rests on the ended
 * lane (the root says it opens), a press opens its session in History, and the
 * window comes back to Godview. */
async function openTheEndedLane(
  win: BrowserWindow,
  opts: OpensEndedOptions,
  before: RoomNow,
): Promise<Record<string, unknown>> {
  const lanes = async (): Promise<LanesNow> =>
    JSON.parse(String(await win.webContents.executeJavaScript(LANES_NOW))) as LanesNow;
  // the ended run's row, drawn and at rest (the lanes settle after the past is lent)
  let drawn: LanesNow = { view: false };
  let last = "";
  const deadline = Date.now() + 20_000;
  for (let rested = false; !rested && Date.now() < deadline; ) {
    drawn = await lanes();
    const now = JSON.stringify([drawn.body, drawn.ended]);
    rested = (drawn.ended?.length ?? 0) > 0 && now === last;
    last = now;
    if (!rested) await sleep(150);
  }
  const row = drawn.ended?.[0];
  const body = drawn.body;
  if (row === undefined || row.height <= 0 || body === null || body === undefined) {
    throw new Error(
      `the timeline was lent an ended run and draws no lane for it: ${JSON.stringify(drawn)}`,
    );
  }
  if ((drawn.readerOpens ?? 0) !== (drawn.ended?.length ?? 0)) {
    throw new Error(
      `the reader's list does not offer each ended run as a control that opens it: ${JSON.stringify(drawn)}`,
    );
  }
  // a point ON the lane the pointer can reach: over its wake first, else its name
  const y = Math.round(row.top + row.height / 2);
  const candidates = [
    Math.round(body.left + body.width * 0.6),
    Math.round(row.left + row.width / 2),
  ];
  let x: number | undefined;
  let under = "";
  for (const candidate of candidates) {
    under = String(
      await win.webContents.executeJavaScript(
        `(() => {
          const hit = document.elementFromPoint(${candidate}, ${y});
          if (hit?.closest(".vf-monitor-timeline-body")) return "lane";
          return hit ? hit.tagName.toLowerCase() + "." + String(hit.className).slice(0, 60) : "nothing";
        })()`,
      ),
    );
    if (under === "lane") {
      x = candidate;
      break;
    }
  }
  if (x === undefined) {
    throw new Error(
      `the ended lane is drawn where the pointer cannot reach it (${under} is over it): ${JSON.stringify(drawn)}`,
    );
  }

  // 1. off the lanes (the axis above them): the root says nothing
  const axis = drawn.axis ?? { left: body.left, top: body.top - 8, width: body.width, height: 0 };
  win.webContents.sendInputEvent({
    type: "mouseMove",
    x: Math.round(axis.left + axis.width / 2),
    y: Math.round(axis.top + axis.height / 2),
  });
  const off = JSON.parse(
    await untilValue(
      win,
      "the timeline's root to say nothing with the pointer off the lanes",
      LANES_NOW,
      5_000,
      (value) => (JSON.parse(value) as LanesNow).opens === null,
    ),
  ) as LanesNow;
  // 2. resting on the ended lane: the root says it opens, a control's cursor
  win.webContents.sendInputEvent({ type: "mouseMove", x, y });
  const on = JSON.parse(
    await untilValue(
      win,
      "the timeline's root to say it opens with the pointer resting on the ended lane",
      LANES_NOW,
      5_000,
      (value) => (JSON.parse(value) as LanesNow).opens === "true",
    ),
  ) as LanesNow;
  if (on.cursor !== "pointer") {
    throw new Error(`an ended lane that opens wears the cursor ${on.cursor}, not a control's`);
  }
  // 3. pressed where the pointer rests: Godview is left for History…
  win.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  try {
    await untilValue(
      win,
      "a press on the ended lane to leave Godview for History",
      VIEW_NOW,
      20_000,
      (now) => now === "history",
    );
  } catch (error) {
    const said = String(await win.webContents.executeJavaScript(STATUS_LINE));
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; the status line says: ${said}`,
    );
  }
  // …and History's room is on that run's session, its reply rendered
  const after = JSON.parse(
    await untilValue(
      win,
      "History's room on the ended run's session",
      roomNow(opts.said),
      30_000,
      (value) => {
        const now = JSON.parse(value) as RoomNow;
        return now.session === opts.session && now.says === true;
      },
    ),
  ) as RoomNow;
  // 4. back to Godview, where the rungs after expect the window
  await toView(win, opts, "godview");
  return {
    lane: opts.lane,
    session: opts.session,
    before: { room: { project: before.project, session: before.session, says: before.says } },
    drawn: { ended: drawn.ended?.length, readerOpens: drawn.readerOpens },
    pointer: { at: { x, y }, off: off.opens, resting: on.opens, cursor: on.cursor },
    opened: {
      view: "history",
      room: { project: after.project, session: after.session, says: after.says },
    },
    back: "godview",
  };
}

/** The rungs: those this run's configuration can show, and the others' reason. */
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
        timelineOpensEnded:
          "unavailable: this desktop keeps no record of past runs (no agent index), so its timeline has no ended lane to open",
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
          timelineOpensEnded:
            "unavailable: the Jump rung ran no seeded conversation here, so no run ended for the timeline to lend as a lane",
        };
      } else {
        const door = await untilEndedAtTheDoor(handle, opts.ranHere.nativeSessionId);
        // TV-8 — the run's session, and History's room put off it, before the timeline is chosen
        const opening: OpensEndedOptions = {
          lane: door.lane,
          session: await recordedSession(handle, opts.ranHere.nativeSessionId),
          said: opts.ranHere.said,
          pressViewKey: opts.pressViewKey,
        };
        const roomBefore = await leaveTheSession(win, opening);
        await chooseView(win, monitor, "TIMELINE", "timeline");
        const lent = await monitor.until(
          (facts) =>
            facts.viewId === "timeline" &&
            facts.history === "complete" &&
            (facts.endedLanes ?? 0) >= 1,
          "the timeline's stage to lend a complete past with the run that ended here",
          30_000,
        );
        const timelineOpensEnded = await openTheEndedLane(win, opening, roomBefore);
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
          timelineOpensEnded,
        };
      }
    }
  } catch (error) {
    failure = error;
  }
  try {
    // a rung that failed in History leaves the window there: Godview first, where the bar is
    if (String(await win.webContents.executeJavaScript(VIEW_NOW)) !== "godview") {
      await toView(win, opts, "godview");
    }
    await chooseView(win, monitor, "SWARM", "swarm");
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
  if (verdicts === undefined) throw new Error("unreachable: the timeline rungs said nothing");
  return verdicts;
}
