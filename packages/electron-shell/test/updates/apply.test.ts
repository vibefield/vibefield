import { describe, expect, it } from "vitest";
import {
  type BoxContent,
  CONSENT_LISTED_MAX,
  censusNotice,
  censusOf,
  consentBox,
  consentWords,
  downloadNotice,
  policyNotice,
  quitNotice,
  stagedTrayLabel,
} from "../../src/main/updates/apply";
import { type SafeWindowContext, safeWindow } from "../../src/main/updates/safe-window";
import { currentList, FIXTURE_SESSIONS, terminalList, unjudgedList } from "./terminal-list-fixture";

// WP12c (L2b-ii, build-wp12-updater.md §10 S2/S7; the PM's rulings 13:31Z, 13:37Z) — the apply's words, PINNED to
// DESIGN.md §9 ("Voice"): sentence case · buttons say what they do · states tell the truth with numbers · errors say
// what happened and what to do next · they don't apologize and are never vague. And EDP-34's predicate as a table.

const PROPER = new Set(["VibeField"]);
const APOLOGY = /\b(sorry|unfortunately|oops|please|apolog)/i;
const VAGUE_BUTTONS = new Set(["OK", "Ok", "Yes", "No", "Submit", "Continue", "Proceed"]);

/** §9's sentence case: the first word capitalised; every later word lowercase unless it is a proper name, a number
 * or a version. */
function sentenceCase(text: string): boolean {
  const words = text.split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
  return words.every((word, index) => {
    const bare = word.replace(/[^A-Za-z0-9.+-]/g, "");
    if (PROPER.has(bare) || /^\d/.test(bare)) return true;
    return index === 0 ? /^[A-Z]/.test(bare) : bare === bare.toLowerCase();
  });
}

function speaksInSection9(box: BoxContent): void {
  expect(sentenceCase(box.message), box.message).toBe(true);
  for (const button of box.buttons) {
    expect(VAGUE_BUTTONS.has(button), `a button says what it does: ${button}`).toBe(false);
    expect(sentenceCase(button), button).toBe(true);
  }
  expect(APOLOGY.test(`${box.message} ${box.detail}`)).toBe(false);
}

const sessions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    sessionId: `s-${i}`,
    title: `zsh ${i}`,
    cwd: `/Users/me/p${i}`,
  }));

describe("the consent box (EDP-35, DESIGN.md §9)", () => {
  it("says the consequence with its number, lists the sessions, and its buttons say what they do", () => {
    const box = consentBox("0.9.0", sessions(3));
    speaksInSection9(box);
    expect(box.message).toBe("Updating ends 3 terminal sessions");
    expect(box.detail.split("\n")).toEqual([
      "VibeField 0.9.0 replaces the terminal service, which ends:",
      "zsh 0 — /Users/me/p0",
      "zsh 1 — /Users/me/p1",
      "zsh 2 — /Users/me/p2",
    ]);
    expect(box.buttons).toEqual(["Cancel", "End 3 sessions and update"]);
    // Cancel is the default AND the cancel: nothing ends by accident
    expect(box.defaultId).toBe(0);
    expect(box.cancelId).toBe(0);
  });

  it("AU-1 (LC-2) — names the version as the window does: a nightly by its day, a beta by its number", () => {
    const nightly = consentBox("0.1.0-nightly.20261028", sessions(1));
    expect(nightly.detail.split("\n")[0]).toBe(
      "The Oct 28 nightly replaces the terminal service, which ends:",
    );
    expect(consentWords("0.2.0-beta.3", sessions(1)).lead).toBe(
      "VibeField 0.2.0 beta 3 replaces the terminal service, which ends:",
    );
  });

  it("is singular for one session and counts the sessions past the listed few", () => {
    const one = consentBox("0.9.0", sessions(1));
    expect(one.message).toBe("Updating ends 1 terminal session");
    expect(one.buttons[1]).toBe("End 1 session and update");
    const many = consentBox("0.9.0", sessions(CONSENT_LISTED_MAX + 3));
    const lines = many.detail.split("\n");
    expect(lines).toHaveLength(1 + CONSENT_LISTED_MAX + 1);
    expect(lines.at(-1)).toBe("and 3 more");
    speaksInSection9(many);
  });

  it("L3c-ii — is consentWords joined: the card lays out the very words the tray's box says", () => {
    const words = consentWords("0.9.0", sessions(CONSENT_LISTED_MAX + 2));
    const box = consentBox("0.9.0", sessions(CONSENT_LISTED_MAX + 2));
    expect(words.message).toBe(box.message);
    expect(words.confirm).toBe(box.buttons[1]);
    expect([words.lead, ...words.listed, `and ${words.more} more`].join("\n")).toBe(box.detail);
    expect(words.listed).toHaveLength(CONSENT_LISTED_MAX);
    expect(words.more).toBe(2);
    expect(consentWords("0.9.0", sessions(2)).more).toBe(0);
  });

  it("names an untitled session rather than printing a blank line", () => {
    const box = consentBox("0.9.0", [{ sessionId: "s-1" }]);
    expect(box.detail.split("\n")[1]).toBe("untitled session");
  });
});

