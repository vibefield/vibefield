// @vitest-environment happy-dom
/**
 * TL (docket v9, RULED 2026-10-09; B-D6 (a)) — the record's past, lent to a
 * view as `capabilities.history`, through the window's door
 * (`agent.recordedLanes`, the backend's derivation).
 *
 * Two claims. PF6: the door is asked only while a mounted view asks — never
 * before it asks, never after it unmounts or stops asking, and the rows'
 * movement under a standing ask reads again no sooner than the floor. And the
 * capability REACHES a view's input: a recording view (the SDK's own test
 * view, never the timeline) reports an ask on mount, and the next input it is
 * handed carries the past, each ended lane coloured with the theme and its
 * desktop said by this reader.
 */

import type { MonitorHistory, MonitorHistoryAsk, ViewReport } from "@vibecook/puppeteer-view-sdk";
import { MonitorViewHost } from "@vibecook/puppeteer-view-sdk/host";
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
  HISTORY_REFRESH_MIN_MS,
  historyRowsKey,
  type RecordedLanesPort,
  useMonitorHistory,
} from "../src/godview/monitor/monitor-history";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 9, 12);
const HERE = "01JDESK";
const PALETTE = fixturePalette("dark");

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
      project: { name: "billing-api", seq: 3 },
      device: { id: HERE, name: "Studio", os: "mac" },
      startedAt: NOW - 3 * HOUR,
      endedAt: NOW - 2 * HOUR,
      spans: [{ kind: "active", from: NOW - 3 * HOUR, to: NOW - 2 * HOUR }],
    },
    {
      id: "past:claude:nat-peer",
      project: { name: "" },
      device: { id: "01JPEER", name: "Laptop" },
      startedAt: NOW - 2 * HOUR,
      endedAt: NOW - HOUR,
      spans: [{ kind: "active", from: NOW - 2 * HOUR, to: NOW - HOUR }],
    },
  ],
});

interface FakePort extends RecordedLanesPort {
  readonly asks: { sinceMs: number; untilMs: number }[];
  /** settle the oldest pending read */
  answer(result?: AgentRecordedLanesResult | Error): Promise<void>;
  readonly pending: number;
}

function fakePort(): FakePort {
  const asks: { sinceMs: number; untilMs: number }[] = [];
  const waiting: Array<{
    resolve: (r: AgentRecordedLanesResult) => void;
    reject: (e: Error) => void;
  }> = [];
  return {
    asks,
    get pending() {
      return waiting.length;
    },
    read(window) {
      asks.push(window);
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    async answer(result = ANSWER) {
      const next = waiting.shift();
      if (next === undefined) throw new Error("no read is waiting");
      await act(async () => {
        if (result instanceof Error) next.reject(result);
        else next.resolve(result);
      });
    },
  };
}

type Rows = { id: string; kind: string; statusSince: number }[];

let root: Root | undefined;
let host: HTMLElement | undefined;
let seen: Array<MonitorHistory | undefined> = [];
let setProps:
  | ((props: { port?: RecordedLanesPort; ask?: MonitorHistoryAsk; rows: Rows }) => void)
  | undefined;

function Probe(initial: { port?: RecordedLanesPort; ask?: MonitorHistoryAsk; rows: Rows }) {
  const [props, set] = useState(initial);
  setProps = set;
  const history = useMonitorHistory({
    port: props.port,
    ask: props.ask,
    rows: props.rows,
    here: HERE,
    palette: PALETTE,
    now: () => Date.now(),
  });
  seen.push(history);
  return null;
}

async function mount(props: { port?: RecordedLanesPort; ask?: MonitorHistoryAsk; rows: Rows }) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Probe {...props} />));
}

const last = () => seen[seen.length - 1];

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

