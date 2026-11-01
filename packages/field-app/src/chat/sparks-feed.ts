import {
  AgentFieldRow,
  ComposeSparksListResult,
  ComposeSparksOpenResult,
  NeedsAnswerResult,
  NeedsItem,
  type NeedsItemId,
  type SparkId,
  type SparkSummary,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { useSyncExternalStore } from "react";
import { askAgain, onReconnectedOver } from "../reconnect";
import { type SparkEntry, sparkEntriesOf } from "./spark-status";
import { cellMarkOf, ThreadLedger, type ThreadMark, threadMarksOf } from "./thread-marks";

// CHAT'S FEED (SP-1b, SP-1d, CP-3; DESIGN.md §8 "Chat's list"). The window's one reading of its sparks, started by the
// frame's host for the window's life so Chat's cell can say a spark needs you from any view: the sparks fieldd keeps
// (`compose.sparks.list`), the field board (`agent.subscribe {projection: "field"}` — content-free, a snapshot then
// deltas at its floor), whose rows say whose session a run is (`spark`) and who started it (`origin`), and since CP-3
// the needs-you queue (`needs.subscribe` — its open items, whole, at each change), which says what waits on you for
// each spark, and is answered through the same feed (`needs.answer`, by an act's place). The list is asked again only
// when the board's sparks change — one appears, or one's run leaves — never on a timer. A fieldd without the queue
// (one before CP-3) refuses its subscribe, and the list stands on the board: no item, said by nothing, never a guess.
// It holds the window's one ledger of each thread's mark (`thread-marks.ts`): Chat says which thread is on screen
// (`showThread`), and every reading latches what happened in the others. A module store, as the status line's is:
// only what reads it redraws when the board moves.
//
// A fieldd restart replaces the window's document (main's boot fence: `FielddDaemonBootFence` →
// `requestAllReplacements`), so the feed, its ledger and its list start again ("Opening Chat…"), and the new feed asks
// for the board afresh. What the feed outlives is a connection drop while the same fieldd stays up: the client
// reconnects, replays the board's and the queue's subscriptions with fresh snapshots, and the list stands as last
// read. A board or a queue refused because the socket closed under the ask is never replayed, so each is asked again
// when the window's client is connected again (`SparksPort.onReconnected`); one refused for good stands until the feed
// starts again. What the board's or the queue's first reading finds is no news, whenever that reading comes.

/** What the feed reads: the window's fieldd client in the product (`sparksPortOver`), a fixture in a test. */
export interface SparksPort {
  list(): Promise<readonly SparkSummary[]>;
  /** The field board: its snapshot, then its deltas, in order. Resolves to the way to stop; rejects with fieldd's
   * refusal, `retryable` (a FielddRpcError's) when asking again may be answered, as when the connection closed under
   * the ask. */
  watch(onFrame: (payload: unknown, kind: "snapshot" | "delta") => void): Promise<() => void>;
  /** CP-3 — the needs-you queue's open items, oldest first: its snapshot, then each change, whole, in order. Resolves
   * to the way to stop; rejects with fieldd's refusal where fieldd has no queue, `retryable` (as the board's) when
   * asking again may be answered. */
  watchNeeds(onItems: (items: readonly NeedsItem[]) => void): Promise<() => void>;
  /** CP-3 — answer an item by its act's place among the item's acts (`needs.answer`): the answered item, or fieldd's
   * refusal thrown. The queue's next frame says it for every window. */
  answer(item: NeedsItemId, choice: number): Promise<NeedsItem>;
  /** Heard each time the window's client turns `ready` again: after its socket closed while the same fieldd stayed up,
   * reconnected on the token fieldd still holds. Never after a fieldd restart, which refuses that token and replaces
   * the window's document. The answer stops it. */
  onReconnected(listener: () => void): () => void;
  /** Wake a spark: its last session resumes; a live one is answered as it is (CR-D11). */
  open(spark: SparkId): Promise<SparkSummary>;
}

const FIELD_ASK = { projection: "field" } as const;

export function sparksPortOver(client: FielddClient): SparksPort {
  return {
    list: async () =>
      ComposeSparksListResult.parse(await client.request("compose.sparks.list", {})).sparks,
    watch: (onFrame) => subscribeInOrder(client, "agent.subscribe", FIELD_ASK, onFrame),
    watchNeeds: (onItems) =>
      subscribeInOrder(client, "needs.subscribe", {}, (payload) => onItems(needsItemsOf(payload))),
    answer: async (item, choice) =>
      NeedsAnswerResult.parse(await client.request("needs.answer", { item, choice })).item,
    onReconnected: onReconnectedOver(client),
    open: async (spark) =>
      ComposeSparksOpenResult.parse(await client.request("compose.sparks.open", { spark })).spark,
  };
}

/** A subscription heard in order: the subscribe answers its snapshot, and a frame heard before that answer waits
 * behind it. Resolves to the way to stop. */
async function subscribeInOrder(
  client: FielddClient,
  method: string,
  params: unknown,
  onFrame: (payload: unknown, kind: "snapshot" | "delta") => void,
): Promise<() => void> {
  let ready = false;
  const early: [unknown, "snapshot" | "delta"][] = [];
  const subscription = await client.subscribe(method, params, (payload, kind) => {
    if (ready) onFrame(payload, kind);
    else early.push([payload, kind]);
  });
  onFrame(subscription.snapshot, "snapshot");
  ready = true;
  for (const [payload, kind] of early) onFrame(payload, kind);
  return () => subscription.unsubscribe();
}

/** The queue's open items as one frame says them (needs.subscribe's snapshot and every change: the list, whole). Each
 * is read on its own, so one this build cannot read is passed over and the rest stand (the tolerant reader); a frame
 * with no list says none. */
export function needsItemsOf(payload: unknown): NeedsItem[] {
  if (!isRecord(payload) || !Array.isArray(payload["items"])) return [];
  const items: NeedsItem[] = [];
  for (const candidate of payload["items"]) {
    const read = NeedsItem.safeParse(candidate);
    if (read.success) items.push(read.data);
  }
  return items;
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

/** The field board's rows as the window reads them: null before the board is read, "failed" while it can't be. */
export type BoardRows = readonly AgentFieldRow[] | "failed" | null;

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
  /** the sparks that need you, or null before the first reading of the list, the board and the queue, each (so what
   * needed you then is no news) */
  readonly needing: readonly SparkEntry[] | null;
  /** the person's live sessions on the board by the persona each runs as (its `profileId`; null for an agent's own
   * folder), or null before the board is read: the New spark sheet's "Sees N sessions" (SP-1c) */
  readonly sessions: ReadonlyMap<string | null, number> | null;
  /** the field board's rows as last read, null before the board is read, or "failed" while it can't be (its
   * subscription refused): @'s sessions in Chat's composer (SP-1d) */
  readonly rows: BoardRows;
  /** Wake, through the feed that reads this window's sparks; null while none does, so no act that wakes is drawn */
  readonly open: SparkOpener | null;
  /** An answer, through the same feed (CP-3); null while none reads the queue, so nothing is answered */
  readonly answer: NeedsAnswerer | null;
  /** the needs that stood when the board or the queue was first read, while they stand (CP-3): what a first reading
   * finds is no news, even one that comes only after a refusal the feed asked past */
  readonly noNews: ReadonlySet<string>;
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

/** Answer one of the queue's items by its act's place (`needs.answer`, CP-3): the item fieldd handed back with its
 * answer, or its refusal thrown in fieldd's words, for the card that asked to say. */
export type NeedsAnswerer = (item: NeedsItemId, choice: number) => Promise<NeedsItem>;

const NO_MARKS: ReadonlyMap<SparkId, ThreadMark> = new Map();
const NO_NEWS: ReadonlySet<string> = new Set();

const OPENING: FeedState = {
  reading: { state: "opening" },
  needing: null,
  sessions: null,
  rows: null,
  open: null,
  answer: null,
  noNews: NO_NEWS,
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

/** The same sparks needing you in the same words, for the same needs: the frame's note changes only when this does. */
function sameNeeds(a: readonly SparkEntry[] | null, b: readonly SparkEntry[]): boolean {
  if (a === null || a.length !== b.length) return false;
  return a.every((entry, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      entry.spark.id === other.spark.id &&
      entry.status === other.status &&
      entry.spark.name === other.spark.name &&
      entry.needs.length === other.needs.length &&
      entry.needs.every((need, at) => need === other.needs[at])
    );
  });
}

class RunningFeed {
  #sparks: readonly SparkSummary[] | null = null;
  #failed: string | null = null;
  #rows: readonly AgentFieldRow[] = [];
  #boardRead = false;
  /** the board has had its first reading, or cannot be read: what it shows then is no news */
  #boardSettled = false;
  /** the queue's open items as last read (CP-3); none while it has not answered, or where fieldd has none */
  #items: readonly NeedsItem[] = [];
  /** the queue has answered once: a frame after that is no first reading */
  #needsRead = false;
  /** the queue has had its first reading, or cannot be read */
  #needsSettled = false;
  #stopNeeds: (() => void) | null = null;
  /** the queue's subscription was refused, as the board's can be: "again", asked again when the window's client is
   * connected again; "for-good" (a fieldd with no queue), never asked again by this feed */
  #needsRefused: "again" | "for-good" | null = null;
  /** the needs (`SparkEntry.needs`' keys) standing on the last reading */
  #standing: ReadonlySet<string> = NO_NEWS;
  /** those of them found by the board's or the queue's first reading, kept while they stand (`FeedState.noNews`) */
  #noNews: ReadonlySet<string> = NO_NEWS;
  /** the board's subscription was refused: "again" when the refusal is retryable (the socket closed under the ask),
   * asked again when the window's client is connected again (`SparksPort.onReconnected`); "for-good" for any other
   * refusal, never asked again by this feed */
  #boardRefused: "again" | "for-good" | null = null;
  #asked = 0;
  #generation = 0;
  #stop: (() => void) | null = null;
  readonly #offReconnected: () => void;
  #open = true;
  #onBoard = "";
  /** the sparks this window has seen have a turn, for its life and written nowhere (HN-D9's rule): a turn seen stays
   * seen whatever the board counts after it. A fieldd restart replaces the window's document, and fieldd re-attaches
   * only the runs a restart left (as it boots, and in its G5 retries after), so the set starts empty over a
   * re-attached run (DESIGN.md §8 "Chat's thread", the open cases) */
  readonly #turnsSeen = new Set<SparkId>();
  /** each thread's mark, for the feed's life (the window's) and written nowhere (HN-D9's rule) */
  readonly #ledger = new ThreadLedger();
  /** the last reading's entries, which a thread shown is read on */
  #entries: readonly SparkEntry[] = [];

  constructor(readonly port: SparksPort) {
    this.#ledger.show(onScreen, []);
    this.refresh();
    this.#watch();
    this.#watchNeeds();
    this.#offReconnected = port.onReconnected(() => {
      if (!this.#open) return;
      if (this.#boardRefused === "again") this.#watch();
      if (this.#needsRefused === "again") this.#watchNeeds();
    });
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

  /** The feed's answer: the queue's next frame says what it did, for every window. */
  readonly answer: NeedsAnswerer = (item, choice) => this.port.answer(item, choice);

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
    this.#offReconnected();
    this.#stop?.();
    this.#stop = null;
    this.#stopNeeds?.();
    this.#stopNeeds = null;
  }

  /** The board, for the feed's life; a gap asks for a fresh snapshot, and so does the window's client reconnected after
   * a refusal the closed socket caused. */
  #watch(): void {
    const mine = ++this.#generation;
    const board = new FieldBoard();
    this.#stop?.();
    this.#stop = null;
    // a board asked again is said as being read, never as the refusal it asks past (rows read before stand meanwhile)
    if (this.#boardRefused !== null) {
      this.#boardRefused = null;
      this.#derive();
    }
    this.port
      .watch((payload, kind) => {
        if (!this.#open || mine !== this.#generation) return;
        if (!board.apply(payload, kind)) {
          this.#watch();
          return;
        }
        this.#rows = board.rows();
        const first = !this.#boardRead;
        this.#boardRead = true;
        this.#boardSettled = true;
        const key = boardSparksKey(this.#rows);
        if (key !== this.#onBoard) {
          this.#onBoard = key;
          this.refresh();
        }
        this.#derive(first);
      })
      .then(
        (unsubscribe) => {
          if (this.#open && mine === this.#generation) this.#stop = unsubscribe;
          else unsubscribe();
        },
        // without the board the list stands on its records and the queue (Asleep, Hello, never a guess), and @ says it
        // can't read what is running rather than read it for good (DESIGN.md §8 "Chat's composer")
        (refusal: unknown) => {
          if (!this.#open || mine !== this.#generation) return;
          this.#boardRefused = askAgain(refusal) ? "again" : "for-good";
          this.#boardSettled = true;
          this.#derive();
        },
      );
  }

  /** The queue, for the feed's life (CP-3). Each frame is the whole list, so no frame can be missed; a reconnect's
   * fresh snapshot comes to the same listener. A fieldd without it refuses for good: the list stands on the board. One
   * refused as the socket closed under the ask is asked again on the board's seam, once the client reconnects. */
  #watchNeeds(): void {
    this.#needsRefused = null;
    this.port
      .watchNeeds((items) => {
        if (!this.#open) return;
        this.#items = items;
        const first = !this.#needsRead;
        this.#needsRead = true;
        this.#needsSettled = true;
        this.#derive(first);
      })
      .then(
        (unsubscribe) => {
          if (this.#open) this.#stopNeeds = unsubscribe;
          else unsubscribe();
        },
        (refusal: unknown) => {
          if (!this.#open) return;
          this.#needsRefused = askAgain(refusal) ? "again" : "for-good";
          if (this.#needsSettled) return;
          this.#needsSettled = true;
          this.#derive();
        },
      );
  }

  /** One reading published. `first`: it follows the board's or the queue's first reading, whose needs are no news. */
  #derive(first = false): void {
    const sessions = this.#boardRead ? sessionsByProfileOf(this.#rows) : null;
    const rows = this.#boardRefused !== null ? "failed" : this.#boardRead ? this.#rows : null;
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
        answer: this.answer,
        noNews: this.#noNews,
        marks: NO_MARKS,
        cell: null,
      });
      return;
    }
    const entries = sparkEntriesOf(this.#sparks, this.#rows, {
      items: this.#items,
      turnsSeen: this.#turnsSeen,
    });
    for (const entry of entries) if (entry.turnSeen) this.#turnsSeen.add(entry.spark.id);
    this.#entries = entries;
    this.#ledger.read(entries);
    const needing = entries.filter((entry) => entry.needsYou);
    // what the list, the board and the queue each say on their first reading is no news: the note waits for all three,
    // and a first reading that comes after them (the board or the queue asked again past a refusal) hands what it
    // finds as already seen
    const read = this.#boardSettled && this.#needsSettled;
    const standing = new Set(needing.flatMap((entry) => entry.needs));
    this.#noNews = noNewsOf(this.#noNews, this.#standing, standing, first);
    this.#standing = standing;
    publish({
      reading: { state: "ready", entries },
      needing: !read ? null : sameNeeds(state.needing, needing) ? state.needing : needing,
      sessions,
      rows,
      open: this.open,
      answer: this.answer,
      noNews: this.#noNews,
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

/** Answer the queue's items through the feed that reads them (CP-3): null while no feed runs, when no reading is ready
 * and so no card stands. */
export function useNeedsAnswerer(): NeedsAnswerer | null {
  return useSyncExternalStore(subscribe, () => state.answer);
}

/** The sparks that need you (S-4), or null before the first reading of the list, the board and the queue: the views
 * track's note over Chat's cell, said for each need new since the last reading (`SparkEntry.needs`) and not among
 * `useNeedsNoNews`'s. */
export function useSparksNeedingYou(): readonly SparkEntry[] | null {
  return useSyncExternalStore(subscribe, () => state.needing);
}

/** The needs (`SparkEntry.needs`' keys) that stood when the board or the queue was first read, while they stand: no
 * news, whenever that reading came (CP-3; DESIGN.md §8 "Chat's list", Needs you). */
export function useNeedsNoNews(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => state.noNews);
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

/** The field board's rows as last read, null before the board is read, or "failed" while it can't be (@'s sessions,
 * SP-1d). */
export function useBoardRows(): BoardRows {
  return useSyncExternalStore(subscribe, () => state.rows);
}

/** How Chat's list stands now — read, opening, or unreadable — as its panel draws it: for Send, which asks it where it
 * cannot go on and says it as the list does (DESIGN.md §8 "Chat's composer"). While it is not read no thread is drawn.
 * A send is pressed only on a list read, so Send reads it unread only when the window's feed starts again under the
 * send. A fieldd restart never does that: it replaces the window's document, and the send with it (main's boot
 * fence). Within one document the feed starts once, so today that only guards a feed restarted in place. */
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

/** The needs no news now: those of `before` that still stand, and after a first reading the ones it found (standing
 * now, not on the reading before it). Kept as it was while nothing changed. */
function noNewsOf(
  before: ReadonlySet<string>,
  last: ReadonlySet<string>,
  standing: ReadonlySet<string>,
  first: boolean,
): ReadonlySet<string> {
  const next = new Set(
    [...standing].filter((need) => before.has(need) || (first && !last.has(need))),
  );
  return next.size === before.size && [...next].every((need) => before.has(need)) ? before : next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
