import type { MonitorHistory } from "@vibecook/puppeteer-view-sdk";
import { HISTORY_WINDOW_MS, keepPast, lendHistory } from "@vibecook/puppeteer-view-sdk/host";
import type { MonitorEndedRow, MonitorPastSnapshot } from "@vibecook/puppeteer-view-sdk/model";
import { projectColourFor } from "@vibecook/puppeteer-view-sdk/toolkit";
import type { MonitorPalette } from "@vibecook/puppeteer-views";
import type { AgentRecordedLanesResult } from "@vibefield/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { sdkOsMark } from "./model-board";

// TL (docket v9, RULED 2026-10-09; B-D6 (a); TIMELINE SHAPES v2) — THE
// RECORD'S PAST, LENT TO A VIEW (capability `history`). The backend beside the
// runtime derives each lane's past from rosettad's record (`agent.recordedLanes`);
// this window only reads it, keeps it, and colours and recedes its ended lanes
// as it does the model's rows (L7).
//
// When it reads (PF6): only while the mounted view's MANIFEST declares
// `capabilities.optional: ['history']` — the view asks nothing itself — over the
// fixed day `[now − 24 h, now]` (T2). A closed Godview unmounts this hook with
// the stage; a switched-away view stops the reads.
//
// Identity (v2 item 5): the snapshot is kept as the SAME object while a re-read
// brings nothing new (`keepPast`; a changed `readAt` alone is nothing new), and
// the view's `MonitorHistory` is built from it once — never per publish — so
// the capabilities memo, and the view's caches keyed on it, hold.
//
// Re-reads (v2 item 8): a row leaving the model reads again after
// HISTORY_LEFT_DEBOUNCE_MS (its ended lane appears in a second, not thirty); a
// row's status moving past its seam, or a new agent row, at most every
// HISTORY_REFRESH_MIN_MS (the view draws "not recorded" between the seam and a
// newer status until then).
//
// Honest states (v2 items 3, 9): before the first answer the capability is
// absent (the view draws today's floor). A record that cannot be read now is
// lent as `unavailable` with its words — unless a good past was read before,
// which is KEPT, marked `partial` with one sentence, never emptied. A desktop
// that keeps no record (the door's NOT_FOUND `no-record`) lends nothing, and is
// not asked again.

/** The floor between two reads the rows' seams ask for. */
export const HISTORY_REFRESH_MIN_MS = 30_000;
/** How long a row's leaving waits for others before the past is read again. */
export const HISTORY_LEFT_DEBOUNCE_MS = 1_000;

/** The sentence a kept past carries when the record could not be read again. */
export const KEPT_PAST_DETAIL =
  "The record could not be read again; this is the last of it that was read.";

/** The backend's door, as the window reads it (`doors.ts` `recordedLanesPortOver`). */
export interface RecordedLanesPort {
  read(window: { sinceMs: number; untilMs: number }): Promise<AgentRecordedLanesResult>;
}

/** The backend's answer as the SDK's snapshot: `device.self` said by this
 * reader as it says it for the model's rows (`modelRowFrom`: it never travels),
 * the OS mark kept only when it is the SDK's word. */
export function snapshotFrom(
  answer: AgentRecordedLanesResult,
  here: string | undefined,
): MonitorPastSnapshot {
  return {
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
  } as MonitorPastSnapshot;
}

/** A refusal the door means as "there is no record here", not "not now". */
function isNoRecord(error: unknown): boolean {
  const data = (error as { rpc?: { data?: { kind?: string; details?: { state?: string } } } })?.rpc
    ?.data;
  const direct = error as { kind?: string; details?: { state?: string } };
  const kind = data?.kind ?? direct?.kind;
  const state = data?.details?.state ?? direct?.details?.state;
  return kind === "NOT_FOUND" && state === "no-record";
}

/** The desktop an ended lane lives on, as `deviceOfRow` says it for a live row. */
function deskOf(lane: MonitorEndedRow, here: string | undefined): string | undefined {
  return lane.device.self ? here : lane.device.id;
}

/**
 * The past narrowed to the chosen desktop, as the live rows are (`narrowToDevice`): the ended lanes elsewhere leave
 * the snapshot BEFORE it is lent. The SAME snapshot when nothing is narrowed or nothing leaves, so identity holds.
 */
export function narrowPast(
  snapshot: MonitorPastSnapshot,
  desk: string | null,
  here: string | undefined,
): MonitorPastSnapshot {
  if (desk === null) return snapshot;
  const kept = snapshot.ended.filter((lane) => deskOf(lane, here) === desk);
  return kept.length === snapshot.ended.length ? snapshot : { ...snapshot, ended: kept };
}

/** What moves a re-read: which agent rows the model holds, and when each one's
 * current status began. */
export function historyRowsKey(
  rows: readonly { readonly id: string; readonly kind: string; readonly statusSince: number }[],
): string {
  return rows
    .filter((row) => row.kind === "agent")
    .map((row) => `${row.id}@${row.statusSince}`)
    .join("\n");
}

function parseRowsKey(key: string): Map<string, number> {
  const rows = new Map<string, number>();
  if (key === "") return rows;
  for (const line of key.split("\n")) {
    const at = line.lastIndexOf("@");
    rows.set(line.slice(0, at), Number(line.slice(at + 1)));
  }
  return rows;
}

