import type { GhostteaTerminalRuntime } from "@vibecook/ghosttea-react";

// THE WATCH-ONLY RUNTIME (TP-R4a: "the mirror cannot take input focus and
// issues zero geometry claims BY CONSTRUCTION").
//
// The mirror is a second `TerminalSurface` on a session another view owns. The
// spec names one hazard for that (§2): "focus implies a claim" — the focus-sync
// effect calls `setFocused(…, true, cols, rows)` regardless of `controlsResize`
// (`TerminalSurface.js:303`) and `setFocused(true)` sends `focus-and-resize`
// (`runtime.js:1332-1345`). Reading 0.10.1 against the tree turned up two more,
// and they are why this file is a RUNTIME facade rather than a set of props:
//
//  1. `controlsResize: false` DOES NOT stop a surface from resizing the PTY.
//     It gates one effect — the explicit `claimResizeControl`
//     (`TerminalSurface.js:295-299`) — and nothing else. The surface's own
//     `ResizeObserver` calls `terminalRuntime.resize(session.id, viewId, cols,
//     rows)` whenever its derived grid changes (`:238-249`, ungated), and
//     `runtime.resize` → `#sendResize` notifies the daemon without ever asking
//     whether this view is the controller (`runtime.js:1452-1465, 1525-1538`).
//     So a mirror sized differently from the authority reflows the real
//     terminal, with no focus involved at all.
//  2. `readWrite` IS NOT A PROP. `TerminalSurfaceProps` has no such field;
//     the component reads `session.readWrite` (`TerminalSurface.js:40`), and
//     the runtime's own `view.readWrite` — the flag guarding `#maybeReclaim`
//     and `#sendViewInput` (`runtime.js:983, 1184`) — comes from the DAEMON's
//     attach response (`runtime.js:846`), not from anything a caller passes.
//     A mirror of a read-write session is a read-write view as far as those
//     guards are concerned, whatever it renders itself as.
//  3. `setTheme` is SESSION-scoped on the control plane. It takes a surfaceId
//     for the worker, then notifies `set-colors` with only a sessionId
//     (`runtime.js:1247-1263`) — so a mirror with its own theme would repaint
//     the session for every viewer, the authority included.
//
// None of those is reachable through props, so the mirror does not hold the
// runtime. It holds this: an ALLOW-LIST facade that forwards the verbs a
// watcher needs and refuses everything else.
//
// Allow-list and not deny-list, deliberately. A deny-list is a promise about
// the methods that existed the day it was written; TP-R4a is a promise about
// the mirror. If a future ghosttea adds a verb this does not name, the mirror
// stops using it — loudly, in the counter below — instead of silently gaining
// the ability to claim something.

/** Everything a WATCHER legitimately needs. Each one is here because it was
 * checked in 0.10.1, not because it sounded harmless. */
const WATCH_ONLY_VERBS = [
  /** The frame subscription itself. The runtime refcounts ONE per session
   * across its surfaces (`#retainFrameSubscription`), so a mirror mounting is
   * exactly the "N views per session" upstream already builds — one decode,
   * two presents. */
  "mount",
  /** Worker-local visibility (`runtime.js:1271-1272` posts `visibility`;
   * nothing reaches the daemon). This is the mirror's RENDER-demand door — the
   * cull-driven half of TP-S2 — and the reason it is safe is exactly the reason
   * it is not enough on its own: it never speaks to the source. SOURCE demand
   * goes through the pool's ledger instead. */
  "setVisible",
  /** Worker-local shader/effect selection, per surface (`runtime.js:1265`). */
  "setEffects",
  /** Reads. `listSessions` is how the widget turns a session ID — the only
   * address it is given (TP-L-C) — into the summary `TerminalSurface` needs;
   * it goes through the facade rather than around it so the guarantee has no
   * exception in it. */
  "scrollbar",
  "isMouseTracking",
  "listSessions",
  "sessionMetadata",
  /** Event plumbing — the scrollbar-state listener the surface installs. */
  "addEventListener",
  "removeEventListener",
] as const;

