import {
  createGhostteaTerminalRuntime,
  type GhostteaTerminalRuntime,
  waitForGhostteaRendererPorts,
} from "@vibecook/ghosttea-react";
import TerminalRenderWorker from "@vibecook/ghosttea-react/terminal-render.worker.js?worker";
import { TerminalConnectTicketResult } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { getHost } from "../host";
import { getRendererLogger } from "../logging";
import type { ColdOpenTrace } from "./cold-open";

// THE WARM TRANSPORT (GT-D14) — the plumbing wakes at app load; the shell does not.
//
// GT-2's law was "no ⌘G ⇒ no bridge, no socket, no shell". James's ask ("can we
// prepare things at the app load phase?") splits it by what the resource MEANS:
//
//   - DEAD WEIGHT — a forked bridge, a dialled socket, a render worker, a GPU
//     device and its pipelines. None of it is a promise to the user, none of it
//     runs anyone's code, and all of it is on the critical path of the first
//     open. It warms at idle.
//   - MEANINGFUL — a PTY, a login shell, a session. Something that RUNS, that
//     appears in the floor's inventory, that a person is responsible for. It is
//     still born on ⌘G and never before.
//
// That line is why this module creates a runtime and a connection and stops. The
// workspace still owns every pane birth (GT-D10): what it receives on first open
// is a connection that already exists, not a session someone else decided on.
//
// PF6 holds by construction: a warm transport that is never claimed schedules
// NOTHING. The worker has a device and no surfaces, so it has no render loop and
// no cursor timers; the performance measurement that forced the device into
// existence is finished immediately rather than left recording; and this module
// owns no interval, no rAF, and no retry loop.

/** The transport the deck inherits: a live runtime and the shell policy that
 * rode the connect answer back (GT-D10 — main is the only reader of both). */
export interface WarmTransport {
  runtime: GhostteaTerminalRuntime;
  shell: { defaultShell: string; home: string };
  /** When the warm finished, so a claim can say how stale its inheritance is. */
  warmedAt: number;
}

type WarmState =
  | { kind: "cold" }
  | { kind: "warming"; promise: Promise<void> }
  | { kind: "warm"; transport: WarmTransport }
  /** Claimed by a deck. The singleton stays in this state for the app's life:
   * re-warming behind a live deck would fork a second bridge for nobody. */
  | { kind: "claimed" }
  /** The warm transport died before anyone used it, or the warm itself failed.
   * Exactly ONE re-warm is allowed from here — GT-D14's "re-warms lazily, never
   * in a loop" is enforced by this state, not by a counter someone must trust. */
  | { kind: "spent"; reason: string };

let state: WarmState = { kind: "cold" };
let rewarmed = false;
/**
 * Bumped by anything that INVALIDATES a warm in flight (a discard, a reset).
 *
 * A warm is several awaits long, and the bridge can die in the middle of it. If
 * the completion could still write its result, a transport discarded halfway
 * would come back to life a moment later holding a runtime whose bridge is
 * already gone — and the deck would inherit it. The rule is the one GT-2c
 * reached for the deck's own updaters: a late answer to a question nobody is
 * asking any more is dropped, not applied.
 */
let generation = 0;

/** Ports are transferred per attach and the wait is one-shot, so the wait must
 * be armed at construction — BEFORE the connect that causes the transfer. */
function makeWarmRuntime(): GhostteaTerminalRuntime {
  return createGhostteaTerminalRuntime({
    ports: waitForGhostteaRendererPorts(45_000),
    clientBuild: "vibefield-godview",
    workerFactory: () => new TerminalRenderWorker(),
    platform: {
      writeClipboard: (text) => void navigator.clipboard?.writeText(text),
      forceCanvasFallback: () => false,
      setForceCanvasFallback: () => undefined,
      // A VibeField renderer cannot reload itself (GT-1 finding 3), and the deck
      // that inherits this runtime recovers in-page instead.
      reload: () => undefined,
    },
  });
}

