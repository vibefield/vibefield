// @vitest-environment happy-dom
/**
 * TL (docket v9, RULED 2026-10-09; B-D6 (a); TIMELINE SHAPES v2) — the record's
 * past, lent to a view as `capabilities.history`, through the window's door
 * (`agent.recordedLanes`, the backend's derivation).
 *
 * The claims:
 * - PF6: the door is read only while a mounted view's MANIFEST declares
 *   `history`, over the fixed day — never otherwise, never after unmount.
 * - Identity (v2 item 5): a re-read that brings nothing new (only `readAt`
 *   moved) keeps the SAME object, so the view is not updated for it.
 * - Re-reads (v2 item 8): a row leaving reads again within a second; a seam
 *   moving or a row arriving, no sooner than the floor.
 * - Honest states (v2 items 3, 9): absent before the first answer;
 *   `unavailable` with words when nothing good was read; a failed re-read KEEPS
 *   the last good past as `partial`; a desktop with no record lends nothing.
 * - Ended lanes are coloured and receded by the window's rules (v2 item 11),
 *   and a recording view (the SDK's own test view, never the timeline) receives
 *   the past through MonitorViewHost.
 * - This desktop's mark follows this desktop's id: an answer read before the id
 *   is known marks its lanes when the id arrives, with no new read, once.
 */

import type { MonitorHistory } from "@vibecook/puppeteer-view-sdk";
import { MonitorViewHost, viewWantsHistory } from "@vibecook/puppeteer-view-sdk/host";
import type { MonitorEndedRow } from "@vibecook/puppeteer-view-sdk/model";
import {
  agentViewsFixture,
  createFixtureReplica,
  createFrameDriver,
  createRecordingView,
  fixturePalette,
  fixtureStage,
  fixtureTheme,
} from "@vibecook/puppeteer-view-sdk/testing";
import { projectColourFor } from "@vibecook/puppeteer-view-sdk/toolkit";
import { AgentRecordedLanesResult } from "@vibefield/contracts";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HISTORY_LEFT_DEBOUNCE_MS,
  HISTORY_REFRESH_MIN_MS,
  historyRowsKey,
  KEPT_PAST_DETAIL,
  type RecordedLanesPort,
  useMonitorHistory,
} from "../src/godview/monitor/monitor-history";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 9, 12);
const HERE = "01JDESK";
const PALETTE = fixturePalette("dark");
const NEVER_RECEDES = (_lane: MonitorEndedRow): boolean => false;

const ANSWER = AgentRecordedLanesResult.parse({
  sinceMs: NOW - DAY,
  untilMs: NOW,
  readAt: NOW,
  fidelity: "bounds",
  state: "complete",
  live: [],
  ended: [
    {
      id: "past:claude:nat-today",
      provider: { id: "claude", label: "Claude Code" },
      title: "Split the invoice writer",
      profileSet: "work",
      project: { name: "billing-api", seq: 3 },
      device: { id: HERE, name: "Studio", os: "mac" },
      startedAt: NOW - 3 * HOUR,
      endedAt: NOW - 2 * HOUR,
      spans: [{ kind: "bounds", from: NOW - 3 * HOUR, to: NOW - 2 * HOUR }],
    },
    {
      id: "past:claude:nat-peer",
      project: { name: "" },
      device: { id: "01JPEER", name: "Laptop", os: "an-os-this-build-has-no-mark-for" },
      startedAt: NOW - 2 * HOUR,
      endedAt: NOW - HOUR,
      spans: [{ kind: "bounds", from: NOW - 2 * HOUR, to: NOW - HOUR }],
    },
  ],
});

/** A door whose answers the test settles one by one. */
interface FakePort extends RecordedLanesPort {
  readonly asks: { sinceMs: number; untilMs: number }[];
  answer(result?: AgentRecordedLanesResult | Error | Record<string, unknown>): Promise<void>;
}

