import type { ObjectRef } from "@vibefield/contracts";

// OB-3a's placeholder for OB-D11's shelf: nothing is kept yet, so nothing can be undone. OB-4 builds it.

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
  keep(_docId: string, _change: KeptChange): KeptChange | undefined {
    return undefined;
  }

  newest(_docId: string, _ref: ObjectRef, _run: string): KeptChange | undefined {
    return undefined;
  }

  forget(_docId: string, _change: KeptChange): void {}

  remap(_docId: string, _ref: ObjectRef, _key: string): void {}
}