/**
 * Force the render backend into existence without a surface or a session.
 *
 * 0.9.1 exposes no `prepare()`, but it does expose a door that reaches the same
 * work: `performance-start` makes the worker run `ensureRenderer()` — the WebGPU
 * adapter, the device, and all six pipelines — before it begins recording, and
 * it does so with no surface mounted (terminal-render.worker.ts:1049-1055). The
 * measurement is finished immediately: the point is the device it forced, not
 * the numbers, and a measurement left open would accumulate sample arrays for a
 * deck that has not opened yet.
 *
 * Named as petition material rather than hidden: a `prepare()` that says what it
 * means would make this a one-liner and would stop a host from reaching a
 * device through an instrument.
 */
async function warmRenderBackend(runtime: GhostteaTerminalRuntime): Promise<string> {
  await runtime.startPerformanceMeasurement();
  // Quiet immediately and cap the wait: with no surfaces there is nothing dirty
  // and nothing scheduled, so the idle loop exits on its first pass.
  const snapshot = await runtime.finishPerformanceMeasurement({ quietMs: 0, timeoutMs: 2_000 });
  return snapshot.backend;
}

/**
 * Warm the transport. Idempotent, at most once per app life plus one recovery.
 *
 * Deliberately returns nothing and never throws: prewarm is an optimization, and
 * a failure here must leave the cold path exactly as it was rather than surface
 * a fault for a surface the user has not asked for. What a failure DOES do is
 * spend the attempt, so the ladder cannot become a loop.
 */
export function prewarmGodviewTransport(fieldd: FielddClient, trace?: ColdOpenTrace): void {
  if (state.kind !== "cold") return;
  const logger = getRendererLogger().child({ component: "godview" });
  const mine = generation;
  /** Deferred to a microtask so the `warming` assignment below lands FIRST.
   * An async function body runs synchronously up to its first await, and the
   * early exits here have none — without the defer, a host with no bridge would
   * write `spent` and then be overwritten by `warming` on the next line. */
  const promise = Promise.resolve().then(async () => {
    /** Whether this warm still owns the singleton. */
    const current = (): boolean => generation === mine;
    try {
      const terminal = getHost().terminal;
      if (terminal === undefined) {
        if (current()) state = { kind: "spent", reason: "this host has no terminal bridge" };
        return;
      }
      const runtime = makeWarmRuntime();
      // Parsed, not cast: a mint without a ticket must fail loudly even here.
      const minted = TerminalConnectTicketResult.parse(
        await fieldd.request("terminal.connectTicket", {}),
      );
      trace?.mark("ticket");
      const attached = await terminal.connect(minted.ticket);
      trace?.mark("connected");
      // `connect()` memoizes its own promise (`#ready ??=` — runtime.ts:351),
      // so the workspace's later connect joins this one instead of racing it.
      await runtime.connect();
      const backend = await warmRenderBackend(runtime);
      trace?.mark("device");
      // Invalidated while this was in flight — the bridge died, or a test reset
      // the singleton. The runtime is disposed rather than published: publishing
      // it would hand the deck a transport whose bridge is already gone.
      if (!current()) {
        runtime.dispose();
        return;
      }
      state = {
        kind: "warm",
        transport: {
          runtime,
          shell: { defaultShell: attached.defaultShell, home: attached.home },
          warmedAt: performance.now(),
        },
      };
      logger.info("renderer.godview.prewarmed", "The Godview transport is warm", { backend });
    } catch (cause) {
      if (!current()) return;
      state = {
        kind: "spent",
        reason: cause instanceof Error ? cause.message : String(cause),
      };
      // Info, not error: nothing is broken for the user — the next ⌘G takes the
      // cold path it would have taken anyway.
      logger.info(
        "renderer.godview.prewarm_failed",
        "The Godview transport could not be warmed; the first open will be cold",
        { reason: state.kind === "spent" ? state.reason : "unknown" },
      );
    }
  });
  state = { kind: "warming", promise };
}

