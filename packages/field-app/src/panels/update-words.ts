import {
  releaseName,
  UPDATES_SERVICE,
  type UpdateChannel,
  type UpdateCheckResult,
  type UpdateView,
} from "@vibefield/contracts";

// WP12d (L3c-ii; build-wp12-updater.md §13 C3) — the Settings update card's own words, in DESIGN.md §9's voice:
// sentence case, states told with their numbers and provenance ("checked 14:02"), errors that say what happened and
// what to do next. Main's sentences — the consent, a refusal, an expired snapshot — arrive on the wire with the answer
// that needs them and are never composed here, so the card and the tray's box cannot say different things.
// AU-3 (AU-L4, AU-L6) — the update's words for every surface the window draws: Settings → Updates and the Me menu's
// row (AU-2) read one state in the same words, and a version in a sentence is its friendly name (`releaseName`,
// contracts — the one main's boxes say too).
// AU-7 (AU-G8; LC-10, LC-40) — where the app runs: a copy macOS won't let replace itself says so on every surface,
// with Move to Applications… as its act; a writable copy outside Applications holds nothing.

/** The channels lowest first, as the segmented control lays them out (EDP-36: a lower one is a downgrade). */
export const UPDATE_CHANNEL_OPTIONS: readonly { id: UpdateChannel; label: string }[] = [
  { id: "stable", label: "Stable" },
  { id: "beta", label: "Beta" },
  { id: "nightly", label: "Nightly" },
];

/** AU-3 — the channel's word: the head's line under the version ("Nightly"), and the segmented control's labels. */
export function channelLabel(channel: UpdateChannel): string {
  return UPDATE_CHANNEL_OPTIONS.find((option) => option.id === channel)?.label ?? channel;
}

/** AU-3 — the Channel row's line, following the choice (DESIGN.md §8 "Settings → Updates"). */
export const UPDATE_CHANNEL_LINES: Readonly<Record<UpdateChannel, string>> = {
  stable: "Tested releases.",
  beta: "Early releases, mostly stable.",
  nightly: "Every night's build: the newest, and the least tested.",
};

/** AU-3 — the Automatic updates switch's line: when installs happen. Install on quit (AU-5) adds "or quit" to `on`
 * in a one-line commit once the physical W row proves it on the mini (LC-49); until then the sentence never promises
 * it. */
export const AUTOMATIC_UPDATES_LINES = {
  on: "Download updates in the background. They install when you restart VibeField, or on their own while no window is open and nothing would end.",
  off: "VibeField checks only when you choose Check for updates, and downloads only when you choose Download.",
} as const;

const RANK: Record<UpdateChannel, number> = { stable: 0, beta: 1, nightly: 2 };

/** A channel below the running build's own: choosing it reinstalls an older release (EDP-36). */
export function isDowngrade(channel: UpdateChannel, buildChannel: UpdateChannel): boolean {
  return RANK[channel] < RANK[buildChannel];
}

/** EDP-36's sentence, said before a lower channel takes — the downgrade is the person's deliberate act. */
export function downgradeWords(channel: UpdateChannel): {
  question: string;
  what: string;
  act: string;
} {
  return {
    question: `Switch to the ${channel} channel?`,
    what: `Return to ${channel} — reinstalls the latest ${channel} release.`,
    act: `Return to ${channel}`,
  };
}

const pad = (n: number): string => String(n).padStart(2, "0");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Two instants on one calendar day, in the person's own time zone. */
const sameDay = (a: number, b: number): boolean => {
  const left = new Date(a);
  const right = new Date(b);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
};

/** The freshness claim: when the last check ran, never implied fresh (DESIGN.md's updates flow). Today reads as the
 * clock alone; an older check names its day. */
export function checkedLabel(lastCheckAt: number | null, now: number): string {
  if (lastCheckAt === null) return "not checked yet";
  const at = new Date(lastCheckAt);
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (sameDay(lastCheckAt, now)) return `checked ${clock}`;
  return `checked ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${clock}`;
}