function fakePort(): FakePort {
  const asks: { sinceMs: number; untilMs: number }[] = [];
  const waiting: Array<{
    resolve: (r: AgentRecordedLanesResult) => void;
    reject: (e: unknown) => void;
  }> = [];
  return {
    asks,
    read(window) {
      asks.push(window);
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    // TV-8's lookup is `godview-open-ended-lane.test.tsx`'s; nothing here opens a lane
    sessions: () => Promise.resolve([]),
    async answer(result = ANSWER) {
      const next = waiting.shift();
      if (next === undefined) throw new Error("no read is waiting");
      await act(async () => {
        if (result instanceof Error || !("ended" in result)) next.reject(result);
        else next.resolve(result as AgentRecordedLanesResult);
      });
    },
  };
}

type Rows = { id: string; kind: string; statusSince: number }[];
interface ProbeProps {
  port?: RecordedLanesPort;
  wants: boolean;
  rows: Rows;
  receded?: (lane: MonitorEndedRow) => boolean;
  desk?: string | null;
  /** this desktop's id; null: not known yet (neither the roster nor the board has said). Absent: HERE */
  here?: string | null;
}

let root: Root | undefined;
let host: HTMLElement | undefined;
let seen: Array<MonitorHistory | undefined> = [];
let setProps: ((props: ProbeProps) => void) | undefined;

function Probe(initial: ProbeProps) {
  const [props, set] = useState(initial);
  setProps = set;
  const history = useMonitorHistory({
    port: props.port,
    wants: props.wants,
    rows: props.rows,
    here: props.here === null ? undefined : (props.here ?? HERE),
    palette: PALETTE,
    receded: props.receded ?? NEVER_RECEDES,
    desk: props.desk ?? null,
    now: () => Date.now(),
  });
  seen.push(history);
  return null;
}

async function mount(props: ProbeProps) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Probe {...props} />));
}

const last = () => seen[seen.length - 1];
const update = async (props: ProbeProps) => act(async () => setProps!(props));
const advance = async (ms: number) => act(async () => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
  seen = [];
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  setProps = undefined;
  vi.useRealTimers();
});

const ROWS: Rows = [
  { id: "run-1", kind: "agent", statusSince: NOW - HOUR },
  { id: "pty-9", kind: "terminal", statusSince: NOW - HOUR },
];

describe("the window reads the backend's door only while a mounted view declares history (PF6)", () => {
  it("reads nothing for a view that does not declare it; once, for the fixed day, for one that does", async () => {
    const port = fakePort();
    await mount({ port, wants: false, rows: ROWS });
    expect(port.asks).toEqual([]);
    expect(last()).toBeUndefined();
    await update({ port, wants: true, rows: ROWS });
    expect(port.asks).toEqual([{ sinceMs: NOW - DAY, untilMs: NOW }]);
    // absent until the first answer: the view draws today's floor
    expect(last()).toBeUndefined();
    await port.answer();
    const history = last()!;
    const colourFor = projectColourFor(PALETTE);
    // colour, `self` and the OS mark as the model's rows say them
    expect(
      history.ended.map((lane) => [
        lane.id,
        lane.colour,
        lane.device.self,
        lane.device.os,
        lane.receded,
      ]),
    ).toEqual([
      ["past:claude:nat-today", colourFor(3), true, "mac", false],
      ["past:claude:nat-peer", colourFor(undefined), false, undefined, false],
    ]);
  });

  it("the view goes (or stops declaring it): the past goes and nothing more is read", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS });
    await port.answer();
    expect(last()).toBeDefined();
    await update({ port, wants: false, rows: ROWS });
    expect(last()).toBeUndefined();
    await update({ port, wants: false, rows: [] });
    await advance(10 * HISTORY_REFRESH_MIN_MS);
    expect(port.asks).toHaveLength(1);
  });

  it("Godview closes mid-read: the late answer reaches nothing, and no timer outlives the stage", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS });
    await update({ port, wants: true, rows: [] });
    const before = seen.length;
    await act(async () => root!.unmount());
    root = undefined;
    await port.answer();
    expect(seen.length).toBe(before);
    await advance(10 * HISTORY_REFRESH_MIN_MS);
    expect(port.asks).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("identity: built once per snapshot, kept while nothing moves (v2 item 5)", () => {
  it("a re-read that only moves readAt keeps the SAME object; a re-read that moves the past makes a new one", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS });
    await port.answer();
    const first = last()!;
    // a publish that changes nothing the hook reads: the same object
    await update({ port, wants: true, rows: [...ROWS] });
    expect(last()).toBe(first);
    // a row leaves → a re-read whose answer differs only in readAt
    await update({ port, wants: true, rows: [ROWS[1]!] });
    await advance(HISTORY_LEFT_DEBOUNCE_MS);
    expect(port.asks).toHaveLength(2);
    await port.answer({ ...ANSWER, readAt: NOW + 1_000 });
    expect(last()).toBe(first);
    // a row arrives → after the floor, a re-read that moves the past
    await update({
      port,
      wants: true,
      rows: [ROWS[1]!, { id: "run-2", kind: "agent", statusSince: NOW }],
    });
    await advance(HISTORY_REFRESH_MIN_MS);
    expect(port.asks).toHaveLength(3);
    await port.answer({ ...ANSWER, readAt: NOW + 2_000, ended: ANSWER.ended.slice(1) });
    expect(last()).not.toBe(first);
    expect(last()!.ended.map((lane) => lane.id)).toEqual(["past:claude:nat-peer"]);
  });

  it("a filter change rebuilds the lanes' receded from the same snapshot; an unknown profile recedes under a profile tab", async () => {
    const port = fakePort();
    const underWork = (lane: MonitorEndedRow): boolean =>
      !(lane.device.self && lane.profileSet === "work");
    await mount({ port, wants: true, rows: ROWS });
    await port.answer();
    const all = last()!;
    await update({ port, wants: true, rows: ROWS, receded: underWork });
    const work = last()!;
    expect(work).not.toBe(all);
    expect(work.ended.map((lane) => lane.receded)).toEqual([false, true]);
    expect(port.asks).toHaveLength(1);
  });
});

