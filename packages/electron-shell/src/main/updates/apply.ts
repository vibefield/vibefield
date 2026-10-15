// WP12c (L2b-ii, `build-wp12-updater.md` §10; the PM's rulings 2026-10-15 13:31–13:40Z) — what the apply needs from the
// world, as one port the controller drives and the tests fake, and the words it shows (DESIGN.md §9: sentence case,
// buttons that say what they do, numbers, errors that say what happened and what to do next, no apology).
//
// The order is EDP §11.5's with one law on top: an irreversible step goes after the last refusal, never before it.
// A payload Squirrel has downloaded is applied at the next start whether or not `quitAndInstall` runs
// (`electron.d.ts:2103-2104`), so Squirrel is staged only AFTER the daemons have stopped — the one state where an
// armed install is safe — and from that stop on, the flow always ends in exit and nothing may start a daemon.

import type { UpdateQuitPlan } from "../quit-flow";

/** One session the floor holds, as the census read it: the id is what the person consents to and what fieldd
 * re-checks, byte for byte; the title and cwd are only for the person to recognise it. */
export interface CensusSession {
  readonly sessionId: string;
  readonly title?: string;
  readonly cwd?: string;
}

/** ONE census snapshot (the PM's ruling 13:31Z): the consent box lists it and the daemon's re-check compares its ids,
 * so what the person consented to is exactly what fieldd compares. `known: false` holds the apply (§10 S1). */
export type CensusSnapshot =
  | { readonly known: true; readonly sessions: readonly CensusSession[] }
  | { readonly known: false };

/** Squirrel's staging, after the daemon stop: `staged` (armed — the install is next), `refused` (its `error`: nothing
 * armed), `timeout` (no answer in the bound: it MAY still arm, so the app exits without relaunch). */
export type StageOutcome =
  | { readonly kind: "staged" }
  | { readonly kind: "refused" }
  | { readonly kind: "timeout" };

export type StopOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly live?: readonly string[] };

/** A native message box's content. */
export interface BoxContent {
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
  readonly defaultId: number;
  readonly cancelId: number;
}

export interface ApplyPort {
  /** The apply exists on this platform: macOS's Squirrel (§10 S5). Elsewhere a staged update stays `apply-unbuilt`. */
  readonly wired: boolean;
  /** `terminal.list` over the live fieldd, bounded (2 s); anything but an answer is `known: false`. */
  census(): Promise<CensusSnapshot>;
  /** The consent box (only when sessions live): true = "End N sessions and update". */
  confirm(content: BoxContent): Promise<boolean>;
  /** Arm the quit flow's update mode with this plan, then quit; false = a quit is already underway. */
  quitForUpdate(plan: UpdateQuitPlan): boolean;
  /** Hold fieldd (nothing may start it from here), then its consented stop: `system.shutdown {native: {stop, sessions,
   * toVersion}}`. A refusal stops nothing and RELEASES the hold. `native: false` (L3b-i, B3: the release leaves the
   * floor's bytes alone) asks fieldd's plain stop, and the floor and its sessions live on. */
  stopDaemons(sessions: readonly string[], version: string, native: boolean): Promise<StopOutcome>;
  /** Squirrel's staging, bounded. */
  stage(boundMs: number): Promise<StageOutcome>;
  /** `quitAndInstall()`. */
  install(): void;
  /** Tell the person, before the exit, why the app is quitting (auto-closes after `NOTICE_AUTOCLOSE_MS`). */
  notify(content: BoxContent): Promise<void>;
  /** Undo an update quit that aborted before the stop: the window reopens, nothing else changed. */
  restore(): void;
}

