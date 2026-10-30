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
  LOCATION_WORDS,
  type MeUpdateLocal,
  type MeUpdateRow,
  meUpdateRow,
  moveRefusalFallback,
  notAppliedNotice,
  notAppliedWords,
  READY_SINCE_DAYS,
  readyClause,
  readySince,
  recentInstall,
  refusalFallback,
  refusalLine,
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
    // AU-7 (LC-40) — a copy macOS won't let replace itself says so over every resting state; a writable copy elsewhere
    // changes nothing; motion outranks it
    [
      { phase: "idle", location: "read-only" },
      "VibeField can't update itself from here",
      "macOS won't let VibeField replace itself where it is. Move it to Applications and it updates as usual.",
    ],
    [
      { phase: "available", version: "1.2.0", location: "read-only" },
      "VibeField can't update itself from here",
      "macOS won't let VibeField replace itself where it is. Move it to Applications and it updates as usual.",
    ],
    [{ phase: "idle", location: "elsewhere" }, "VibeField is up to date", undefined],
    [{ phase: "checking", location: "read-only" }, "Checking for updates…", undefined],
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
    // AU-7 — a copy that can't replace itself is the attention ink, as the publisher's holds are
    expect(updateStateWords({ ...BASE, location: "read-only" }, NOW).tone).toBe("attention");
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
    // AU-7 — never a copy that can't replace itself (its Restart refuses); a writable one elsewhere waits as ever
    expect(updateWaits({ ...staged, location: "read-only" })).toBe(false);
    expect(updateWaits({ ...staged, location: "elsewhere" })).toBe(true);
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
    // AU-5 — after install on quit, the quit leads (DESIGN.md §8), ready again or not
    const quit = { ...view, lastApply: { ...last, trigger: "quit" as const } };
    expect(notAppliedWords(quit)).toEqual({
      text: "The last quit didn't install the Oct 28 nightly. VibeField came back on the Oct 27 nightly, and the update is ready to try again.",
      ready: true,
    });
    expect(notAppliedWords({ ...quit, phase: "idle" })).toEqual({
      text: "The last quit didn't install the Oct 28 nightly. VibeField came back on the Oct 27 nightly.",
      ready: false,
    });
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

  it("says a Move main refused: the step that didn't happen, then why (AU-7)", () => {
    expect(moveRefusalFallback("busy")).toEqual({
      message: "VibeField didn't move to Applications",
      detail: "VibeField is already quitting or updating.",
    });
    expect(moveRefusalFallback("not-needed").detail).toBe("It already runs from Applications.");
    expect(moveRefusalFallback("gone").detail).toBe("Nothing changed (gone).");
    for (const reason of ["not-needed", "busy", "gone"]) {
      const words = moveRefusalFallback(reason);
      expect(`${words.message} ${words.detail}`).not.toMatch(APOLOGY);
    }
  });
});