describe("the window asks the backend's door only while a mounted view asks (PF6)", () => {
  it("asks nothing before a view asks, then once, for the view's day ending now", async () => {
    const port = fakePort();
    await mount({ port, rows: ROWS });
    expect(port.asks).toEqual([]);
    expect(last()).toBeUndefined();
    await act(async () => setProps!({ port, ask: { sinceMs: NOW - 3 * DAY }, rows: ROWS }));
    // clamped to the day (T2)
    expect(port.asks).toEqual([{ sinceMs: NOW - DAY, untilMs: NOW }]);
    await port.answer();
    const history = last()!;
    expect(history.fidelity).toBe("bounds");
    const colourFor = projectColourFor(PALETTE);
    expect(history.ended.map((lane) => [lane.id, lane.colour, lane.device.self])).toEqual([
      ["past:claude:nat-today", colourFor(3), true],
      ["past:claude:nat-peer", colourFor(undefined), false],
    ]);
  });

  it("a scrub back past what it holds (a new seq) reads again at once; the same ask does not", async () => {
    const port = fakePort();
    await mount({ port, ask: { sinceMs: NOW - DAY }, rows: ROWS });
    await port.answer();
    await act(async () => setProps!({ port, ask: { sinceMs: NOW - DAY }, rows: ROWS }));
    expect(port.asks).toHaveLength(1);
    await act(async () => setProps!({ port, ask: { sinceMs: NOW - DAY, seq: 1 }, rows: ROWS }));
    expect(port.asks).toHaveLength(2);
  });

  it("the rows' movement under the ask reads again, no sooner than the floor, once", async () => {
    const port = fakePort();
    await mount({ port, ask: { sinceMs: NOW - DAY }, rows: ROWS });
    await port.answer();
    // a terminal's status is no seam; a run's is
    await act(async () =>
      setProps!({
        port,
        ask: { sinceMs: NOW - DAY },
        rows: [ROWS[0]!, { ...ROWS[1]!, statusSince: NOW - 1 }],
      }),
    );
    await act(async () => vi.advanceTimersByTime(HISTORY_REFRESH_MIN_MS));
    expect(port.asks).toHaveLength(1);
    await act(async () =>
      setProps!({ port, ask: { sinceMs: NOW - DAY }, rows: [{ ...ROWS[0]!, statusSince: NOW }] }),
    );
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(port.asks).toHaveLength(2);
    // the run left the model: again, but not before the floor from that read
    await act(async () => setProps!({ port, ask: { sinceMs: NOW - DAY }, rows: [] }));
    await act(async () => vi.advanceTimersByTime(HISTORY_REFRESH_MIN_MS - 1));
    expect(port.asks).toHaveLength(2);
    await act(async () => vi.advanceTimersByTime(1));
    expect(port.asks).toHaveLength(3);
  });

  it("the view stops asking (switched away): the past goes, and nothing more is read", async () => {
    const port = fakePort();
    await mount({ port, ask: { sinceMs: NOW - DAY }, rows: ROWS });
    await port.answer();
    expect(last()).toBeDefined();
    await act(async () => setProps!({ port, rows: ROWS }));
    expect(last()).toBeUndefined();
    await act(async () => setProps!({ port, rows: [] }));
    await act(async () => vi.advanceTimersByTime(10 * HISTORY_REFRESH_MIN_MS));
    expect(port.asks).toHaveLength(1);
  });

  it("Godview closes mid-read: the late answer reaches nothing, and no timer outlives the stage", async () => {
    const port = fakePort();
    await mount({ port, ask: { sinceMs: NOW - DAY }, rows: ROWS });
    await act(async () => setProps!({ port, ask: { sinceMs: NOW - DAY }, rows: [] }));
    const before = seen.length;
    await act(async () => root!.unmount());
    root = undefined;
    await port.answer();
    expect(seen.length).toBe(before);
    await act(async () => vi.advanceTimersByTime(10 * HISTORY_REFRESH_MIN_MS));
    expect(port.asks).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a door that refuses is the past's honest unavailable, in words", async () => {
    const port = fakePort();
    await mount({ port, ask: { sinceMs: NOW - DAY }, rows: ROWS });
    await port.answer(new Error("UNAVAILABLE"));
    expect(last()).toMatchObject({
      state: "unavailable",
      detail: "The record of past runs could not be read",
      live: [],
      ended: [],
    });
  });

  it("only agent rows' seams move a re-read", () => {
    expect(historyRowsKey(ROWS)).toBe(`run-1@${NOW - HOUR}`);
  });
});

describe("the capability reaches a view's input", () => {
  it("a test view reports an ask on mount, and its next input carries the past", async () => {
    vi.useRealTimers();
    const port = fakePort();
    const frames = createFrameDriver();
    const replica = createFixtureReplica(agentViewsFixture(2));
    const recording = createRecordingView("past-reader", {
      manifest: { capabilities: { optional: ["history"] } },
      onMount: (_root, _input, commands) => commands.report({ history: { sinceMs: NOW - DAY } }),
    });
    const commands = { select: vi.fn(), create: vi.fn(async () => ({ opened: true })) };

    function Stage() {
      const [report, setReport] = useState<ViewReport>({});
      const history = useMonitorHistory({
        port,
        ask: report.history,
        rows: [],
        here: HERE,
        palette: PALETTE,
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
          onReport={(next) => setReport(next)}
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
    await port.answer();
    await act(async () => frames.step());
    const history = recording.lastInput!.capabilities.history!;
    expect(history.ended.map((lane) => lane.id)).toEqual([
      "past:claude:nat-today",
      "past:claude:nat-peer",
    ]);
    expect(history.ended[0]!.colour).toBe(projectColourFor(PALETTE)(3));
    expect(history.ended[0]!.spans).toEqual([
      { kind: "active", from: NOW - 3 * HOUR, to: NOW - 2 * HOUR },
    ]);
  });
});