export const CENSUS_BOUND_MS = 2_000;
export const SQUIRREL_STAGE_MS = 120_000;
export const NOTICE_AUTOCLOSE_MS = 60_000;
/** The consent box lists at most this many sessions; the rest are counted. */
export const CONSENT_LISTED_MAX = 5;

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** EDP-35's consent box, in DESIGN.md §9's voice: the wording IS the consequence. */
export function consentBox(version: string, sessions: readonly CensusSession[]): BoxContent {
  const n = sessions.length;
  const noun = plural(n, "terminal session", "terminal sessions");
  const listed = sessions.slice(0, CONSENT_LISTED_MAX).map((session) => {
    const title = session.title?.trim() || "untitled session";
    return session.cwd ? `${title} — ${session.cwd}` : title;
  });
  const more = n - listed.length;
  const lines = [
    `VibeField ${version} replaces the terminal service, which ends:`,
    ...listed,
    ...(more > 0 ? [`and ${more} more`] : []),
  ];
  return {
    message: `Updating ends ${n} ${noun}`,
    detail: lines.join("\n"),
    buttons: ["Cancel", `End ${n} ${plural(n, "session", "sessions")} and update`],
    defaultId: 0,
    cancelId: 0,
  };
}

/** The two exit-WITHOUT-relaunch branches tell the person before the window goes (the PM's ruling 13:37Z): an app
 * that vanishes with no sentence is what EDP-35 forbids. */
export function quitNotice(reason: "squirrel-timeout" | "install-failed"): BoxContent {
  return {
    message: "VibeField is quitting to finish the update",
    detail:
      reason === "squirrel-timeout"
        ? "Preparing the update took longer than 2 minutes. Open VibeField again: it finishes the update or says why it can't."
        : "The installer didn't take over. Open VibeField again: it finishes the update or says why it can't.",
    buttons: ["Quit"],
    defaultId: 0,
    cancelId: 0,
  };
}

/** Why the apply did not start, said before anything is torn down (L3b-i, B1/B2; DESIGN.md §9). The person clicked
 * "Restart to Update"; nothing changed, and the words say what happens next. */
export function policyNotice(
  why:
    | { readonly kind: "unreachable" }
    | { readonly kind: "unverified" }
    | { readonly kind: "killed"; readonly channel: string }
    | { readonly kind: "yanked"; readonly version: string }
    | { readonly kind: "floor-unmet"; readonly version: string; readonly floor: string },
): BoxContent {
  const detail = (() => {
    switch (why.kind) {
      case "unreachable":
        // the PM's words (2026-10-15 16:03Z)
        return "VibeField checks the update policy before installing and couldn't reach it; try again when online.";
      case "unverified":
        return "VibeField checks the update policy before installing, and the policy it found didn't verify. Nothing changed; it checks again next time.";
      case "killed":
        return `Updates on the ${why.channel} channel are paused by VibeField's publisher. Nothing changed; your current version keeps running.`;
      case "yanked":
        return `VibeField ${why.version} was withdrawn after it downloaded, so it won't install. Nothing changed; the next update replaces it.`;
      case "floor-unmet":
        return `VibeField ${why.version} needs macOS ${why.floor} or later. Nothing changed; your current version keeps running.`;
    }
  })();
  return {
    message: "VibeField didn't install the update",
    detail,
    buttons: ["OK"],
    defaultId: 0,
    cancelId: 0,
  };
}

/** C2 (L3c-i) — the consent's snapshot went stale before the answer (two minutes, or the update changed): nothing
 * changed, and the next Restart takes a fresh one. Never a silent proceed on an old list. */
export function expiredNotice(): BoxContent {
  return {
    message: "VibeField didn't install the update",
    detail:
      "The list of sessions it would end may have changed while you decided. Nothing changed; choose Restart to Update again.",
    buttons: ["OK"],
    defaultId: 0,
    cancelId: 0,
  };
}

/** The tray's verb for a staged update (the macOS menu convention the tray already uses: Title Case, an ellipsis for
 * a verb that asks). `undefined` sessions = not wired here; `"unknown"` = the census could not be read. A release that
 * leaves the floor alone (`keepsSessions`, L3b-i B3) ends no session, so its verb is the plain one whatever the count. */
export function stagedTrayLabel(
  sessions: number | "unknown" | undefined,
  keepsSessions = false,
): string {
  if (keepsSessions && sessions !== undefined) return "Restart to Update";
  if (sessions === undefined || sessions === "unknown") return "Update Downloaded";
  if (sessions === 0) return "Restart to Update";
  return `Update Ends ${sessions} ${plural(sessions, "Session", "Sessions")}…`;
}
