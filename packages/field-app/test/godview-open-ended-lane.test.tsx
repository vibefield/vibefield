// @vitest-environment happy-dom
/**
 * TV-8 (RULED 2026-10-11) — an ended lane opens its session in History: the
 * host's half, `openEndedLane` (`src/godview/monitor/open-ended-lane.ts`). The
 * view's command and its click are puppeteer's and are not wired here.
 *
 * The claims:
 * - The native session id is read off the lane the hook LENDS — its own
 *   provider strips the prefix — so a native id that holds a colon survives. A
 *   lane that names no provider is read by the id's own grammar: a provider id
 *   holds no colon, so it ends at the first one. A lane the timeline no longer
 *   lends is a refusal, said.
 * - The index's lookup (`index.sessions`) is asked for that one id. Of several
 *   rows the lane's own provider's is kept when a row names one, else the
 *   thread's root; a row naming another provider is not this run's.
 * - The open is the Peek's past pick from Godview, call for call: the place
 *   first (`openHistoryAt`), then the History view.
 * - An answer that lands after the person left Godview opens nothing and says
 *   nothing: they clicked, then went elsewhere, and History must not pull them
 *   back.
 * - A refusal is said on the status line, once: the record cannot be read now
 *   (the door's own words as the detail), and no session is recorded.
 * - One ask at a time per lane; a newer pick wins over an older ask's answer.
 * - `openEndedLane` is one function for the window's life: it reads what the
 *   hook lends at the moment it is called. It exists before any past does.
 * - The view side's contract (puppeteer `dce6adb`): the view reads the
 *   command's presence once, at mount, and calls it synchronously from its own
 *   pointerup, keydown or click, catching nothing. So it returns at once and
 *   NEVER throws, whatever the id is; an id that is not an ended lane's is a
 *   view's bug — logged, with nothing said and nothing moved.
 * - A receded lane is lent like any other, and opens like any other.
 */

import {
  AgentRecordedLanesResult,
  type FrameView,
  type FrameViewState,
} from "@vibefield/contracts";
import type { MonitorEndedRow } from "@vibefield/puppeteer-view-sdk/model";
import { fixturePalette } from "@vibefield/puppeteer-view-sdk/testing";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStatusNotice, resetStatusLineForTest, statusLineSaid } from "../src/frame/status-line";
import { resetActiveViewForTest, subscribeActiveView } from "../src/frame/view-state";
import {
  HISTORY_LEFT_DEBOUNCE_MS,
  type RecordedLanesPort,
  useMonitorHistory,
} from "../src/godview/monitor/monitor-history";
import {
  lendEndedLanes,
  openEndedLane,
  type RecordedSessionRow,
  resetOpenEndedLaneForTest,
} from "../src/godview/monitor/open-ended-lane";
import { getHistoryOpenAt, resetHistoryOpenAtForTest } from "../src/history/open-at";
import { type FieldHost, setHost } from "../src/host";
import { getRendererLogger, type RendererLogger, setRendererLogger } from "../src/logging";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 11, 12);
const HERE = "01JDESK";

const GONE = {
  id: "ended-lane:gone",
  text: "Could not open — this run is no longer in the timeline",
};
const UNREAD = {
  id: "ended-lane:unread",
  text: "Could not open — the record cannot be read now",
};
const UNRECORDED = {
  id: "ended-lane:unrecorded",
  text: "Could not open — no session is recorded for this run",
};

function lane(id: string, provider?: string): MonitorEndedRow {
  return {
    id,
    ...(provider === undefined ? {} : { provider: { id: provider, label: provider } }),
    project: { name: "billing-api", seq: 3 },
    device: { id: HERE, name: "Studio", self: true },
    startedAt: NOW - 3 * HOUR,
    endedAt: NOW - 2 * HOUR,
    spans: [{ kind: "bounds", from: NOW - 3 * HOUR, to: NOW - 2 * HOUR }],
  };
}

const TODAY = lane("past:claude:nat-today", "claude");
const OTHER = lane("past:codex:nat-other", "codex");
/** a native id that holds colons: nothing in the id says where the provider ends */
const COLONS = lane("past:codex:rollout:2026-10-09T12:00:nat", "codex");
const UNNAMED = lane("past:claude:nat-unnamed");
/** no provider on the row, and a native id that holds colons */
const UNNAMED_COLONS = lane("past:codex:rollout:2026-10-09T12:00:nat");

