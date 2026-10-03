import type { FrameView, FrameZoomAct } from "@vibefield/contracts";
import { useSyncExternalStore } from "react";
import { getHost } from "../host";
import { getRendererLogger } from "../logging";

// The renderer's view of the window's active view (One Frame FR-1) — a MIRROR,
// not a copy, and the one replacement for Godview's open bit (GT-D2), which it
// retires: "Godview is open" is now "the view is godview".
//
// The host owns the value (main's `view.ts`): the View menu marks it and lends
// ⌘W to Godview's panes by it, so a renderer that kept its own would be a second
// owner main had to be told about. This store holds only what the host last
// said, which is why the views track, the cover, the field's freeze and the
// menu's mark can never disagree — there is one value and everyone reads it.
//
// board-status.ts's shape (a module store read through useSyncExternalStore),
// for the same reason it has one: the readers are in different subtrees and
// threading a prop between them would invent a second owner.

let view: FrameView = "canvas";
let attached = false;
const listeners = new Set<() => void>();

function announce(): void {
  for (const fn of listeners) fn();
}

/** Subscribe to the host once, on the first reader. A browser harness with no
 * `view` host stays on the canvas forever, which is the truth there: nothing
 * can move it. */
function attach(): void {
  if (attached) return;
  attached = true;
  const host = getHost().view;
  if (host === undefined) return;
  host.onState((state) => {
    if (state.view === view) return;
    view = state.view;
    announce();
  });
}

export function subscribeActiveView(fn: () => void): () => void {
  attach();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getActiveView(): FrameView {
  return view;
}

/** Ask the host for a view. No optimistic echo: the store moves when the host
 * says so, so a refused or lost request never leaves the track's thumb on a
 * view the window is not in. Resolves once the host has answered (or failed). */
export function requestView(next: FrameView): Promise<void> {
  const host = getHost().view;
  if (host === undefined) return Promise.resolve();
  return host.set(next).then(
    () => undefined,
    (error: unknown) => {
      getRendererLogger()
        .child({ component: "frame" })
        .error("renderer.frame.view_refused", "The shell refused a view request", error);
    },
  );
}

/** The View menu's zoom acts (One Frame FR-4, 3b), as main sends them — the
 * head's door to them. A host with no menu bar (a browser harness) sends none. */
export function subscribeMenuZoom(handler: (act: FrameZoomAct) => void): () => void {
  const onZoom = getHost().view?.onZoom;
  return onZoom === undefined ? () => undefined : onZoom(handler);
}

/** The one subscription every reader shares. */
export function useActiveView(): FrameView {
  return useSyncExternalStore(subscribeActiveView, getActiveView, getActiveView);
}

/** Whether a view covers the field — every view but the canvas, the ground
 * floor (FV-D1). The field freezes and recedes under it (DESIGN.md §6). */
export function useCovered(): boolean {
  return useActiveView() !== "canvas";
}

/** Test seam: drop the host subscription and the value between cases. */
export function resetActiveViewForTest(): void {
  view = "canvas";
  attached = false;
  listeners.clear();
}
