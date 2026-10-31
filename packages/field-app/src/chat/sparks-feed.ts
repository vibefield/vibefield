import {
  AgentFieldRow,
  ComposeSparksListResult,
  ComposeSparksOpenResult,
  type SparkId,
  type SparkSummary,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { useSyncExternalStore } from "react";
import { type SparkEntry, sparkEntriesOf } from "./spark-status";

// CHAT'S FEED (SP-1b; DESIGN.md §8 "Chat's list"). The window's one reading of its sparks, started by the frame's
// host for the window's life so Chat's cell can say a spark needs you from any view: the sparks fieldd keeps
// (`compose.sparks.list`), and the field board (`agent.subscribe {projection: "field"}` — content-free, a snapshot
// then deltas at its floor), whose rows say whose session a run is (`spark`) and who started it (`origin`). The
// list is asked again only when the board's sparks change — one appears, or one's run leaves — never on a timer.
// A module store, as the status line's is: only what reads it redraws when the board moves.

/** What the feed reads: the window's fieldd client in the product (`sparksPortOver`), a fixture in a test. */
export interface SparksPort {
  list(): Promise<readonly SparkSummary[]>;
  /** The field board: its snapshot, then its deltas, in order. Resolves to the way to stop. */
  watch(onFrame: (payload: unknown, kind: "snapshot" | "delta") => void): Promise<() => void>;
  /** Wake a spark: its last session resumes; a live one is answered as it is (CR-D11). */
  open(spark: SparkId): Promise<SparkSummary>;
}

const FIELD_ASK = { projection: "field" } as const;

export function sparksPortOver(client: FielddClient): SparksPort {
  return {
    list: async () =>
      ComposeSparksListResult.parse(await client.request("compose.sparks.list", {})).sparks,
    watch: async (onFrame) => {
      // the subscribe answers its snapshot; a delta heard before that answer waits behind it
      let ready = false;
      const early: [unknown, "snapshot" | "delta"][] = [];
      const subscription = await client.subscribe("agent.subscribe", FIELD_ASK, (payload, kind) => {
        if (ready) onFrame(payload, kind);
        else early.push([payload, kind]);
      });
      onFrame(subscription.snapshot, "snapshot");
      ready = true;
      for (const [payload, kind] of early) onFrame(payload, kind);
      return () => subscription.unsubscribe();
    },
    open: async (spark) =>
      ComposeSparksOpenResult.parse(await client.request("compose.sparks.open", { spark })).spark,
  };
}

/**
 * The field board as one window reads it (MF-1): a snapshot, then deltas on top of its `since`. Each row is read on
 * its own, so one this build cannot read is passed over and the rest stand (the tolerant reader); an unreadable
 * upsert drops the row it would have replaced rather than leave it stale.
 */
export class FieldBoard {
  #revision: number | null = null;
  #epoch: string | undefined;
  readonly #rows = new Map<string, AgentFieldRow>();

  /** One frame. False is a gap — a delta not on top of what this board holds — and the reader asks again. */
  apply(payload: unknown, kind: "snapshot" | "delta"): boolean {
    if (!isRecord(payload) || typeof payload["revision"] !== "number") return true;
    const epoch = typeof payload["epoch"] === "string" ? payload["epoch"] : undefined;
    if (kind === "snapshot") {
      this.#rows.clear();
      this.#upsert(payload["rows"]);
      this.#revision = payload["revision"];
      this.#epoch = epoch;
      return true;
    }
    if (this.#revision === null || payload["since"] !== this.#revision) return false;
    if (epoch !== undefined && epoch !== this.#epoch) return false;
    if (Array.isArray(payload["removed"])) {
      for (const id of payload["removed"]) if (typeof id === "string") this.#rows.delete(id);
    }
    this.#upsert(payload["upserts"]);
    this.#revision = payload["revision"];
    return true;
  }

  rows(): AgentFieldRow[] {
    return [...this.#rows.values()];
  }

  #upsert(rows: unknown): void {
    if (!Array.isArray(rows)) return;
    for (const candidate of rows) {
      const read = AgentFieldRow.safeParse(candidate);
      if (read.success) this.#rows.set(read.data.runtimeRunId, read.data);
      else if (isRecord(candidate) && typeof candidate["runtimeRunId"] === "string") {
        this.#rows.delete(candidate["runtimeRunId"]);
      }
    }
  }
}

/** Chat's reading, as the frame and the view draw it: honest states, never a blank. */
export type SparksReading =
  | { readonly state: "opening" }
  | { readonly state: "unavailable"; readonly reason: string }
  | { readonly state: "ready"; readonly entries: readonly SparkEntry[] };

interface FeedState {
  readonly reading: SparksReading;
  /** the sparks that need you, or null before the first reading (so what needed you then is no news) */
  readonly needing: readonly SparkEntry[] | null;
  /** the person's live sessions on the board by the persona each runs as (its `profileId`; null for an agent's own
   * folder), or null before the board is read: the New spark sheet's "Sees N sessions" (SP-1c) */
  readonly sessions: ReadonlyMap<string | null, number> | null;
}

const OPENING: FeedState = { reading: { state: "opening" }, needing: null, sessions: null };
let state: FeedState = OPENING;
const listeners = new Set<() => void>();

function publish(next: FeedState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The sparks on the board with a live run, as one key: the list is asked again whenever it changes. */
function boardSparksKey(rows: readonly AgentFieldRow[]): string {
  return [...new Set(rows.filter((row) => row.alive && row.spark).map((row) => row.spark))]
    .sort()
    .join(" ");
}

/** The same sparks needing you in the same words: the frame's note and dot change only when this does. */
function sameNeeds(a: readonly SparkEntry[] | null, b: readonly SparkEntry[]): boolean {
  if (a === null || a.length !== b.length) return false;
  return a.every(
    (entry, index) =>
      entry.spark.id === b[index]?.spark.id &&
      entry.status === b[index]?.status &&
      entry.spark.name === b[index]?.spark.name,
  );
}

class RunningFeed {
  #sparks: readonly SparkSummary[] | null = null;
  #failed: string | null = null;
  #rows: readonly AgentFieldRow[] = [];
  #boardRead = false;
  #asked = 0;
  #generation = 0;
  #stop: (() => void) | null = null;
  #open = true;
  #onBoard = "";

  constructor(readonly port: SparksPort) {
    this.refresh();
    this.#watch();
  }

  refresh(): void {
    const ask = ++this.#asked;
    this.port.list().then(
      (listed) => {
        if (!this.#open || ask !== this.#asked) return;
        this.#sparks = listed;
        this.#failed = null;
        this.#derive();
      },
      (error: unknown) => {
        if (!this.#open || ask !== this.#asked) return;
        this.#failed = error instanceof Error ? error.message : String(error);
        this.#derive();
      },
    );
  }

  close(): void {
    this.#open = false;
    this.#stop?.();
    this.#stop = null;
  }

  /** The board, for the feed's life; a gap asks for a fresh snapshot. */
  #watch(): void {
    const mine = ++this.#generation;
    const board = new FieldBoard();
    this.#stop?.();
    this.#stop = null;
    this.port
      .watch((payload, kind) => {
        if (!this.#open || mine !== this.#generation) return;
        if (!board.apply(payload, kind)) {
          this.#watch();
          return;
        }
        this.#rows = board.rows();
        this.#boardRead = true;
        const key = boardSparksKey(this.#rows);
        if (key !== this.#onBoard) {
          this.#onBoard = key;
          this.refresh();
        }
        this.#derive();
      })
      .then(
        (unsubscribe) => {
          if (this.#open && mine === this.#generation) this.#stop = unsubscribe;
          else unsubscribe();
        },
        // without the board the list stands on its records: Asleep, Hello, never a guess
        () => undefined,
      );
  }

  #derive(): void {
    const sessions = this.#boardRead ? sessionsByProfileOf(this.#rows) : null;
    if (this.#sparks === null) {
      publish({
        reading:
          this.#failed === null
            ? { state: "opening" }
            : { state: "unavailable", reason: this.#failed },
        needing: null,
        sessions,
      });
      return;
    }
    const entries = sparkEntriesOf(this.#sparks, this.#rows);
    const needing = entries.filter((entry) => entry.needsYou);
    publish({
      reading: { state: "ready", entries },
      needing: sameNeeds(state.needing, needing) ? state.needing : needing,
      sessions,
    });
  }
}

let running: RunningFeed | null = null;

/** Start the window's feed over `port` (its host does, once); the answer stops it. */
export function startSparksFeed(port: SparksPort): () => void {
  running?.close();
  const feed = new RunningFeed(port);
  running = feed;
  return () => {
    feed.close();
    if (running !== feed) return;
    running = null;
    publish(OPENING);
  };
}

/** Chat chooses a spark it was asked to (the New spark sheet's, once hatched): one request at a time, counted, so the
 * same spark asked again is chosen again. */
let chooseRequest: { readonly spark: SparkId; readonly seq: number } | null = null;
const choosers = new Set<() => void>();

export function chooseSpark(spark: SparkId): void {
  chooseRequest = { spark, seq: (chooseRequest?.seq ?? 0) + 1 };
  for (const listener of choosers) listener();
}

export function useChooseRequest(): { readonly spark: SparkId; readonly seq: number } | null {
  return useSyncExternalStore(
    (listener) => {
      choosers.add(listener);
      return () => choosers.delete(listener);
    },
    () => chooseRequest,
  );
}

/** Ask for the list again (after a Wake, which changes the spark's record). */
export function refreshSparks(): void {
  running?.refresh();
}

/** The doors the feed reads through, for Wake; null while no feed runs. */
export function sparksDoor(): SparksPort | null {
  return running?.port ?? null;
}

export function useSparksReading(): SparksReading {
  return useSyncExternalStore(subscribe, () => state.reading);
}

/** The sparks that need you (S-4), or null before the first reading. */
export function useSparksNeedingYou(): readonly SparkEntry[] | null {
  return useSyncExternalStore(subscribe, () => state.needing);
}

/** The person's live sessions by the persona each runs as, or null before the board is read. */
export function useSessionTally(): ReadonlyMap<string | null, number> | null {
  return useSyncExternalStore(subscribe, () => state.sessions);
}

/** The person's live sessions by persona (null: an agent's own folder); a spark's own session is not one of them. */
function sessionsByProfileOf(rows: readonly AgentFieldRow[]): ReadonlyMap<string | null, number> {
  const tally = new Map<string | null, number>();
  for (const row of rows) {
    if (!row.alive || row.spark !== undefined) continue;
    const profile = row.profileId ?? null;
    tally.set(profile, (tally.get(profile) ?? 0) + 1);
  }
  return tally;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
