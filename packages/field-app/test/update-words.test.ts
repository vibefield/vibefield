import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UpdateView } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_UPDATES_LINES,
  channelLabel,
  channelUnresolved,
  checkedLabel,
  downgradeWords,
  downloadRefusalFallback,
  isDowngrade,
  notAppliedWords,
  READY_SINCE_DAYS,
  readySince,
  recentInstall,
  refusalFallback,
  restartAsks,
  shortDay,
  UPDATE_CHANNEL_LINES,
  UPDATE_CHANNEL_OPTIONS,
  updateStateWords,
  updateWaits,
  youAreOn,
} from "../src/panels/update-words";

// WP12d (L3c-ii; build-wp12-updater.md §13 C3) — the update card's own words, pinned to DESIGN.md §9: sentence case,
// states with their numbers and provenance, errors that say what happened and what to do next, no apology.
// AU-3 — the page's words: a version in a sentence is its friendly name, a skip is the person's own act, the ready
// day grows the words from the 7th day, an install that took is said for a day, one that didn't on its launch only.

/** The contracts' own projections (AU-1's fixtures), read through the schema main writes them by. */
const viewFixture = (name: string): UpdateView =>
  UpdateView.parse(
    JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), `../../contracts/fixtures/${name}.json`),
        "utf8",
      ),
    ),
  );

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** The clock the state line is read against where no day is in question. */
const NOW = new Date(2026, 9, 15, 14, 20).getTime();

const BASE: UpdateView = {
  phase: "idle",
  channel: "stable",
  buildChannel: "stable",
  enabled: true,
  lastCheckAt: null,
  applyWired: true,
};
const APOLOGY = /\b(sorry|unfortunately|oops|please|apolog)/i;

describe("the card's state line", () => {
  it.each([
    [{ phase: "idle" }, "VibeField is up to date", undefined],
    [
      { phase: "idle", enabled: false },
      "Automatic updates are off",
      "VibeField checks only when you choose Check for updates.",
    ],
    [{ phase: "checking" }, "Checking for updates…", undefined],
    // AU-3 (AU-G6) — a skip is the person's own act, said as theirs
    [
      { phase: "available", version: "1.2.0", declined: true },
      "You skipped VibeField 1.2.0",
      "The next one downloads on its own.",
    ],
    // AU-3 (AU-G5) — with updates off, a found update waits for Download
    [
      { phase: "available", version: "1.2.0", enabled: false },
      "VibeField 1.2.0 is available",
      "Automatic updates are off, so it waits for you.",
    ],
    [{ phase: "available", version: "1.2.0" }, "VibeField 1.2.0 is available", undefined],
    // AU-3 (LC-45) — when it installs: the restart, until install on quit lands (AU-5)
    [
      { phase: "downloading", version: "1.2.0", percent: 41.6 },
      "Downloading VibeField 1.2.0 · 42%",
      "It installs when you restart VibeField.",
    ],
    [
      { phase: "staged", version: "1.2.0", sessions: 0 },
      "VibeField 1.2.0 is ready — restart to finish updating",
      undefined,
    ],
    [
      { phase: "staged", version: "1.2.0", sessions: 3 },
      "VibeField 1.2.0 is ready — restart to finish updating",
      "Restarting ends 3 terminal sessions. You choose when.",
    ],
    [
      { phase: "staged", version: "1.2.0", sessions: 1 },
      "VibeField 1.2.0 is ready — restart to finish updating",
      "Restarting ends 1 terminal session. You choose when.",
    ],
    [
      { phase: "staged", version: "1.2.0", sessions: 3, keepsSessions: true },
      "VibeField 1.2.0 is ready — restart to finish updating",
      "Your terminal sessions keep running.",
    ],
    [
      { phase: "staged", version: "1.2.0", sessions: "unknown" },
      "VibeField 1.2.0 is ready — restart to finish updating",
      "VibeField couldn't read which terminal sessions are running; it asks again when you restart.",
    ],
    [
      { phase: "staged", version: "1.2.0", applyWired: false },
      "VibeField 1.2.0 is downloaded",
      "Installing it from here comes with a later release on this platform.",
    ],
    [
      { phase: "paused" },
      "Updates are paused by VibeField's publisher",
      "Your current version keeps running.",
    ],
    [
      { phase: "unsupported" },
      "This update needs a newer macOS",
      "Your current version keeps running.",
    ],
    [{ phase: "offline" }, "Couldn't check — offline", "VibeField tries again on its own."],
    [
      { phase: "failed", unavailable: "feed-unverified" },
      "Couldn't check for updates",
      "Updates are unavailable (feed-unverified). Check again, or see Diagnostics for the details.",
    ],
  ] as const)("%o", (view, headline, detail) => {
    const words = updateStateWords({ ...BASE, ...view }, NOW);
    expect(words.headline).toBe(headline);
    expect(words.detail).toBe(detail);
    for (const said of [words.headline, words.detail ?? ""]) expect(said).not.toMatch(APOLOGY);
  });

  it("tones the policy's answers as attention and a failed check as an error — never offline, which retries", () => {
    expect(updateStateWords({ ...BASE, phase: "paused" }, NOW).tone).toBe("attention");
    expect(updateStateWords({ ...BASE, phase: "unsupported" }, NOW).tone).toBe("attention");
    expect(updateStateWords({ ...BASE, phase: "failed" }, NOW).tone).toBe("error");
    expect(updateStateWords({ ...BASE, phase: "offline" }, NOW).tone).toBe("neutral");
  });

  it("says a version by its friendly name: a nightly by its day, a beta by its number (AU-L6)", () => {
    const nightly = "0.1.0-nightly.20261028";
    const headline = (view: Partial<UpdateView>): string =>
      updateStateWords({ ...BASE, ...view }, NOW).headline;
    expect(headline({ phase: "staged", version: nightly, sessions: 0 })).toBe(
      "The Oct 28 nightly is ready — restart to finish updating",
    );
    expect(headline({ phase: "downloading", version: nightly, percent: 7 })).toBe(
      "Downloading the Oct 28 nightly · 7%",
    );
    expect(headline({ phase: "available", version: "0.2.0-beta.3" })).toBe(
      "VibeField 0.2.0 beta 3 is available",
    );
    expect(youAreOn(nightly)).toBe("You're on the Oct 28 nightly");
    expect(youAreOn("0.2.0")).toBe("You're on VibeField 0.2.0");
  });

  it("says a channel with nothing published quietly — no failure, never the danger line (LC-31)", () => {
    const view: UpdateView = {
      ...BASE,
      channel: "beta",
      phase: "failed",
      unavailable: "channel-unresolved",
    };
    expect(channelUnresolved(view)).toBe(true);
    expect(updateStateWords(view, NOW)).toEqual({ headline: "No beta release yet", tone: "quiet" });
    expect(channelUnresolved({ ...view, unavailable: "feed-unverified" })).toBe(false);
  });
});

