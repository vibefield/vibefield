// WP12b (EDP §11.1; build-wp12-updater.md D14) — the update system's ONE decision: a pure
// `decideUpdate(state, census, context) → action`, unit-tested as a truth table. Tray, Settings and the quit flow
// render its output and decide nothing themselves. (EDP §11.1 calls it `UpdatePolicy`; renamed, because
// `UpdatePolicy` is the signed policy document's contract in @vibefield/contracts.)
//
// L1 (WP12b) decides checks, downloads and whether a staged update is offered. The apply gate (EDP-34's safe window,
// EDP-35's census) is WP12c's: until it is wired, a staged update is HELD with `apply-unbuilt` — and electron-updater's
// install-on-quit stays off, so nothing applies behind the gate.

export type UpdateTrigger = "launch" | "manual" | "resume" | "available" | "downloaded";

/** The controller's state, as the decision reads it (the controller's own type, re-stated minimally). */
export type DecideState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "not-available" }
  | { readonly kind: "available"; readonly version: string }
  | { readonly kind: "downloading"; readonly version: string }
  | { readonly kind: "staged"; readonly version: string }
  | { readonly kind: "error" };

export interface DecideContext {
  readonly trigger: UpdateTrigger;
  /** The person's off switch; an ABSENT setting is on (the `Option<bool>` regression class, EDP §13.1). */
  readonly enabled: boolean;
  readonly lastCheckAt: number | null;
  readonly now: number;
  /** A resume checks only when the last check is at least this old (EDP §11.2). */
  readonly staleMs: number;
  /** Versions the person declined (persisted across restarts and a staged download). */
  readonly declined: readonly string[];
  /** WP12c's apply gate exists. False in L1. */
  readonly applyWired: boolean;
}

export type UpdateAction =
  | { readonly kind: "check" }
  | { readonly kind: "download"; readonly version: string }
  | { readonly kind: "offer-restart"; readonly version: string }
  | {
      readonly kind: "hold";
      readonly version: string;
      readonly reason: "sessions" | "apply-unbuilt";
    }
  | {
      readonly kind: "none";
      readonly reason: "disabled" | "in-flight" | "fresh" | "declined" | "nothing-to-do";
    };

/** `census`: VibeField-hosted live sessions (EDP-33/35: never auto-escalated past live sessions). 0 until WP12c reads
 * the terminal inventory. */
export function decideUpdate(
  state: DecideState,
  census: number,
  context: DecideContext,
): UpdateAction {
  const { trigger } = context;
  if (trigger === "launch" || trigger === "manual" || trigger === "resume") {
    if (state.kind === "checking" || state.kind === "downloading")
      return { kind: "none", reason: "in-flight" };
    // the off switch stops automatic checks; a person's explicit check still runs (and then downloads nothing)
    if (!context.enabled && trigger !== "manual") return { kind: "none", reason: "disabled" };
    if (
      trigger === "resume" &&
      context.lastCheckAt !== null &&
      context.now - context.lastCheckAt < context.staleMs
    ) {
      return { kind: "none", reason: "fresh" };
    }
    return { kind: "check" };
  }
  if (trigger === "available") {
    if (state.kind !== "available") return { kind: "none", reason: "nothing-to-do" };
    if (context.declined.includes(state.version)) return { kind: "none", reason: "declined" };
    if (!context.enabled) return { kind: "none", reason: "disabled" };
    return { kind: "download", version: state.version };
  }
  // trigger === "downloaded"
  if (state.kind !== "staged") return { kind: "none", reason: "nothing-to-do" };
  if (context.declined.includes(state.version)) return { kind: "none", reason: "declined" };
  if (census > 0) return { kind: "hold", version: state.version, reason: "sessions" };
  if (!context.applyWired) return { kind: "hold", version: state.version, reason: "apply-unbuilt" };
  return { kind: "offer-restart", version: state.version };
}
