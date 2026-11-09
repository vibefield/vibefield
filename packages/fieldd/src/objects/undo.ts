import type { ObjectRef } from "@vibefield/contracts";
import { OBJECT_LIMITS, OBJECT_ROOM } from "@vibefield/contracts";

// OB-D11 A — an agent's changes get their own undo, separate from ⌘Z: the window records each act's inverse and fieldd
// keeps them newest first per board, bounded per agent per object (UNDO_KEPT, so a chatty agent cannot erase what another
// did) and for the board as a whole (UNDO_BOARD_CEILING), so a reload of the window loses none. They live in fieldd's
// memory: a fieldd restart loses them, and the desk stops offering the undo.

export interface KeptChange {
  /** which act made it: undoing a place takes the object away */
  readonly op: "place" | "remove" | "act";
  readonly ref: ObjectRef;
  /** whose change it is: a spark's stays the spark's across a wake */
  holder: string;
  key: string;
  readonly inverse: unknown;
  readonly label: string;
  /** an undo of this change is on its way to the window */
  undoing?: boolean;
}

export class AgentUndoShelf {
  readonly #perDoc = new Map<string, KeptChange[]>();

  /** Keep a change. Returns what fell off, if anything. */
  keep(docId: string, change: KeptChange): KeptChange[] {
    const kept = this.#perDoc.get(docId) ?? [];
    kept.unshift(change);
    this.#perDoc.set(docId, kept);
    const fell: KeptChange[] = [];
    const same = kept.filter((c) => c.ref === change.ref && c.holder === change.holder);
    const oldest = same.length > OBJECT_LIMITS.UNDO_KEPT ? same.at(-1) : undefined;
    if (oldest !== undefined) {
      kept.splice(kept.indexOf(oldest), 1);
      fell.push(oldest);
    }
    if (kept.length > OBJECT_ROOM.UNDO_BOARD_CEILING) {
      const last = kept.pop();
      if (last !== undefined) fell.push(last);
    }
    return fell;
  }

  /** How many changes a board holds. */
  size(docId: string): number {
    return this.#perDoc.get(docId)?.length ?? 0;
  }

  /** The newest change this holder made to this object. */
  newest(docId: string, ref: ObjectRef, holder: string): KeptChange | undefined {
    return this.#perDoc.get(docId)?.find((c) => c.ref === ref && c.holder === holder);
  }

  /** A resume continued a plain run in a new one: what it changed is the new run's to have undone. */
  rekey(from: string, to: string): void {
    for (const kept of this.#perDoc.values())
      for (const change of kept) if (change.holder === from) change.holder = to;
  }

  forget(docId: string, change: KeptChange): void {
    const kept = this.#perDoc.get(docId);
    if (kept === undefined) return;
    const at = kept.indexOf(change);
    if (at >= 0) kept.splice(at, 1);
  }

  /** OB-D11 — a remove's undo moved the object: every change still kept on its ref follows. */
  remap(docId: string, ref: ObjectRef, key: string): void {
    for (const change of this.#perDoc.get(docId) ?? []) if (change.ref === ref) change.key = key;
  }
}
