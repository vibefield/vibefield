import type { GhostteaTerminalRuntime } from "@vibecook/ghosttea-react";

// DS-4 — THE DECK TAKES ON FOCUS. DS-D5, ruled 2026-09-30 with James's note:
// "the latest focused pane takes full control include resizing, LWW. no matter
// it is local pane, remote desktop pane or mobile pane" (TPv3 §6 amended the
// same day; `thinking-desktop-sync-plane.md` §6.3).
//
// The lease stays explicit (TP-D2): the cell never mints geometry on focus.
// The POLICY sits in the host, above it — when a CONTROLLER pane gains focus,
// its host takes the seat: `ClaimGeometry` on an empty seat, otherwise ONE
// `TransferGeometry` to itself, which the cell authorizes on the pane's own
// `geometry` right (field-native `activation.rs` `transfer_geometry`). A
// controller is a surface that asked for resize control — `controlsResize`
// and an interactive session. A mirror never asks, so it never takes; in this
// window it does not even hold this runtime (it holds `watchOnlyRuntime`, which
// refuses every geometry verb). The pane that loses the seat renders what the
// new holder sized: its own resizes become claims the cell refuses, and its
// frames carry the holder's grid — the runtime's behaviour, not this file's.
//
// TWO roads, never both, chosen by what the pinned ghosttea-react offers:
//
//  · The runtime HAS `takeResizeControl` (ghosttea `feat/geometry-take`,
//    gt-take's `d952944` and `a24a28d`): the SURFACE takes on focus, because the
//    deck passes `takeGeometryOnFocus` to the workspace (GodviewDeck.tsx) and a
//    surface owns the two facts a take needs — its view id and its grid — and
//    knows when its own input has focus. This facade then hands the runtime
//    through UNTOUCHED: a second take from here would be a second CAS per focus.
//  · It does NOT (the pin when this landed, ghosttea `8a0930e`): there is no
//    take to send, so focus does the most the lease allows without one — the
//    controller's `claimResizeControl` again, which claims a seat that emptied
//    since the pane mounted and re-sizes a seat the pane already holds (a
//    same-size re-claim is no SIGWINCH). On a seat another client holds it is
//    refused, and the pane renders what that holder sized. The surface's focus
//    effect reaches the runtime as `setFocused(handle, viewId, true, cols,
//    rows)`, the one call that carries all three facts, so that is where this
//    road listens — on the false→true edge only, per view.
//
// RETIRES with the pin move past gt-take: the take road makes this a pass
// through, so the file and the cast on `takeGeometryOnFocus` in GodviewDeck.tsx
// can go in the same commit as the pin.

/** True when the runtime can take a held seat itself (gt-take's API). */
export function runtimeTakesSeats(runtime: GhostteaTerminalRuntime): boolean {
  return typeof (runtime as { takeResizeControl?: unknown }).takeResizeControl === "function";
}

/**
 * The runtime the deck hands its workspace. With a take-capable runtime it is
 * the runtime itself; without one, a facade that re-claims a controller's seat
 * when the controller gains focus. Forwarding binds to the TARGET (the runtime
 * keeps its state in `#private` fields) and returns the SAME function object on
 * every read — `TerminalSurface`'s effects and `removeEventListener` compare
 * identity (the `watchOnlyRuntime` pattern).
 */
export function deckFocusRuntime(runtime: GhostteaTerminalRuntime): GhostteaTerminalRuntime {
  if (runtimeTakesSeats(runtime)) return runtime;

  /** view id → the session handle it asked resize control for */
  const controllers = new Map<string, string>();
  const focused = new Set<string>();
  const intercepted = new Map<PropertyKey, unknown>([
    [
      "claimResizeControl",
      (sessionHandle: string, viewId: string, cols: number, rows: number): void => {
        controllers.set(viewId, sessionHandle);
        runtime.claimResizeControl(sessionHandle, viewId, cols, rows);
      },
    ],
    [
      "releaseResizeControl",
      (viewId: string): void => {
        controllers.delete(viewId);
        runtime.releaseResizeControl(viewId);
      },
    ],
    [
      "setFocused",
      (sessionHandle: string, viewId: string, isFocused: boolean, cols: number, rows: number) => {
        const gained = isFocused && !focused.has(viewId);
        if (isFocused) focused.add(viewId);
        else focused.delete(viewId);
        runtime.setFocused(sessionHandle, viewId, isFocused, cols, rows);
        if (gained && controllers.get(viewId) === sessionHandle)
          runtime.claimResizeControl(sessionHandle, viewId, cols, rows);
      },
    ],
  ]);
  const bound = new Map<PropertyKey, unknown>();
  return new Proxy(runtime as unknown as Record<PropertyKey, unknown>, {
    get(target, property) {
      const own = intercepted.get(property);
      if (own !== undefined) return own;
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      let fn = bound.get(property);
      if (fn === undefined) {
        fn = (value as (...args: unknown[]) => unknown).bind(target);
        bound.set(property, fn);
      }
      return fn;
    },
  }) as unknown as GhostteaTerminalRuntime;
}
