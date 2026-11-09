import type {
  AtWorkState,
  ObjectAtWork,
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

/** The run an act is by, as the desk shows it. */
export interface AtWorkAgent {
  readonly run: string;
  readonly handle: string;
  readonly agent: string;
}

interface Row extends AtWorkAgent {
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
        ...(board.holder !== undefined ? { holder: board.holder } : {}),
        ...(board.waiters.length > 0 ? { waiters: [...board.waiters] } : {}),
      });
    }
    return { objects };
  }

  /** Who a caller sees on an object: everyone not yet gone. */
  agentsOn(ref: ObjectRef): { handle: string; state: AtWorkState }[] {
    const rows = this.#boards.get(ref)?.rows.values() ?? [];
    return [...rows]
      .filter((row) => row.real !== "released")
      .map(({ handle, state }) => ({ handle, state }));
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
  opened(ref: ObjectRef, agent: AtWorkAgent): void {
    this.#set(ref, agent, "open");
  }

  /** An operation starts: `reading` or `acting`, until its answer arrives. */
  begin(ref: ObjectRef, agent: AtWorkAgent, state: "reading" | "acting"): void {
    this.#set(ref, agent, state);
  }

  /** An operation's answer arrived. */
  settle(ref: ObjectRef, agent: AtWorkAgent, state: "open" | "failed" | "needs-you"): void {
    this.#set(ref, agent, state);
  }

  /** The agent stopped working on the object, or was stopped: it stays visible long enough to be seen leaving. */
  released(ref: ObjectRef, run: string): void {
    const board = this.#boards.get(ref);
    if (board === undefined) return;
    this.#dropLease(board, run);
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
    if (board.holder !== undefined && board.holder !== run) {
      if (!board.waiters.includes(run)) {
        board.waiters.push(run);
        this.#changed();
      }
      return false;
    }
    if (board.holder === run) return true;
    board.holder = run;
    removeFrom(board.waiters, run);
    this.#changed();
    return true;
  }

  /** The holder, to reach a `busy` caller's words. */
  holderOf(ref: ObjectRef): string | undefined {
    return this.#boards.get(ref)?.holder;
  }

  /** OB-D9 — handing a `one` kind moves it. */
  moveHolder(ref: ObjectRef, run: string): void {
    const board = this.#board(ref);
    board.holder = run;
    removeFrom(board.waiters, run);
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

  #set(ref: ObjectRef, agent: AtWorkAgent, state: AtWorkState): void {
    const board = this.#board(ref);
    const shown: AtWorkState = board.held ? "paused" : state;
    const row = board.rows.get(agent.run);
    if (row === undefined) {
      board.rows.set(agent.run, { ...agent, real: state, state: shown, since: this.#now() });
    } else {
      if (row.leaving !== undefined) {
        clearTimeout(row.leaving);
        delete row.leaving;
      }
      if (row.real === state && row.state === shown) return;
      row.real = state;
      if (row.state !== shown) row.since = this.#now();
      row.state = shown;
    }
    this.#changed();
  }

  #dropLease(board: Board, run: string): void {
    if (board.holder === run) delete board.holder;
    removeFrom(board.waiters, run);
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

const atWork = (row: Row): ObjectAtWork => ({
  run: row.run,
  handle: row.handle,
  agent: row.agent,
  state: row.state,
  since: row.since,
  ...(row.lastChange !== undefined ? { lastChange: { label: row.lastChange } } : {}),
});
