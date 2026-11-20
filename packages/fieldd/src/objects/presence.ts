import type {
  AtWorkState,
  ObjectAtWork,
  ObjectAtWorkProject,
  ObjectPresence,
  ObjectRef,
  ObjectsPresenceSnapshot,
} from "@vibefield/contracts";
import { OBJECT_ROOM } from "@vibefield/contracts";

// OB-4 (thinking-objects-at-work.md §7; OB-L6) — who is at work on what: per object, per run, one of §7's states, when
// it began, and what the separate undo would undo. States follow actual operations and an operation stops being in
// flight when its answer arrives. The person's hand wins (OB-L5): while an object is held, every agent on it reads
// `paused`, and it comes back as whatever it really is when the hand lifts. A `one` kind has a holder and waiters
// (OB-D9): the holder is the run acting on it, and a holder's lease ends with its release, its grant or its run.
//
// Item 550 (2026-11-18) — what the desk shows of a run (its name, its agent, its project's ids, its spark, the spark
// that started it) is the run's NOW, never what it was when it first came onto the object: it is read at each act and
// at every `refresh`, and the feed hears of it only when something it carries changed.

/** The run an act is by, as the desk names it. */
export interface AtWorkAgent {
  readonly run: string;
  readonly handle: string;
  readonly agent: string;
}

/** Item 550 (2026-11-18) — what the desk shows of a run: ids and words, never a look. */
export interface AtWorkFacts {
  readonly handle: string;
  /** the agent's catalog id */
  readonly agent: string;
  readonly project?: ObjectAtWorkProject;
  /** the run is this spark's own session */
  readonly spark?: string;
  /** a spark started this run */
  readonly startedBy?: string;
}

interface Row {
  readonly run: string;
  /** what the desk shows of the run, as last read: a released row keeps its words while it is seen leaving */
  facts: AtWorkFacts;
  /** what the agent is really doing, beneath a hold */
  real: AtWorkState;
  state: AtWorkState;
  since: number;
  lastChange?: string;
  /** removes a released row once the desk has shown it leaving */
  leaving?: ReturnType<typeof setTimeout>;
}

interface Board {
  readonly rows: Map<string, Row>;
  holder?: string;
  readonly waiters: string[];
  held: boolean;
}

export interface PresenceOptions {
  /** where an object stands, for the frame */
  locate(ref: ObjectRef): { docId: string; key: string } | undefined;
  /** how the desk shows a run now (item 550, 2026-11-18) */
  facts(run: string): AtWorkFacts;
  /** who a run's lease belongs to: a spark's stays the spark's across its runs */
  keyOf?(run: string): string;
  readonly now?: () => number;
  readonly releasedShownMs?: number;
}

export class ObjectPresenceBoard {
  readonly #boards = new Map<ObjectRef, Board>();
  readonly #listeners = new Set<() => void>();
  readonly #now: () => number;
  readonly #releasedShownMs: number;

