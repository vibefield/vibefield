// @vitest-environment node
/**
 * THE LAUNCHER'S GATE (QL-D7 as revised 2026-09-28), as the deck computes it.
 *
 * A pane shows the empty pane launcher while its session was born in this view
 * (the deck's new-pane door, or the workspace's first shell — ghosttea's birth
 * receipt), has no agent facet, has not exited, has had no input, runs no
 * foreground job and is not a peer's. Restored and attached sessions have no
 * receipt and never qualify. Pure: the deck supplies the facts.
 */

import { describe, expect, it } from "vitest";
import {
  bornInThisView,
  type FreshShellFacts,
  freshShellIds,
  launcherCwds,
  recordBornShell,
} from "../src/godview/deck-launchers";

function facts(
  overrides: Partial<Record<keyof FreshShellFacts, readonly string[]>>,
): FreshShellFacts {
  const has = (key: keyof FreshShellFacts) => (id: string) => overrides[key]?.includes(id) === true;
  return {
    bornHere: has("bornHere"),
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

  it("admits only a shell born here with no agent, no input, no exit, no job, not a peer's", () => {
    const fresh = freshShellIds(
      sessions,
      facts({
        bornHere: ["split", "first", "typed", "agent", "gone", "busy", "peer"],
        hasInput: ["typed"],
        hasAgent: ["agent"],
        isRemote: ["peer"],
      }),
    );
    expect([...fresh].sort()).toEqual(["first", "split"]);
  });

  it("never admits a restored or attached session, however empty", () => {
    expect(freshShellIds(sessions, facts({})).size).toBe(0);
  });

  it("reads a split's birth from the deck's record and the first shell's from ghosttea's receipt", () => {
    const runtime = { sessionCreatedHere: (id: string) => id === "first" };
    recordBornShell(runtime, "split");
    const bornHere = bornInThisView(runtime);
    expect(["split", "first", "restored"].map(bornHere)).toEqual([true, true, false]);
    // no runtime yet: nothing is born here, and nothing is recorded
    recordBornShell(null, "early");
    expect(["split", "first", "early"].map(bornInThisView(null))).toEqual([false, false, false]);
  });

  it("forgets a split's birth when the runtime is replaced — the reaper and the input history go with it", () => {
    const before = { sessionCreatedHere: () => false };
    const after = { sessionCreatedHere: () => false };
    recordBornShell(before, "split");
    expect(bornInThisView(before)("split")).toBe(true);
    // a pool retry: the new runtime never saw the split's input, and the new
    // reaper holds no receipt for it, so the gate must not either
    expect(bornInThisView(after)("split")).toBe(false);
    recordBornShell(after, "split-2");
    expect(bornInThisView(before)("split-2")).toBe(false);
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
