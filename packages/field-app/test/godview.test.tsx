// @vitest-environment happy-dom
/**
 * The Godview's renderer-side laws (GT-2), at the grain the repo tests chrome:
 * the pure pane rules. (The state that opens it is the frame's since One Frame
 * FR-1 — `view-frame.test.tsx`.) The deck itself is not mounted here — it needs
 * a bridge, a floor, and a GPU, and `pnpm smoke:godview` drives all three.
 */
import { describe, expect, it } from "vitest";
import {
  paneCwd,
  readDeviceHost,
  rememberDeviceHost,
  savedPaneSessionIds,
} from "../src/godview/deck-restore";
import { type DeckSession, describePane } from "../src/godview/pane-faces";

/** A SessionSummary is wide and only a few fields carry meaning here. */
function session(overrides: Partial<DeckSession> & { id: string }): DeckSession {
  return {
    handle: `handle-${overrides.id}`,
    executable: "/bin/zsh",
    cols: 100,
    rows: 30,
    exited: false,
    readWrite: true,
    title: null,
    cwd: null,
    bellCount: 0,
    pid: 4242,
    createdAtMs: 0,
    exitCode: null,
    exitSignal: null,
    requestedTermination: null,
    exitOutcome: null,
    ownerId: null,
    persistence: "keep-until-exit",
    activity: "idle",
    ...overrides,
  } as DeckSession;
}

describe("describePane", () => {
  it("says nothing about a live pane — the terminal IS the state", () => {
    expect(describePane(session({ id: "a" }))).toBeUndefined();
  });

  it("calls a clean exit an exit, without color: 0 is an ending, not a failure", () => {
    expect(describePane(session({ id: "a", exited: true, exitCode: 0 }))).toEqual({
      label: "exited",
    });
  });

  it("gives a nonzero code the red of §2.5, and states the code", () => {
    expect(describePane(session({ id: "a", exited: true, exitCode: 127 }))).toEqual({
      label: "exited · 127",
      color: "var(--vf-red)",
    });
  });

  it("names the signal when one ended it", () => {
    expect(
      describePane(session({ id: "a", exited: true, exitCode: null, exitSignal: "SIGKILL" })),
    ).toEqual({ label: "ended · SIGKILL", color: "var(--vf-red)" });
  });

  it("admits it does not know how a session ended rather than inventing a code", () => {
    expect(describePane(session({ id: "a", exited: true, exitCode: null }))).toEqual({
      label: "ended",
    });
  });
});

// `sessionsToAdopt` and its three rules were deleted at GT-2e: the deck no
// longer decides what a pane holds. `GhostteaWorkspace` claims on mount and
// creates through its own doors (GT-D10), so there is no product rule left here
// to unit-test — what replaced it is a workspace behaviour, asserted in
// `pnpm smoke:godview` against the real library.

// ---- the restore question (GT-3, GT-D8) --------------------------------------

describe("savedPaneSessionIds", () => {
  it("reads pane session ids out of a saved layout, in tree order", () => {
    const layout = {
      version: 1,
      root: {
        kind: "split",
        id: "split-1",
        axis: "horizontal",
        ratio: 0.5,
        first: { kind: "pane", id: "pane-1", sessionId: "one", meta: { cwd: "/repo/api" } },
        second: { kind: "pane", id: "pane-2", sessionId: "two" },
      },
      activePaneId: "pane-1",
      zoomedPaneId: null,
    };
    expect(savedPaneSessionIds(JSON.stringify(layout))).toEqual(["one", "two"]);
  });

  it("reads the pre-v1 nested session shape ghosttea still restores", () => {
    // Believing only the modern field would call a restorable layout empty and
    // start clean without asking — the one silent data loss this gate could do.
    const legacy = { layout: { kind: "pane", id: "pane-1", session: { id: "old" } } };
    expect(savedPaneSessionIds(JSON.stringify(legacy))).toEqual(["old"]);
  });

  it("treats absent, malformed, and unrecognized documents as no layout", () => {
    expect(savedPaneSessionIds(null)).toEqual([]);
    expect(savedPaneSessionIds("{ not json")).toEqual([]);
    expect(savedPaneSessionIds(JSON.stringify({ version: 9, root: { kind: "future" } }))).toEqual(
      [],
    );
  });
});

