import type { UpdateView } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  checkedLabel,
  downgradeWords,
  isDowngrade,
  refusalFallback,
  UPDATE_CHANNEL_OPTIONS,
  updateStateWords,
} from "../src/panels/update-words";

// WP12d (L3c-ii; build-wp12-updater.md §13 C3) — the update card's own words, pinned to DESIGN.md §9: sentence case,
// states with their numbers and provenance, errors that say what happened and what to do next, no apology.

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
    [
      { phase: "available", version: "1.2.0", declined: true },
      "VibeField 1.2.0 is available",
      "You skipped this version. The next one downloads on its own.",
    ],
    [
      { phase: "available", version: "1.2.0", enabled: false },
      "VibeField 1.2.0 is available",
      "Automatic updates are off, so VibeField didn't download it. Turn them on to download it.",
    ],
    [
      { phase: "downloading", version: "1.2.0", percent: 41.6 },
      "Downloading VibeField 1.2.0 · 42%",
      undefined,
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
    const words = updateStateWords({ ...BASE, ...view });
    expect(words.headline).toBe(headline);
    expect(words.detail).toBe(detail);
    for (const said of [words.headline, words.detail ?? ""]) expect(said).not.toMatch(APOLOGY);
  });

  it("tones the policy's answers as attention and a failed check as an error — never offline, which retries", () => {
    expect(updateStateWords({ ...BASE, phase: "paused" }).tone).toBe("attention");
    expect(updateStateWords({ ...BASE, phase: "unsupported" }).tone).toBe("attention");
    expect(updateStateWords({ ...BASE, phase: "failed" }).tone).toBe("error");
    expect(updateStateWords({ ...BASE, phase: "offline" }).tone).toBe("neutral");
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
});