/** AU-3 (AU-L3) — a day in the update's words: "Oct 19", the person's own calendar day in fixed English months (the
 * voice is English, as `releaseName`'s nightly days are). */
export function shortDay(at: number): string {
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** AU-3 (AU-L6) — the version you are on, in friendly words: "You're on the Oct 28 nightly", "You're on VibeField
 * 0.2.0" (§9: one name everywhere). */
export function youAreOn(version: string): string {
  return `You're on ${releaseName(version)}`;
}

/** AU-7 (AU-G8; LC-10, LC-40, LC-41) — the location's words (DESIGN.md §8 "Settings → Updates", "The Me menu"). The
 * act wears "…": the Me row opens Settings → Updates, and the page's move may ask through the quit gate. */
export const LOCATION_WORDS = {
  headline: "VibeField can't update itself from here",
  detail:
    "macOS won't let VibeField replace itself where it is. Move it to Applications and it updates as usual.",
  elsewhere: "VibeField runs outside Applications",
  move: "Move to Applications…",
  moving: "Moving VibeField to Applications…",
  /** the Me row's line 2 (R5), in the attention ink */
  row: "Can't update from here",
} as const;

/** AU-7 (AU-G8; LC-10) — a copy macOS won't let replace itself (App Translocation, a mounted disk image, a folder it
 * can't write): the one hold that changes the act, on the page and the Me row alike. Only motion outranks it — a
 * person's check from the status item runs (nothing it finds downloads). */
export function cannotUpdateHere(view: UpdateView | null | undefined): boolean {
  return (
    view?.location === "read-only" && view.phase !== "checking" && view.phase !== "downloading"
  );
}

/** AU-3 (AU-L1; AU-D1 A, AU-D2 A) — an install waits on you: an update ready and its apply wired, including one that
 * would end sessions. The face's dot, the Updates nav row's dot and the page's ready line all read THIS; never a
 * check, a download or a held state. AU-7: never a copy that can't replace itself (its Restart refuses). */
export function updateWaits(view: UpdateView | null | undefined): boolean {
  return view?.phase === "staged" && view.applyWired && view.location !== "read-only";
}

/** AU-3 (AU-L2) — Restart to update asks first ("…"): it ends sessions, or must read them before it can (the census
 * unknown, or not read yet). A release that leaves the floor alone, or ends nothing, restarts on the one click. */
export function restartAsks(view: UpdateView): boolean {
  if (view.keepsSessions === true) return false;
  const sessions = view.sessions;
  return sessions === undefined || sessions === "unknown" || sessions > 0;
}

/** AU-3 (AU-D3 A) — time grows the words, never the mark: from a ready update's 7th day. */
export const READY_SINCE_DAYS = 7;

/** "Ready since Oct 19" once a staged update has waited `READY_SINCE_DAYS` (by `stagedAt`, the day it FIRST became
 * ready on this Mac), else null. The page leads its cost with it; the Me row says it as its third line (AU-2). */
export function readySince(view: UpdateView | null | undefined, now: number): string | null {
  if (view?.phase !== "staged" || view.stagedAt === undefined) return null;
  // AU-7 — never under a copy that can't install it: the move is the news
  if (cannotUpdateHere(view)) return null;
  return now - view.stagedAt >= READY_SINCE_DAYS * DAY_MS
    ? `Ready since ${shortDay(view.stagedAt)}`
    : null;
}

/** AU-3 (AU-D11 A) — an install that took, for a day from the first launch that ran it (`lastApply.at`): "today",
 * then "yesterday" once the date turns. */
export interface RecentInstall {
  readonly day: "today" | "yesterday";
  readonly version: string;
  /** the version it left; absent when an older app wrote the record */
  readonly from?: string;
}

export function recentInstall(
  view: UpdateView | null | undefined,
  now: number,
): RecentInstall | null {
  const last = view?.lastApply;
  if (view?.phase !== "idle" || last === undefined || last.outcome !== "installed") return null;
  const age = now - last.at;
  if (age < 0 || age >= DAY_MS) return null;
  return {
    day: sameDay(last.at, now) ? "today" : "yesterday",
    version: last.version,
    ...(last.from !== undefined ? { from: last.from } : {}),
  };
}

// ── AU-2 (the corner, DESIGN.md §8 "The Me menu") reads these: the row's own flow, its acts and its shape. They land
// with the page (LC-30: the page is the window's first AU slice), so the row is built on the words the page says. ──

/** The row's flow inside one open of the menu; the next open reads the resting row again. `checking`: a check started
 * from this row, in this open; `answered`: that check came back (LC-5: when the CHECK settles) and the view says what
 * it found; `unreachable`: `check()` rejected, the bridge failed; `requested`: Download asked, not yet downloading. */
export type MeUpdateLocal =
  | { readonly kind: "rest" }
  | { readonly kind: "checking" }
  | { readonly kind: "answered"; readonly outcome: UpdateCheckResult["outcome"] }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "preparing" }
  | { readonly kind: "confirming" }
  | { readonly kind: "restarting" }
  | { readonly kind: "requested" };