describe("paneCwd — a peer's path is never spawned locally (GT-5c, the 2026-08-06 erratum)", () => {
  // The finding, restored as a test: `paneCwd` decoded the URL and returned
  // `url.pathname`, DISCARDING the host, while its own comment said this was
  // where a foreign one "would be caught" and the spec read that TODO as a
  // safeguard that existed. Existing locally, the peer's path opened a shell on
  // the wrong machine's directory; absent, `createSession` threw and the pane
  // vanished without a word.

  it("refuses a pane the deck recorded as a PEER'S, whatever its path says", () => {
    // The authoritative branch: locality is stamped at persist time, when the
    // deck knows it, rather than reconstructed from a hostname later.
    expect(
      paneCwd({ cwd: "file://studio-mini.local/Users/peer/src", remoteDevice: "studio-mini" }),
    ).toBeNull();
    // Even a bare path — a peer whose ghosttea reports one — is a peer's path.
    expect(paneCwd({ cwd: "/Users/peer/src", remoteDevice: "studio-mini" })).toBeNull();
  });

  it("refuses a URL whose host is not this device's", () => {
    expect(
      paneCwd({ cwd: "file://studio-mini.local/Users/peer/src" }, "jamess-macbook"),
    ).toBeNull();
  });

  it("accepts this device's own host, case- and trailing-dot-insensitively", () => {
    expect(paneCwd({ cwd: "file://Jamess-MacBook.local/Users/x" }, "jamess-macbook.local")).toBe(
      "/Users/x",
    );
    expect(paneCwd({ cwd: "file://jamess-macbook.local./Users/x" }, "jamess-macbook.local")).toBe(
      "/Users/x",
    );
  });

  it("reads a hostless URL and localhost as this machine (RFC 8089)", () => {
    expect(paneCwd({ cwd: "file:///Users/x" }, "jamess-macbook")).toBe("/Users/x");
    expect(paneCwd({ cwd: "file://localhost/Users/x" }, "jamess-macbook")).toBe("/Users/x");
  });

  it("still decodes percent-encoding, plain paths, and nothing else", () => {
    expect(paneCwd({ cwd: "file:///Users/x/My%20Repo" }, "jamess-macbook")).toBe(
      "/Users/x/My Repo",
    );
    expect(paneCwd({ cwd: "/repo/api" }, "jamess-macbook")).toBe("/repo/api");
    expect(paneCwd({ cwd: "https://example.com/x" }, "jamess-macbook")).toBeNull();
    expect(paneCwd({}, "jamess-macbook")).toBeNull();
    expect(paneCwd(null, "jamess-macbook")).toBeNull();
  });

  it("falls back to the pre-GT-5c reading only when no local host has been learned", () => {
    // Named residual, and narrow by construction: reachable only from a layout
    // persisted before this slice, since every pane written since carries
    // `remoteDevice` when it is a peer's.
    expect(paneCwd({ cwd: "file://some-host/Users/x" })).toBe("/Users/x");
  });
});

describe("the device host, learned rather than asked for (GT-5c)", () => {
  it("remembers the host a LOCAL pane announced, and normalizes it", () => {
    localStorage.clear();
    rememberDeviceHost("file://Jamess-MacBook.local/Users/x");
    expect(readDeviceHost()).toBe("jamess-macbook.local");
    // …and that value is exactly what makes the comparison above run.
    expect(paneCwd({ cwd: "file://studio-mini/Users/p" }, readDeviceHost())).toBeNull();
  });

  it("learns nothing from a cwd that names no host", () => {
    localStorage.clear();
    rememberDeviceHost("file:///Users/x");
    rememberDeviceHost("/Users/x");
    rememberDeviceHost(null);
    expect(readDeviceHost()).toBeNull();
  });
});

// ---- the kill affordance (GT-3, GT-D5), RETIRED at GT-6a -------------------
//
// Five rows lived here: the two-step arm, the audited `terminal.terminate`,
// the cancel, the silence for an already-exited session, and the verbatim
// refusal. They went with the chip the record's frame displaced (§07 names a
// pane's whole chrome and no kill is in it). They are not rewritten against
// another surface because there is no other surface: the monitor's actions
// are `select` and `createAt` alone, and ghosttea's own pane close detaches.
// If an end-a-session gesture comes back, these rows are in this file's
// history at 522065df and should come back with it.

// ---- the overlay state and the toggle button, RETIRED with One Frame FR-1 ---
//
// Godview's open bit and its corner button gave way to the window's one view
// owner and the views track (main's `view.ts`, the renderer's
// `frame/view-state.ts`); their rows — follows the host, no optimistic echo,
// stays put on a host with no door, the button presses the owner's door — are
// rewritten against the view in `view-frame.test.tsx`.