function row(sessionId: string, native: string, more: Partial<RecordedSessionRow> = {}) {
  return { sessionId, nativeSessionId: native, rootSessionId: sessionId, ...more };
}

/** The index's lookup, each ask settled by the test. */
interface FakeSessions {
  readonly asks: string[][];
  sessions(nativeSessionIds: readonly string[]): Promise<readonly RecordedSessionRow[]>;
  /** settle the OLDEST ask still waiting */
  answer(rows: readonly RecordedSessionRow[]): Promise<void>;
  refuse(error: unknown): Promise<void>;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

function fakeSessions(): FakeSessions {
  const asks: string[][] = [];
  const waiting: Array<{
    resolve: (rows: readonly RecordedSessionRow[]) => void;
    reject: (error: unknown) => void;
  }> = [];
  const next = () => {
    const ask = waiting.shift();
    if (ask === undefined) throw new Error("no lookup is waiting");
    return ask;
  };
  return {
    asks,
    sessions(nativeSessionIds) {
      asks.push([...nativeSessionIds]);
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    async answer(rows) {
      next().resolve(rows);
      await settle();
    },
    async refuse(error) {
      next().reject(error);
      await settle();
    },
  };
}

/** What the frame asked the shell for, with the place History held at that moment. */
let viewAsked: Array<{ view: FrameView; place: ReturnType<typeof getHistoryOpenAt> }> = [];
let publishView: ((state: FrameViewState) => void) | null = null;
let stopView: (() => void) | undefined;

/** The window is in `view`, as the shell says it. */
function frameIn(view: FrameView): void {
  publishView?.({ view } as FrameViewState);
}

/** The shell, answering a view request with `set`. */
function hostWith(set: (next: FrameView) => Promise<FrameViewState>): void {
  setHost({
    logger: {} as RendererLogger,
    getConnection: () => Promise.resolve({ port: 1, token: "t" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    platform: "darwin",
    view: {
      set,
      onState: (handler) => {
        publishView = handler;
        return () => {
          publishView = null;
        };
      },
    },
  } as FieldHost);
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
  resetActiveViewForTest();
  resetHistoryOpenAtForTest();
  resetStatusLineForTest();
  resetOpenEndedLaneForTest();
  viewAsked = [];
  publishView = null;
  hostWith((next) => {
    viewAsked.push({ view: next, place: getHistoryOpenAt() });
    return Promise.resolve({ view: next });
  });
  // the frame's own readers attach the mirror in the product; here the test does
  stopView = subscribeActiveView(() => undefined);
  frameIn("godview");
});

afterEach(() => {
  stopView?.();
  resetStatusLineForTest();
  vi.useRealTimers();
});

describe("the native session id is read off the lent lane, never split out of the id", () => {
  it("a native id that holds a colon: the lane's own provider strips the prefix, and the door is asked for that one id", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY, COLONS], port });
    openEndedLane(COLONS.id);
    expect(port.asks).toEqual([["rollout:2026-10-09T12:00:nat"]]);
    await port.answer([row("ses-colons", "rollout:2026-10-09T12:00:nat")]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-colons", timelineId: null });
  });

  it("an id the timeline does not lend is a refusal, said, and the door is not asked", () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane("past:claude:nat-left-the-day");
    expect(port.asks).toEqual([]);
    expect(getStatusNotice()).toEqual(GONE);
    expect(getHistoryOpenAt()).toBeNull();
    expect(viewAsked).toEqual([]);
  });

  it("nothing is lent at all (no past, or the stage is gone): the same refusal", () => {
    openEndedLane(TODAY.id);
    expect(getStatusNotice()).toEqual(GONE);
    expect(getHistoryOpenAt()).toBeNull();
  });