/** What a click on the row does: `open` folds the menu and opens Settings → Updates; `none` is `aria-disabled`. */
export type MeUpdateAct = "check" | "restart" | "ask" | "download" | "open" | "none";

/** The update row as the menu draws it: plain data, so the catalog builds it with the shipping words. */
export interface MeUpdateRow {
  readonly glyph: "reset" | "arrow" | "check";
  /** 180: `arrow` turned down, a download (§13) */
  readonly turn: 0 | 180;
  /** line 1, the act (13/500) */
  readonly label: string;
  readonly labelTone?: "attention" | "danger";
  /** line 2, the act's line (11.5/400, tertiary unless an ink is named) */
  readonly detail: string;
  readonly detailTone?: "attention" | "danger" | "quiet";
  /** line 3: the publisher's floor or the ready day, one at most (AU-D3) */
  readonly note?: { readonly text: string; readonly tone?: "attention" };
  /** 0–100: the 2px bar, on real progress only */
  readonly progress?: number;
  /** the 6px cyan end dot, only while the face wears the mark */
  readonly dot: boolean;
  readonly act: MeUpdateAct;
}

const sessionsNoun = (n: number): string => (n === 1 ? "terminal session" : "terminal sessions");

/** AU-3 (LC-31) — the check found no release on the chosen channel (`channel-unresolved`): nothing is published there
 * yet, which is no failure — quiet on every surface, never the danger line. */
export function channelUnresolved(view: UpdateView): boolean {
  return view.phase === "failed" && view.unavailable === UPDATES_SERVICE.STATE_CHANNEL_UNRESOLVED;
}

export interface UpdateStateWords {
  headline: string;
  /** absent (or undefined) when the headline says it all */
  detail?: string | undefined;
  /** `attention` for the policy's own answers (paused, an OS below the floor); `error` for a check that failed;
   * `quiet` for a channel with nothing published yet (LC-31: no failure, the tertiary ink) */
  tone: "neutral" | "attention" | "error" | "quiet";
}

/** The page's state line: what the updater is doing, in words, with its number. `now` is the clock the ready day and
 * a recent install are read against. */