/**
 * Take the warm transport, if one is ready RIGHT NOW.
 *
 * Synchronous and non-blocking. Callers that could otherwise build a SECOND
 * runtime must consult `pendingWarmTransport` first — see the law below.
 */
export function claimWarmTransport(): WarmTransport | null {
  if (state.kind !== "warm") return null;
  const { transport } = state;
  state = { kind: "claimed" };
  return transport;
}

/**
 * THE ONE-RUNTIME LAW, and the reason it is not merely an optimization.
 *
 * `waitForGhostteaRendererPorts` resolves from a `window` message listener
 * (runtime.ts), and main posts the two MessagePorts EXACTLY ONCE per attach.
 * Two runtimes waiting at the same time therefore both resolve — with the same
 * two ports — and then both call `start()` on one control channel. The result
 * is not a slow deck but a broken one: whichever runtime the workspace is
 * holding may never see a frame, and it sits at `rendererBackend: "starting"`
 * forever.
 *
 * So a deck that finds no warm transport may not simply build its own: it has to
 * know whether a warm is still IN FLIGHT and wait for that one instead. This
 * returns the promise to wait on, or null when nothing is pending and building
 * a runtime is safe.
 */
export function pendingWarmTransport(): Promise<void> | null {
  return state.kind === "warming" ? state.promise : null;
}

/**
 * The deck is taking ownership of the transport, warm or not.
 *
 * The second half of the one-runtime law, and the half that is easy to miss:
 * `pendingWarmTransport` only sees a warm ALREADY IN FLIGHT. A prewarm that is
 * merely SCHEDULED — the idle callback has not fired yet — is invisible to it,
 * so a deck that opened first would build its runtime, and the prewarm would
 * then wake up behind it and build a second one waiting for the same ports.
 * That is the harder version of the same bug, and it is closed here rather than
 * by timing: once the deck has taken over, the singleton is CLAIMED for the rest
 * of the app's life and `prewarmGodviewTransport` is a no-op.
 *
 * Returns the warm transport when there is one to inherit, otherwise null — in
 * which case the caller owns the only ports wait and may build its own.
 */
export function takeTransportForDeck(): WarmTransport | null {
  const transport = state.kind === "warm" ? state.transport : null;
  // Anything still in flight is superseded: it will finish, find itself stale,
  // and dispose its own runtime rather than publishing it.
  generation += 1;
  state = { kind: "claimed" };
  return transport;
}

/**
 * The warm transport died before anyone used it (GT-D14's custody clause).
 *
 * Exactly one re-warm follows, and only from a state that was actually warm or
 * warming — a claimed transport belongs to a live deck whose own recovery ladder
 * (GT-1) owns it from then on, and re-warming behind it would fork a bridge for
 * nobody.
 */
export function discardWarmTransport(reason: string): void {
  if (state.kind === "warm") {
    state.transport.runtime.dispose();
  } else if (state.kind !== "warming") {
    return;
  }
  // A warm still in flight is invalidated rather than awaited: it will finish,
  // find itself superseded, and dispose its own runtime.
  generation += 1;
  state = { kind: "spent", reason };
}

/** Re-warm once, if the first attempt was spent. GT-D14: lazily, never a loop. */
export function rewarmGodviewTransport(fieldd: FielddClient): void {
  if (state.kind !== "spent" || rewarmed) return;
  rewarmed = true;
  state = { kind: "cold" };
  prewarmGodviewTransport(fieldd);
}

/** What the warm singleton currently is, for the lab readout and the tests. */
export function warmTransportState(): WarmState["kind"] {
  return state.kind;
}

/** Test seam ONLY: the singleton is per-app-life by design. */
export function resetWarmTransportForTest(): void {
  if (state.kind === "warm") state.transport.runtime.dispose();
  // Same invalidation as a discard: a warm left in flight by the previous case
  // must not land in the next one.
  generation += 1;
  state = { kind: "cold" };
  rewarmed = false;
}