describe("the ready update — the dot's one reading, and the words time grows (AU-D1…D3)", () => {
  it("waits on you only while an update is ready and its apply wired", () => {
    const staged: UpdateView = { ...BASE, phase: "staged", version: "1.2.0" };
    expect(updateWaits(staged)).toBe(true);
    expect(updateWaits({ ...staged, applyWired: false })).toBe(false);
    expect(updateWaits({ ...staged, phase: "downloading" })).toBe(false);
    expect(updateWaits({ ...staged, phase: "available" })).toBe(false);
    expect(updateWaits(null)).toBe(false);
    expect(updateWaits(undefined)).toBe(false);
  });

  it('asks first ("…") when the restart ends sessions or must read them first', () => {
    const staged: UpdateView = { ...BASE, phase: "staged", version: "1.2.0" };
    expect(restartAsks({ ...staged, sessions: 2 })).toBe(true);
    expect(restartAsks({ ...staged, sessions: "unknown" })).toBe(true);
    expect(restartAsks(staged)).toBe(true);
    expect(restartAsks({ ...staged, sessions: 0 })).toBe(false);
    expect(restartAsks({ ...staged, sessions: 4, keepsSessions: true })).toBe(false);
  });

  it("names the ready day from the 7th day, and leads the cost with it", () => {
    const view = viewFixture("update-view.staged-since");
    const stagedAt = view.stagedAt ?? 0;
    const day = shortDay(stagedAt);
    expect(readySince(view, stagedAt + (READY_SINCE_DAYS - 1) * DAY)).toBeNull();
    expect(readySince(view, stagedAt + READY_SINCE_DAYS * DAY)).toBe(`Ready since ${day}`);
    expect(updateStateWords(view, stagedAt + 9 * DAY).detail).toBe(
      `Ready since ${day}. Restarting ends 3 terminal sessions. You choose when.`,
    );
    expect(updateStateWords(view, stagedAt + DAY).detail).toBe(
      "Restarting ends 3 terminal sessions. You choose when.",
    );
    expect(shortDay(new Date(2026, 9, 19, 12).getTime())).toBe("Oct 19");
  });
});

