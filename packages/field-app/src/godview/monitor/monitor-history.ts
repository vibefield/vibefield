import type { MonitorHistory, MonitorHistoryAsk } from "@vibecook/puppeteer-view-sdk";
import { lendHistory } from "@vibecook/puppeteer-view-sdk/host";
import type { MonitorPastSnapshot } from "@vibecook/puppeteer-view-sdk/model";
import { projectColourFor } from "@vibecook/puppeteer-view-sdk/toolkit";
import type { MonitorPalette } from "@vibecook/puppeteer-views";
import type { AgentRecordedLanesResult } from "@vibefield/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { sdkOsMark } from "./model-board";

// TL (docket v9, RULED 2026-10-09; B-D6 (a)) — THE RECORD'S PAST, LENT TO A
// VIEW (capability `history`). The backend beside the runtime derives each
// lane's past from rosettad's record (`agent.recordedLanes`); this window only
// asks for it and colours it, as it colours the model's rows (L7).
//
// When it asks (PF6): only while a view is MOUNTED and its report carries an
// ask (`ViewReport.history`). The slot drops a view's report with the view, so
// a switched-away timeline asks nothing more, and a closed Godview unmounts
// this hook with the stage. A new ask (a new `sinceMs` or `seq`: a scrub back
// past what it holds) reads at once. While the ask stands, a row leaving the
// model or a row's status moving past its seam reads again, at most every
// HISTORY_REFRESH_MIN_MS: the record catches up a little behind the runtime,
// and between the seam and a newer status the view draws "not recorded"
// until then. Nothing is kept here but the last answer.

/** The floor between two reads the rows' movement asks for. */
export const HISTORY_REFRESH_MIN_MS = 30_000;

/** The widest window the record is read for: the view's day (T2). */
const MAX_WINDOW_MS = 24 * 60 * 60_000;

/** The backend's door, as the window reads it (`doors.ts` `recordedLanesPortOver`). */
export interface RecordedLanesPort {
  read(window: { sinceMs: number; untilMs: number }): Promise<AgentRecordedLanesResult>;
}

/** The backend's answer as the view's capability: `device.self` said by this
 * reader as it says it for the model's rows (`modelRowFrom`: it never travels),
 * the OS mark kept only when it is the SDK's word, each ended lane coloured with
 * the theme. */
export function historyForView(
  answer: AgentRecordedLanesResult,
  here: string | undefined,
  colourFor: (seq: number | undefined) => string,
): MonitorHistory {
  const past: MonitorPastSnapshot = {
    ...answer,
    ended: answer.ended.map((lane) => ({
      ...lane,
      device: {
        id: lane.device.id,
        name: lane.device.name,
        ...(sdkOsMark(lane.device.os) !== undefined ? { os: sdkOsMark(lane.device.os) } : {}),
        self: lane.device.id === here,
      },
    })),
  };
  return lendHistory(past, colourFor);
}

/** The past when the backend's door did not answer: nothing, in words. */
export function unreadHistory(window: { sinceMs: number; untilMs: number }): MonitorHistory {
  return Object.freeze({
    ...window,
    readAt: window.untilMs,
    fidelity: "bounds",
    state: "unavailable",
    detail: "The record of past runs could not be read",
    live: Object.freeze([]),
    ended: Object.freeze([]),
  });
}

/** What moves a re-read: which rows the model holds, and when each one's
 * current status began (a seam that moved). */
export function historyRowsKey(
  rows: readonly { readonly id: string; readonly kind: string; readonly statusSince: number }[],
): string {
  return rows
    .filter((row) => row.kind === "agent")
    .map((row) => `${row.id}@${row.statusSince}`)
    .join("\n");
}

export interface MonitorHistoryOptions {
  /** absent: this door has no record (the catalog, an older fieldd) */
  readonly port: RecordedLanesPort | undefined;
  /** the mounted view's ask; absent: nothing is read */
  readonly ask: MonitorHistoryAsk | undefined;
  readonly rows: readonly {
    readonly id: string;
    readonly kind: string;
    readonly statusSince: number;
  }[];
  /** this desktop's id: the rows whose `device.self` is true */
  readonly here: string | undefined;
  readonly palette: Pick<MonitorPalette, "tint" | "neutral">;
  /** test seam */
  readonly now?: (() => number) | undefined;
}

/** `capabilities.history` for the mounted view, read only while it asks. */
export function useMonitorHistory(options: MonitorHistoryOptions): MonitorHistory | undefined {
  const { port, ask, here, palette } = options;
  const now = options.now ?? Date.now;
  const askKey = ask === undefined ? undefined : `${ask.sinceMs}:${ask.seq ?? 0}`;
  // nothing to watch while nothing asks: no view pays for a past it does not draw
  const rowsKey = askKey === undefined || port === undefined ? "" : historyRowsKey(options.rows);
  const [answer, setAnswer] = useState<
    | { readonly key: string; readonly result: AgentRecordedLanesResult }
    | { readonly key: string; readonly unread: MonitorHistory }
    | undefined
  >(undefined);
  /** bumped by the rows' movement, after the floor: a re-read of the same ask */
  const [generation, setGeneration] = useState(0);
  const lastRead = useRef(0);
  const nowRef = useRef(now);
  nowRef.current = now;
  const askRef = useRef(ask);
  askRef.current = ask;

  // read: at once for a new ask, again for each generation the rows asked for
  useEffect(() => {
    if (port === undefined || askKey === undefined) {
      setAnswer(undefined);
      return;
    }
    const asked = askRef.current!;
    const untilMs = nowRef.current();
    const window = { sinceMs: Math.max(asked.sinceMs, untilMs - MAX_WINDOW_MS), untilMs };
    if (window.sinceMs >= window.untilMs) return;
    let live = true;
    lastRead.current = untilMs;
    port.read(window).then(
      (result) => {
        if (live) setAnswer({ key: askKey, result });
      },
      () => {
        if (live) setAnswer({ key: askKey, unread: unreadHistory(window) });
      },
    );
    return () => {
      live = false;
    };
  }, [port, askKey, generation]);

  // the rows moved while the ask stands: read again, no sooner than the floor
  // (a new ask reads at once above; only movement UNDER one asks again)
  const watched = useRef<{ askKey: string | undefined; rowsKey: string } | undefined>(undefined);
  useEffect(() => {
    const before = watched.current;
    watched.current = { askKey, rowsKey };
    if (port === undefined || askKey === undefined) return;
    if (before === undefined || before.askKey !== askKey || before.rowsKey === rowsKey) return;
    const wait = Math.max(0, lastRead.current + HISTORY_REFRESH_MIN_MS - nowRef.current());
    const timer = setTimeout(() => setGeneration((value) => value + 1), wait);
    return () => clearTimeout(timer);
  }, [rowsKey, port, askKey]);

  const tintL = palette.tint.l;
  const tintC = palette.tint.c;
  const neutral = palette.neutral;
  return useMemo(() => {
    if (answer === undefined || answer.key !== askKey) return undefined;
    if ("unread" in answer) return answer.unread;
    // a reader's colour function, as the replica's (L7)
    const colourFor = projectColourFor({ tint: { l: tintL, c: tintC }, neutral });
    return historyForView(answer.result, here, colourFor);
  }, [answer, askKey, here, tintL, tintC, neutral]);
}
