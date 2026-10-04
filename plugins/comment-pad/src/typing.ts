// TYPING IS A GESTURE (ICE design-015 §6.1), on a plugin kind: the pad's typing SESSION — the world half of the
// desk's one editor while it is on a pad. The pad holds the session's text as a DRAFT in its writing (the kind's
// local — the record draws it at once, the document does not move), never as a live write: so the session needs
// no claim on the cell (core's `Editing` is the note's and the calendar's — not a plugin's), and a peer sees the
// session only when it lands. The session ends — the editor's 1 s without input, Escape, a blur, another part
// taking the editor — with `commit()`: ONE undoable transaction writing the pad's `ink` cell (`{ text, seeds }`,
// one cell so a text never pairs with another writer's seeds), through the desk's WRITER'S GATE (`writable(docs)` —
// none without a document, none on a read-only one). A session that nets to nothing — the text and the hand as it
// found them — commits nothing. ⌘Z undoes a session, never a keystroke. Every keystroke carries the hand's seeds
// (`carrySeeds`: the common prefix and suffix keep their glyphs' hands, the inserted run gets fresh ones).
//
// Collaboration is the cell's: a commit writes the whole text it holds (committer-wins, as the note's is); between
// sessions a peer's text reaches the editor's field (the lease's `value`).

import {
  carrySeeds,
  type Entity,
  encodeSeeds,
  freshSeed,
  type ObjectDomHost,
  seedsFor,
  type TypingDocs,
  type World,
  writable,
} from "@vibefield/plugin-sdk/desk";
import type { PadDraft, PadWriting } from "./writing";

/** A cell of the pad's compiled object — `ink` (`{ text, seeds }`) or `props` (`{ pen, accent, seed }`). */
export type PadCell = ObjectDomHost["object"]["groups"][number]["component"];

/** What a pad's `ink` cell holds. */
export interface PadText {
  readonly text: string;
  readonly seeds: string;
}

export interface PadTypingOptions {
  readonly world: World;
  readonly docs: TypingDocs;
  /** The pad's cells, from its compiled object (`ObjectDomHost.object` — the host's `defineObject`). */
  readonly ink: PadCell;
  readonly props: PadCell;
  /** The pad's writing on this desk (its local) — where a session's draft is drawn from. */
  readonly writing: () => PadWriting | undefined;
  /** A fresh seed for a glyph just written (`Math.random`'s unless a test says). */
  readonly fresh?: () => number;
}

export interface PadTyping {
  /** The pad a session is on, or undefined. */
  editing(): Entity | undefined;
  /** A session is open: a draft written and not yet committed. */
  open(): boolean;
  /** The pad's writing as the document holds it (never the draft). */
  committed(e: Entity): PadText | undefined;
  /** The text a field should show for `e`: the draft while a session is open on it, else the cell's. */
  text(e: Entity): string;
  /** Put a session on `e` (a session on another pad ends first). False for a dead entity, a non-pad, a read-only document. */
  begin(e: Entity): boolean;
  /** The platform's value for the pad: the seeds carried, the draft drawn. The inserted run, or null when nothing changed. */
  input(value: string): { readonly from: number; readonly to: number } | null;
  /** End the SESSION: ONE transaction with the draft, unless it nets to nothing. Whether it committed. The pad stays the session's. */
  commit(): boolean;
  /** End the session and let the pad go: commit, then no pad. */
  end(): void;
}

const inkOf = (world: World, cell: PadCell, e: Entity): PadText | undefined => {
  const v = world.get(e, cell) as Partial<PadText> | undefined;
  return v === undefined
    ? undefined
    : {
        text: typeof v.text === "string" ? v.text : "",
        seeds: typeof v.seeds === "string" ? v.seeds : "",
      };
};

export function createPadTyping(opts: PadTypingOptions): PadTyping {
  const { world, docs } = opts;
  const fresh = opts.fresh ?? freshSeed;
  let editing: Entity | undefined;
  /** The cell as the session found it — what "nets to nothing" means. */
  let start: PadText | undefined;
  let draft: PadDraft | undefined;

  const alive = (e: Entity | undefined): e is Entity => e !== undefined && world.isAlive(e);
  const seedOf = (e: Entity): number => {
    const v = (world.get(e, opts.props) as { seed?: unknown } | undefined)?.seed;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const sameHand = (a: PadText, b: PadText, seed: number): boolean => {
    const x = seedsFor(a.text, a.seeds, seed);
    const y = seedsFor(b.text, b.seeds, seed);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  };
  const drop = (e: Entity | undefined): void => {
    if (e !== undefined) opts.writing()?.setDraft(e, undefined);
  };

  const commit = (): boolean => {
    const e = editing;
    const d = draft;
    const from = start;
    draft = undefined;
    start = undefined;
    if (d === undefined || !alive(e)) {
      drop(e);
      return false;
    }
    // NETS TO NOTHING — the text and the hand as the session found them: no transaction
    if (from !== undefined && from.text === d.text && sameHand(from, d, seedOf(e))) {
      drop(e);
      return false;
    }
    const value = { text: d.text, seeds: d.seeds };
    const doc = docs.current();
    if (doc === undefined) {
      world.edit(e).set(opts.ink, value); // no document at all: the runtime is all there is (a bare desk, a test)
      drop(e);
      return true;
    }
    // THE WRITER'S GATE: a document gone read-only mid-session takes nothing — the draft goes, the cell is as it was
    const session = writable(docs);
    if (session === undefined) {
      drop(e);
      return false;
    }
    session.store.transaction((tx) => {
      tx.edit(e).set(opts.ink, value);
    });
    drop(e);
    return true;
  };

  const end = (): void => {
    commit();
    editing = undefined;
  };

  return {
    editing: () => (alive(editing) ? editing : undefined),
    open: () => draft !== undefined,
    committed: (e) => (alive(e) ? inkOf(world, opts.ink, e) : undefined),
    text: (e) =>
      e === editing && draft !== undefined ? draft.text : (inkOf(world, opts.ink, e)?.text ?? ""),
    begin(e) {
      if (editing === e && alive(e)) return true;
      if (editing !== undefined) end();
      if (!alive(e) || inkOf(world, opts.ink, e) === undefined) return false;
      if (docs.current() !== undefined && writable(docs) === undefined) return false; // a read-only document: read, never written
      editing = e;
      draft = undefined;
      start = undefined;
      return true;
    },
    input(value) {
      const e = editing;
      if (!alive(e)) return null;
      const cur = draft ?? inkOf(world, opts.ink, e);
      if (cur === undefined || cur.text === value) return null;
      if (draft === undefined) start = inkOf(world, opts.ink, e);
      const carried = carrySeeds(cur.text, seedsFor(cur.text, cur.seeds, seedOf(e)), value, fresh);
      draft = { text: value, seeds: encodeSeeds(carried.seeds) };
      opts.writing()?.setDraft(e, draft);
      return { from: carried.from, to: carried.to };
    },
    commit,
    end,
  };
}
