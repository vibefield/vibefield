// VT-4a (track VT, 2026-11-24) — THE FLOOR'S EXIT, as the fieldd that started it saw it. fieldd starts the native
// floor detached and lets it go (the floor outlives fieldd), so nothing ever read how it ended: the next floor's
// boot says only "planned" or "unplanned". While the fieldd that started it lives, the operating system tells it
// the exit code or the signal for free, and this keeps that fact for the log.
//
// The entry (`bin.ts`) starts the first floor before fieldd has a logger, so an exit is held here until the daemon
// listens (`hearFloorExits`), a few at most. A floor some earlier fieldd started is not this process's child, and
// its exit is still read only as the link going down.

export interface FloorExit {
  pid: number | null;
  /** the exit code, or null when a signal ended it */
  code: number | null;
  /** the signal that ended it, or null when it exited by itself */
  signal: string | null;
  /** unix ms */
  at: number;
}

/** As much of a spawned child as the watch reads. */
export interface FloorChild {
  readonly pid?: number | undefined;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
}

const HELD_MAX = 8;
const held: FloorExit[] = [];
let listener: ((exit: FloorExit) => void) | null = null;

/** Say one floor's exit to whoever listens, or hold it until someone does. */
export function noteFloorExit(exit: FloorExit): void {
  if (listener !== null) {
    try {
      listener(exit);
    } catch {
      // a log that cannot take it does not end the daemon
    }
    return;
  }
  held.push(exit);
  if (held.length > HELD_MAX) held.splice(0, held.length - HELD_MAX);
}

/** Watch a floor this process just started. Listening for a child's exit does not keep fieldd alive for it. */
export function watchFloorExit(child: FloorChild, now: () => number = Date.now): void {
  child.once("exit", (code, signal) => {
    noteFloorExit({ pid: child.pid ?? null, code, signal, at: now() });
  });
}

/** Hear every floor exit from now on, and the ones held since the entry started the first floor. Returns how to
 * stop hearing. */
export function hearFloorExits(hear: (exit: FloorExit) => void): () => void {
  listener = hear;
  for (const exit of held.splice(0)) {
    try {
      hear(exit);
    } catch {
      // as above
    }
  }
  return () => {
    if (listener === hear) listener = null;
  };
}
