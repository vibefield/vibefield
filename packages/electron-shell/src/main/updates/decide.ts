// WP12b (EDP §11.1; build-wp12-updater.md D14) — the update system's ONE decision: a pure
// `decideUpdate(state, census, context) → action`, unit-tested as a truth table. Tray, Settings and the quit flow
// render its output and decide nothing themselves. (EDP §11.1 calls it `UpdatePolicy`; renamed, because
// `UpdatePolicy` is the signed policy document's contract in @vibefield/contracts.)
//
// L1 (WP12b) decides checks, downloads and whether a staged update is offered. The apply gate (EDP-34's safe window,
// EDP-35's census) is WP12c's: where it is not wired (L2b-ii wires macOS), a staged update is HELD with `apply-unbuilt`
// — and electron-updater's install-on-quit stays off, so nothing applies behind the gate.
//
// WP12d (L3b-i, `build-wp12-updater.md` §12; the PM's ruling 2026-10-15 16:03Z) — the policy's levers bite HERE and
// nowhere else (B1): a kill switch downloads and applies nothing (a staged update is held `killed`, since a later
// policy may lift it); a yanked version is never downloaded and a yanked STAGED one is discarded; a host below the
// policy's OS floor skips the release (discarded if staged, never installed). And the census gates only a release
// that touches the native plane (B3): one that leaves the floor's bytes alone keeps its sessions, so it needs neither.

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

/** The verified policy's levers, as the decision reads them (EDP-37). */
export interface PolicyLevers {
  readonly killSwitch: boolean;
  readonly yanked: readonly string[];
  readonly floors: { readonly os?: string };
  readonly requireUserConfirmation: boolean;
}

export type LeverRefusal = "killed" | "yanked" | "floor-unmet";

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
  /** WP12c's apply gate exists on this platform (L2b-ii: macOS; Windows and Linux keep `apply-unbuilt`, §10 S5). */
  readonly applyWired: boolean;
  /** L3b-i (B1) — the last VERIFIED policy's levers; absent or null = none verified yet, so no lever can bite */
  readonly policy?: PolicyLevers | null;
  /** the host OS's own version (macOS: `process.getSystemVersion()`); null = unreadable, so an OS floor reads unmet */
  readonly hostOs?: string | null;
  /** L3b-i (B3) — the staged release touches the native plane; absent = touched (the fail-safe) */
  readonly nativeTouched?: boolean;
}

export type UpdateAction =
  | { readonly kind: "check" }
  | { readonly kind: "download"; readonly version: string }
  | { readonly kind: "offer-restart"; readonly version: string }
  | {
      readonly kind: "hold";
      readonly version: string;
      readonly reason: "sessions" | "census-unknown" | "apply-unbuilt" | "killed";
    }
  /** a staged version the policy now forbids (yanked, or above this host's floor): forgotten, never installed */
  | {
      readonly kind: "discard";
      readonly version: string;
      readonly reason: "yanked" | "floor-unmet";
    }
  | {
      readonly kind: "none";
      readonly reason:
        | "disabled"
        | "in-flight"
        | "fresh"
        | "declined"
        | "nothing-to-do"
        | LeverRefusal;
    };

/** VibeField-hosted live sessions (EDP-33/35), read from the floor's own inventory; `"unknown"` when it cannot be read
 * (the inventory unobserved, the link down, no answer in its bound) — which HOLDS, never reads as zero (§10 S1). */
export type CensusCount = number | "unknown";

/** Dotted numeric versions (`15.1.0` against `14.0`): <0, 0 or >0, and NaN when either has a part that is not a
 * number — which the floor reads as unmet (fail closed). */
export function compareDotted(a: string, b: string): number {
  const parts = (v: string) =>
    v.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (Number.isNaN(l) || Number.isNaN(r)) return Number.NaN;
    if (l !== r) return l - r;
  }
  return 0;
}

/** Semver precedence, enough for the advisory `minSupported` line: the dotted core first, then a prerelease sorts
 * below its release, identifiers compared numerically when both are numbers. NaN when a core part is not a number. */
export function compareSemver(a: string, b: string): number {
  const [aCore = "", ...aPre] = a.split("-");
  const [bCore = "", ...bPre] = b.split("-");
  const core = compareDotted(aCore, bCore);
  if (Number.isNaN(core) || core !== 0) return core;
  const ap = aPre.join("-");
  const bp = bPre.join("-");
  if (ap === bp) return 0;
  if (ap === "") return 1;
  if (bp === "") return -1;
  const ai = ap.split(".");
  const bi = bp.split(".");
  for (let i = 0; i < Math.max(ai.length, bi.length); i++) {
    const x = ai[i];
    const y = bi[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    return numeric ? Number(x) - Number(y) : x < y ? -1 : 1;
  }
  return 0;
}

/** B1 — what the policy says of one version on this host: the first lever that refuses it, or null. */
export function leverRefusal(
  version: string,
  policy: PolicyLevers | null | undefined,
  hostOs: string | null | undefined,
): LeverRefusal | null {
  if (policy === null || policy === undefined) return null;
  if (policy.killSwitch) return "killed";
  if (policy.yanked.includes(version)) return "yanked";
  const floor = policy.floors.os;
  if (floor !== undefined && !(hostOs != null && compareDotted(hostOs, floor) >= 0)) {
    return "floor-unmet";
  }
  return null;
}

/** `census`: never auto-escalated past live sessions; an unknown census holds too. */
export function decideUpdate(
  state: DecideState,
  census: CensusCount,
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
    const lever = leverRefusal(state.version, context.policy, context.hostOs);
    if (lever !== null) return { kind: "none", reason: lever };
    if (!context.enabled) return { kind: "none", reason: "disabled" };
    return { kind: "download", version: state.version };
  }
  // trigger === "downloaded"
  if (state.kind !== "staged") return { kind: "none", reason: "nothing-to-do" };
  if (context.declined.includes(state.version)) return { kind: "none", reason: "declined" };
  const lever = leverRefusal(state.version, context.policy, context.hostOs);
  if (lever === "killed") return { kind: "hold", version: state.version, reason: "killed" };
  if (lever !== null) return { kind: "discard", version: state.version, reason: lever };
  // the census gates only a release that touches the floor: an untouched one keeps its sessions (B3)
  if (context.nativeTouched !== false) {
    if (census === "unknown")
      return { kind: "hold", version: state.version, reason: "census-unknown" };
    if (census > 0) return { kind: "hold", version: state.version, reason: "sessions" };
  }
  if (!context.applyWired) return { kind: "hold", version: state.version, reason: "apply-unbuilt" };
  return { kind: "offer-restart", version: state.version };
}
