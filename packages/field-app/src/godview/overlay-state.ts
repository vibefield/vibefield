import { useSyncExternalStore } from "react";
import { getHost } from "../host";
import { getRendererLogger } from "../logging";

// The renderer's view of the overlay bit (GT-D2) — a MIRROR, not a copy.
//
// The host owns the value because ⇧⇧ is detected in main: it is answered before
// this page is offered the keystroke, so a renderer that kept its own flag
// would be wrong every time the menu was used. The store below
// holds only what the host last said, which is why the toolbar button and the
// menu's checkmark can never disagree — there is one value and everyone reads
// it.
//
// board-status.ts's shape (a module store read through useSyncExternalStore),
// for the same reason it has one: the readers are in different subtrees and
// threading a prop between them would invent a second owner.

let open = false;
let attached = false;
const listeners = new Set<() => void>();

function announce(): void {
  for (const fn of listeners) fn();
}

/** Subscribe to the host once, on the first reader. A browser harness with no
 * `godview` host stays closed forever, which is the truth there: nothing can
 * open it. */
function attach(): void {
  if (attached) return;
  attached = true;
  const godview = getHost().godview;
  if (godview === undefined) return;
  godview.onState((state) => {
    if (state.open === open) return;
    open = state.open;
    announce();
  });
}

export function subscribeGodviewOpen(fn: () => void): () => void {
  attach();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function isGodviewOpen(): boolean {
  return open;
}

/** Ask the host to flip it — the same request ⇧⇧ makes. No optimistic echo:
 * the store moves when the host says so, so a refused or lost transition never
 * leaves the button lit over a closed overlay. */
export function requestGodviewToggle(): void {
  const godview = getHost().godview;
  if (godview === undefined) return;
  void godview.set().catch((error: unknown) => {
    getRendererLogger()
      .child({ component: "godview" })
      .error("renderer.godview.toggle_failed", "The shell refused a Godview toggle", error);
  });
}

/** The one subscription both the overlay and the toolbar button read. */
export function useGodviewOpen(): boolean {
  return useSyncExternalStore(subscribeGodviewOpen, isGodviewOpen, isGodviewOpen);
}

/** Test seam: drop the host subscription and the value between cases. */
export function resetGodviewOpenForTest(): void {
  open = false;
  attached = false;
  listeners.clear();
}
