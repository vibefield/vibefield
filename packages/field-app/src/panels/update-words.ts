import type { UpdateChannel, UpdateView } from "@vibefield/contracts";

// WP12d (L3c-ii; build-wp12-updater.md §13 C3) — the Settings update card's own words, in DESIGN.md §9's voice:
// sentence case, states told with their numbers and provenance ("checked 14:02"), errors that say what happened and
// what to do next. Main's sentences — the consent, a refusal, an expired snapshot — arrive on the wire with the answer
// that needs them and are never composed here, so the card and the tray's box cannot say different things.

/** The channels lowest first, as the segmented control lays them out (EDP-36: a lower one is a downgrade). */
export const UPDATE_CHANNEL_OPTIONS: readonly { id: UpdateChannel; label: string }[] = [
  { id: "stable", label: "Stable" },
  { id: "beta", label: "Beta" },
  { id: "nightly", label: "Nightly" },
];

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

/** The freshness claim: when the last check ran, never implied fresh (DESIGN.md's updates flow). Today reads as the
 * clock alone; an older check names its day. */
export function checkedLabel(lastCheckAt: number | null, now: number): string {
  if (lastCheckAt === null) return "not checked yet";
  const at = new Date(lastCheckAt);
  const today = new Date(now);
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  if (sameDay) return `checked ${clock}`;
  return `checked ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${clock}`;
}

const sessionsNoun = (n: number): string => (n === 1 ? "terminal session" : "terminal sessions");

export interface UpdateStateWords {
  headline: string;
  /** absent (or undefined) when the headline says it all */
  detail?: string | undefined;
  /** `attention` for the policy's own answers (paused, an OS below the floor); `error` for a check that failed */
  tone: "neutral" | "attention" | "error";
}

/** The card's state line: what the updater is doing, in words, with its number. */
export function updateStateWords(view: UpdateView): UpdateStateWords {
  const version = view.version ?? "";
  switch (view.phase) {
    case "checking":
      return { headline: "Checking for updates…", tone: "neutral" };
    case "available":
      return {
        headline: `VibeField ${version} is available`,
        detail:
          view.declined === true
            ? "You skipped this version. The next one downloads on its own."
            : !view.enabled
              ? "Automatic updates are off, so VibeField didn't download it. Turn them on to download it."
              : undefined,
        tone: "neutral",
      };
    case "downloading":
      return {
        headline: `Downloading VibeField ${version} · ${Math.round(view.percent ?? 0)}%`,
        tone: "neutral",
      };
    case "staged": {
      if (!view.applyWired)
        return {
          headline: `VibeField ${version} is downloaded`,
          detail: "Installing it from here comes with a later release on this platform.",
          tone: "neutral",
        };
      const sessions = view.sessions;
      return {
        headline: `VibeField ${version} is ready — restart to finish updating`,
        detail:
          view.keepsSessions === true
            ? "Your terminal sessions keep running."
            : sessions === "unknown"
              ? "VibeField couldn't read which terminal sessions are running; it asks again when you restart."
              : typeof sessions === "number" && sessions > 0
                ? `Restarting ends ${sessions} ${sessionsNoun(sessions)}. You choose when.`
                : undefined,
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
      return {
        headline: "Couldn't check for updates",
        detail: `Updates are unavailable (${view.unavailable ?? "failed"}). Check again, or see Diagnostics for the details.`,
        tone: "error",
      };
    default:
      return view.enabled
        ? { headline: "VibeField is up to date", tone: "neutral" }
        : {
            headline: "Automatic updates are off",
            detail: "VibeField checks only when you choose Check for updates.",
            tone: "neutral",
          };
  }
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