export function updateStateWords(view: UpdateView, now: number): UpdateStateWords {
  // AU-7 (LC-40) — the copy can't replace itself: every resting state says so, in the attention ink
  if (cannotUpdateHere(view))
    return { headline: LOCATION_WORDS.headline, detail: LOCATION_WORDS.detail, tone: "attention" };
  const version = view.version ?? "";
  switch (view.phase) {
    case "checking":
      return { headline: "Checking for updates…", tone: "neutral" };
    case "available":
      // AU-3 (AU-G6) — a skip is the person's own act, said as theirs; (AU-G5) with updates off a found update waits
      // for Download
      if (view.declined === true)
        return {
          headline: `You skipped ${releaseName(version)}`,
          detail: "The next one downloads on its own.",
          tone: "neutral",
        };
      return {
        headline: `${releaseName(version, { start: true })} is available`,
        detail: !view.enabled ? "Automatic updates are off, so it waits for you." : undefined,
        tone: "neutral",
      };
    case "downloading":
      return {
        headline: `Downloading ${releaseName(version)} · ${Math.round(view.percent ?? 0)}%`,
        // AU-3 (LC-45) — when it installs, by the switch: on, it becomes "…when you restart or quit VibeField." in
        // LC-49's one-line commit, once the physical W row proves install on quit (AU-5); until then both say the restart
        detail: "It installs when you restart VibeField.",
        tone: "neutral",
      };
    case "staged": {
      if (!view.applyWired)
        return {
          headline: `${releaseName(version, { start: true })} is downloaded`,
          detail: "Installing it from here comes with a later release on this platform.",
          tone: "neutral",
        };
      const sessions = view.sessions;
      const cost =
        view.keepsSessions === true
          ? "Your terminal sessions keep running."
          : sessions === "unknown"
            ? "VibeField couldn't read which terminal sessions are running; it asks again when you restart."
            : typeof sessions === "number" && sessions > 0
              ? `Restarting ends ${sessions} ${sessionsNoun(sessions)}. You choose when.`
              : undefined;
      // AU-3 (AU-D3 A) — from the 7th day the ready day leads the cost; the mark never changes
      const since = readySince(view, now);
      return {
        headline: `${releaseName(version, { start: true })} is ready — restart to finish updating`,
        detail: since === null ? cost : cost === undefined ? `${since}.` : `${since}. ${cost}`,
        tone: "neutral",
      };
    }
    case "paused":
      return {
        headline: "Updates are paused by VibeField's publisher",
        detail: "Your current version keeps running.",
        tone: "attention",
      };
    case "unsupported":
      return {
        headline: "This update needs a newer macOS",
        detail: "Your current version keeps running.",
        tone: "attention",
      };
    case "offline":
      return {
        headline: "Couldn't check — offline",
        detail: "VibeField tries again on its own.",
        tone: "neutral",
      };
    case "failed":
      // AU-3 (LC-31) — a channel with nothing published is no failure: quiet, never the danger line
      if (channelUnresolved(view))
        return { headline: `No ${view.channel} release yet`, tone: "quiet" };
      return {
        headline: "Couldn't check for updates",
        detail: `Updates are unavailable (${view.unavailable ?? "failed"}). Check again, or see Diagnostics for the details.`,
        tone: "error",
      };
    default: {
      if (!view.enabled)
        return {
          headline: "Automatic updates are off",
          detail: "VibeField checks only when you choose Check for updates.",
          tone: "neutral",
        };
      // AU-3 (AU-D11 A) — for a day after an update, where it came from
      const recent = recentInstall(view, now);
      return {
        headline: "VibeField is up to date",
        detail:
          recent === null
            ? undefined
            : recent.from === undefined
              ? `Updated ${recent.day}.`
              : `Updated ${recent.day} from ${releaseName(recent.from)}.`,
        tone: "neutral",
      };
    }
  }
}

/** AU-3 (AU-G7; LC-34) — the page's notice for an install that didn't take, said on the launch right after it only
 * (`lastApply.thisLaunch`), and never while ANOTHER version is ready (a newer staged update is the news then).
 * `ready`: the same version is staged again, so it can be tried again; otherwise the page offers Check for updates.
 * AU-5 — after install on quit (`trigger: "quit"`) it leads "The last quit…" (DESIGN.md §8). The Me menu says it its
 * own way (AU-2). */