describe("the quit notices (the PM's ruling 13:37Z: the person is told before the window goes)", () => {
  it.each(["squirrel-timeout", "install-failed"] as const)(
    "%s says what happened and what to do next",
    (reason) => {
      const box = quitNotice(reason);
      speaksInSection9(box);
      expect(box.message).toBe("VibeField is quitting to finish the update");
      expect(box.detail).toMatch(/Open VibeField again/);
      expect(box.buttons).toEqual(["Quit"]);
    },
  );

  it("the timeout's notice carries its number", () => {
    expect(quitNotice("squirrel-timeout").detail).toMatch(/2 minutes/);
  });
});

describe("the tray's staged verb (the macOS menu convention: Title Case, an ellipsis for a verb that asks)", () => {
  it.each([
    [undefined, "Update Downloaded"],
    ["unknown", "Update Downloaded"],
    [0, "Restart to Update"],
    [1, "Update Ends 1 Session…"],
    [4, "Update Ends 4 Sessions…"],
  ] as const)("sessions %s → %s", (count, label) => {
    expect(stagedTrayLabel(count)).toBe(label);
  });

  it("a release that keeps the floor's sessions (B3) is the plain verb, whatever the count", () => {
    expect(stagedTrayLabel(3, true)).toBe("Restart to Update");
    expect(stagedTrayLabel("unknown", true)).toBe("Restart to Update");
    // not wired here: still no verb
    expect(stagedTrayLabel(undefined, true)).toBe("Update Downloaded");
  });
});

describe("the policy notices (L3b-i, B1/B2; DESIGN.md §9: what happened, what happens next, no apology)", () => {
  it("each says the update did not install, and why, with one plain button", () => {
    const boxes = [
      policyNotice({ kind: "unreachable" }),
      policyNotice({ kind: "unverified" }),
      policyNotice({ kind: "killed", channel: "beta" }),
      policyNotice({ kind: "yanked", version: "1.2.0" }),
      policyNotice({ kind: "floor-unmet", version: "1.2.0", floor: "15.0" }),
      censusNotice(), // L3c-ii — the census unread: nothing ended, and why
    ];
    for (const box of boxes) {
      expect(box.message).toBe("VibeField didn't install the update");
      expect(box.buttons).toEqual(["OK"]);
      expect(box.detail).not.toMatch(/sorry|unfortunately/i);
    }
    expect(boxes[0]?.detail).toBe(
      "VibeField checks the update policy before installing and couldn't reach it; try again when online.",
    );
    expect(boxes[2]?.detail).toContain("the beta channel");
    expect(boxes[3]?.detail).toMatch(/^VibeField 1\.2\.0 was withdrawn/);
    expect(boxes[4]?.detail).toContain("needs macOS 15.0 or later");
  });

  it("AU-1 (LC-2) — a nightly's withdrawal and floor are said by the nightly's name", () => {
    const NIGHTLY = "0.1.0-nightly.20261028";
    expect(policyNotice({ kind: "yanked", version: NIGHTLY }).detail).toBe(
      "The Oct 28 nightly was withdrawn after it downloaded, so it won't install. Nothing changed; the next update replaces it.",
    );
    expect(policyNotice({ kind: "floor-unmet", version: NIGHTLY, floor: "26.0" }).detail).toBe(
      "The Oct 28 nightly needs macOS 26.0 or later. Nothing changed; your current version keeps running.",
    );
  });

  it("AU-1 (AU-G5, AU-G6) — a lever that refuses a person's Download says the download, never the install", () => {
    const NIGHTLY = "0.1.0-nightly.20261028";
    const boxes = [
      downloadNotice({ kind: "killed", channel: "beta" }),
      downloadNotice({ kind: "yanked", version: NIGHTLY }),
      downloadNotice({ kind: "floor-unmet", version: NIGHTLY, floor: "26.0" }),
    ];
    for (const box of boxes) {
      expect(box.message).toBe("VibeField didn't download the update");
      expect(box.buttons).toEqual(["OK"]);
      // nothing downloaded: no word of an install, or of a download that happened
      expect(box.detail).not.toMatch(/install|after it downloaded/);
    }
    // a paused channel and an OS floor read as the apply's notice reads them
    expect(boxes[0]?.detail).toBe(policyNotice({ kind: "killed", channel: "beta" }).detail);
    expect(boxes[1]?.detail).toBe(
      "The Oct 28 nightly was withdrawn, so it won't download. Nothing changed; the next update replaces it.",
    );
    expect(boxes[2]?.detail).toBe(
      policyNotice({ kind: "floor-unmet", version: NIGHTLY, floor: "26.0" }).detail,
    );
  });
});

