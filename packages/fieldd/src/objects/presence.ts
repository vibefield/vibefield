import type { AtWorkState, ObjectRef, ObjectsPresenceSnapshot } from "@vibefield/contracts";

// OB-3a's placeholder for OB-4's board: the door and the room call it, and it tracks nothing yet.

/** The run an act is by, as the desk shows it. */
export interface AtWorkAgent {
  readonly run: string;
  readonly handle: string;
  readonly agent: string;
}

export interface PresenceOptions {
  locate(ref: ObjectRef): { docId: string; key: string } | undefined;
  readonly now?: () => number;
  readonly releasedShownMs?: number;
}

export class ObjectPresenceBoard {
  constructor(readonly _opts: PresenceOptions) {}

  onChange(_listener: () => void): () => void {
    return () => undefined;
  }

  snapshot(): ObjectsPresenceSnapshot {
    return { objects: [] };
  }

  agentsOn(_ref: ObjectRef): { handle: string; state: AtWorkState }[] {
    return [];
  }

  opened(_ref: ObjectRef, _agent: AtWorkAgent): void {}

  begin(_ref: ObjectRef, _agent: AtWorkAgent, _state: "reading" | "acting"): void {}

  settle(_ref: ObjectRef, _agent: AtWorkAgent, _state: "open" | "failed" | "needs-you"): void {}

  released(_ref: ObjectRef, _run: string): void {}

  hold(_ref: ObjectRef, _held: boolean): void {}

  isHeld(_ref: ObjectRef): boolean {
    return false;
  }

  setLastChange(_ref: ObjectRef, _run: string, _label: string | undefined): void {}

  claim(_ref: ObjectRef, _run: string): boolean {
    return true;
  }

  holderOf(_ref: ObjectRef): string | undefined {
    return undefined;
  }

  moveHolder(_ref: ObjectRef, _run: string): void {}

  drop(_ref: ObjectRef): void {}

  runEnded(_run: string): void {}
}