export function notAppliedWords(
  view: UpdateView | null | undefined,
): { readonly text: string; readonly ready: boolean } | null {
  if (view === null || view === undefined) return null;
  const last = view.lastApply;
  if (last === undefined || last.outcome !== "not-applied" || last.thisLaunch !== true) return null;
  const staged = view.phase === "staged";
  if (staged && view.version !== last.version) return null;
  const which = last.trigger === "quit" ? "quit" : "restart";
  const lead = `The last ${which} didn't install ${releaseName(last.version)}.`;
  // the version it came back on: the one the apply left, else the one running now (the same app)
  const back = last.from ?? view.currentVersion;
  if (back === undefined)
    return { text: staged ? `${lead} The update is ready to try again.` : lead, ready: staged };
  const cameBack = `VibeField came back on ${releaseName(back)}`;
  return {
    text: staged
      ? `${lead} ${cameBack}, and the update is ready to try again.`
      : `${lead} ${cameBack}.`,
    ready: staged,
  };
}

/** The advisory UNSUPPORTED line (EDP §11.6): the running version is older than the oldest the publisher supports.
 * Never a block — a sentence. */
export function unsupportedBelowWords(minSupported: string): string {
  return `This version of VibeField is older than the oldest one its publisher supports (${minSupported}). Update when you can.`;
}

/** A refusal that came back with no words of main's: only a race reaches it (the button shows while staged, wired and
 * on), so it says what happened plainly and names the reason for Diagnostics. */
export function refusalFallback(reason: string): { message: string; detail: string } {
  return reason === "quit-underway"
    ? {
        message: "VibeField is already restarting",
        detail: "It finishes the update it started; nothing else changed.",
      }
    : { message: "VibeField didn't install the update", detail: `Nothing changed (${reason}).` };
}

/** AU-7 (AU-G8) — a Move main refused without words of its own (it sends none: a refusal comes before the quit gate
 * asks anything): the step that didn't happen, then why. */
export function moveRefusalFallback(reason: string): { message: string; detail: string } {
  const message = "VibeField didn't move to Applications";
  if (reason === "not-needed") return { message, detail: "It already runs from Applications." };
  if (reason === "busy") return { message, detail: "VibeField is already quitting or updating." };
  return { message, detail: `Nothing changed (${reason}).` };
}

/** AU-3 (LC-38) — a Download main refused without words of its own: the step that didn't happen, then why. Main's
 * words win whenever it sends them (a lever, a read-only location). */
export function downloadRefusalFallback(reason: string): { message: string; detail: string } {
  const message = "VibeField didn't download the update";
  if (reason === "not-available")
    return { message, detail: "That version is no longer available." };
  if (reason === "busy") return { message, detail: "VibeField is busy with another update step." };
  return { message, detail: `Nothing changed (${reason}).` };
}

// ── AU-2 (the corner; DESIGN.md §8 "The Me menu", AU-D4 B) — the row the menu always carries, nearest the face. One
// state, the same verbs as the page (AU-L4): the row's line 2 is tertiary unless an ink is named (LC-43), a failed
// check is the danger ink, the policy's holds the attention ink, offline and a channel with nothing published quiet
// (LC-3, LC-31). An act wears "…" only when it asks first (LC-41): Check for updates checks in place and wears none. ──

/** A refusal main said (a prepare, a confirm or a Download it would not do), as one line at the menu's top. */
export function refusalLine(words: { readonly message: string; readonly detail: string }): string {
  return `${words.message}. ${words.detail}`;
}

/** The row without its third line and its end dot: what the phase and the click say. */
type MeUpdateRowBody = Omit<MeUpdateRow, "note" | "dot">;

const CHECK_FOR_UPDATES = "Check for updates";
const SETTINGS_HAS_MORE = "Settings → Updates has more";
const KEEPS_RUNNING = "Your version keeps running";

const capitalised = (words: string): string => words.charAt(0).toUpperCase() + words.slice(1);

