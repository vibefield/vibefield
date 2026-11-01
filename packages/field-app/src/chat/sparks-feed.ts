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
import { cellMarkOf, ThreadLedger, type ThreadMark, threadMarksOf } from "./thread-marks";

// CHAT'S FEED (SP-1b, SP-1d; DESIGN.md §8 "Chat's list"). The window's one reading of its sparks, started by the
// frame's host for the window's life so Chat's cell can say a spark needs you from any view: the sparks fieldd keeps
// (`compose.sparks.list`), and the field board (`agent.subscribe {projection: "field"}` — content-free, a snapshot
// then deltas at its floor), whose rows say whose session a run is (`spark`) and who started it (`origin`). The
// list is asked again only when the board's sparks change — one appears, or one's run leaves — never on a timer.
// It holds the window's one ledger of each thread's mark (`thread-marks.ts`): Chat says which thread is on screen
// (`showThread`), and every reading latches what happened in the others. A module store, as the status line's is:
// only what reads it redraws when the board moves.

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

/** What Chat says while its list cannot be read (DESIGN.md §8 "Chat's list"), fieldd's words under it; Send says the
 * same when it cannot go on while the list says it (§8 "Chat's composer"). */
export const SPARKS_UNREADABLE = "Chat can't read your sparks";

interface FeedState {
  readonly reading: SparksReading;
  /** the sparks that need you, or null before the first reading (so what needed you then is no news) */
  readonly needing: readonly SparkEntry[] | null;
  /** the person's live sessions on the board by the persona each runs as (its `profileId`; null for an agent's own
   * folder), or null before the board is read: the New spark sheet's "Sees N sessions" (SP-1c) */
  readonly sessions: ReadonlyMap<string | null, number> | null;
  /** the field board's rows as last read, or null before the board is read: @'s sessions in Chat's composer (SP-1d) */
  readonly rows: readonly AgentFieldRow[] | null;
  /** Wake, through the feed that reads this window's sparks; null while none does, so no act that wakes is drawn */
  readonly open: SparkOpener | null;
  /** each thread's mark on the reading (SP-1d): a needs-you dot, or unread; empty before the first reading */
  readonly marks: ReadonlyMap<SparkId, ThreadMark>;
  /** Chat's cell's mark, which the views track draws in another view: needs while any needs-you dot stands, else
   * unread while a thread is */
  readonly cell: ThreadMark | null;
}

/** Wake a spark (`compose.sparks.open`): its last session resumes; a live one is answered as it is (CR-D11). It throws
 * its refusal, in fieldd's words, for the act that asked to say once, where it was asked (DESIGN.md §8 "Chat's list",
 * the thread's column as SP-1d built it). THE one wake for every act that asks for one: Wake on the thread's line, and
 * Send. */
export type SparkOpener = (spark: SparkId) => Promise<void>;

const NO_MARKS: ReadonlyMap<SparkId, ThreadMark> = new Map();

const OPENING: FeedState = {
  reading: { state: "opening" },
  needing: null,
  sessions: null,
  rows: null,
  open: null,
  marks: NO_MARKS,
  cell: null,
};
let state: FeedState = OPENING;
const listeners = new Set<() => void>();

/** The thread on screen (SP-1d): the one Chat shows while Chat is the view, else null. Chat says it (`showThread`);
 * it outlives any one feed, so a feed started later knows it. */
let onScreen: SparkId | null = null;

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

/** The same threads with the same marks: what draws the dots redraws only when this changes. */
function sameMarks(
  a: ReadonlyMap<SparkId, ThreadMark>,
  b: ReadonlyMap<SparkId, ThreadMark>,
): boolean {
  return a.size === b.size && [...b].every(([spark, mark]) => a.get(spark) === mark);
}