describe("the census reads how old the list is (IL-D5 (a), `draft/thinking-inventory-latency.md` §5)", () => {
  it("a current list is the census: every row, by the id fieldd re-checks at the stop", () => {
    expect(censusOf(currentList())).toEqual({ known: true, sessions: FIXTURE_SESSIONS });
    // an empty list of stale cells names none
    const observation = currentList().observation as Record<string, unknown>;
    const noneStale = { ...currentList(), observation: { ...observation, staleCells: [] } };
    expect(censusOf(noneStale)).toEqual({ known: true, sessions: FIXTURE_SESSIONS });
  });

  it("a list naming a cell older than its bound is unknown — never its rows, which may miss a session", () => {
    expect(censusOf(terminalList("terminal-list.stale-cell.json"))).toEqual({ known: false });
  });

  it("fieldd's own half: the stream silent past the bound names every cell, and the census is unknown", () => {
    expect(censusOf(terminalList("terminal-list.link-silent.json"))).toEqual({ known: false });
  });

  it("a list that cannot say how old it is (no boundMs) is read as its rows", () => {
    expect(censusOf(unjudgedList())).toEqual({ known: true, sessions: FIXTURE_SESSIONS });
  });

  it("anything but a list is unknown", () => {
    expect(censusOf(undefined)).toEqual({ known: false });
    expect(censusOf({ terminals: "none" })).toEqual({ known: false });
  });
});

describe("EDP-34's safe window — the predicate, as a truth table", () => {
  const open: SafeWindowContext = {
    windowless: true,
    trayResident: true,
    displayHeldAwake: false,
    planes: ["shell", "fieldd", "field-native"],
    census: 0,
  };
  it.each([
    ["every clause holds", {}, { open: true }],
    ["a window is open", { windowless: false }, { open: false, clause: "windowless" }],
    ["not tray-resident", { trayResident: false }, { open: false, clause: "tray-resident" }],
    [
      "the display is held awake",
      { displayHeldAwake: true },
      { open: false, clause: "display-awake-unheld" },
    ],
    [
      "the display clause has no reader yet — fails closed",
      { displayHeldAwake: "unknown" },
      { open: false, clause: "display-awake-unheld" },
    ],
    [
      "a native-touching release with live sessions",
      { census: 2 },
      { open: false, clause: "plane-gate" },
    ],
    [
      "a native-touching release with an unknown census",
      { census: "unknown" },
      { open: false, clause: "plane-gate" },
    ],
    ["a shell-only release ignores the census", { planes: ["shell"], census: 2 }, { open: true }],
    [
      "the first failing clause is the one named",
      { windowless: false, census: 2 },
      { open: false, clause: "windowless" },
    ],
  ] as const)("%s", (_name, over, expected) => {
    expect(safeWindow({ ...open, ...(over as Partial<SafeWindowContext>) })).toEqual(expected);
  });
});