describe("an ended lane does what a live row does under each filter (the MV lead's ruling, 2026-10-10)", () => {
  it("the scope row's desktop NARROWS: this desktop's ended lanes leave before the past is lent, and the object holds while the choice does", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS, desk: "01JPEER" });
    await port.answer();
    const peerOnly = last()!;
    expect(peerOnly.ended.map((lane) => lane.id)).toEqual(["past:claude:nat-peer"]);
    // narrowed, never receded: what is left is drawn whole
    expect(peerOnly.ended.map((lane) => lane.receded)).toEqual([false]);
    // publishes with the choice unchanged keep the SAME object
    await update({ port, wants: true, rows: [...ROWS], desk: "01JPEER" });
    await update({ port, wants: true, rows: [...ROWS], desk: "01JPEER" });
    expect(last()).toBe(peerOnly);
    // this desktop chosen: only its lane
    await update({ port, wants: true, rows: [...ROWS], desk: HERE });
    expect(last()!.ended.map((lane) => lane.id)).toEqual(["past:claude:nat-today"]);
    // every desktop: both, and no new read was needed for any of it
    await update({ port, wants: true, rows: [...ROWS], desk: null });
    expect(last()!.ended.map((lane) => lane.id)).toEqual([
      "past:claude:nat-today",
      "past:claude:nat-peer",
    ]);
    expect(port.asks).toHaveLength(1);
  });

  it("a choice that drops nothing lends the same object as no choice", async () => {
    const port = fakePort();
    const peerOnlyAnswer = { ...ANSWER, ended: ANSWER.ended.slice(1) };
    await mount({ port, wants: true, rows: ROWS, desk: null });
    await port.answer(peerOnlyAnswer);
    const all = last()!;
    await update({ port, wants: true, rows: ROWS, desk: "01JPEER" });
    expect(last()).toBe(all);
  });
});