/** The verbs a mirror must never reach, named so the refusal counter can say
 * which one was attempted. Not the implementation — the allow-list above is —
 * but the vocabulary a test asserts against and a log line reads from. */
export const MIRROR_REFUSED_VERBS = [
  // geometry (TP-L-D: a mirror holds no lease and claims none)
  "resize",
  "claimResizeControl",
  "setFocused",
  // input (TP-D11's read-only policy, and the C-2 contract)
  "sendKey",
  "sendText",
  "paste",
  "sendMouse",
  "interrupt",
  "scroll",
  "scrollTo",
  "setSelection",
  "copySelection",
  // session-wide mutation wearing a per-surface signature (finding 3 above)
  "setTheme",
  // lifecycle — a watcher never ends what it watches
  "terminate",
  "unregisterSession",
] as const;

export type MirrorRefusedVerb = (typeof MIRROR_REFUSED_VERBS)[number];

/**
 * Refused verbs whose callers chain on the result.
 *
 * A refusal has to be a NO-OP, not a fault: `copySelection` is awaited by the
 * surface (`TerminalSurface.js:519` — `.copySelection(…).catch(…)`), so
 * returning `undefined` from it turns a refusal into a TypeError inside someone
 * else's event handler. Refusing safely means refusing in the shape the caller
 * expects, which for an async verb is a settled promise. Found by the mirror's
 * own test dispatching a pointer sequence at a surface that should never have
 * received one.
 */
const ASYNC_REFUSED_VERBS = new Set<PropertyKey>(["copySelection"]);

/** What the facade turned away. Zero is the gate (TP-R4a); anything else names
 * the verb, so a failing assertion says WHAT the mirror tried to do rather than
 * that a number was not zero. */
export interface MirrorRefusals {
  readonly count: number;
  readonly verbs: readonly string[];
}

export interface WatchOnlyRuntime {
  /** Hand this to `GhostteaProvider`. It is not the runtime and never was. */
  readonly runtime: GhostteaTerminalRuntime;
  refusals(): MirrorRefusals;
}

/**
 * Wrap a runtime so a surface mounted against it can only watch.
 *
 * The forwarding binds to the TARGET, not to the facade: the runtime keeps its
 * state in `#private` fields, and a method invoked with the facade as `this`
 * would throw on the first field access. Binding once per property read is also
 * what makes the facade transparent to `TerminalSurface`'s effect dependencies
 * — they compare the runtime object, not its methods.
 */
export function watchOnlyRuntime(runtime: GhostteaTerminalRuntime): WatchOnlyRuntime {
  const allowed = new Set<PropertyKey>(WATCH_ONLY_VERBS);
  const refused: string[] = [];
  const bound = new Map<PropertyKey, unknown>();

  const facade = new Proxy(runtime as unknown as Record<PropertyKey, unknown>, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (allowed.has(property)) {
        // Cached so repeated reads return the SAME function object: React
        // dependency arrays and `removeEventListener` both compare identity,
        // and a fresh bound function per read would break the listener cleanup
        // the surface installs.
        let fn = bound.get(property);
        if (fn === undefined) {
          fn = (value as (...args: unknown[]) => unknown).bind(target);
          bound.set(property, fn);
        }
        return fn;
      }
      let refusal = bound.get(property);
      if (refusal === undefined) {
        const async = ASYNC_REFUSED_VERBS.has(property);
        refusal = (): unknown => {
          refused.push(String(property));
          // A refusal never throws and never rejects: the caller asked for
          // something a watcher does not do, and the honest answer is nothing
          // — an empty result, delivered the way it was asked for.
          return async ? Promise.resolve("") : undefined;
        };
        bound.set(property, refusal);
      }
      return refusal;
    },
    // A mirror never writes to the runtime either — the surface does not, but
    // "by construction" should not depend on that staying true.
    set() {
      return true;
    },
  }) as unknown as GhostteaTerminalRuntime;

  return {
    runtime: facade,
    refusals: () => ({ count: refused.length, verbs: [...refused] }),
  };
}