  it("a lane that names no provider is read by the id's own grammar — a provider id holds no colon, so it ends at the FIRST one — and a native id that holds colons is asked whole", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [UNNAMED_COLONS], port });
    openEndedLane(UNNAMED_COLONS.id);
    expect(port.asks).toEqual([["rollout:2026-10-09T12:00:nat"]]);
    // the provider read off the id is the one a row's is held to
    await port.answer([
      row("ses-claude", "rollout:2026-10-09T12:00:nat", { provider: "claude" }),
      row("ses-codex", "rollout:2026-10-09T12:00:nat", { provider: "codex" }),
    ]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-codex", timelineId: null });
    expect(statusLineSaid()).toEqual([]);
  });

  it("a lane that names no provider is asked about, and `no session is recorded` is said only when the index has none", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [UNNAMED], port });
    openEndedLane(UNNAMED.id);
    expect(port.asks).toEqual([["nat-unnamed"]]);
    expect(statusLineSaid()).toEqual([]);
    await port.answer([]);
    expect(getStatusNotice()).toEqual(UNRECORDED);
    expect(getHistoryOpenAt()).toBeNull();
  });

  it.each([
    ["nothing after the provider's colon", "past:codex:"],
    ["no colon after the provider", "past:codex"],
    ["no provider before the colon", "past::nat"],
    ["a provider part that is no provider id", "past:not a provider:nat"],
  ])(
    "a lane that names no provider and whose id carries no native session (%s) is refused, not asked",
    (_name, id) => {
      const port = fakeSessions();
      lendEndedLanes({ ended: [lane(id)], port });
      openEndedLane(id);
      expect(port.asks).toEqual([]);
      expect(getStatusNotice()).toEqual(UNRECORDED);
      expect(getHistoryOpenAt()).toBeNull();
    },
  );

  it.each([
    ["an id that is another provider's", "past:claude:nat"],
    ["nothing after its provider's colon", "past:codex:"],
  ])("a lane that names its provider is read by it alone (%s): refused, not asked", (_name, id) => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [lane(id, "codex")], port });
    openEndedLane(id);
    expect(port.asks).toEqual([]);
    expect(getStatusNotice()).toEqual(UNRECORDED);
    expect(getHistoryOpenAt()).toBeNull();
  });
});

describe("which of the index's rows the lane opens", () => {
  it("one row: History opens at rosetta's own session id, never the native one", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    await port.answer([row("ses-today", "nat-today")]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-today", timelineId: null });
    expect(statusLineSaid()).toEqual([]);
  });

  it("several rows and one names the lane's provider: that one, wherever it stands", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    await port.answer([
      row("ses-codex", "nat-today", { provider: "codex" }),
      row("ses-unnamed", "nat-today"),
      row("ses-claude", "nat-today", { provider: "claude" }),
    ]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-claude", timelineId: null });
  });

  it("several rows and none names a provider: the thread's root before a delegated child", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    await port.answer([
      row("ses-child", "nat-today", { rootSessionId: "ses-root" }),
      row("ses-root", "nat-today"),
    ]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-root", timelineId: null });
  });

  it("a row naming another provider is not this run's, and a row for another native id is not this ask's: no session, said", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    await port.answer([
      row("ses-codex", "nat-today", { provider: "codex" }),
      row("ses-elsewhere", "nat-elsewhere"),
    ]);
    expect(getStatusNotice()).toEqual(UNRECORDED);
    expect(getHistoryOpenAt()).toBeNull();
    expect(viewAsked).toEqual([]);
  });
});

describe("the open is the Peek's past pick from Godview, call for call (`FramePeek.openPast`)", () => {
  it("from Godview: the place first, then the History view — the same two calls in the same order", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    // nothing moves before the door answers
    expect(getHistoryOpenAt()).toBeNull();
    expect(viewAsked).toEqual([]);
    await port.answer([row("ses-today", "nat-today")]);
    // the place stood when the view was asked for
    expect(viewAsked).toEqual([
      { view: "history", place: { sessionId: "ses-today", timelineId: null } },
    ]);
  });

  it("each open is a fresh place, so the same lane opened twice opens the room twice", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    await port.answer([row("ses-today", "nat-today")]);
    const first = getHistoryOpenAt();
    openEndedLane(TODAY.id);
    await port.answer([row("ses-today", "nat-today")]);
    expect(getHistoryOpenAt()).toEqual(first);
    expect(getHistoryOpenAt()).not.toBe(first);
  });
});

