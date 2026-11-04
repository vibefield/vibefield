// @vitest-environment node
/**
 * THE LAUNCHER'S GATE (QL-D7 as revised 2026-09-28), as the deck computes it.
 *
 * The terminal owner declares an interactive shell unused for its entire lifetime.
 * No browser receipt grants that status; restored shells need the same native fact.
 */

import { describe, expect, it } from "vitest";
import {
  type FreshShellFacts,
  freshShellIds,
  isUnusedShell,
  launcherCwds,
} from "../src/godview/deck-launchers";

function facts(
  overrides: Partial<Record<keyof FreshShellFacts, readonly string[]>>,
): FreshShellFacts {
  const has = (key: keyof FreshShellFacts) => (id: string) => overrides[key]?.includes(id) === true;
  return {
    unused: has("unused"),
    hasInput: has("hasInput"),
    hasAgent: has("hasAgent"),
    isRemote: has("isRemote"),
  };
}

describe("the fresh shells", () => {
  const sessions = [
    { id: "split", exited: false, activity: { kind: "idle" } },
    { id: "first", exited: false, activity: { kind: "idle" } },
    { id: "restored", exited: false, activity: { kind: "idle" } },
    { id: "typed", exited: false, activity: { kind: "idle" } },
    { id: "agent", exited: false, activity: { kind: "idle" } },
    { id: "gone", exited: true, activity: { kind: "idle" } },
    { id: "busy", exited: false, activity: { kind: "foreground-job" } },
    { id: "peer", exited: false, activity: { kind: "idle" } },
  ];

  it("admits only an owner-declared unused shell with no agent, no input, no exit, not a peer's", () => {
    const fresh = freshShellIds(
      sessions,
      facts({
        unused: ["split", "first", "typed", "agent", "gone", "busy", "peer"],
        hasInput: ["typed"],
        hasAgent: ["agent"],
        isRemote: ["peer"],
      }),
    );
    expect([...fresh].sort()).toEqual(["busy", "first", "split"]);
  });

  it("never admits a session with unknown input ownership", () => {
    expect(freshShellIds(sessions, facts({})).size).toBe(0);
  });

  it("reads lifetime input from the terminal owner, surviving a runtime replacement", () => {
    const session = { programKind: "interactive-shell", inputUsed: false };
    const runtime = () => ({ sessionSummary: () => session, sessionHasInput: () => false });
    expect(isUnusedShell(runtime() as never, "shell")).toBe(true);
    session.inputUsed = true; // accepted input on any device or automation client
    expect(isUnusedShell(runtime() as never, "shell")).toBe(false);
  });

  it("fails closed for unknown ownership, applications, and local input awaiting metadata", () => {
    for (const session of [undefined, {}, { programKind: "application", inputUsed: false }]) {
      expect(
        isUnusedShell(
          { sessionSummary: () => session, sessionHasInput: () => false } as never,
          "shell",
        ),
      ).toBe(false);
    }
    expect(
      isUnusedShell(
        {
          sessionSummary: () => ({ programKind: "interactive-shell", inputUsed: false }),
          sessionHasInput: () => true,
        } as never,
        "shell",
      ),
    ).toBe(false);
  });
});

describe("the launchers' folders", () => {
  it("decodes the floor's OSC 7 URL, drops a peer's path, and falls back to the birth folder", () => {
    const folders = launcherCwds(
      [
        { id: "plain", cwd: "/Users/j/src/vibe-field" },
        { id: "url", cwd: "file://this-mac/Users/j/src/rosetta" },
        { id: "peer", cwd: "file://other-mac/Users/j/src/puppeteer" },
        { id: "unannounced", cwd: undefined },
      ] as never,
      new Map([
        ["unannounced", "/Users/j/src/born-here"],
        ["peer", "/Users/j/fallback"],
      ]),
      "this-mac",
    );
    expect(folders.get("plain")).toBe("/Users/j/src/vibe-field");
    expect(folders.get("url")).toBe("/Users/j/src/rosetta");
    expect(folders.get("unannounced")).toBe("/Users/j/src/born-here");
    expect(folders.get("peer")).toBe("/Users/j/fallback");
  });
});