/** The resting check row, its line 2 in the hold's ink when it names one. */
const checkRow = (detail: string, detailTone?: MeUpdateRow["detailTone"]): MeUpdateRowBody => ({
  glyph: "reset",
  turn: 0,
  label: CHECK_FOR_UPDATES,
  detail,
  ...(detailTone !== undefined ? { detailTone } : {}),
  act: "check",
});

/** R2 and R3's line: the version you are on in friendly words — or, from a main that names none, when the last check
 * ran ("Checked 14:02") — and with automatic updates off, that they are. */
function idleLine(view: UpdateView, now: number): string {
  if (!view.enabled) return "Automatic updates are off";
  return view.currentVersion !== undefined
    ? youAreOn(view.currentVersion)
    : capitalised(checkedLabel(view.lastCheckAt, now));
}

/** The row at rest, read from the view alone (R2–R18). */
function restingRow(view: UpdateView, now: number): MeUpdateRowBody {
  // R5 (AU-7, LC-10) — the one hold that changes the act: it opens Settings → Updates, where the move is
  if (cannotUpdateHere(view))
    return {
      glyph: "reset",
      turn: 0,
      label: LOCATION_WORDS.move,
      detail: LOCATION_WORDS.row,
      detailTone: "attention",
      act: "open",
    };
  switch (view.phase) {
    case "checking":
      // R6 — a check that began elsewhere reads the same while it runs
      return {
        glyph: "reset",
        turn: 0,
        label: "Checking for updates…",
        detail: idleLine(view, now),
        act: "none",
      };
    case "downloading": {
      // R7 — a bar on real progress only; the page has the rest
      const percent = Math.round(view.percent ?? 0);
      return {
        glyph: "arrow",
        turn: 180,
        label: "Downloading update",
        detail: `${percent}% downloaded`,
        progress: percent,
        act: "open",
      };
    }
    case "staged": {
      // R11 — downloaded where the apply isn't wired yet (Windows, Linux)
      if (!view.applyWired)
        return {
          glyph: "arrow",
          turn: 180,
          label: "Update downloaded",
          detail: "Installs with a later release",
          act: "open",
        };
      // R8 — nothing ends, so nothing asks: the one click restarts
      if (!restartAsks(view))
        return {
          glyph: "reset",
          turn: 0,
          label: "Restart to update",
          detail: "Your sessions keep running",
          act: "restart",
        };
      // R9, R10 — the cost before the click (AU-L2), or the census main reads first
      const sessions = view.sessions;
      return {
        glyph: "reset",
        turn: 0,
        label: "Restart to update…",
        detail:
          typeof sessions === "number"
            ? `Ends ${sessions} ${sessionsNoun(sessions)}`
            : "Checks your sessions first",
        act: "ask",
      };
    }
    case "available": {
      // R13 — a skip is the person's own act, said as theirs
      const name = releaseName(view.version ?? "");
      if (view.declined === true) return checkRow(`You skipped ${name}`);
      // R12 (AU-G5) — with automatic updates off, a found update waits for Download, in place (LC-6)
      if (!view.enabled)
        return {
          glyph: "arrow",
          turn: 180,
          label: "Download update",
          detail: "Automatic updates are off",
          act: "download",
        };
      // R14 — found and held by a lever (yanked), or between two views
      return checkRow(idleLine(view, now));
    }
    case "paused":
      return checkRow("Paused by the publisher", "attention");
    case "unsupported":
      return checkRow("The update needs a newer macOS", "attention");
    case "offline":
      return checkRow("Couldn't check — offline", "quiet");
    case "failed":
      // LC-31 — a channel with nothing published is no failure: quiet, never the danger line
      if (channelUnresolved(view)) return checkRow(`No ${view.channel} release yet`, "quiet");
      return checkRow("The last check failed", "danger");
    default: {
      // idle — R4 (AU-D11, LC-7): for a day from the first launch that ran it, the no-notes form (AU-6
      // adds "What's new"); "You're on …" when an older app's record names no version it came from
      const recent = recentInstall(view, now);
      if (recent !== null) {
        const from = recent.from;
        return {
          glyph: "check",
          turn: 0,
          label: `Updated ${recent.day}`,
          detail: from !== undefined ? `From ${releaseName(from)}` : youAreOn(recent.version),
          act: "open",
        };
      }
      // R2, R3
      return checkRow(idleLine(view, now));
    }
  }
}