/** The same sparks needing you in the same words: the frame's note changes only when this does. */
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
  /** the sparks this window has seen have a turn, for its life and written nowhere (HN-D9's rule): a run fieldd
   * re-attached reads its transcript back, which the board never counts, so a turn seen before stays seen */
  readonly #turnsSeen = new Set<SparkId>();
  /** each thread's mark, for the feed's life (the window's) and written nowhere (HN-D9's rule) */
  readonly #ledger = new ThreadLedger();
  /** the last reading's entries, which a thread shown is read on */
  #entries: readonly SparkEntry[] = [];

  constructor(readonly port: SparksPort) {
    this.#ledger.show(onScreen, []);
    this.refresh();
    this.#watch();
  }

  /** A thread came on screen, or left it: opening it reads it, and the reading stands as it was. */
  show(spark: SparkId | null): void {
    this.#ledger.show(spark, this.#entries);
    if (state.reading.state === "ready") publish({ ...state, ...this.#marked() });
  }

  /** The ledger's marks on the last reading, kept as they were while nothing changed. */
  #marked(): Pick<FeedState, "marks" | "cell"> {
    const marks = threadMarksOf(this.#entries, this.#ledger);
    return sameMarks(state.marks, marks)
      ? { marks: state.marks, cell: state.cell }
      : { marks, cell: cellMarkOf(marks) };
  }

  /** The feed's wake: the list is asked again whether it woke or not, since the record says what the door did. */
  readonly open: SparkOpener = async (spark) => {
    try {
      await this.port.open(spark);
    } finally {
      refreshSparks();
    }
  };

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
    const rows = this.#boardRead ? this.#rows : null;
    if (this.#sparks === null) {
      publish({
        reading:
          this.#failed === null
            ? { state: "opening" }
            : { state: "unavailable", reason: this.#failed },
        needing: null,
        sessions,
        rows,
        open: this.open,
        marks: NO_MARKS,
        cell: null,
      });
      return;
    }
    const entries = sparkEntriesOf(this.#sparks, this.#rows, this.#turnsSeen);
    for (const entry of entries) if (entry.turnSeen) this.#turnsSeen.add(entry.spark.id);
    this.#entries = entries;
    this.#ledger.read(entries);
    const needing = entries.filter((entry) => entry.needsYou);
    publish({
      reading: { state: "ready", entries },
      needing: sameNeeds(state.needing, needing) ? state.needing : needing,
      sessions,
      rows,
      open: this.open,
      ...this.#marked(),
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

/** Ask for the list again (after a hatch or a wake, which change the spark's record). */
export function refreshSparks(): void {
  running?.refresh();
}

export function useSparksReading(): SparksReading {
  return useSyncExternalStore(subscribe, () => state.reading);
}

/** Wake, through the feed that published the reading: null while no feed runs, when no reading is ready and so no act
 * that wakes is drawn. */
export function useSparkOpener(): SparkOpener | null {
  return useSyncExternalStore(subscribe, () => state.open);
}

/** The sparks that need you (S-4), or null before the first reading: the views track's note over Chat's cell. */
export function useSparksNeedingYou(): readonly SparkEntry[] | null {
  return useSyncExternalStore(subscribe, () => state.needing);
}

/** Chat says which thread is on screen (SP-1d; DESIGN.md §8 "Chat's list"): the one it shows while Chat is the view,
 * else null. Opening a thread reads it: its needs-you dot and its unread go. */
export function showThread(spark: SparkId | null): void {
  if (spark === onScreen) return;
  onScreen = spark;
  running?.show(spark);
}

/** The thread on screen now, as Chat last said it (`showThread`), or null: for Send, which asks it when no pane of
 * its thread settled (DESIGN.md §8 "Chat's composer"). */
export function threadOnScreen(): SparkId | null {
  return onScreen;
}

/** Each thread's mark (SP-1d), by its spark: a needs-you dot while the need stands or since it stood off screen,
 * else unread since its spark's own turn ended off screen. Empty before the first reading. Chat's rows draw it. */
export function useThreadMarks(): ReadonlyMap<SparkId, ThreadMark> {
  return useSyncExternalStore(subscribe, () => state.marks);
}

/** Chat's cell's mark (SP-1d): "needs" while any thread's needs-you dot stands, else "unread" while any thread is
 * unread, else null (and before the first reading). It does not know the view: the frame draws it in another view
 * only, where nothing is on screen. A spark's need, however it is read into `SparkEntry.needsYou`, is a needs mark. */
export function useCellMark(): ThreadMark | null {
  return useSyncExternalStore(subscribe, () => state.cell);
}

/** The person's live sessions by the persona each runs as, or null before the board is read. */
export function useSessionTally(): ReadonlyMap<string | null, number> | null {
  return useSyncExternalStore(subscribe, () => state.sessions);
}

/** The field board's rows as last read, or null before the board is read (@'s sessions, SP-1d). */
export function useBoardRows(): readonly AgentFieldRow[] | null {
  return useSyncExternalStore(subscribe, () => state.rows);
}

/** How Chat's list stands now — read, opening, or unreadable — as its panel draws it: for Send, which asks it where it
 * cannot go on and says it as the list does (DESIGN.md §8 "Chat's composer"). While it is not read — fieldd
 * restarting, or its list refused — no thread is drawn. */
export function sparksReadingNow(): SparksReading["state"] {
  return state.reading.state;
}

/** `spark`'s entry as the feed reads it now, or null while the list does not hold it. */
export function sparkEntryNow(spark: SparkId): SparkEntry | null {
  return state.reading.state === "ready"
    ? (state.reading.entries.find((entry) => entry.spark.id === spark) ?? null)
    : null;
}

/** For Send (SP-1d; DESIGN.md §8 "Chat's composer"): `spark`'s entry once `test` holds for it, heard as the feed
 * publishes — never polled — or null after `timeoutMs`. */
export function whenSparkEntry(
  spark: SparkId,
  test: (entry: SparkEntry) => boolean,
  timeoutMs: number,
): Promise<SparkEntry | null> {
  const held = (): SparkEntry | null => {
    const entry = sparkEntryNow(spark);
    return entry !== null && test(entry) ? entry : null;
  };
  const now = held();
  if (now !== null) return Promise.resolve(now);
  return new Promise((resolve) => {
    const stop = subscribe(() => {
      const entry = held();
      if (entry === null) return;
      clearTimeout(timer);
      stop();
      resolve(entry);
    });
    const timer = setTimeout(() => {
      stop();
      resolve(null);
    }, timeoutMs);
  });
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