describe("this desktop's mark follows this desktop's id (LANDED §TL's owed row: `here` known after the answer)", () => {
  /** the profile tab's rule, which reads the mark: only this desktop's runs under Work stay lit */
  const underWork = (lane: MonitorEndedRow): boolean =>
    !(lane.device.self && lane.profileSet === "work");
  const marks = () => last()!.ended.map((lane) => [lane.id, lane.device.self, lane.receded]);

  it("an answer read while `here` is unknown marks no lane; when `here` arrives its lanes are marked at once, with no new read", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS, here: null, receded: underWork });
    await port.answer();
    // nobody has said which desktop is here: no lane is this desktop's, so every lane recedes under the tab
    expect(marks()).toEqual([
      ["past:claude:nat-today", false, true],
      ["past:claude:nat-peer", false, true],
    ]);
    await update({ port, wants: true, rows: ROWS, here: HERE, receded: underWork });
    expect(marks()).toEqual([
      ["past:claude:nat-today", true, false],
      ["past:claude:nat-peer", false, true],
    ]);
    await advance(10 * HISTORY_REFRESH_MIN_MS);
    expect(port.asks).toHaveLength(1);
  });

  it("the mark is said once: publishes after it, and a re-read that moves nothing, keep the SAME object", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS, here: null });
    await port.answer();
    const unmarked = last()!;
    await update({ port, wants: true, rows: ROWS, here: HERE });
    const marked = last()!;
    expect(marked).not.toBe(unmarked);
    expect(marked.ended[0]!.device.self).toBe(true);
    // publishes that move nothing the hook reads
    await update({ port, wants: true, rows: [...ROWS], here: HERE });
    await update({ port, wants: true, rows: [...ROWS], here: HERE });
    expect(last()).toBe(marked);
    // a run leaves → a re-read whose answer differs only in readAt: nothing in the lent past moved
    await update({ port, wants: true, rows: [ROWS[1]!], here: HERE });
    await advance(HISTORY_LEFT_DEBOUNCE_MS);
    expect(port.asks).toHaveLength(2);
    await port.answer({ ...ANSWER, readAt: NOW + 1_000 });
    expect(last()).toBe(marked);
  });

  it("`here` arriving marks nothing when no lane is this desktop's: the SAME object", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS, here: null });
    await port.answer({ ...ANSWER, ended: ANSWER.ended.slice(1) });
    const before = last()!;
    await update({ port, wants: true, rows: ROWS, here: HERE });
    expect(last()).toBe(before);
  });

  it("a past kept over a failed re-read keeps the marks `here` gave it", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS, here: null });
    await port.answer();
    await update({ port, wants: true, rows: ROWS, here: HERE });
    await update({ port, wants: true, rows: [ROWS[1]!], here: HERE });
    await advance(HISTORY_LEFT_DEBOUNCE_MS);
    await port.answer(new Error("UNAVAILABLE"));
    expect(last()!.state).toBe("partial");
    expect(last()!.ended.map((lane) => lane.device.self)).toEqual([true, false]);
  });

  it("`here` known before the answer: the lanes are marked as they are first lent, and one object is lent", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS });
    const before = seen.length;
    await port.answer();
    const lent = seen.slice(before).filter((history) => history !== undefined);
    expect(new Set(lent).size).toBe(1);
    expect(last()!.ended.map((lane) => lane.device.self)).toEqual([true, false]);
  });
});