/** P1 — the row's own check while it runs: dimmed, its line unchanged. */
const checkingRow = (rest: MeUpdateRowBody): MeUpdateRowBody => ({
  glyph: "reset",
  turn: 0,
  label: "Checking for updates…",
  detail: rest.detail,
  ...(rest.detailTone !== undefined ? { detailTone: rest.detailTone } : {}),
  act: "none",
});

/** P2–P8 — the row's check came back (when the CHECK settled, LC-5) and the view says what it found: resolved where
 * it stands. "VibeField is up to date" only for THIS row's up-to-date answer while the view is idle — never for a held
 * one. */
function answeredRow(
  view: UpdateView,
  outcome: UpdateCheckResult["outcome"],
  rest: MeUpdateRowBody,
): MeUpdateRowBody {
  switch (view.phase) {
    case "checking":
      // P1 — the answer came before the view that says the check runs
      return checkingRow(rest);
    case "idle":
      // P2 — inert until the menu folds; the next open reads the resting row again
      return outcome === "up-to-date"
        ? {
            glyph: "reset",
            turn: 0,
            label: "VibeField is up to date",
            detail: rest.detail,
            act: "none",
          }
        : rest;
    case "available": {
      // P3 — the Download row in place (off), or the lever's hold
      if (view.declined !== true) return rest;
      // P4 — the hold said in line 1; the page has Download anyway
      const name = releaseName(view.version ?? "");
      return {
        glyph: "reset",
        turn: 0,
        label: `You skipped ${name}`,
        detail: "Download it from Settings",
        act: "open",
      };
    }
    case "downloading":
    case "staged":
      // P3 — the download or the ready row, in place
      return rest;
    case "offline":
      // P5
      return {
        glyph: "reset",
        turn: 0,
        label: "Couldn't check — offline",
        detail: "VibeField tries again on its own",
        act: "none",
      };
    case "failed":
      // LC-31 — a check that finds nothing published answers as the held row does
      if (channelUnresolved(view)) return rest;
      // P6
      return {
        glyph: "reset",
        turn: 0,
        label: "Couldn't check for updates",
        labelTone: "danger",
        detail: SETTINGS_HAS_MORE,
        act: "open",
      };
    case "paused":
      // P7
      return {
        glyph: "reset",
        turn: 0,
        label: "Updates are paused",
        labelTone: "attention",
        detail: KEEPS_RUNNING,
        act: "none",
      };
    case "unsupported":
      // P8
      return {
        glyph: "reset",
        turn: 0,
        label: "Needs a newer macOS",
        labelTone: "attention",
        detail: KEEPS_RUNNING,
        act: "none",
      };
  }
}

