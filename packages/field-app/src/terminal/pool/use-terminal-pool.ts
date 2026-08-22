import type { FielddClient } from "@vibefield/fieldd-client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { LIVE_SOURCE_DEMAND, NO_SOURCE_DEMAND, type SourceDemandMode } from "./demand";
import {
  bindTerminalSessionView,
  openTerminalPool,
  subscribeTerminalPool,
  type TerminalPoolSnapshot,
  type TerminalSessionView,
  type TransportTrace,
  terminalPoolSnapshot,
} from "./terminal-pool";

// The React bindings, and all of them. The pool is a module: it publishes a
// snapshot and takes declarations, and `useSyncExternalStore` is exactly the
// door for state that lives outside the tree and outlives it.

/** Read the pool. Re-renders on every published change and on nothing else. */
export function useTerminalPool(): TerminalPoolSnapshot {
  return useSyncExternalStore(subscribeTerminalPool, terminalPoolSnapshot, terminalPoolSnapshot);
}

/**
 * Claim the pool for this consumer, opening it on the sessions it would like to
 * rejoin (best first).
 *
 * Idempotent, and deliberately WITHOUT a teardown: a consumer unmounting does
 * not close the window's transport. That is the promotion's whole point — the
 * deck can come and go (and does, every time the overlay's gate flips) while the
 * bridge, the socket, the worker and the device stay exactly where they are. The
 * transport goes away when the window does (`disposeTerminalPool`).
 *
 * The claim runs ONCE per consumer, on the ids it had at mount: a later change
 * to `rejoin` is a different question (which session to open NEXT), and
 * re-claiming on it would re-enter a pool that is already open and do nothing —
 * so the dependency is deliberately the client and the trace, not the list.
 */
export function useTerminalPoolOpen(
  fieldd: FielddClient,
  options: { rejoin?: readonly string[]; trace?: TransportTrace } = {},
): void {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const { rejoin, trace } = latest.current;
    openTerminalPool(fieldd, {
      ...(rejoin !== undefined ? { sessionIds: rejoin } : {}),
      ...(trace !== undefined ? { trace } : {}),
    });
  }, [fieldd]);
}

/**
 * Bind one view per session id and declare a single demand across them.
 *
 * The release is the load-bearing half (TP-L-E'): every handle is released when
 * this unmounts, and when the id set changes the views that left are released in
 * the same pass that binds the ones that arrived. Nothing is left holding demand
 * for a session that is no longer on screen — which, with the ledger living in a
 * module that outlives React, is a leak nothing else would notice.
 */
export function useTerminalSessionViews(
  sessionIds: readonly string[],
  mode: SourceDemandMode,
): void {
  const bound = useRef(new Map<string, TerminalSessionView>());
  // The id set as one comparable value: `sessionIds` is a fresh array on every
  // render of a consumer that maps its panes, and depending on the array itself
  // would rebind the whole set at its render cadence rather than at the panes'.
  const key = sessionIds.join(" ");
  useEffect(() => {
    const demand = mode === "live" ? LIVE_SOURCE_DEMAND : NO_SOURCE_DEMAND;
    const views = bound.current;
    const wanted = new Set(key === "" ? [] : key.split(" "));
    for (const [sessionId, view] of views) {
      if (wanted.has(sessionId)) view.declare(demand);
      else {
        view.release();
        views.delete(sessionId);
      }
    }
    for (const sessionId of wanted) {
      if (!views.has(sessionId)) views.set(sessionId, bindTerminalSessionView(sessionId, demand));
    }
  }, [key, mode]);
  // The unmount release, kept in its OWN effect with no dependencies: folded
  // into the effect above it would run on every id change and release the set it
  // had just bound. React cleanups run before the next effect, not after it.
  useEffect(() => {
    const views = bound.current;
    return () => {
      for (const view of views.values()) view.release();
      views.clear();
    };
  }, []);
}