describe("re-reads follow the rows (v2 item 8)", () => {
  it("a run leaving the model reads again within a second; a terminal's status moves nothing", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS });
    await port.answer();
    await update({ port, wants: true, rows: [ROWS[0]!, { ...ROWS[1]!, statusSince: NOW - 1 }] });
    await advance(HISTORY_REFRESH_MIN_MS);
    expect(port.asks).toHaveLength(1);
    await update({ port, wants: true, rows: [ROWS[1]!] });
    await advance(HISTORY_LEFT_DEBOUNCE_MS - 1);
    expect(port.asks).toHaveLength(1);
    await advance(1);
    expect(port.asks).toHaveLength(2);
  });

  it("a seam moving or a row arriving reads again no sooner than the floor", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS });
    await port.answer({ ...ANSWER, live: [{ id: "run-1", seamAt: NOW - HOUR, spans: [] }] });
    await update({
      port,
      wants: true,
      rows: [{ ...ROWS[0]!, statusSince: NOW - 1_000 }, ROWS[1]!],
    });
    await advance(HISTORY_REFRESH_MIN_MS - 1);
    expect(port.asks).toHaveLength(1);
    await advance(1);
    expect(port.asks).toHaveLength(2);
    await port.answer();
    await update({
      port,
      wants: true,
      rows: [...ROWS, { id: "run-new", kind: "agent", statusSince: NOW }],
    });
    await advance(HISTORY_REFRESH_MIN_MS - 1);
    expect(port.asks).toHaveLength(2);
    await advance(1);
    expect(port.asks).toHaveLength(3);
  });

  it("only agent rows' seams move a re-read", () => {
    expect(historyRowsKey(ROWS)).toBe(`run-1@${NOW - HOUR}`);
  });

  it("a leaving is not dropped by the next publish: another row's status moving inside the second changes nothing", async () => {
    const port = fakePort();
    const other = { id: "run-2", kind: "agent", statusSince: NOW - HOUR };
    await mount({ port, wants: true, rows: [ROWS[0]!, other] });
    await port.answer();
    await update({ port, wants: true, rows: [other] });
    await advance(HISTORY_LEFT_DEBOUNCE_MS / 2);
    // the record holds no lane for run-2, so its status moves no re-read of its own
    await update({ port, wants: true, rows: [{ ...other, statusSince: NOW }] });
    await advance(HISTORY_LEFT_DEBOUNCE_MS / 2);
    expect(port.asks).toHaveLength(2);
  });

  it("a leaving is not put off to the floor by a seam moving inside the second", async () => {
    const port = fakePort();
    const other = { id: "run-2", kind: "agent", statusSince: NOW - HOUR };
    await mount({ port, wants: true, rows: [ROWS[0]!, other] });
    await port.answer({ ...ANSWER, live: [{ id: "run-2", seamAt: NOW - HOUR, spans: [] }] });
    await update({ port, wants: true, rows: [other] });
    await advance(HISTORY_LEFT_DEBOUNCE_MS / 2);
    await update({ port, wants: true, rows: [{ ...other, statusSince: NOW }] });
    await advance(HISTORY_LEFT_DEBOUNCE_MS / 2);
    expect(port.asks).toHaveLength(2);
    // and that one read served the seam too: nothing more is asked at the floor
    await port.answer({ ...ANSWER, live: [{ id: "run-2", seamAt: NOW, spans: [] }] });
    await advance(10 * HISTORY_REFRESH_MIN_MS);
    expect(port.asks).toHaveLength(2);
  });

  it("a view that begins to ask reads once: the rows it begins with are the baseline, not a row arriving", async () => {
    const port = fakePort();
    await mount({ port, wants: false, rows: ROWS });
    await update({ port, wants: true, rows: ROWS });
    await port.answer();
    await advance(10 * HISTORY_REFRESH_MIN_MS);
    expect(port.asks).toHaveLength(1);
  });
});

/** Rows that count each walk of them (`historyRowsKey` filters). */
function countedRows(rows: Rows): { rows: Rows; walks: () => number } {
  let walks = 0;
  const counted = new Proxy([...rows], {
    get(target, key, receiver) {
      if (key === "filter") walks += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  return { rows: counted, walks: () => walks };
}

describe("the rows are watched only while a read could follow", () => {
  it("each publish is walked once while the view asks; never for a view that does not ask", async () => {
    const port = fakePort();
    const idle = countedRows(ROWS);
    await mount({ port, wants: false, rows: idle.rows });
    expect(idle.walks()).toBe(0);
    const asked = countedRows(ROWS);
    await update({ port, wants: true, rows: asked.rows });
    await port.answer();
    // the answer re-renders the window with the same rows: they are not walked again
    expect(asked.walks()).toBe(1);
  });

  it("a door with no record stops the watch: a publish walks nothing", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS });
    await port.answer({
      rpc: {
        data: { kind: "NOT_FOUND", details: { service: "agent.monitor", state: "no-record" } },
      },
    });
    const published = countedRows([...ROWS, { id: "run-new", kind: "agent", statusSince: NOW }]);
    await update({ port, wants: true, rows: published.rows });
    expect(published.walks()).toBe(0);
    expect(last()).toBeUndefined();
  });
});