/** The row in place: the resting row, or what this open's click has made of it (P1–P14). */
function inPlaceRow(
  view: UpdateView,
  local: MeUpdateLocal,
  rest: MeUpdateRowBody,
): MeUpdateRowBody {
  switch (local.kind) {
    case "rest":
      return rest;
    case "checking":
      // P1 — until the answer, unless the view already moved on to a download (the news on its own)
      return view.phase === "downloading" || view.phase === "staged" ? rest : checkingRow(rest);
    case "answered":
      return answeredRow(view, local.outcome, rest);
    case "unreachable":
      // P9 — the door itself failed
      return {
        glyph: "reset",
        turn: 0,
        label: "Couldn't reach the updater",
        labelTone: "danger",
        detail: SETTINGS_HAS_MORE,
        act: "open",
      };
    case "preparing":
      // P10 — main reads the sessions; line 1 unchanged, dimmed
      if (view.phase !== "staged") return rest;
      return {
        glyph: rest.glyph,
        turn: rest.turn,
        label: rest.label,
        detail: "Reading the running sessions…",
        act: "none",
      };
    case "confirming":
      // P12 — a restart that asked nothing, starting (one that asked keeps its question, busy)
      if (view.phase !== "staged") return rest;
      return {
        glyph: "reset",
        turn: 0,
        label: "Restart to update",
        detail: "Starting the update…",
        act: "none",
      };
    case "restarting":
      // P13
      return {
        glyph: "reset",
        turn: 0,
        label: "Restarting…",
        detail: "VibeField opens again",
        act: "none",
      };
    case "requested":
      // P14 — Download asked; the view says downloading next, and the row is R7 by the view alone
      if (view.phase !== "available") return rest;
      return {
        glyph: "arrow",
        turn: 180,
        label: "Download update",
        detail: "Starting the download…",
        act: "none",
      };
  }
}

/** Line 3 (AU-D3): the publisher's floor, else the ready day from its 7th — one at most; it never changes the mark. */
function noteOf(view: UpdateView, now: number): NonNullable<MeUpdateRow["note"]> | null {
  if (view.unsupportedBelow !== undefined)
    return { text: "Your version is unsupported", tone: "attention" };
  const since = readySince(view, now);
  return since === null ? null : { text: since };
}

/** AU-2 (AU-D4 B) — the Me menu's update row: `view` null where no updater runs (a development build, a browser
 * harness), `local` the row's flow inside this open, `now` the clock the ready day and a recent install are read
 * against. */
export function meUpdateRow({
  view,
  local,
  now,
}: {
  view: UpdateView | null;
  local: MeUpdateLocal;
  now: number;
}): MeUpdateRow {
  // R1 (LC-4) — the row still stands, dimmed, and names no version: this build can't act on it
  if (view === null)
    return {
      glyph: "reset",
      turn: 0,
      label: CHECK_FOR_UPDATES,
      detail: "This build doesn't update itself",
      dot: false,
      act: "none",
    };
  const body = inPlaceRow(view, local, restingRow(view, now));
  const note = noteOf(view, now);
  return {
    ...body,
    ...(note !== null ? { note } : {}),
    // the 6px end dot ties the row to the face's: only while the face wears it
    dot: updateWaits(view) && local.kind !== "restarting",
  };
}

/** AU-2 (AU-D1) — the face's title clause while it wears the dot: "the Oct 28 nightly is ready", else null. */
export function readyClause(view: UpdateView | null | undefined): string | null {
  if (!updateWaits(view) || view?.version === undefined) return null;
  return `${releaseName(view.version)} is ready`;
}

/** AU-2 (AU-G7; LC-8) — the Me menu's notice for an install that didn't take, said on the launch that judged it
 * (`lastApply.thisLaunch`), once per window (the controller holds the once). The row is the ready row again when the
 * same version is staged; never while ANOTHER version is ready (the newer one is the news, as on the page, LC-34). */
export function notAppliedNotice(view: UpdateView | null | undefined): string | null {
  if (view === null || view === undefined) return null;
  const last = view.lastApply;
  if (last === undefined || last.outcome !== "not-applied" || last.thisLaunch !== true) return null;
  const staged = view.phase === "staged";
  if (staged && view.version !== last.version) return null;
  // the quit's words are AU-5's install on quit; the trigger is AU-1's, so a record that says quit is said truly
  const when = last.trigger === "quit" ? "quit" : "restarted";
  const name = releaseName(last.version, { start: true });
  const lead = `${name} didn't install when VibeField ${when}.`;
  return staged
    ? `${lead} It's ready to try again.`
    : `${lead} Settings → Updates has the details.`;
}
