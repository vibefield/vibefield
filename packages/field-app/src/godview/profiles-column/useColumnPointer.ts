import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

// UM-R2 (DESIGN.md §8 "The reach") — THE POINTER'S HOLD ON THE COLUMN: leaving arms a grace, so a card survives the
// trip to it; entering another target while a card shows waits a dwell, so a pass over the column swaps nothing; and
// reaching what is shown cancels both. The first open, with nothing showing, is at once, as it always was. The two
// numbers are the only hover contract DESIGN.md records; TS timing constants are the repo's norm (`deck-state.ts`).

/** §8: the card closes this long after the pointer leaves. */
const GRACE_MS = 320;
/** §8: another target replaces the card this long after the pointer reaches it. */
const DWELL_MS = 120;

export interface ColumnPointer {
  /** the pointer came onto a target (a profile's id or the add), or left them (null) */
  point: (target: string | null) => void;
  /** the pointer lets go at once, its timers cancelled */
  clear: () => void;
}

/** `showing`: what the column shows now (the pointed profile, the pointed add, or the pinned card), or null. */
export function useColumnPointer(
  showing: string | null,
  setPointed: (target: string | null) => void,
): ColumnPointer {
  const shown = useRef(showing);
  useLayoutEffect(() => {
    shown.current = showing;
  }, [showing]);
  const timer = useRef<number | undefined>(undefined);
  const cancel = useCallback((): void => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const arm = useCallback(
    (ms: number, target: string | null): void => {
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        setPointed(target);
      }, ms);
    },
    [cancel, setPointed],
  );
  const point = useCallback(
    (target: string | null): void => {
      if (target === null) {
        arm(GRACE_MS, null);
        return;
      }
      // nothing shows yet, or this is what shows: it needs no wait, and it cancels any
      if (shown.current === null || shown.current === target) {
        cancel();
        setPointed(target);
        return;
      }
      arm(DWELL_MS, target);
    },
    [arm, cancel, setPointed],
  );
  const clear = useCallback((): void => {
    cancel();
    setPointed(null);
  }, [cancel, setPointed]);
  useEffect(() => cancel, [cancel]);
  return { point, clear };
}
