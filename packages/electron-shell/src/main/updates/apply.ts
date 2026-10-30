// WP12c (L2b-ii, `build-wp12-updater.md` §10; the PM's rulings 2026-10-15 13:31–13:40Z) — what the apply needs from the
// world, as one port the controller drives and the tests fake, and the words it shows (DESIGN.md §9: sentence case,
// buttons that say what they do, numbers, errors that say what happened and what to do next, no apology).
//
// The order is EDP §11.5's with one law on top: an irreversible step goes after the last refusal, never before it.
// A payload Squirrel has downloaded is applied at the next start whether or not `quitAndInstall` runs
// (`electron.d.ts:2103-2104`), so Squirrel is staged only AFTER the daemons have stopped — the one state where an
// armed install is safe — and from that stop on, the flow always ends in exit and nothing may start a daemon.

import { releaseName, TerminalListResult } from "@vibefield/contracts";
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

/** `terminal.list`'s answer as ONE census snapshot (`ApplyPort.census`). Anything but a list is `known: false`, and so —
 * IL-D5 (a) (`draft/thinking-inventory-latency.md` §5) — is a list whose observation names a cell older than its bound
 * (`staleCells`, the floor's own or fieldd's when the stream stops reaching it): that cell's rows may miss a session it
 * holds now, so a consent read from them could end one the person was never shown. The apply HOLDS as `census-unknown`
 * until a list is current, as fieldd's own re-check at the stop refuses. A list with no `boundMs` — a fieldd or a floor
 * that cannot say how old its rows are — is read as its rows. */
export function censusOf(answer: unknown): CensusSnapshot {
  const listed = TerminalListResult.safeParse(answer);
  if (!listed.success) return { known: false };
  const { terminals, observation } = listed.data;
  if ((observation?.staleCells?.length ?? 0) > 0) return { known: false };
  return {
    known: true,
    sessions: terminals.map((terminal) => ({
      sessionId: terminal.sessionId,
      ...(terminal.title !== undefined ? { title: terminal.title } : {}),
      ...(terminal.cwd !== undefined ? { cwd: terminal.cwd } : {}),
    })),
  };
}

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
  /** `terminal.list` over the live fieldd, bounded (2 s), read by `censusOf`: anything but a current list is
   * `known: false`. */
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

/** EDP-35's consent, in DESIGN.md §9's voice: the wording IS the consequence. Composed ONCE (L3c-ii): the tray's box
 * joins these words, and the Settings card lays the same words out, so the two cannot say different things. AU-1
 * (LC-2): the version is said by its friendly name (`releaseName`), as the window says it. */
export type ConsentWords = {
  readonly message: string;
  readonly lead: string;
  readonly listed: readonly string[];
  readonly more: number;
  readonly confirm: string;
};

export function consentWords(version: string, sessions: readonly CensusSession[]): ConsentWords {
  const n = sessions.length;
  const listed = sessions.slice(0, CONSENT_LISTED_MAX).map((session) => {
    const title = session.title?.trim() || "untitled session";
    return session.cwd ? `${title} — ${session.cwd}` : title;
  });
  return {
    message: `Updating ends ${n} ${plural(n, "terminal session", "terminal sessions")}`,
    lead: `${releaseName(version, { start: true })} replaces the terminal service, which ends:`,
    listed,
    more: n - listed.length,
    confirm: `End ${n} ${plural(n, "session", "sessions")} and update`,
  };
}

/** EDP-35's consent box: `consentWords`, joined for a native dialog. */
export function consentBox(version: string, sessions: readonly CensusSession[]): BoxContent {
  const words = consentWords(version, sessions);
  const lines = [
    words.lead,
    ...words.listed,
    ...(words.more > 0 ? [`and ${words.more} more`] : []),
  ];
  return {
    message: words.message,
    detail: lines.join("\n"),
    buttons: ["Cancel", words.confirm],
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

/** A lever of the signed policy (B1) that refused one version, as the words name it. */
export type LeverWhy =
  | { readonly kind: "killed"; readonly channel: string }
  | { readonly kind: "yanked"; readonly version: string }
  | { readonly kind: "floor-unmet"; readonly version: string; readonly floor: string };

/** A paused channel and an OS floor read the same whether they stopped an install or a download. */
const pausedDetail = (channel: string): string =>
  `Updates on the ${channel} channel are paused by VibeField's publisher. Nothing changed; your current version keeps running.`;
const floorDetail = (version: string, floor: string): string =>
  `${releaseName(version, { start: true })} needs macOS ${floor} or later. Nothing changed; your current version keeps running.`;

/** Why the apply did not start, said before anything is torn down (L3b-i, B1/B2; DESIGN.md §9). The person clicked
 * "Restart to Update"; nothing changed, and the words say what happens next. */
export function policyNotice(
  why: { readonly kind: "unreachable" } | { readonly kind: "unverified" } | LeverWhy,
): BoxContent {
  const detail = (() => {
    switch (why.kind) {
      case "unreachable":
        // the PM's words (2026-10-15 16:03Z)
        return "VibeField checks the update policy before installing and couldn't reach it; try again when online.";
      case "unverified":
        return "VibeField checks the update policy before installing, and the policy it found didn't verify. Nothing changed; it checks again next time.";
      case "killed":
        return pausedDetail(why.channel);
      case "yanked":
        return `${releaseName(why.version, { start: true })} was withdrawn after it downloaded, so it won't install. Nothing changed; the next update replaces it.`;
      case "floor-unmet":
        return floorDetail(why.version, why.floor);
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

/** AU-1 (AU-G5, AU-G6) — why a person's Download did not start: a lever refused the version before any byte came, so
 * the words say "download", never "install" or "after it downloaded". The message is the one the window says for a
 * download refusal main sends no words for, so the two never differ on it. */
export function downloadNotice(why: LeverWhy): BoxContent {
  const detail =
    why.kind === "killed"
      ? pausedDetail(why.channel)
      : why.kind === "yanked"
        ? `${releaseName(why.version, { start: true })} was withdrawn, so it won't download. Nothing changed; the next update replaces it.`
        : floorDetail(why.version, why.floor);
  return {
    message: "VibeField didn't download the update",
    detail,
    buttons: ["OK"],
    defaultId: 0,
    cancelId: 0,
  };
}

/** L3c-ii — the census could not be read when the person chose to update: VibeField ends no session it cannot name, and
 * says so (before, the tray's click did nothing visible here: an act with no sentence, which EDP-35 forbids). */
export function censusNotice(): BoxContent {
  return {
    message: "VibeField didn't install the update",
    detail:
      "VibeField couldn't read which terminal sessions are running, so it ended none. Nothing changed; try again in a moment.",
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