describe("the install, after it — for a day when it took, on its launch when it didn't (AU-D11, AU-G7)", () => {
  it("says where an install came from for a day, today then yesterday", () => {
    const view = viewFixture("update-view.updated");
    const at = view.lastApply?.at ?? 0;
    expect(recentInstall(view, at + 30 * 60 * 1000)).toEqual({
      day: "today",
      version: "0.1.0-nightly.20261028",
      from: "0.1.0-nightly.20261027",
    });
    expect(updateStateWords(view, at + 30 * 60 * 1000).detail).toBe(
      "Updated today from the Oct 27 nightly.",
    );
    expect(recentInstall(view, at + DAY)).toBeNull();
    expect(updateStateWords(view, at + DAY).detail).toBeUndefined();

    const lateNight: UpdateView = {
      ...view,
      lastApply: {
        version: "1.2.0",
        outcome: "installed",
        at: new Date(2026, 9, 27, 23, 0).getTime(),
      },
    };
    const morning = new Date(2026, 9, 28, 8, 0).getTime();
    expect(recentInstall(lateNight, morning)).toEqual({ day: "yesterday", version: "1.2.0" });
    expect(updateStateWords(lateNight, morning).detail).toBe("Updated yesterday.");
  });

  it("says an install that didn't take on the launch that found it, and the update ready to try again", () => {
    const view = viewFixture("update-view.not-applied");
    expect(notAppliedWords(view)).toEqual({
      text: "The last restart didn't install the Oct 28 nightly. VibeField came back on the Oct 27 nightly, and the update is ready to try again.",
      ready: true,
    });
    // not staged again: no try again, the page offers Check for updates
    expect(notAppliedWords({ ...view, phase: "idle" })).toEqual({
      text: "The last restart didn't install the Oct 28 nightly. VibeField came back on the Oct 27 nightly.",
      ready: false,
    });
    // said once (LC-34): never on a later launch, never while another version is the news, never for one that took
    const last = view.lastApply;
    if (last === undefined) throw new Error("the fixture carries lastApply");
    expect(notAppliedWords({ ...view, lastApply: { ...last, thisLaunch: false } })).toBeNull();
    expect(notAppliedWords({ ...view, version: "0.1.0-nightly.20261029" })).toBeNull();
    expect(notAppliedWords(viewFixture("update-view.updated"))).toBeNull();
    expect(notAppliedWords(null)).toBeNull();
  });
});

describe("the provenance — when the last check ran, never implied fresh", () => {
  const now = new Date(2026, 9, 15, 14, 20).getTime();
  it("says the clock for today, the day for an older check, and never-checked plainly", () => {
    expect(checkedLabel(new Date(2026, 9, 15, 9, 5).getTime(), now)).toBe("checked 09:05");
    expect(checkedLabel(new Date(2026, 9, 13, 23, 59).getTime(), now)).toMatch(
      /^checked .+, 23:59$/u,
    );
    expect(checkedLabel(null, now)).toBe("not checked yet");
  });
});

describe("the options' lines — what the switch and the channel mean (DESIGN.md §8 Settings → Updates)", () => {
  it("says when installs happen, and promises no install on quit before AU-5 lands", () => {
    expect(AUTOMATIC_UPDATES_LINES.on).toBe(
      "Download updates in the background. They install when you restart VibeField, or on their own while no window is open and nothing would end.",
    );
    expect(AUTOMATIC_UPDATES_LINES.on).not.toContain("quit");
    expect(AUTOMATIC_UPDATES_LINES.off).toBe(
      "VibeField checks only when you choose Check for updates, and downloads only when you choose Download.",
    );
  });

  it("says each channel's line and word", () => {
    expect(UPDATE_CHANNEL_LINES).toEqual({
      stable: "Tested releases.",
      beta: "Early releases, mostly stable.",
      nightly: "Every night's build: the newest, and the least tested.",
    });
    expect(channelLabel("nightly")).toBe("Nightly");
    expect(channelLabel("beta")).toBe("Beta");
  });
});

describe("the channel — EDP-36: a lower channel is a downgrade, said before it takes", () => {
  it("lays the channels out lowest first and knows a downgrade from the build's own channel", () => {
    expect(UPDATE_CHANNEL_OPTIONS.map((option) => option.id)).toEqual([
      "stable",
      "beta",
      "nightly",
    ]);
    expect(isDowngrade("stable", "nightly")).toBe(true);
    expect(isDowngrade("beta", "nightly")).toBe(true);
    expect(isDowngrade("nightly", "nightly")).toBe(false);
    expect(isDowngrade("beta", "stable")).toBe(false);
  });

  it("says EDP-36's own sentence, and its button says what it does", () => {
    expect(downgradeWords("stable")).toEqual({
      question: "Switch to the stable channel?",
      what: "Return to stable — reinstalls the latest stable release.",
      act: "Return to stable",
    });
  });
});

describe("a refusal main sent no words for (a race)", () => {
  it("says what happened and names the reason", () => {
    expect(refusalFallback("not-staged")).toEqual({
      message: "VibeField didn't install the update",
      detail: "Nothing changed (not-staged).",
    });
    expect(refusalFallback("quit-underway").message).toBe("VibeField is already restarting");
  });

  it("says a Download main refused: the step that didn't happen, then why (AU-3)", () => {
    expect(downloadRefusalFallback("not-available")).toEqual({
      message: "VibeField didn't download the update",
      detail: "That version is no longer available.",
    });
    expect(downloadRefusalFallback("busy").detail).toBe(
      "VibeField is busy with another update step.",
    );
    expect(downloadRefusalFallback("disabled").detail).toBe("Nothing changed (disabled).");
    for (const reason of ["not-available", "busy", "disabled"]) {
      const words = downloadRefusalFallback(reason);
      expect(`${words.message} ${words.detail}`).not.toMatch(APOLOGY);
    }
  });
});
