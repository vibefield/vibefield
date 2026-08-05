import { createSwarmPhysicsHost } from "./swarm-physics-host";
import type { SwarmPhysicsCommand, SwarmPhysicsOutbound } from "./swarm-physics-protocol";

// THE SWARM'S PHYSICS THREAD (GT-3c, GT-D16).
//
// Thin on purpose: this file is a timer and a mailbox. Everything it does is in
// `swarm-physics-host.ts`, which the inline driver runs too, so there is no
// behaviour that exists only in the worker and therefore only in production.
//
// The worker is bundled the way this package already bundles one — the
// `new Worker(new URL(...), { type: "module" })` form Vite resolves at build
// time, exactly as `doc-thumbnails.ts` has been doing since B-track. That form
// needs no config, emits a same-origin chunk, and satisfies the shell's CSP
// (`script-src 'self'`, which `worker-src` falls back to) without a `blob:`
// exemption.
//
// There is no rAF here: a dedicated worker has none, and does not want one. It
// steps on a timer and the accumulator absorbs the timer's jitter, which is the
// same guard that already absorbed a stalled display.

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SwarmPhysicsCommand>) => void) | null;
  postMessage(message: SwarmPhysicsOutbound, transfer?: Transferable[]): void;
  close(): void;
};

/**
 * Wake this many times per physics step.
 *
 * At 1× a late timer tick — and timers are only ever late — pushes the
 * accumulator either side of the step boundary, so pumps alternate between
 * solving nothing and solving two, and frames reach the main thread in
 * clumps its interpolation then has to smooth over. Sampling at twice the rate
 * catches each boundary within half a step for a wakeup that costs two
 * comparisons when nothing is due.
 */
const OVERSAMPLE = 2;
/** Never spin faster than this, whatever the lab's rate knob says. */
const MIN_TIMER_MS = 4;

let timer: ReturnType<typeof setInterval> | undefined;
let timerPeriod = 0;

const host = createSwarmPhysicsHost({
  post: (message, transfer) => {
    if (transfer && transfer.length > 0) scope.postMessage(message, transfer);
    else scope.postMessage(message);
  },
});

function retimeIfNeeded(): void {
  if (host.disposed) return;
  const period = Math.max(MIN_TIMER_MS, host.stepMs() / OVERSAMPLE);
  if (timer !== undefined && Math.abs(period - timerPeriod) < 0.5) return;
  if (timer !== undefined) clearInterval(timer);
  timerPeriod = period;
  timer = setInterval(() => host.pump(performance.now()), period);
}

function stop(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

scope.onmessage = (event) => {
  const command = event.data;
  host.handle(command);
  if (command.type === "dispose") {
    stop();
    // The stage is gone (PF6): this thread has nothing left to be. Closing is
    // belt to the terminate()'s braces — whichever lands first, no swarm physics
    // outlives the swarm.
    scope.close();
    return;
  }
  if (command.type === "init" || command.type === "updateParameters") retimeIfNeeded();
};
