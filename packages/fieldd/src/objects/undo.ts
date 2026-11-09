import type { ObjectRef } from "@vibefield/contracts";
import { OBJECT_LIMITS } from "@vibefield/contracts";

// OB-D11 A — an agent's changes get their own undo, separate from ⌘Z: the window records each act's inverse and fieldd
// keeps them newest first per board, bounded (UNDO_KEPT), so a reload of the window loses none. They live in fieldd's
// memory: a fieldd restart loses them, and the desk stops offering the undo.

export interface KeptChange {
  /** which act made it: undoing a place takes the object away */
  readonly op: "place" | "remove" | "act";
  readonly ref: ObjectRef;
  readonly run: string;
  key: string;
  readonly inverse: unknown;
  readonly label: string;
}

export class AgentUndoShelf {
  readonly #perDoc = new Map<string, KeptChange[]>();

  /** Keep a change. Returns what fell off the far end, if anything. */
  keep(docId: string, change: KeptChange): KeptChange | undefined {
    const kept = this.#perDoc.get(docId) ?? [];
    kept.unshift(change);
    this.#perDoc.set(docId, kept);
    return kept.length > OBJECT_LIMITS.UNDO_KEPT ? kept.pop() : undefined;
  }

  /** The newest change this run made to this object. */
  newest(docId: string, ref: ObjectRef, run: string): KeptChange | undefined {
    return this.#perDoc.get(docId)?.find((c) => c.ref === ref && c.run === run);
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