describe("honest states (v2 items 3, 9)", () => {
  it("nothing good read yet: the record's own unavailable, with its words", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS });
    await port.answer({
      ...ANSWER,
      state: "unavailable",
      detail: "The agent index is starting",
      ended: [],
    });
    expect(last()).toMatchObject({
      state: "unavailable",
      detail: "The agent index is starting",
      ended: [],
    });
  });

  it("a failed re-read after a good one KEEPS the last past, marked partial, and never empties the lanes", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS });
    await port.answer();
    await update({ port, wants: true, rows: [ROWS[1]!] });
    await advance(HISTORY_LEFT_DEBOUNCE_MS);
    await port.answer(new Error("UNAVAILABLE"));
    const kept = last()!;
    expect(kept.state).toBe("partial");
    expect(kept.detail).toBe(KEPT_PAST_DETAIL);
    expect(kept.ended.map((lane) => lane.id)).toEqual([
      "past:claude:nat-today",
      "past:claude:nat-peer",
    ]);
    // the backend's own unavailable after a good read is kept the same way, and the object holds
    await update({ port, wants: true, rows: [] });
    await update({ port, wants: true, rows: [{ id: "run-3", kind: "agent", statusSince: NOW }] });
    await advance(HISTORY_REFRESH_MIN_MS);
    await port.answer({
      ...ANSWER,
      state: "unavailable",
      detail: "The agent index is starting",
      ended: [],
    });
    expect(last()).toBe(kept);
  });

  it("a door with no record lends nothing and is not asked again", async () => {
    const port = fakePort();
    await mount({ port, wants: true, rows: ROWS });
    await port.answer({
      rpc: {
        data: { kind: "NOT_FOUND", details: { service: "agent.monitor", state: "no-record" } },
      },
    });
    expect(last()).toBeUndefined();
    await update({ port, wants: true, rows: [] });
    await advance(10 * HISTORY_REFRESH_MIN_MS);
    expect(port.asks).toHaveLength(1);
  });

  it("a door with no port lends nothing", async () => {
    await mount({ wants: true, rows: ROWS });
    expect(last()).toBeUndefined();
  });
});

describe("the capability reaches a view's input", () => {
  it("a test view that declares history receives the past, and the same object across a re-read that moved nothing", async () => {
    vi.useRealTimers();
    const port = fakePort();
    const frames = createFrameDriver();
    const replica = createFixtureReplica(agentViewsFixture(2));
    const recording = createRecordingView("past-reader", {
      manifest: { capabilities: { optional: ["history"] } },
    });
    const commands = { select: vi.fn(), create: vi.fn(async () => ({ opened: true })) };
    let rerender: ((n: number) => void) | undefined;

    function Stage() {
      const [rows, setRows] = useState<Rows>(ROWS);
      rerender = (n) => setRows(n === 0 ? ROWS : [ROWS[1]!]);
      const history = useMonitorHistory({
        port,
        wants: viewWantsHistory(recording.view),
        rows,
        here: HERE,
        palette: PALETTE,
        receded: NEVER_RECEDES,
        desk: null,
        now: () => NOW,
      });
      return (
        <MonitorViewHost
          replica={replica}
          view={recording.view}
          stage={fixtureStage("default")}
          theme={fixtureTheme("dark")}
          parameters={{}}
          capabilities={history === undefined ? {} : { history }}
          commands={commands}
          scheduler={frames.scheduler}
        />
      );
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<Stage />));
    expect(recording.mounts).toBe(1);
    expect(port.asks).toEqual([{ sinceMs: NOW - DAY, untilMs: NOW }]);
    expect(recording.lastInput!.capabilities.history).toBeUndefined();
    await port.answer();
    await act(async () => frames.step());
    const history = recording.lastInput!.capabilities.history!;
    expect(history.ended.map((lane) => [lane.id, lane.title])).toEqual([
      ["past:claude:nat-today", "Split the invoice writer"],
      ["past:claude:nat-peer", undefined],
    ]);
    expect(history.ended[0]!.colour).toBe(projectColourFor(PALETTE)(3));
    // a run leaves; the re-read moves nothing but readAt: no update reaches the view
    const updates = recording.updates;
    await act(async () => rerender!(1));
    await act(
      async () => new Promise((resolve) => setTimeout(resolve, HISTORY_LEFT_DEBOUNCE_MS + 50)),
    );
    expect(port.asks).toHaveLength(2);
    await port.answer({ ...ANSWER, readAt: NOW + 5_000 });
    await act(async () => frames.step());
    expect(recording.lastInput!.capabilities.history).toBe(history);
    expect(recording.updates).toBe(updates);
  });
});