describe("an answer that lands after the person left Godview opens nothing: they clicked, then went elsewhere", () => {
  it.each([
    ["History", "history"],
    ["the canvas", "canvas"],
  ] as const)(
    "the frame is in %s when the row answers: no place, no view asked, no notice",
    async (_name, view) => {
      const port = fakeSessions();
      lendEndedLanes({ ended: [TODAY], port });
      openEndedLane(TODAY.id);
      frameIn(view);
      await port.answer([row("ses-today", "nat-today")]);
      expect(getHistoryOpenAt()).toBeNull();
      expect(viewAsked).toEqual([]);
      expect(statusLineSaid()).toEqual([]);
    },
  );

  it("the same for a refusal, and for an answer with no row: nothing is said to someone who went elsewhere", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    frameIn("history");
    await port.refuse(new Error("the agent index is starting"));
    expect(statusLineSaid()).toEqual([]);
    frameIn("godview");
    openEndedLane(TODAY.id);
    frameIn("canvas");
    await port.answer([]);
    expect(statusLineSaid()).toEqual([]);
    expect(getHistoryOpenAt()).toBeNull();
    expect(viewAsked).toEqual([]);
  });

  it("the view is read when the answer lands: back in Godview by then, it opens as ever", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    frameIn("canvas");
    frameIn("godview");
    await port.answer([row("ses-today", "nat-today")]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-today", timelineId: null });
    expect(viewAsked).toHaveLength(1);
  });

  it("a dropped answer frees the lane and is logged at debug, never said", async () => {
    const before = getRendererLogger();
    const debugged: string[] = [];
    const recording: RendererLogger = {
      child: () => recording,
      trace() {},
      debug: (event) => void debugged.push(event),
      info() {},
      warn() {},
      error() {},
      fatal() {},
      isLevelEnabled: () => true,
    };
    setRendererLogger(recording);
    try {
      const port = fakeSessions();
      lendEndedLanes({ ended: [TODAY], port });
      openEndedLane(TODAY.id);
      frameIn("history");
      await port.answer([row("ses-today", "nat-today")]);
      expect(debugged).toEqual(["renderer.godview.ended_lane_left"]);
      frameIn("godview");
      openEndedLane(TODAY.id);
      expect(port.asks).toHaveLength(2);
    } finally {
      setRendererLogger(before);
    }
  });
});

describe("a refusal is said on the status line, once", () => {
  it("the door refuses: the record cannot be read now, with the door's own words as the detail", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    await port.refuse(new Error("the agent index is starting"));
    expect(getStatusNotice()).toEqual({ ...UNREAD, detail: "the agent index is starting" });
    expect(getHistoryOpenAt()).toBeNull();
    expect(viewAsked).toEqual([]);
  });

  it("a refusal with no words carries no detail", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    await port.refuse(new Error(""));
    expect(getStatusNotice()).toEqual(UNREAD);
  });

  it("the door answers no row: no session is recorded for this run", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    await port.answer([]);
    expect(getStatusNotice()).toEqual(UNRECORDED);
    expect(getHistoryOpenAt()).toBeNull();
    expect(viewAsked).toEqual([]);
  });

  it("said once: the same refusal for a second lane while it stands is not said twice, and a different one waits its turn", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY, OTHER], port });
    openEndedLane(TODAY.id);
    await port.answer([]);
    openEndedLane(OTHER.id);
    await port.answer([]);
    expect(statusLineSaid()).toEqual([UNRECORDED]);
    openEndedLane(TODAY.id);
    await port.refuse(new Error("the agent index is starting"));
    // the line holds one notice at a time: the second is said when the first has stood
    expect(getStatusNotice()).toEqual(UNRECORDED);
    vi.advanceTimersByTime(2_400);
    expect(statusLineSaid()).toEqual([UNRECORDED, UNREAD]);
  });

  it("a door that throws before it answers is a refusal too, and the lane can be asked again", async () => {
    const asks: string[][] = [];
    lendEndedLanes({
      ended: [TODAY],
      port: {
        sessions(ids) {
          asks.push([...ids]);
          throw new Error("the door is closed");
        },
      },
    });
    openEndedLane(TODAY.id);
    await settle();
    expect(getStatusNotice()).toEqual({ ...UNREAD, detail: "the door is closed" });
    openEndedLane(TODAY.id);
    await settle();
    expect(asks).toHaveLength(2);
  });
});

