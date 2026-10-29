import type { Logger } from "@vibefield/logging";
import {
  type BoxContent,
  type CensusSession,
  type CensusSnapshot,
  CONSENT_LISTED_MAX,
  type StopOutcome,
} from "./updates/apply";

// AL-3 (`draft/thinking-app-lifecycle.md` §4–§5; ESR §7.3 as amended 2026-10-27) — what a PERSON's quit asks before
// anything closes, and the consented stop it ends with. A quit stops every daemon pair this shell can reach (AL-D1,
// AL-D5): census 0 quits without a word, census > 0 shows one box naming what it ends (AL-D3), census unknown says
// so and ends nothing it cannot name, and an OS logout never asks (AL-D6). The stop is the update's primitive — the
// consented set goes to fieldd, which re-checks it against its own live set — so a session born after the census
// refuses the stop and the box asks again. Pure: the pairs, the box and the preference arrive through the port, and
// the tests drive it with plain fakes (quit-flow.ts's shape). The words are DESIGN.md §9's and the update consent's
// (`consentWords`): the button says what it does, the numbers are counted.
// AU-7 (LC-25; main-process.md §7.2, brought forward from AU-5): the stop says whether it was COMPLETE — every pair
// read, the attached one among them, and every planned stop answered — because a move to Applications runs only after
// a complete stop (a pair left running would execute from the Trash).
// AU-5 (AU-D9 A; LC-24, LC-25, LC-36; main-process.md §7.2): when a person's quit will hand a ready update to Squirrel
// after the stop, the consent box says so in its LAST line ("The Oct 28 nightly installs as you quit.") — one
// declarative sentence, no third button. Main decides whether it will try (`installLine`); the unknown-census box and a
// logout never carry it (an unknown census leaves pairs running, and a logout installs nothing).

/** Why the shell asks the pairs to stop — the `system.shutdown` reasons of a quit (contracts `NativeRestartReason`). */
export type QuitReason = "quit" | "logout";

/** One daemon pair this shell can reach at quit: the attached user's, and every resident one. */
export interface QuitPair {
  /** the user's name, for the box and the log — never a path */
  readonly label: string;
  /** the attached user's pair stops LAST, so a refusal there leaves the app whole */
  readonly attached: boolean;
  /** `terminal.list`, bounded; anything but a current list is `known: false` (`censusOf`) */
  census(): Promise<CensusSnapshot>;
  /** `system.shutdown {reason, native: {stop, sessions}}`, then a bounded wait for the pair to go */
  stop(sessions: readonly string[], reason: QuitReason): Promise<StopOutcome>;
  /** a client the port opened only for this quit (a resident pair's adopt-only probe): closed once the quit is over */
  close?(): void;
}

/** A native box's content, and whether it offers "Do not ask again". */
export interface QuitBox extends BoxContent {
  readonly suppressible: boolean;
}

export interface QuitBoxAnswer {
  readonly confirmed: boolean;
  /** the person ticked "Do not ask again" */
  readonly suppress: boolean;
}

export interface QuitGatePort {
  /** every pair this shell can reach, without starting one */
  pairs(): Promise<readonly QuitPair[]>;
  /** `desktop.confirmQuit` — the box is shown only while it holds */
  confirmEnabled(): boolean;
  confirm(box: QuitBox): Promise<QuitBoxAnswer>;
  /** "Do not ask again": turn `desktop.confirmQuit` off (best-effort; Settings turns it back on) */
  suppress(): void;
  /** from the decision on, nothing may start a pair (the coordinators' hold) … */
  hold(): void;
  /** … until a quit that ended nothing gives the app back */
  release(): void;
  /** AU-5 — the consent box's last line when this quit will install a ready update (null: it will not — nothing staged,
   * updates off, a policy that asks first, a move waiting); read only for a person's quit whose census box shows */
  installLine?(): string | null;
  readonly log: Pick<Logger, "info" | "warn">;
}

/** AU-7 (main-process.md §7.2) — how the stop went. `done`: the quit goes on; `complete` = no pair's census was
 * unknown at the decision, the attached user's pair was among those reached, and every planned stop answered (a pair
 * left running, or no decision at all, is incomplete); `ended` = the sessions the stopped pairs ended with consent.
 * `aborted`: a session was born after the census and the person kept the app. */