export interface MonitorHistoryOptions {
  /** absent: this door has no record (the catalog, an older fieldd) */
  readonly port: RecordedLanesPort | undefined;
  /** the mounted view declares `history` (`viewWantsHistory`) */
  readonly wants: boolean;
  readonly rows: readonly {
    readonly id: string;
    readonly kind: string;
    readonly statusSince: number;
  }[];
  /** this desktop's id: the rows whose `device.self` is true */
  readonly here: string | undefined;
  readonly palette: Pick<MonitorPalette, "tint" | "neutral">;
  /** the window's rule for a lane drawn faint — the RECEDING filters (the profile tab); keep it stable */
  readonly receded: (lane: MonitorEndedRow) => boolean;
  /** the chosen desktop (P2's scope row), which NARROWS: an ended lane elsewhere leaves, as a live row does. Null: all */
  readonly desk: string | null;
  /** test seam */
  readonly now?: (() => number) | undefined;
}

/** `capabilities.history` for the mounted view, read only while it declares it. */
export function useMonitorHistory(options: MonitorHistoryOptions): MonitorHistory | undefined {
  const { port, wants, here, palette, receded, desk } = options;
  const now = options.now ?? Date.now;
  const asking = wants && port !== undefined;
  // nothing to watch while nothing asks: no view pays for a past it does not draw
  const rowsKey = asking ? historyRowsKey(options.rows) : "";
  /** the snapshot lent, kept as one object while nothing moves */
  const [snapshot, setSnapshot] = useState<MonitorPastSnapshot | undefined>(undefined);
  /** the door said there is no record here: lend nothing, ask no more */
  const [noRecord, setNoRecord] = useState(false);
  /** bumped to read again */
  const [generation, setGeneration] = useState(0);
  const lastRead = useRef(0);
  const lastGood = useRef<MonitorPastSnapshot | undefined>(undefined);
  const nowRef = useRef(now);
  nowRef.current = now;
  const hereRef = useRef(here);
  hereRef.current = here;
  const seams = useRef<ReadonlyMap<string, number>>(new Map());

  // a new door forgets what the old one said
  useEffect(() => {
    setNoRecord(false);
    setSnapshot(undefined);
    lastGood.current = undefined;
  }, [port]);

  // read: at once while the view asks, again for each generation the rows asked for
  useEffect(() => {
    if (!asking || noRecord) {
      if (!asking) {
        setSnapshot(undefined);
        lastGood.current = undefined;
      }
      return;
    }
    const untilMs = nowRef.current();
    const window = { sinceMs: untilMs - HISTORY_WINDOW_MS, untilMs };
    let live = true;
    lastRead.current = untilMs;
    const keep = (next: MonitorPastSnapshot): void => {
      setSnapshot((previous) => keepPast(previous, next));
    };
    // a record that cannot be read now: the last good past stays, said partial
    const fail = (unavailable: MonitorPastSnapshot): void => {
      const good = lastGood.current;
      keep(
        good === undefined ? unavailable : { ...good, state: "partial", detail: KEPT_PAST_DETAIL },
      );
    };
    port!.read(window).then(
      (answer) => {
        if (!live) return;
        const next = snapshotFrom(answer, hereRef.current);
        if (next.state === "unavailable") {
          fail(next);
          return;
        }
        lastGood.current = next;
        keep(next);
      },
      (error: unknown) => {
        if (!live) return;
        if (isNoRecord(error)) {
          setNoRecord(true);
          setSnapshot(undefined);
          return;
        }
        fail({
          ...window,
          readAt: untilMs,
          fidelity: "bounds",
          state: "unavailable",
          detail: "The record of past runs could not be read",
          live: [],
          ended: [],
        });
      },
    );
    return () => {
      live = false;
    };
  }, [port, asking, noRecord, generation]);

  // the seams the snapshot was read at, for the rows' movement below
  useEffect(() => {
    seams.current = new Map((snapshot?.live ?? []).map((lane) => [lane.id, lane.seamAt]));
  }, [snapshot]);

  // the rows moved while the view asks: a row left → read again within a
  // second; a seam moved or a row arrived → no sooner than the floor
  const watched = useRef<string | undefined>(undefined);
  useEffect(() => {
    const before = watched.current;
    watched.current = rowsKey;
    if (!asking || noRecord || before === undefined || before === rowsKey) return;
    const was = parseRowsKey(before);
    const is = parseRowsKey(rowsKey);
    const left = [...was.keys()].some((id) => !is.has(id));
    const moved = [...is].some(([id, since]) => {
      if (!was.has(id)) return true;
      const seam = seams.current.get(id);
      return seam !== undefined && since > seam;
    });
    if (!left && !moved) return;
    const wait = left
      ? HISTORY_LEFT_DEBOUNCE_MS
      : Math.max(0, lastRead.current + HISTORY_REFRESH_MIN_MS - nowRef.current());
    const timer = setTimeout(() => setGeneration((value) => value + 1), wait);
    return () => clearTimeout(timer);
  }, [rowsKey, asking, noRecord]);

  const tintL = palette.tint.l;
  const tintC = palette.tint.c;
  const neutral = palette.neutral;
  // the narrowing filter first, keyed on the snapshot's identity and the choice
  const narrowed = useMemo(
    () => (snapshot === undefined ? undefined : narrowPast(snapshot, desk, here)),
    [snapshot, desk, here],
  );
  // built once per narrowed snapshot (and per theme or receding filter), never per publish
  return useMemo(() => {
    if (!asking || noRecord || narrowed === undefined) return undefined;
    const colourFor = projectColourFor({ tint: { l: tintL, c: tintC }, neutral });
    return lendHistory(narrowed, { colourFor, receded });
  }, [asking, noRecord, narrowed, tintL, tintC, neutral, receded]);
}