describe("one ask at a time", () => {
  it("the same lane again while its ask is in flight is not a second ask; once answered, it asks afresh", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    openEndedLane(TODAY.id);
    openEndedLane(TODAY.id);
    expect(port.asks).toHaveLength(1);
    await port.answer([row("ses-today", "nat-today")]);
    expect(viewAsked).toHaveLength(1);
    openEndedLane(TODAY.id);
    expect(port.asks).toHaveLength(2);
  });

  it("another lane wins: the older ask's late answer opens nothing and says nothing", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY, OTHER], port });
    openEndedLane(TODAY.id);
    openEndedLane(OTHER.id);
    expect(port.asks).toEqual([["nat-today"], ["nat-other"]]);
    // the older ask answers late, after the newer pick
    await port.answer([row("ses-today", "nat-today")]);
    expect(getHistoryOpenAt()).toBeNull();
    expect(viewAsked).toEqual([]);
    await port.answer([row("ses-other", "nat-other")]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-other", timelineId: null });
    expect(viewAsked).toHaveLength(1);
    expect(statusLineSaid()).toEqual([]);
  });

  it("an older ask's late REFUSAL is not said over a newer pick", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY, OTHER], port });
    openEndedLane(TODAY.id);
    openEndedLane(OTHER.id);
    await port.refuse(new Error("the agent index is starting"));
    expect(statusLineSaid()).toEqual([]);
    await port.answer([row("ses-other", "nat-other")]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-other", timelineId: null });
  });

  it("a pick that is refused at once wins too: the older ask's answer opens nothing", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    openEndedLane("past:claude:nat-left-the-day");
    await port.answer([row("ses-today", "nat-today")]);
    expect(getHistoryOpenAt()).toBeNull();
    expect(statusLineSaid()).toEqual([GONE]);
    // and the first lane is free to be asked again
    openEndedLane(TODAY.id);
    expect(port.asks).toHaveLength(2);
  });
});

// ── the view side's contract ─────────────────────────────────────────────────

