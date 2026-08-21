import {
  createGhostteaTerminalRuntime,
  type GhostteaTerminalRuntime,
  waitForGhostteaRendererPorts,
} from "@vibecook/ghosttea-react";
import TerminalRenderWorker from "@vibecook/ghosttea-react/terminal-render.worker.js?worker";

// THE ONE RUNTIME PER WINDOW (TP-D5, §9.1) — built here and nowhere else.
//
// There were two of these, byte for byte: the deck's `makeRuntime` and the
// prewarm's `makeWarmRuntime`. They had to agree about the ports wait, the
// worker bundling and the platform seam, and nothing but review kept them in
// step. One call site is the point of the pool promotion, not a tidy-up.

/**
 * How long after its last view unmounts a session keeps its frame subscription.
 *
 * TP-R1's grace, and it is OURS now rather than a library default nobody named.
 * 0.10.1's own default is 1000ms (`runtime.js:28`), so this changes nothing
 * today and states what the number is: the runtime refcounts one frame
 * subscription per session handle across its mounted surfaces
 * (`#retainFrameSubscription`, `runtime.js:526`), and when the last reference
 * goes away it waits this long before dropping the subscription and posting
 * `drop-session` to the render worker (`runtime.js:570-596`). The wait is what
 * makes a pane closing and reopening — or a deck remounting onto a new
 * generation — cost nothing; the drop is what makes an unwatched session cost
 * nothing. TP-R1 is the claim that both halves are true.
 */
export const TERMINAL_FRAME_SUBSCRIPTION_GRACE_MS = 1_000;

/**
 * Build the window's terminal runtime.
 *
 * Ports are transferred per ATTACH and the wait is one-shot, so a runtime is
 * born with its own fresh wait, armed before the connect that causes the
 * transfer. Generous, because a redeem talks to two daemons. The pool is what
 * guarantees only one of these waits is ever armed at a time — see the
 * one-runtime law in `terminal-pool.ts`.
 */
export function createTerminalRuntime(): GhostteaTerminalRuntime {
  return createGhostteaTerminalRuntime({
    ports: waitForGhostteaRendererPorts(45_000),
    clientBuild: "vibefield-godview",
    frameSubscriptionGraceMs: TERMINAL_FRAME_SUBSCRIPTION_GRACE_MS,
    // Bundled explicitly: the runtime's default resolves its worker relative to
    // its own module URL, which under Vite means an asset inside node_modules.
    workerFactory: () => new TerminalRenderWorker(),
    platform: {
      writeClipboard: (text) => void navigator.clipboard?.writeText(text),
      forceCanvasFallback: () => false,
      setForceCanvasFallback: () => undefined,
      // A VibeField renderer cannot reload itself — security.ts denies every
      // renderer-initiated navigation outside dev (GT-1 finding 3) — and should
      // not want to: a reload would take the whole canvas down with the deck.
      // Recovery is in-page: the pool's ladder replaces the runtime instead.
      reload: () => undefined,
    },
  });
}