export type QuitStopOutcome =
  | { readonly kind: "done"; readonly complete: boolean; readonly ended: number }
  | { readonly kind: "aborted" };

export interface QuitGate {
  /** The census and, when it has to, the box. `unattended` (an OS logout) never asks. "cancel" changed nothing. */
  decide(options: { readonly unattended: boolean }): Promise<"proceed" | "cancel">;
  /** After the durable close: the consented stop of every pair the decision named, the attached one last.
   * "aborted" = a session was born after the census and the person cancelled the second ask: the attached pair
   * stopped nothing, and the caller gives the app back. */
  stop(): Promise<QuitStopOutcome>;
}

/** How many times a stop that a birth refused is asked again before the pair is left (and said). */
const MAX_STOP_ATTEMPTS = 3;

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** A session the box names: its census row, and whose it is when the shell runs more than one user's pair. */
export interface NamedSession extends CensusSession {
  readonly owner?: string;
}

/** AL-D3 — the consent box, in the update consent's shape: the message is the consequence, the detail names the
 * sessions (five at most, then a count), and the button says what it does. AU-5: `installs`, the ready update's
 * sentence, is the detail's last line. */
export function quitConsentBox(
  sessions: readonly NamedSession[],
  options: { readonly bornDuringQuit?: boolean; readonly installs?: string } = {},
): QuitBox {
  const n = sessions.length;
  const rows = sessions.slice(0, CONSENT_LISTED_MAX).map((session) => {
    const title = session.title?.trim() || "untitled session";
    const where = session.cwd ? ` — ${session.cwd}` : "";
    const whose = session.owner !== undefined ? ` (${session.owner})` : "";
    return `${title}${where}${whose}`;
  });
  const more = n - rows.length;
  const lead = options.bornDuringQuit
    ? "A session started while VibeField was quitting. Quitting stops the terminal service, which ends:"
    : "Quitting stops the terminal service, which ends:";
  return {
    message: `Quit VibeField and end ${n} ${plural(n, "terminal session", "terminal sessions")}?`,
    detail: [
      lead,
      ...rows,
      ...(more > 0 ? [`and ${more} more`] : []),
      ...(options.installs !== undefined ? [options.installs] : []),
    ].join("\n"),
    buttons: ["Cancel", `Quit and end ${n} ${plural(n, "session", "sessions")}`],
    defaultId: 0,
    cancelId: 0,
    suppressible: options.bornDuringQuit !== true,
  };
}

/** A census could not be read: VibeField ends no session it cannot name (`censusNotice`'s rule), and a box that names
 * none ends none — so with any census unknown the quit ends NO session anywhere (a pair whose census is known and
 * empty still stops: that ends nothing). Two buttons, never a third: this box is the only one that can say the
 * terminal service stays, because here there is nothing the person could be asked to consent to. */
export function unknownCensusBox(): QuitBox {
  return {
    message: "VibeField couldn't check for running sessions",
    detail:
      "It ends no session it can't name, so quitting now leaves the terminal service running. Open VibeField again and quit to stop it.",
    buttons: ["Cancel", "Quit and leave it running"],
    defaultId: 0,
    cancelId: 0,
    suppressible: false,
  };
}

interface PlannedStop {
  readonly pair: QuitPair;
  readonly sessions: readonly string[];
}

interface QuitPlan {
  readonly reason: QuitReason;
  readonly stops: readonly PlannedStop[];
  /** AU-7 — every census was read and the attached pair was among them (the stops must still answer) */
  readonly whole: boolean;
}