describe("called from a view's own handler, which catches nothing: it returns at once and never throws", () => {
  /** every `warn` and `error` the function logged, as `level event` */
  let logged: string[] = [];
  let loggerBefore: RendererLogger;

  beforeEach(() => {
    logged = [];
    loggerBefore = getRendererLogger();
    const recording: RendererLogger = {
      child: () => recording,
      trace() {},
      debug() {},
      info() {},
      warn: (event) => void logged.push(`warn ${event}`),
      error: (event) => void logged.push(`error ${event}`),
      fatal() {},
      isLevelEnabled: () => true,
    };
    setRendererLogger(recording);
  });

  afterEach(() => {
    setRendererLogger(loggerBefore);
  });

  /** what a view could hand the command that is not an ended lane's id (`past:…`) */
  const NOT_A_LANE: ReadonlyArray<readonly [string, unknown]> = [
    ["an empty string", ""],
    ["a live row's id", "run-1"],
    ["undefined", undefined],
    ["null", null],
    ["a number", 7],
    ["an object", { id: TODAY.id }],
  ];

  it.each(NOT_A_LANE)(
    "%s, with a past lent: nothing thrown, asked, said or opened — the view's bug is logged",
    (_name, id) => {
      const port = fakeSessions();
      lendEndedLanes({ ended: [TODAY], port });
      expect(() => openEndedLane(id as string)).not.toThrow();
      expect(port.asks).toEqual([]);
      expect(statusLineSaid()).toEqual([]);
      expect(getHistoryOpenAt()).toBeNull();
      expect(viewAsked).toEqual([]);
      expect(logged).toEqual(["warn renderer.godview.ended_lane_not_a_lane"]);
    },
  );

  it.each(NOT_A_LANE)("%s, before any past is lent: the same", (_name, id) => {
    expect(() => openEndedLane(id as string)).not.toThrow();
    expect(statusLineSaid()).toEqual([]);
    expect(getHistoryOpenAt()).toBeNull();
    expect(logged).toEqual(["warn renderer.godview.ended_lane_not_a_lane"]);
  });

  it("an id that is not a lane's takes no lane's turn: the ask in flight still answers", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    openEndedLane("run-1");
    openEndedLane("");
    await port.answer([row("ses-today", "nat-today")]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-today", timelineId: null });
  });

  it("an ended lane's id the timeline does not lend — before any past, and with one — is said, never thrown", () => {
    expect(() => openEndedLane("past:claude:nat-before-any-past")).not.toThrow();
    expect(statusLineSaid()).toEqual([GONE]);
    resetStatusLineForTest();
    lendEndedLanes({ ended: [TODAY], port: fakeSessions() });
    expect(() => openEndedLane("past:claude:nat-left-the-day")).not.toThrow();
    expect(statusLineSaid()).toEqual([GONE]);
  });

  it("it returns before the door answers: the press itself opens nothing and asks no view", () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    expect(openEndedLane(TODAY.id)).toBeUndefined();
    expect(port.asks).toEqual([["nat-today"]]);
    expect(getHistoryOpenAt()).toBeNull();
    expect(viewAsked).toEqual([]);
  });

  it("a fault inside reaches no caller: a log that throws after the refusal was said", () => {
    const broken = {
      child: () => {
        throw new Error("the log is down");
      },
    } as unknown as RendererLogger;
    setRendererLogger(broken);
    expect(() => openEndedLane("past:claude:nat-left-the-day")).not.toThrow();
    expect(getStatusNotice()).toEqual(GONE);
    expect(() => openEndedLane("run-1")).not.toThrow();
  });

  it("a fault inside reaches no caller: lent lanes that cannot be read are logged, and nothing is said of a run nobody could look up", () => {
    const unreadable = new Proxy([] as MonitorEndedRow[], {
      get: () => {
        throw new Error("the lanes cannot be read");
      },
    });
    lendEndedLanes({ ended: unreadable, port: fakeSessions() });
    expect(() => openEndedLane(TODAY.id)).not.toThrow();
    expect(logged).toEqual(["error renderer.godview.ended_lane_fault"]);
    expect(getHistoryOpenAt()).toBeNull();
  });

  it("a door that answers something that is not rows could not be read: said, and the lane is free again", async () => {
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    await port.answer("not rows" as unknown as RecordedSessionRow[]);
    expect(getStatusNotice()).toEqual(UNREAD);
    expect(getHistoryOpenAt()).toBeNull();
    openEndedLane(TODAY.id);
    expect(port.asks).toHaveLength(2);
    await port.answer([null] as unknown as RecordedSessionRow[]);
    expect(statusLineSaid()).toEqual([UNREAD]);
    expect(getHistoryOpenAt()).toBeNull();
  });

  it("a shell that throws at the view request after the answer: logged, never an unhandled rejection, and the lane is free again", async () => {
    hostWith(() => {
      throw new Error("the shell is gone");
    });
    const port = fakeSessions();
    lendEndedLanes({ ended: [TODAY], port });
    openEndedLane(TODAY.id);
    await port.answer([row("ses-today", "nat-today")]);
    // the place was opened before the view was asked for, as the Peek's pick does it
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-today", timelineId: null });
    expect(logged).toEqual(["error renderer.godview.ended_lane_fault"]);
    openEndedLane(TODAY.id);
    expect(port.asks).toHaveLength(2);
  });
});

// ── the hook lends an opening what it lends the view ─────────────────────────

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
      spans: [{ kind: "bounds", from: NOW - 3 * HOUR, to: NOW - 2 * HOUR }],
    },
    {
      id: "past:codex:nat-peer",
      provider: { id: "codex", label: "Codex" },
      project: { name: "" },
      device: { id: "01JPEER", name: "Laptop", os: "mac" },
      startedAt: NOW - 2 * HOUR,
      endedAt: NOW - HOUR,
      spans: [{ kind: "bounds", from: NOW - 2 * HOUR, to: NOW - HOUR }],
    },
  ],
});

/** The past's door whole: the lanes' reads settled by the test, and the lookup. */
function fakePastDoor(): RecordedLanesPort & {
  lookups: FakeSessions;
  reads: number;
  answerRead(result?: AgentRecordedLanesResult): Promise<void>;
} {
  const lookups = fakeSessions();
  const waiting: Array<(result: AgentRecordedLanesResult) => void> = [];
  const door = {
    lookups,
    reads: 0,
    read: () => {
      door.reads += 1;
      return new Promise<AgentRecordedLanesResult>((resolve) => waiting.push(resolve));
    },
    sessions: (ids: readonly string[]) => lookups.sessions(ids),
    async answerRead(result: AgentRecordedLanesResult = ANSWER) {
      const next = waiting.shift();
      if (next === undefined) throw new Error("no read is waiting");
      await act(async () => next(result));
    },
  };
  return door;
}