  constructor(private readonly opts: PresenceOptions) {
    this.#now = opts.now ?? Date.now;
    this.#releasedShownMs = opts.releasedShownMs ?? OBJECT_ROOM.RELEASED_SHOWN_MS;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The whole list, as `objects.presence.subscribe` carries it. */
  snapshot(): ObjectsPresenceSnapshot {
    const objects: ObjectPresence[] = [];
    for (const [ref, board] of this.#boards) {
      const at = this.opts.locate(ref);
      if (at === undefined) continue;
      if (board.rows.size === 0 && board.holder === undefined) continue;
      objects.push({
        ref,
        docId: at.docId,
        key: at.key,
        agents: [...board.rows.values()].map(atWork),
        ...(board.holder !== undefined ? { holder: this.#runOf(board, board.holder) } : {}),
        ...(board.waiters.length > 0
          ? { waiters: board.waiters.map((key) => this.#runOf(board, key)) }
          : {}),
      });
    }
    return { objects };
  }

  /** Who a caller sees on an object: everyone not yet gone, by handle and state and nothing more (an agent is never
   * told a run's project, its spark or who started it). */
  agentsOn(ref: ObjectRef): { handle: string; state: AtWorkState }[] {
    const rows = this.#boards.get(ref)?.rows.values() ?? [];
    return [...rows]
      .filter((row) => row.real !== "released")
      .map(({ facts, state }) => ({ handle: facts.handle, state }));
  }

  /** Item 550 (2026-11-18) — something the desk shows of a run may have moved (its title, its project's ids, who
   * started it): each run on the board is read again, and the feed is told only when something it carries changed. A
   * released row keeps its words. */
  refresh(): void {
    if (this.#boards.size === 0) return;
    const read = new Map<string, AtWorkFacts>();
    let moved = false;
    for (const board of this.#boards.values()) {
      for (const row of board.rows.values()) {
        if (row.real === "released") continue;
        let facts = read.get(row.run);
        if (facts === undefined) {
          facts = this.opts.facts(row.run);
          read.set(row.run, facts);
        }
        if (sameFacts(row.facts, facts)) continue;
        row.facts = facts;
        moved = true;
      }
    }
    if (moved) this.#changed();
  }

  /** The objects a run is on now and has not released. */
  onObjects(run: string): ObjectRef[] {
    return [...this.#boards]
      .filter(([, board]) => {
        const row = board.rows.get(run);
        return row !== undefined && row.real !== "released";
      })
      .map(([ref]) => ref);
  }

  /** Take a run off an object at once, with no leaving to show: its successor stands there now. */
  forget(ref: ObjectRef, run: string): void {
    const board = this.#boards.get(ref);
    const row = board?.rows.get(run);
    if (board === undefined || row === undefined) return;
    if (row.leaving !== undefined) clearTimeout(row.leaving);
    board.rows.delete(run);
    this.#tidy(ref, board);
    this.#changed();
  }

  /** Every run on an object now, released or not. */
  runsOn(ref: ObjectRef): string[] {
    return [...(this.#boards.get(ref)?.rows.keys() ?? [])];
  }

  /** The agent now has the object open, or is otherwise on it. */
  opened(ref: ObjectRef, run: string): void {
    this.#set(ref, run, "open");
  }

  /** An operation starts: `reading` or `acting`, until its answer arrives. */
  begin(ref: ObjectRef, run: string, state: "reading" | "acting"): void {
    this.#set(ref, run, state);
  }

  /** An operation's answer arrived. A row that has left since it began stays left: a late answer revives nothing. */
  settle(ref: ObjectRef, run: string, state: "open" | "failed" | "needs-you"): void {
    const row = this.#boards.get(ref)?.rows.get(run);
    if (row === undefined || row.real === "released") return;
    this.#set(ref, run, state);
  }

  /** The agent stopped working on the object, or was stopped: it stays visible long enough to be seen leaving. */
  released(ref: ObjectRef, run: string): void {
    const board = this.#boards.get(ref);
    if (board === undefined) return;
    this.#dropLease(board, this.#keyOf(run));
    const row = board.rows.get(run);
    if (row !== undefined && row.real !== "released") {
      row.real = "released";
      row.state = "released";
      row.since = this.#now();
      delete row.lastChange;
      const timer = setTimeout(() => {
        if (board.rows.get(run) !== row) return;
        board.rows.delete(run);
        this.#tidy(ref, board);
        this.#changed();
      }, this.#releasedShownMs);
      timer.unref?.();
      row.leaving = timer;
    }
    this.#tidy(ref, board);
    this.#changed();
  }

  /** OB-L5 — the person's hand came onto or left an object. */
  hold(ref: ObjectRef, held: boolean): void {
    const board = held ? this.#board(ref) : this.#boards.get(ref);
    if (board === undefined || board.held === held) return;
    board.held = held;
    const at = this.#now();
    for (const row of board.rows.values()) {
      if (row.real === "released") continue;
      row.state = held ? "paused" : row.real;
      row.since = at;
    }
    this.#tidy(ref, board);
    this.#changed();
  }

  isHeld(ref: ObjectRef): boolean {
    return this.#boards.get(ref)?.held === true;
  }

  /** What the separate undo would undo for this run on this object (OB-D11). */
  setLastChange(ref: ObjectRef, run: string, label: string | undefined): void {
    const row = this.#boards.get(ref)?.rows.get(run);
    if (row === undefined || row.lastChange === label) return;
    if (label === undefined) delete row.lastChange;
    else row.lastChange = label;
    this.#changed();
  }

  /** OB-D9 — a `one` kind's lease. True when `run` is (now) the holder; false when another holds it and `run` waits. */
  claim(ref: ObjectRef, run: string): boolean {
    const board = this.#board(ref);
    const key = this.#keyOf(run);
    if (board.holder !== undefined && board.holder !== key) {
      if (!board.waiters.includes(key)) {
        board.waiters.push(key);
        this.#changed();
      }
      return false;
    }
    if (board.holder === key) return true;
    board.holder = key;
    removeFrom(board.waiters, key);
    this.#changed();
    return true;
  }

  /** The holder, to reach a `busy` caller's words. */
  holderOf(ref: ObjectRef): string | undefined {
    const board = this.#boards.get(ref);
    return board?.holder === undefined ? undefined : this.#runOf(board, board.holder);
  }

  /** OB-D9 — handing a `one` kind moves it. */
  moveHolder(ref: ObjectRef, run: string): void {
    const board = this.#board(ref);
    const key = this.#keyOf(run);
    board.holder = key;
    removeFrom(board.waiters, key);
    this.#changed();
  }

  /** A holder's lease ends with no row to end it through: the person took the object back. */
  dropLease(ref: ObjectRef, key: string): void {
    const board = this.#boards.get(ref);
    if (board === undefined) return;
    this.#dropLease(board, key);
    this.#tidy(ref, board);
    this.#changed();
  }

  /** Forget every trace of an object (it is gone from its board). */
  drop(ref: ObjectRef): void {
    const board = this.#boards.get(ref);
    if (board === undefined) return;
    for (const row of board.rows.values()) if (row.leaving) clearTimeout(row.leaving);
    this.#boards.delete(ref);
    this.#changed();
  }

  /** A run has ended: it is off every object. */
  runEnded(run: string): void {
    for (const ref of [...this.#boards.keys()]) this.released(ref, run);
  }

  #set(ref: ObjectRef, run: string, state: AtWorkState): void {
    const board = this.#board(ref);
    const shown: AtWorkState = board.held ? "paused" : state;
    const row = board.rows.get(run);
    const facts = this.opts.facts(run);
    if (row === undefined) {
      board.rows.set(run, { run, facts, real: state, state: shown, since: this.#now() });
    } else {
      if (row.leaving !== undefined) {
        clearTimeout(row.leaving);
        delete row.leaving;
      }
      const moved = !sameFacts(row.facts, facts);
      if (moved) row.facts = facts;
      if (row.real === state && row.state === shown && !moved) return;
      row.real = state;
      if (row.state !== shown) row.since = this.#now();
      row.state = shown;
    }
    this.#changed();
  }

  /** A holder that lets go leaves nobody waiting: they ask again, and the first to act holds it. */
  #dropLease(board: Board, key: string): void {
    if (board.holder === key) {
      delete board.holder;
      board.waiters.length = 0;
      return;
    }
    removeFrom(board.waiters, key);
  }

  #keyOf(run: string): string {
    return this.opts.keyOf?.(run) ?? run;
  }

  /** The run the desk shows for a lease: the newest of the holder's on this object. */
  #runOf(board: Board, key: string): string {
    return [...board.rows.keys()].filter((run) => this.#keyOf(run) === key).at(-1) ?? key;
  }

  #board(ref: ObjectRef): Board {
    let board = this.#boards.get(ref);
    if (board === undefined) {
      board = { rows: new Map(), waiters: [], held: false };
      this.#boards.set(ref, board);
    }
    return board;
  }

  #tidy(ref: ObjectRef, board: Board): void {
    if (board.rows.size === 0 && board.holder === undefined && !board.held)
      this.#boards.delete(ref);
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

const removeFrom = (list: string[], value: string): void => {
  const at = list.indexOf(value);
  if (at >= 0) list.splice(at, 1);
};

const sameFacts = (a: AtWorkFacts, b: AtWorkFacts): boolean =>
  a.handle === b.handle &&
  a.agent === b.agent &&
  a.spark === b.spark &&
  a.startedBy === b.startedBy &&
  a.project?.name === b.project?.name &&
  a.project?.seq === b.project?.seq &&
  a.project?.ink === b.project?.ink;

const atWork = ({ run, facts, state, since, lastChange }: Row): ObjectAtWork => ({
  run,
  handle: facts.handle,
  agent: facts.agent,
  state,
  since,
  ...(lastChange !== undefined ? { lastChange: { label: lastChange } } : {}),
  ...(facts.project !== undefined ? { project: { ...facts.project } } : {}),
  ...(facts.spark !== undefined ? { spark: facts.spark } : {}),
  ...(facts.startedBy !== undefined ? { startedBy: facts.startedBy } : {}),
});