export function createQuitGate(port: QuitGatePort): QuitGate {
  let plan: QuitPlan | null = null;
  let reached: readonly QuitPair[] = [];
  const closeReached = (): void => {
    for (const pair of reached) pair.close?.();
    reached = [];
  };
  /** AU-5 — the consent box, with the ready update's line last when main will install it as the app quits */
  const consentBoxFor = (named: readonly NamedSession[]): QuitBox => {
    const installs = port.installLine?.() ?? null;
    return quitConsentBox(named, installs !== null ? { installs } : {});
  };

  return {
    async decide({ unattended }) {
      plan = null;
      closeReached();
      const pairs = [...(await port.pairs())].sort(
        (a, b) => Number(a.attached) - Number(b.attached),
      );
      reached = pairs;
      const readings = await Promise.all(
        pairs.map(async (pair) => ({ pair, census: await pair.census() })),
      );
      const owners = pairs.length > 1;
      const named: NamedSession[] = [];
      const stops: PlannedStop[] = [];
      const unknown: string[] = [];
      for (const { pair, census } of readings) {
        if (!census.known) {
          unknown.push(pair.label);
          continue;
        }
        named.push(...census.sessions.map((s) => (owners ? { ...s, owner: pair.label } : s)));
        stops.push({ pair, sessions: census.sessions.map((s) => s.sessionId) });
      }
      port.log.info("desktop.quit.census_read", "The quit read the sessions it would end", {
        pairs: pairs.length,
        sessions: named.length,
        unknownPairs: unknown.length,
        unattended,
      });
      // a person's quit with any census unknown ends no session: only pairs with nothing to end still stop (above)
      const planned =
        unknown.length > 0 && !unattended ? stops.filter((s) => s.sessions.length === 0) : stops;
      if (!unattended) {
        const box =
          unknown.length > 0
            ? unknownCensusBox()
            : named.length > 0 && port.confirmEnabled()
              ? consentBoxFor(named)
              : null;
        if (box !== null) {
          const answer = await port.confirm(box);
          if (!answer.confirmed) {
            port.log.info("desktop.quit.cancelled", "The person cancelled the quit", {
              sessions: named.length,
              unknownPairs: unknown.length,
            });
            closeReached();
            return "cancel";
          }
          if (answer.suppress && box.suppressible) port.suppress();
        }
      }
      port.hold();
      plan = {
        reason: unattended ? "logout" : "quit",
        stops: planned,
        whole: unknown.length === 0 && pairs.some((pair) => pair.attached),
      };
      port.log.info("desktop.quit.consented", "The quit will stop the pairs it read", {
        reason: plan.reason,
        pairs: planned.length,
        sessions: planned.reduce((n, s) => n + s.sessions.length, 0),
        leftRunning: pairs.length - planned.length,
      });
      return "proceed";
    },

    async stop() {
      const current = plan;
      plan = null;
      if (current === null) {
        closeReached();
        // no decision proved anything stopped
        return { kind: "done", complete: false, ended: 0 };
      }
      try {
        return await stopPlanned(current);
      } finally {
        closeReached();
      }
    },
  };

  async function stopPlanned(current: QuitPlan): Promise<QuitStopOutcome> {
    let complete = current.whole;
    let ended = 0;
    for (const planned of current.stops) {
      let sessions = planned.sessions;
      for (let attempt = 1; ; attempt++) {
        const outcome = await planned.pair.stop(sessions, current.reason);
        if (outcome.ok) {
          port.log.info("desktop.quit.pair_stopped", "A daemon pair stopped for the quit", {
            attached: planned.pair.attached,
            sessions: sessions.length,
            attempt,
          });
          ended += sessions.length;
          break;
        }
        if (outcome.live === undefined || attempt >= MAX_STOP_ATTEMPTS) {
          port.log.warn(
            "desktop.quit.pair_left_running",
            "A daemon pair did not stop for the quit; it keeps running",
            { attached: planned.pair.attached, reason: outcome.reason, attempt },
          );
          complete = false;
          break;
        }
        // the re-check refused: the live set is not the consented one (a session was born after the census)
        if (current.reason === "logout") {
          sessions = outcome.live; // the person is leaving the Mac: end what is live now
          continue;
        }
        const census = await planned.pair.census();
        if (!census.known) {
          port.log.warn(
            "desktop.quit.pair_left_running",
            "A daemon pair's sessions changed during the quit and could not be read again; it keeps running",
            { attached: planned.pair.attached, attempt },
          );
          complete = false;
          break;
        }
        const answer = await port.confirm(
          quitConsentBox(census.sessions, { bornDuringQuit: true }),
        );
        if (!answer.confirmed) {
          port.release();
          port.log.info(
            "desktop.quit.aborted",
            "A session started during the quit and the person kept the app",
            { attached: planned.pair.attached, sessions: census.sessions.length },
          );
          return { kind: "aborted" };
        }
        sessions = census.sessions.map((s) => s.sessionId);
      }
    }
    return { kind: "done", complete, ended };
  }
}