type Rows = { id: string; kind: string; statusSince: number }[];
interface ProbeProps {
  port: RecordedLanesPort;
  rows: Rows;
  desk?: string | null;
  receded?: (lane: MonitorEndedRow) => boolean;
}

const PALETTE = fixturePalette("dark");
const NEVER_RECEDES = (_lane: MonitorEndedRow): boolean => false;
const ROWS: Rows = [{ id: "run-1", kind: "agent", statusSince: NOW - HOUR }];

describe("the hook lends an opening the lanes it lends the view", () => {
  let root: Root | undefined;
  let host: HTMLElement | undefined;
  let setProps: ((props: ProbeProps) => void) | undefined;

  function Probe(initial: ProbeProps) {
    const [props, set] = useState(initial);
    setProps = set;
    useMonitorHistory({
      port: props.port,
      wants: true,
      rows: props.rows,
      here: HERE,
      palette: PALETTE,
      receded: props.receded ?? NEVER_RECEDES,
      desk: props.desk ?? null,
      now: () => Date.now(),
    });
    return null;
  }

  async function mount(props: ProbeProps): Promise<void> {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<Probe {...props} />));
  }

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
    setProps = undefined;
  });

  it("one function across re-reads: held from before a re-read, it opens by the past that is lent NOW", async () => {
    const port = fakePastDoor();
    // what a view's commands would hold, taken before any past is lent
    const held = openEndedLane;
    await mount({ port, rows: ROWS });
    // before the first answer nothing is lent
    held("past:claude:nat-today");
    expect(statusLineSaid()).toEqual([GONE]);
    resetStatusLineForTest();
    await port.answerRead();
    held("past:claude:nat-today");
    expect(port.lookups.asks).toEqual([["nat-today"]]);
    await port.lookups.answer([row("ses-today", "nat-today")]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-today", timelineId: null });
    // a run leaves the model → a re-read that drops today's lane and keeps the peer's
    await act(async () => setProps!({ port, rows: [] }));
    await act(async () => vi.advanceTimersByTime(HISTORY_LEFT_DEBOUNCE_MS));
    expect(port.reads).toBe(2);
    await port.answerRead({ ...ANSWER, readAt: NOW + 1_000, ended: ANSWER.ended.slice(1) });
    expect(openEndedLane).toBe(held);
    held("past:claude:nat-today");
    expect(port.lookups.asks).toHaveLength(1);
    expect(statusLineSaid()).toEqual([GONE]);
    held("past:codex:nat-peer");
    expect(port.lookups.asks).toEqual([["nat-today"], ["nat-peer"]]);
  });

  it("a lane the chosen desktop narrows away is not lent: it cannot be opened from a view that does not draw it", async () => {
    const port = fakePastDoor();
    await mount({ port, rows: ROWS, desk: HERE });
    await port.answerRead();
    openEndedLane("past:codex:nat-peer");
    expect(port.lookups.asks).toEqual([]);
    expect(statusLineSaid()).toEqual([GONE]);
    openEndedLane("past:claude:nat-today");
    expect(port.lookups.asks).toEqual([["nat-today"]]);
  });

  it("a receded lane (the host is showing another profile or desktop) is lent too: pressed, it opens like any other", async () => {
    const port = fakePastDoor();
    const everyLaneRecedes = (_lane: MonitorEndedRow): boolean => true;
    await mount({ port, rows: ROWS, receded: everyLaneRecedes });
    await port.answerRead();
    openEndedLane("past:codex:nat-peer");
    expect(port.lookups.asks).toEqual([["nat-peer"]]);
    await port.lookups.answer([row("ses-peer", "nat-peer")]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-peer", timelineId: null });
    expect(viewAsked).toHaveLength(1);
    expect(statusLineSaid()).toEqual([]);
  });

  it("the stage closes: nothing is lent any more", async () => {
    const port = fakePastDoor();
    await mount({ port, rows: ROWS });
    await port.answerRead();
    await act(async () => root!.unmount());
    root = undefined;
    openEndedLane("past:claude:nat-today");
    expect(port.lookups.asks).toEqual([]);
    expect(statusLineSaid()).toEqual([GONE]);
  });
});