// AU-2 — the Me menu's update row (DESIGN.md §8 "The Me menu"; renderer.md §2.1 with the lead's calls): one state,
// the page's verbs, every line whole in the 256px panel, an act wearing "…" only when it asks first (LC-41).
describe("the Me menu's update row — at rest, in place, and the hold in its ink (AU-2)", () => {
  const REST: MeUpdateLocal = { kind: "rest" };
  const CURRENT = "0.1.0-nightly.20261027";
  const NEXT = "0.1.0-nightly.20261028";
  const NIGHTLY: UpdateView = {
    ...BASE,
    channel: "nightly",
    buildChannel: "nightly",
    currentVersion: CURRENT,
  };
  const STAGED: UpdateView = { ...NIGHTLY, phase: "staged", version: NEXT, sessions: 0 };
  const FOUND: UpdateView = { ...NIGHTLY, phase: "available", version: NEXT };
  type Phase = "checking" | "preparing" | "confirming" | "restarting" | "requested";
  const at = (kind: Phase): MeUpdateLocal => ({ kind });
  const answered = (outcome: "up-to-date" | "found" | "held" | "failed"): MeUpdateLocal => ({
    kind: "answered",
    outcome,
  });
  const CHECK = {
    glyph: "reset",
    turn: 0,
    label: "Check for updates",
    act: "check",
    dot: false,
  } as const;
  const ON_27 = "You're on the Oct 27 nightly";

  // [row, view, the row's flow, what it says]
  const ROWS: [string, UpdateView | null, MeUpdateLocal, Partial<MeUpdateRow>][] = [
    // ── at rest ──
    [
      "R1 — no updater: dimmed, no version",
      null,
      REST,
      {
        glyph: "reset",
        label: "Check for updates",
        detail: "This build doesn't update itself",
        act: "none",
        dot: false,
      },
    ],
    ["R2 — the version you are on", NIGHTLY, REST, { ...CHECK, detail: ON_27 }],
    [
      "R2 — a main that names none: when it last checked",
      BASE,
      REST,
      { ...CHECK, detail: "Not checked yet" },
    ],
    [
      "R3 — off",
      { ...NIGHTLY, enabled: false },
      REST,
      { ...CHECK, detail: "Automatic updates are off" },
    ],
    // AU-7 (LC-10, LC-40) — the one hold that changes the act: it opens Settings → Updates, where the move is
    [
      "R5 — a copy macOS won't let replace itself",
      { ...NIGHTLY, location: "read-only" },
      REST,
      {
        glyph: "reset",
        turn: 0,
        label: "Move to Applications…",
        detail: "Can't update from here",
        detailTone: "attention",
        act: "open",
        dot: false,
      },
    ],
    [
      "R5 — over a ready update it can't install: no dot, no restart",
      { ...STAGED, location: "read-only" },
      REST,
      {
        label: "Move to Applications…",
        detail: "Can't update from here",
        detailTone: "attention",
        act: "open",
        dot: false,
      },
    ],
    [
      "R5 — over the publisher's hold",
      { ...NIGHTLY, phase: "paused", location: "read-only" },
      REST,
      { label: "Move to Applications…", detailTone: "attention", act: "open" },
    ],
    [
      "R5 — a writable copy elsewhere changes nothing",
      { ...NIGHTLY, location: "elsewhere" },
      REST,
      { ...CHECK, detail: ON_27 },
    ],
    [
      "R5 — motion outranks it: a check the status item began",
      { ...NIGHTLY, phase: "checking", location: "read-only" },
      REST,
      { glyph: "reset", label: "Checking for updates…", act: "none", dot: false },
    ],
    [
      "R6 — a check that began elsewhere",
      { ...NIGHTLY, phase: "checking" },
      REST,
      { glyph: "reset", label: "Checking for updates…", act: "none", dot: false },
    ],
    [
      "R7 — downloading, on real progress",
      { ...NIGHTLY, phase: "downloading", version: NEXT, percent: 41.6 },
      REST,
      {
        glyph: "arrow",
        turn: 180,
        label: "Downloading update",
        detail: "42% downloaded",
        progress: 42,
        act: "open",
        dot: false,
      },
    ],
    [
      "R8 — nothing ends, so nothing asks",
      STAGED,
      REST,
      {
        glyph: "reset",
        label: "Restart to update",
        detail: "Your sessions keep running",
        act: "restart",
        dot: true,
      },
    ],
    [
      "R9 — the cost before the click",
      { ...STAGED, sessions: 3 },
      REST,
      { label: "Restart to update…", detail: "Ends 3 terminal sessions", act: "ask", dot: true },
    ],
    [
      "R9 — one session",
      { ...STAGED, sessions: 1 },
      REST,
      { label: "Restart to update…", detail: "Ends 1 terminal session", act: "ask" },
    ],
    [
      "R10 — the census unread",
      { ...STAGED, sessions: "unknown" },
      REST,
      { label: "Restart to update…", detail: "Checks your sessions first", act: "ask", dot: true },
    ],
    [
      "R11 — downloaded where the apply isn't wired",
      { ...STAGED, applyWired: false },
      REST,
      {
        glyph: "arrow",
        turn: 180,
        label: "Update downloaded",
        detail: "Installs with a later release",
        act: "open",
        dot: false,
      },
    ],
    [
      "R12 — found, with automatic updates off: Download in place (LC-6)",
      { ...FOUND, enabled: false },
      REST,
      {
        glyph: "arrow",
        turn: 180,
        label: "Download update",
        detail: "Automatic updates are off",
        act: "download",
        dot: false,
      },
    ],
    [
      "R13 — a skip, the person's own act",
      { ...FOUND, declined: true },
      REST,
      { ...CHECK, detail: "You skipped the Oct 28 nightly" },
    ],
    ["R14 — found and held by a lever", FOUND, REST, { ...CHECK, detail: ON_27 }],
    [
      "R15 — paused",
      { ...NIGHTLY, phase: "paused" },
      REST,
      { ...CHECK, detail: "Paused by the publisher", detailTone: "attention" },
    ],
    [
      "R16 — unsupported",
      { ...NIGHTLY, phase: "unsupported" },
      REST,
      { ...CHECK, detail: "The update needs a newer macOS", detailTone: "attention" },
    ],
    [
      "R17 — offline, quiet",
      { ...NIGHTLY, phase: "offline" },
      REST,
      { ...CHECK, detail: "Couldn't check — offline", detailTone: "quiet" },
    ],
    [
      "R18 — the last check failed",
      { ...NIGHTLY, phase: "failed", unavailable: "feed-unverified" },
      REST,
      { ...CHECK, detail: "The last check failed", detailTone: "danger" },
    ],
    [
      "LC-31 — a channel with nothing published: quiet",
      { ...NIGHTLY, channel: "beta", phase: "failed", unavailable: "channel-unresolved" },
      REST,
      { ...CHECK, detail: "No beta release yet", detailTone: "quiet" },
    ],
    // ── in place: this open's click ──
    [
      "P1 — the row's own check",
      NIGHTLY,
      at("checking"),
      { glyph: "reset", label: "Checking for updates…", detail: ON_27, act: "none" },
    ],
    [
      "P2 — up to date, inert until the fold",
      NIGHTLY,
      answered("up-to-date"),
      { label: "VibeField is up to date", detail: ON_27, act: "none" },
    ],
    ["P2 — never for a held answer", NIGHTLY, answered("held"), { ...CHECK, detail: ON_27 }],
    [
      "P3 — found and downloading: the download row in place",
      { ...NIGHTLY, phase: "downloading", version: NEXT, percent: 3 },
      answered("found"),
      { label: "Downloading update", detail: "3% downloaded", progress: 3, act: "open" },
    ],
    [
      "P4 — a skip, said in line 1",
      { ...FOUND, declined: true },
      answered("found"),
      { label: "You skipped the Oct 28 nightly", detail: "Download it from Settings", act: "open" },
    ],
    [
      "P5 — offline",
      { ...NIGHTLY, phase: "offline" },
      answered("failed"),
      {
        label: "Couldn't check — offline",
        detail: "VibeField tries again on its own",
        act: "none",
      },
    ],
    [
      "P6 — the check failed",
      { ...NIGHTLY, phase: "failed", unavailable: "feed-unverified" },
      answered("failed"),
      {
        label: "Couldn't check for updates",
        labelTone: "danger",
        detail: "Settings → Updates has more",
        act: "open",
      },
    ],
    [
      "LC-31 — a check that finds nothing published answers as the held row",
      { ...NIGHTLY, channel: "beta", phase: "failed", unavailable: "channel-unresolved" },
      answered("failed"),
      { ...CHECK, detail: "No beta release yet", detailTone: "quiet" },
    ],
    [
      "P7 — paused",
      { ...NIGHTLY, phase: "paused" },
      answered("held"),
      {
        label: "Updates are paused",
        labelTone: "attention",
        detail: "Your version keeps running",
        act: "none",
      },
    ],
    [
      "P8 — unsupported",
      { ...NIGHTLY, phase: "unsupported" },
      answered("held"),
      {
        label: "Needs a newer macOS",
        labelTone: "attention",
        detail: "Your version keeps running",
        act: "none",
      },
    ],
    [
      "P9 — the door itself failed",
      NIGHTLY,
      { kind: "unreachable", message: "No handler registered" },
      {
        label: "Couldn't reach the updater",
        labelTone: "danger",
        detail: "Settings → Updates has more",
        act: "open",
      },
    ],
    [
      "P10 — main reads the sessions",
      { ...STAGED, sessions: 3 },
      at("preparing"),
      {
        label: "Restart to update…",
        detail: "Reading the running sessions…",
        act: "none",
        dot: true,
      },
    ],
    [
      "P12 — a restart that asked nothing, starting",
      STAGED,
      at("confirming"),
      { label: "Restart to update", detail: "Starting the update…", act: "none", dot: true },
    ],
    [
      "P13 — restarting: the dot goes with the act",
      STAGED,
      at("restarting"),
      { label: "Restarting…", detail: "VibeField opens again", act: "none", dot: false },
    ],
    [
      "P14 — Download asked",
      { ...FOUND, enabled: false },
      at("requested"),
      {
        glyph: "arrow",
        turn: 180,
        label: "Download update",
        detail: "Starting the download…",
        act: "none",
      },
    ],
    [
      "P14 — then the view says downloading",
      { ...NIGHTLY, enabled: false, phase: "downloading", version: NEXT, percent: 0 },
      at("requested"),
      { label: "Downloading update", detail: "0% downloaded", progress: 0, act: "open" },
    ],
  ];

  it.each(ROWS)("%s", (_name, view, local, says) => {
    const row = meUpdateRow({ view, local, now: NOW });
    expect(row).toMatchObject(says);
    // a tone the case names is the row's; one it doesn't name, the row has none
    if (says.labelTone === undefined) expect(row.labelTone).toBeUndefined();
    if (says.detailTone === undefined) expect(row.detailTone).toBeUndefined();
    if (says.progress === undefined) expect(row.progress).toBeUndefined();
    expect(`${row.label} ${row.detail}`).not.toMatch(APOLOGY);
    // an act wears "…" only when it asks first (LC-41)
    if (row.act === "check") expect(row.label).toBe("Check for updates");
    if (row.act === "restart" || row.act === "download") expect(row.label).not.toMatch(/…$/u);
  });

  it("keeps every line whole in the 256px panel: line 2 at 30 characters, line 1 at 26 (two named exceptions each)", () => {
    const longer = ["This build doesn't update itself", "VibeField tries again on its own"];
    for (const [, view, local] of ROWS) {
      const row = meUpdateRow({ view, local, now: NOW });
      if (!longer.includes(row.detail)) {
        expect(row.detail.length, row.detail).toBeLessThanOrEqual(30);
      }
      // P4's line 1 names the version it skipped
      if (row.label.startsWith("You skipped")) continue;
      expect(row.label.length, row.label).toBeLessThanOrEqual(26);
    }
  });

  it("says R4 for a day after an install took, in the no-notes form (LC-7; EL9: AU-1's fixture)", () => {
    const view = viewFixture("update-view.updated");
    const installed = view.lastApply?.at ?? 0;
    expect(meUpdateRow({ view, local: REST, now: installed + 30 * 60 * 1000 })).toMatchObject({
      glyph: "check",
      label: "Updated today",
      detail: "From the Oct 27 nightly",
      act: "open",
      dot: false,
    });
    // no `from` (an older app's record): the version it is on
    const last = view.lastApply;
    if (last === undefined) throw new Error("the fixture carries lastApply");
    const unknownFrom: UpdateView = {
      ...view,
      lastApply: { version: last.version, outcome: "installed", at: installed },
    };
    expect(meUpdateRow({ view: unknownFrom, local: REST, now: installed + 60_000 }).detail).toBe(
      "You're on the Oct 28 nightly",
    );
    // a day on, the resting row again
    expect(meUpdateRow({ view, local: REST, now: installed + DAY })).toMatchObject({
      ...CHECK,
      detail: "You're on the Oct 28 nightly",
    });
    // the idle fixture: R2 in the version's friendly name
    const idle = viewFixture("update-view.idle");
    expect(meUpdateRow({ view: idle, local: REST, now: NOW }).detail).toBe(ON_27);
  });

  it("adds one third line at most: the floor outranks the ready day, which starts on day 7 (AU-D3)", () => {
    const view = viewFixture("update-view.staged-since");
    const stagedAt = view.stagedAt ?? 0;
    const line3 = (v: UpdateView, now: number) => meUpdateRow({ view: v, local: REST, now }).note;
    expect(line3(view, stagedAt + (READY_SINCE_DAYS - 1) * DAY)).toBeUndefined();
    expect(line3(view, stagedAt + READY_SINCE_DAYS * DAY)).toEqual({
      text: `Ready since ${shortDay(stagedAt)}`,
    });
    // AU-7 — never under a copy that can't install it (R5): the move is the news
    const readOnly: UpdateView = { ...view, location: "read-only" };
    expect(line3(readOnly, stagedAt + READY_SINCE_DAYS * DAY)).toBeUndefined();
    expect(readySince(readOnly, stagedAt + READY_SINCE_DAYS * DAY)).toBeNull();
    const floor = { ...view, unsupportedBelow: "0.1.0-nightly.20261028" };
    expect(line3(floor, stagedAt + READY_SINCE_DAYS * DAY)).toEqual({
      text: "Your version is unsupported",
      tone: "attention",
    });
    expect(line3(floor, stagedAt + DAY)).toEqual({
      text: "Your version is unsupported",
      tone: "attention",
    });
    // it never changes the mark, the act or the cost
    const row = meUpdateRow({ view: floor, local: REST, now: stagedAt + 9 * DAY });
    expect(row).toMatchObject({
      label: "Restart to update…",
      detail: "Ends 3 terminal sessions",
      dot: true,
    });
  });

  it("reads main's location fixtures: R5 for a read-only copy, the resting row for one elsewhere (AU-7)", () => {
    expect(
      meUpdateRow({ view: viewFixture("update-view.read-only"), local: REST, now: NOW }),
    ).toMatchObject({
      label: "Move to Applications…",
      detail: "Can't update from here",
      detailTone: "attention",
      act: "open",
      dot: false,
    });
    expect(
      meUpdateRow({ view: viewFixture("update-view.elsewhere"), local: REST, now: NOW }),
    ).toMatchObject({ label: "Check for updates", act: "check" });
    // the face's clause, like its dot, never names an update the copy can't install
    expect(readyClause({ ...STAGED, location: "read-only" })).toBeNull();
  });

  it("names the face's ready clause only while an install waits on you (AU-D1)", () => {
    expect(readyClause(STAGED)).toBe("the Oct 28 nightly is ready");
    expect(readyClause({ ...STAGED, sessions: 4 })).toBe("the Oct 28 nightly is ready");
    expect(readyClause({ ...STAGED, applyWired: false })).toBeNull();
    expect(readyClause({ ...NIGHTLY, phase: "downloading", version: NEXT })).toBeNull();
    expect(readyClause(null)).toBeNull();
    expect(readyClause(undefined)).toBeNull();
  });

  it("says an install that didn't take once, in the menu's words (LC-8; EL9: AU-1's fixture)", () => {
    const view = viewFixture("update-view.not-applied");
    expect(notAppliedNotice(view)).toBe(
      "The Oct 28 nightly didn't install when VibeField restarted. It's ready to try again.",
    );
    // not staged again: the page has the details
    expect(notAppliedNotice({ ...view, phase: "idle" })).toBe(
      "The Oct 28 nightly didn't install when VibeField restarted. Settings → Updates has the details.",
    );
    const last = view.lastApply;
    if (last === undefined) throw new Error("the fixture carries lastApply");
    // AU-5's install on quit, said as the record says it
    expect(notAppliedNotice({ ...view, lastApply: { ...last, trigger: "quit" } })).toBe(
      "The Oct 28 nightly didn't install when VibeField quit. It's ready to try again.",
    );
    // never on a later launch, never while another version is the news, never for one that took
    expect(notAppliedNotice({ ...view, lastApply: { ...last, thisLaunch: false } })).toBeNull();
    expect(notAppliedNotice({ ...view, version: "0.1.0-nightly.20261029" })).toBeNull();
    expect(notAppliedNotice(viewFixture("update-view.updated"))).toBeNull();
    expect(notAppliedNotice(viewFixture("update-view.idle"))).toBeNull();
    expect(notAppliedNotice(null)).toBeNull();
    expect(notAppliedNotice(view)).not.toMatch(APOLOGY);
    // and the row is the ready row again
    expect(meUpdateRow({ view, local: REST, now: last.at }).label).toBe("Restart to update");
  });

  it("says a refusal as one line, in main's words", () => {
    expect(refusalLine(downloadRefusalFallback("not-available"))).toBe(
      "VibeField didn't download the update. That version is no longer available.",
    );
    expect(refusalLine(refusalFallback("not-staged"))).toBe(
      "VibeField didn't install the update. Nothing changed (not-staged).",
    );
  });

  it('says where the app runs in its own words, the act wearing "…" on both surfaces (AU-7; LC-41)', () => {
    expect(LOCATION_WORDS.move).toBe("Move to Applications…");
    expect(LOCATION_WORDS.moving).toBe("Moving VibeField to Applications…");
    expect(LOCATION_WORDS.elsewhere).toBe("VibeField runs outside Applications");
    for (const said of Object.values(LOCATION_WORDS)) {
      expect(said).not.toMatch(APOLOGY);
      // straight apostrophes, as the product writes them
      expect(said).not.toMatch(/[\u2018\u2019]/u);
    }
  });
});
