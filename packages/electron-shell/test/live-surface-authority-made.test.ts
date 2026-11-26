import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type LiveSurfaceAttachTicketV1,
  type LiveSurfaceBrowserSourceV1,
  PAGES_MADE_EMULATION,
  PAGES_RUN_PROFILE_PREFIX,
  type RendererParticipantIdentity,
  type ShellSurfacesMintParams,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { describe, expect, it } from "vitest";
import {
  ADOPT_GRACE_MS,
  HELD_PAGES_MAX,
  KEPT_UNUSED_MS,
  LiveSurfaceAuthority,
  type LiveSurfaceAuthorityDeps,
  type LiveSurfaceMakeForRun,
  type LiveSurfaceRuntimeHandle,
  RUN_PROFILE_PREFIX,
} from "../src/main/live-surfaces/authority";

// EY-1 (1f, 2026-11-19): a run's made pages in main's custody. A page an agent's call makes is
// minted for its run and held by the run, with no window as its owner, until a window's mint naming
// it (`made`) adopts it. The run's own session is reserved: it opens only by an adopt, or for a key
// main adopted into that run while the run lives, and it is cleared once the run has ended and its
// last page is gone. Fakes only: no Electron, the grace on an injected timer, no signal.

const WINDOW = 7;
const OTHER_WINDOW = 8;

const VIEWPORT = { logicalViewport: { width: 320, height: 180 }, deviceScaleFactor: 1 } as const;

const MAKE: LiveSurfaceMakeForRun = {
  run: "r1",
  url: "https://example.test/a",
  by: "tab",
  ...VIEWPORT,
};

function participant(id: string, incarnation = "1"): RendererParticipantIdentity {
  return { participantId: id, incarnation: `${id}:${incarnation}` };
}

function runSource(run: string): LiveSurfaceBrowserSourceV1 {
  return {
    kind: "browser",
    initialUrl: "https://example.test/a",
    profile: { mode: "memory", ref: `run:${run}` },
    ...VIEWPORT,
  };
}

/** EY-1 (F2, 2026-11-24): the source custody makes a run's page from: the run's session, on the pane's default device. */
function madeSource(run: string): LiveSurfaceBrowserSourceV1 {
  return { ...runSource(run), emulation: { ...PAGES_MADE_EMULATION } };
}

const DESK_SOURCE: LiveSurfaceBrowserSourceV1 = {
  kind: "browser",
  initialUrl: "https://example.test/a",
  profile: { mode: "persistent", ref: "desk" },
  ...VIEWPORT,
};

/** A window's mint, with the adopt field (`made`) of 1f's contract. */
function mint(
  identity: RendererParticipantIdentity,
  source: LiveSurfaceBrowserSourceV1,
  extra: { reuseKey?: string; made?: string } = {},
): ShellSurfacesMintParams {
  return { rendererParticipant: identity, source, ...extra };
}

/** A logger that keeps the events said, by name. */
function logs(): { logger: Logger; events: string[] } {
  const events: string[] = [];
  const say = (event: string): void => {
    events.push(event);
  };
  const logger = { debug: say, info: say, warn: say, error: say, fatal: say };
  return { logger: logger as unknown as Logger, events };
}

/** What a call threw, or undefined. */
function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

interface FakeTimer {
  readonly run: () => void;
  readonly ms: number;
  cleared: boolean;
}

function fixture(overrides: Partial<LiveSurfaceAuthorityDeps> = {}) {
  const built: { surfaceId: string; source: LiveSurfaceBrowserSourceV1 }[] = [];
  const disposed: string[] = [];
  /** EY-1 (S1): the pages asked to hold for their run, in order */
  const held: string[] = [];
  const timers: FakeTimer[] = [];
  const cleared: string[] = [];
  const gone: [string, string, string][] = [];
  /** EY-1 (C7, C8): each held page's word that it failed, as custody gave it with the hold */
  const failures = new Map<string, () => void>();
  /** EY-1 (C6): the clock (unix ms), and when the pages plane last asked for each page's control binding */
  const clock = { now: 1_000_000 };
  const asked = new Map<string, number>();
  const windows = new Map<string, { webContentsId: number }>();
  const product = new Set<number>([WINDOW]);
  /** EY-1 (C4): each window's renderer generation, as its host says it (one more at each document it loads); a window
   * a row never sets says none */
  const generations = new Map<number, number>();
  /** EY-1 (C4): the windows with no standing document now (the first load not ended, or between two documents), as
   * their hosts say it */
  const loading = new Set<number>();
  let ids = 0;
  const runtime = (surfaceId: string): LiveSurfaceRuntimeHandle => ({
    surfaceId,
    attach: () => {
      throw new Error("attach is the control session's job, not this suite's");
    },
    dispose: () => {
      disposed.push(surfaceId);
    },
    holdForRun: (onFailed) => {
      held.push(surfaceId);
      if (onFailed !== undefined) failures.set(surfaceId, onFailed);
    },
    agentAskedAt: () => asked.get(surfaceId) ?? null,
  });
  const notHere = (): never => {
    throw new Error("only browser pages here");
  };
  const ticket = (): LiveSurfaceAttachTicketV1 => ({ v: 1, token: `ticket-${"x".repeat(32)}` });
  const deps: LiveSurfaceAuthorityDeps = {
    resolveWindow: (identity) => windows.get(identity.incarnation) ?? null,
    hostFor: (webContentsId) => {
      if (!product.has(webContentsId)) return null;
      const generation = generations.get(webContentsId);
      const host = generation === undefined ? {} : { rendererGeneration: generation };
      const live = loading.has(webContentsId) ? { rendererLive: false } : {};
      return Object.assign(host, live, { issue: ticket });
    },
    factories: {
      browser: (surfaceId, source) => {
        built.push({ surfaceId, source });
        return runtime(surfaceId);
      },
      sckWindow: notHere,
      iosSimulator: notHere,
      iosSimulatorDevice: notHere,
    },
    enumeration: null,
    randomId: () => {
      ids += 1;
      return `s-made-${ids}`;
    },
    productWindows: () => [...product],
    timers: {
      setTimeout: (run, ms) => {
        const timer: FakeTimer = { run, ms, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (handle) => {
        (handle as FakeTimer).cleared = true;
      },
    },
    clearRunPartition: (source) => {
      cleared.push(source.profile.ref);
      return Promise.resolve();
    },
    onMadeDisposed: (run, surfaceId, why) => {
      gone.push([run, surfaceId, why]);
    },
    now: () => clock.now,
    ...overrides,
  };
  const authority = new LiveSurfaceAuthority(deps);
  /** Runs the grace timers still standing. */
  const elapse = (): void => {
    for (const timer of timers.splice(0)) if (!timer.cleared) timer.run();
  };
  return {
    authority,
    built,
    disposed,
    held,
    timers,
    elapse,
    cleared,
    gone,
    failures,
    clock,
    asked,
    windows,
    product,
    generations,
    loading,
  };
}

describe("a run's made pages (EY-1 1f)", () => {
  it("makes a page in the run's own memory profile, held by the run with no window as its owner", () => {
    const { authority, built } = fixture();
    const made = authority.makeForRun(MAKE);
    expect(built).toEqual([{ surfaceId: made.surfaceId, source: madeSource("r1") }]);
    expect(authority.state()).toMatchObject({ runtimes: 1, owners: 0 });
  });

  // EY-1 (F2, 2026-11-24): a made page is born on the pane's default device (contracts' word), so the desk's first
  // word of its device at the adopt is no switch. The make's own size is kept; its density is the device's.
  it("makes a run's page on the browser pane's default device, whatever density its make names", () => {
    const { authority, built } = fixture();
    authority.makeForRun({ ...MAKE, deviceScaleFactor: 3 });
    expect(built[0]?.source.emulation).toEqual({
      deviceScaleFactor: 2,
      mobile: false,
      touchPoints: 0,
    });
    expect(built[0]?.source.emulation).toEqual(PAGES_MADE_EMULATION);
    expect(built[0]?.source.logicalViewport).toEqual(MAKE.logicalViewport);
    // each page its own copy: nothing a producer does to one reaches the next
    authority.makeForRun(MAKE);
    expect(built[1]?.source.emulation).not.toBe(built[0]?.source.emulation);
  });

  // EY-1 (2026-11-24): the window names a made pane's session from contracts' word, so main's prefix is that word
  // and no literal of its own: the two can never drift apart.
  it("names a run's session by contracts' one prefix, and keeps no literal of its own", () => {
    expect(RUN_PROFILE_PREFIX).toBe(PAGES_RUN_PROFILE_PREFIX);
    const { authority, built } = fixture();
    authority.makeForRun(MAKE);
    expect(built[0]?.source.profile).toEqual({
      mode: "memory",
      ref: `${PAGES_RUN_PROFILE_PREFIX}r1`,
    });
    const text = readFileSync(
      join(import.meta.dirname, "../src/main/live-surfaces/authority.ts"),
      "utf8",
    );
    // (a boolean, so a failure does not print the file)
    expect(text.includes("export const RUN_PROFILE_PREFIX = PAGES_RUN_PROFILE_PREFIX;")).toBe(true);
  });

  // (EY-1 C4, 2026-11-24: re-made. It closed the desk's only window and expected the page held on.)
  it("never lets a release, or a window's close while another desk stands, dispose a page the run holds", () => {
    const { authority, windows, disposed, product } = fixture();
    product.add(OTHER_WINDOW);
    const made = authority.makeForRun(MAKE);
    authority.releaseAllForWebContents(WINDOW);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    expect(authority.release({ rendererParticipant: alice, surfaceId: made.surfaceId })).toEqual({
      released: false,
    });
    expect(disposed).toEqual([]);
    expect(authority.state().runtimes).toBe(1);
  });

  // EY-1 (C4, 2026-11-24): a held page was made for the desk of the windows that stood, and a make with no window is
  // refused. When the last of them goes, no desk is left for it to land on and no document that could name it, so it
  // goes with the window, as every page a window owns does. It stood on unseen, its run still working it, to the
  // run's end.
  it("lets every held page go with the last product window, kept or not, and tells each run; a new window's panes then leave", () => {
    const { authority, disposed, gone, windows, product } = fixture();
    product.add(OTHER_WINDOW);
    const waited = authority.makeForRun(MAKE);
    const kept = authority.makeForRun({ ...MAKE, run: "r2" });
    authority.keepForRun("r2", kept.surfaceId);
    // one of two desks goes: the other may still place them
    product.delete(OTHER_WINDOW);
    authority.releaseAllForWebContents(OTHER_WINDOW);
    expect(disposed).toEqual([]);
    // the last one goes (closed to the tray): the pages go with it
    product.delete(WINDOW);
    authority.releaseAllForWebContents(WINDOW);
    expect(disposed).toEqual([waited.surfaceId, kept.surfaceId]);
    expect(gone).toEqual([
      ["r1", waited.surfaceId, "grace"],
      ["r2", kept.surfaceId, "grace"],
    ]);
    expect(authority.state().runtimes).toBe(0);
    // the window comes back: a pane placed for either page, with its made id or without, is told it is gone for good
    product.add(WINDOW);
    const alice = participant("alice", "2");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    const closed = { kind: "PRECONDITION_FAILED", state: "made-closed" };
    expect(
      thrown(() =>
        authority.mint(
          mint(alice, runSource("r1"), { reuseKey: "pane-1", made: waited.surfaceId }),
        ),
      ),
    ).toEqual(closed);
    expect(
      thrown(() => authority.mint(mint(alice, runSource("r2"), { reuseKey: "pane-2" }))),
    ).toEqual(closed);
    // and each run, still alive, makes another page now that a desk stands
    expect(thrown(() => authority.makeForRun(MAKE))).toBeUndefined();
  });

  it("refuses with no window, and when every window's room is 0; any window with room makes", () => {
    const { authority, built, product } = fixture();
    product.clear();
    expect(thrown(() => authority.makeForRun(MAKE))).toEqual({
      kind: "UNAVAILABLE",
      state: "no-window",
    });
    product.add(WINDOW);
    product.add(OTHER_WINDOW);
    // a window that has not told its room is not counted full: the adopt's own check decides
    authority.makeForRun(MAKE);
    authority.setRoom(WINDOW, 0);
    authority.setRoom(OTHER_WINDOW, 1);
    authority.makeForRun(MAKE);
    authority.setRoom(OTHER_WINDOW, 0);
    expect(thrown(() => authority.makeForRun(MAKE))).toEqual({
      kind: "RESOURCE_EXHAUSTED",
      state: "desk-full",
    });
    expect(built).toHaveLength(2);
  });

  it("is bounded by custody's own cap", () => {
    const { authority } = fixture({ limits: { maxRuntimes: 1 } });
    authority.makeForRun(MAKE);
    expect(thrown(() => authority.makeForRun(MAKE))).toEqual({ kind: "RESOURCE_EXHAUSTED" });
  });

  it("adopts the run's page on a window's mint naming it: the same page, the window its owner", () => {
    const { authority, built, disposed, timers, windows } = fixture();
    const made = authority.makeForRun(MAKE);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    const adopted = authority.mint(
      mint(alice, runSource("r1"), { reuseKey: "pane-1", made: made.surfaceId }),
    );
    expect(adopted.surfaceId).toBe(made.surfaceId);
    expect(built).toHaveLength(1);
    expect(authority.state()).toMatchObject({ runtimes: 1, owners: 1 });
    expect(timers.every((timer) => timer.cleared)).toBe(true);
    // the run's hold is gone: the page now lives and goes with its window, as any pane does
    authority.releaseAllForWebContents(WINDOW);
    expect(disposed).toEqual([made.surfaceId]);
  });

  it("refuses a made naming no held page, another run, another profile, or a page already adopted", () => {
    const { authority, built, windows } = fixture();
    const made = authority.makeForRun(MAKE);
    const alice = participant("alice");
    const bob = participant("bob");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    windows.set(bob.incarnation, { webContentsId: WINDOW });
    const refused = { kind: "PRECONDITION_FAILED" };
    const adopt = (
      who: RendererParticipantIdentity,
      source: LiveSurfaceBrowserSourceV1,
      made: string,
    ): unknown => thrown(() => authority.mint(mint(who, source, { reuseKey: "pane-1", made })));
    expect(adopt(alice, runSource("r1"), "s-not-made")).toEqual({
      ...refused,
      state: "made-closed",
    });
    expect(adopt(alice, DESK_SOURCE, "s-not-made")).toEqual(refused);
    expect(adopt(alice, runSource("r2"), made.surfaceId)).toEqual(refused);
    expect(adopt(alice, DESK_SOURCE, made.surfaceId)).toEqual(refused);
    expect(adopt(alice, runSource("r1"), made.surfaceId)).toBeUndefined();
    expect(adopt(bob, runSource("r1"), made.surfaceId)).toEqual(refused);
    expect(built).toHaveLength(1);
  });

  it("disposes a page no window adopted at the grace, and says it as the run's", () => {
    const { authority, disposed, timers, elapse, gone } = fixture();
    const made = authority.makeForRun(MAKE);
    expect(ADOPT_GRACE_MS).toBe(30_000);
    expect(timers.map((timer) => timer.ms)).toEqual([ADOPT_GRACE_MS]);
    elapse();
    expect(disposed).toEqual([made.surfaceId]);
    expect(gone).toEqual([["r1", made.surfaceId, "grace"]]);
    expect(authority.state().runtimes).toBe(0);
  });

  it("disposes a held page at once when a window declines to place it; an adopted one stays", () => {
    const { authority, disposed, gone, windows } = fixture();
    const declined = authority.makeForRun(MAKE);
    const kept = authority.makeForRun(MAKE);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-2", made: kept.surfaceId }));
    authority.declineMade(WINDOW, "s-not-made");
    authority.declineMade(WINDOW, kept.surfaceId);
    authority.declineMade(WINDOW, declined.surfaceId);
    expect(disposed).toEqual([declined.surfaceId]);
    expect(gone).toEqual([["r1", declined.surfaceId, "declined"]]);
  });

  it("never re-mints an adopted page's key out of the run's profile, from any window", () => {
    const { authority, built, windows, product } = fixture();
    product.add(OTHER_WINDOW);
    const made = authority.makeForRun(MAKE);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-1", made: made.surfaceId }));
    const reloaded = participant("alice", "2");
    const bob = participant("bob");
    windows.set(reloaded.incarnation, { webContentsId: WINDOW });
    windows.set(bob.incarnation, { webContentsId: OTHER_WINDOW });
    const again = (who: RendererParticipantIdentity, source: LiveSurfaceBrowserSourceV1) =>
      authority.mint(mint(who, source, { reuseKey: "pane-1" }));
    const refused = { kind: "PRECONDITION_FAILED" };
    expect(thrown(() => again(reloaded, DESK_SOURCE))).toEqual(refused);
    expect(thrown(() => again(bob, DESK_SOURCE))).toEqual(refused);
    // a reload re-binds the same page; a second window's mint of the key opens in the run's profile
    expect(again(reloaded, runSource("r1")).surfaceId).toBe(made.surfaceId);
    again(bob, runSource("r1"));
    // (the made page is born on the pane's default device; the second window's own mint names its own)
    expect(built.map((page) => page.source)).toEqual([madeSource("r1"), runSource("r1")]);
  });

  it("opens a run's session only by an adopt or a key adopted into it: a synced pane opens nothing", () => {
    const { authority, built, windows } = fixture();
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    const keyed = (run: string, reuseKey?: string): unknown => {
      const extra = reuseKey === undefined ? {} : { reuseKey };
      return thrown(() => authority.mint(mint(alice, runSource(run), extra)));
    };
    const refused = { kind: "PRECONDITION_FAILED" };
    // a pane synced from another device names a run this main never had
    expect(keyed("r9", "pane-9")).toEqual(refused);
    expect(keyed("r9")).toEqual(refused);
    const made = authority.makeForRun(MAKE);
    const held = authority.makeForRun(MAKE);
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-1", made: made.surfaceId }));
    // (EY-1 C4, 2026-11-24: while the run holds a page this document may yet name, the refusal is bare)
    expect(keyed("r1", "other")).toEqual(refused);
    expect(built).toHaveLength(2);
    // and with none held, the pane can never be given a page: it is told so, and still nothing opens
    authority.closeMade("r1", held.surfaceId);
    expect(keyed("r1", "other")).toEqual({ ...refused, state: "made-closed" });
    expect(built).toHaveLength(2);
  });

  it("at the run's end: its held pages go, no mint enters its session, and it is cleared after its last page", async () => {
    const { authority, cleared, disposed, gone, windows } = fixture();
    const held = authority.makeForRun(MAKE);
    const adopted = authority.makeForRun(MAKE);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-2", made: adopted.surfaceId }));
    expect(await authority.endRun("r1")).toEqual({ disposed: 1, clearing: "waiting" });
    expect(disposed).toEqual([held.surfaceId]);
    expect(gone).toEqual([["r1", held.surfaceId, "run-end"]]);
    // a page in the person's window stays as it stands, so the clear waits for it
    expect(cleared).toEqual([]);
    const reloaded = participant("alice", "2");
    windows.set(reloaded.incarnation, { webContentsId: WINDOW });
    const remint = () => authority.mint(mint(reloaded, runSource("r1"), { reuseKey: "pane-2" }));
    expect(thrown(remint)).toEqual({ kind: "PRECONDITION_FAILED", state: "made-closed" });
    // EY-1 (C4, 2026-11-24): a key never adopted into the run is told the same once the run has ended: nothing is held
    // for it, so no page can come to its pane (before: bare, and the pane of a page the run's end let go stood on a
    // failure). A run this main never had stays bare
    const stranger = () => authority.mint(mint(reloaded, runSource("r1"), { reuseKey: "pane-9" }));
    expect(thrown(stranger)).toEqual({ kind: "PRECONDITION_FAILED", state: "made-closed" });
    const foreign = () => authority.mint(mint(reloaded, runSource("r9"), { reuseKey: "pane-9" }));
    expect(thrown(foreign)).toEqual({ kind: "PRECONDITION_FAILED" });
    authority.releaseAllForWebContents(WINDOW);
    await Promise.resolve();
    expect(cleared).toEqual(["run:r1"]);
    // ended, the run's session stays shut
    expect(thrown(() => authority.makeForRun(MAKE))).toEqual({ kind: "PRECONDITION_FAILED" });
  });

  it("clears a run's session at its end at once when no page of it lives", async () => {
    const { authority, cleared } = fixture();
    authority.makeForRun(MAKE);
    expect(await authority.endRun("r1")).toEqual({ disposed: 1, clearing: "now" });
    expect(cleared).toEqual(["run:r1"]);
    expect(await authority.endRun("r2")).toEqual({ disposed: 0, clearing: "none" });
    expect(cleared).toEqual(["run:r1"]);
  });

  // EY-1 (1f, 2026-11-19): main's early check of the desk's room is a hint. A window that has not
  // said its room is unknown, not full, and the desk's adopt decides; deskHasRoom is the one read
  // of the rule, which the pages broker's pop-up answer asks too.
  it("counts a window that has not said its room as unknown, not full: deskHasRoom is the one read", () => {
    const { authority, product } = fixture();
    product.add(OTHER_WINDOW);
    authority.setRoom(WINDOW, 0);
    // one window at 0 and another untold: the desk may have room
    expect(authority.deskHasRoom()).toBe(true);
    expect(thrown(() => authority.makeForRun(MAKE))).toBeUndefined();
    authority.setRoom(OTHER_WINDOW, 0);
    expect(authority.deskHasRoom()).toBe(false);
    expect(thrown(() => authority.makeForRun(MAKE))).toEqual({
      kind: "RESOURCE_EXHAUSTED",
      state: "desk-full",
    });
    authority.setRoom(OTHER_WINDOW, 2);
    expect(authority.deskHasRoom()).toBe(true);
    product.clear();
    expect(authority.deskHasRoom()).toBe(false);
  });

  it("keeps no room said by a window that is not a product window", () => {
    const { authority, product } = fixture();
    // said before it was a product window: not kept, so once it is one it has said nothing yet
    authority.setRoom(OTHER_WINDOW, 0);
    product.add(OTHER_WINDOW);
    authority.setRoom(WINDOW, 0);
    expect(thrown(() => authority.makeForRun(MAKE))).toBeUndefined();
  });

  it("says a decline naming a page no run holds, and lets nothing go", () => {
    const { logger, events } = logs();
    const { authority, disposed, gone } = fixture({ logger });
    authority.makeForRun(MAKE);
    authority.declineMade(WINDOW, "s-made-unknown");
    const unheld = events.filter((event) => event === "desktop.live_surfaces.made_decline_unheld");
    expect(unheld).toHaveLength(1);
    expect(disposed).toEqual([]);
    expect(gone).toEqual([]);
    expect(authority.state().runtimes).toBe(1);
  });
});

// EY-1 (7b, 2026-11-19): ONE record per run, kept under its first id while fieldd may name it by another (a resume's
// rebind): every page of the run lands in the record's own session, its ids all find it, and main's close of a page
// keeps its key shut for the record's life.
describe("one record per run, through a resume and main's close (EY-1 7b)", () => {
  const refused = { kind: "PRECONDITION_FAILED" };
  // the one word a window's pane leaves on (SHELL_SURFACES_MADE_CLOSED)
  const closed = { kind: "PRECONDITION_FAILED", state: "made-closed" };

  it("a page made after the rebind, and a re-mint under either id, lands in the record's own session", () => {
    const { authority, built, windows, product } = fixture();
    product.add(OTHER_WINDOW);
    const made = authority.makeForRun(MAKE);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-1", made: made.surfaceId }));
    expect(authority.rebindRun("r1", "r2")).toBe(true);
    expect(authority.madeBy(made.surfaceId)).toBe("r2");
    authority.makeForRun({ ...MAKE, run: "r2" });
    const bob = participant("bob");
    const carol = participant("carol");
    windows.set(bob.incarnation, { webContentsId: OTHER_WINDOW });
    windows.set(carol.incarnation, { webContentsId: OTHER_WINDOW });
    authority.mint(mint(bob, runSource("r2"), { reuseKey: "pane-1" }));
    authority.mint(mint(carol, runSource("r1"), { reuseKey: "pane-1" }));
    expect(built.map((page) => page.source.profile.ref)).toEqual([
      "run:r1",
      "run:r1",
      "run:r1",
      "run:r1",
    ]);
  });

  it("after a rebind, a former id with a key the record does not hold is refused, and so is an unknown run", () => {
    const { authority, built, windows } = fixture();
    const made = authority.makeForRun(MAKE);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-1", made: made.surfaceId }));
    expect(authority.rebindRun("r1", "r2")).toBe(true);
    const reloaded = participant("alice", "2");
    windows.set(reloaded.incarnation, { webContentsId: WINDOW });
    const remint = (run: string, reuseKey: string) =>
      thrown(() => authority.mint(mint(reloaded, runSource(run), { reuseKey })));
    // (EY-1 C4, 2026-11-24: nothing is held for the run, so a key it never adopted is told it is gone for good; it
    // was bare. It opens nothing either way)
    expect(remint("r1", "other")).toEqual(closed);
    expect(remint("r9", "pane-1")).toEqual(refused);
    expect(built).toHaveLength(1);
  });

  it("refuses a rebind from an unknown run, onto an id that names a record, or of an ended run", async () => {
    const { authority } = fixture();
    expect(authority.rebindRun("r9", "r10")).toBe(false);
    authority.makeForRun(MAKE);
    authority.makeForRun({ ...MAKE, run: "r5" });
    expect(authority.rebindRun("r1", "r5")).toBe(false);
    await authority.endRun("r5");
    expect(authority.rebindRun("r5", "r6")).toBe(false);
    expect(authority.madeBy("s-made-1")).toBe("r1");
  });

  it("at the end under the new id: a page held before the rebind goes, said by the new id, and the session is cleared once", async () => {
    const { authority, cleared, gone, windows } = fixture();
    const held = authority.makeForRun(MAKE);
    const adopted = authority.makeForRun(MAKE);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-2", made: adopted.surfaceId }));
    expect(authority.rebindRun("r1", "r2")).toBe(true);
    expect(await authority.endRun("r2")).toEqual({ disposed: 1, clearing: "waiting" });
    expect(gone).toEqual([["r2", held.surfaceId, "run-end"]]);
    expect(cleared).toEqual([]);
    authority.releaseAllForWebContents(WINDOW);
    await Promise.resolve();
    expect(cleared).toEqual(["run:r1"]);
  });

  it("main's close: the page goes and its key is never minted again, across a rebind; another key still re-mints", () => {
    const { authority, built, disposed, gone, windows } = fixture();
    const first = authority.makeForRun(MAKE);
    const second = authority.makeForRun(MAKE);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-1", made: first.surfaceId }));
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-2", made: second.surfaceId }));
    expect(authority.closeMade("r1", first.surfaceId)).toBe(true);
    expect(disposed).toEqual([first.surfaceId]);
    // main closed it: no grace and no decline to tell
    expect(gone).toEqual([]);
    const reloaded = participant("alice", "2");
    windows.set(reloaded.incarnation, { webContentsId: WINDOW });
    const remint = (run: string, reuseKey: string) =>
      thrown(() => authority.mint(mint(reloaded, runSource(run), { reuseKey })));
    expect(remint("r1", "pane-1")).toEqual(closed);
    expect(remint("r1", "pane-2")).toBeUndefined();
    expect(authority.rebindRun("r1", "r2")).toBe(true);
    expect(remint("r2", "pane-1")).toEqual(closed);
    // a page of no such run, or of another, is untouched
    expect(authority.closeMade("r9", second.surfaceId)).toBe(false);
    expect(authority.closeMade("r2", "s-made-404")).toBe(false);
    expect(built).toHaveLength(2);
  });

  it("names a run page's run by the id fieldd names it by now, and no run for a desk page", () => {
    const { authority, windows } = fixture();
    const made = authority.makeForRun(MAKE);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    const desk = authority.mint(mint(alice, DESK_SOURCE));
    expect(authority.madeBy(made.surfaceId)).toBe("r1");
    expect(authority.madeBy(desk.surfaceId)).toBeNull();
    expect(authority.madeBy("s-made-404")).toBeNull();
  });

  it("refuses a closed key's adopt of another page the run holds, with the word", () => {
    const { authority, built, timers, windows } = fixture();
    const first = authority.makeForRun(MAKE);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-1", made: first.surfaceId }));
    expect(authority.closeMade("r1", first.surfaceId)).toBe(true);
    const second = authority.makeForRun(MAKE);
    const adopt = () =>
      authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-1", made: second.surfaceId }));
    expect(thrown(adopt)).toEqual(closed);
    // the second page is still the run's, held, and nothing more was made
    expect(authority.madeBy(second.surfaceId)).toBe("r1");
    expect(timers.at(-1)?.cleared).toBe(false);
    expect(built).toHaveLength(2);
  });

  it("main's close of a held page leaves no grace behind: its run is never told it went", () => {
    const { authority, disposed, elapse, gone, timers } = fixture();
    const held = authority.makeForRun(MAKE);
    expect(authority.closeMade("r1", held.surfaceId)).toBe(true);
    expect(timers.every((timer) => timer.cleared)).toBe(true);
    elapse();
    expect(disposed).toEqual([held.surfaceId]);
    expect(gone).toEqual([]);
  });

  it("a page main let go is gone for good: a first mint naming it says the word; another run's says nothing", () => {
    const { authority, built, elapse, windows } = fixture();
    const graced = authority.makeForRun(MAKE);
    elapse();
    const kept = authority.makeForRun({ ...MAKE, run: "r2" });
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    const adopt = (run: string, made: string) =>
      thrown(() => authority.mint(mint(alice, runSource(run), { reuseKey: "pane-1", made })));
    expect(adopt("r1", graced.surfaceId)).toEqual(closed);
    // a run mismatch (a stale or forged prop) never removes a pane
    expect(adopt("r1", kept.surfaceId)).toEqual(refused);
    expect(built).toHaveLength(2);
  });
});

// EY-1 (S1, 2026-11-24): a page main made for a run is held for its run from its make (started with no window
// attached), and once the run was told of it the adopt grace no longer ends it: it goes by a window's mint (adopted),
// the desk's decline, its run's own close, or its run's end. The grace stands for a page no answer named.
describe("a made page its run is using (EY-1 S1)", () => {
  it("holds the page it made for its run from the make; a window's own mint asks no hold", () => {
    const { authority, held, windows } = fixture();
    const made = authority.makeForRun(MAKE);
    expect(held).toEqual([made.surfaceId]);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    authority.mint(mint(alice, DESK_SOURCE));
    expect(held).toEqual([made.surfaceId]);
  });

  it("keeps a page its run was told of: no grace ends it, and a window's mint naming it adopts it long after", () => {
    const { authority, asked, clock, disposed, timers, elapse, gone, windows, product } = fixture();
    const made = authority.makeForRun(MAKE);
    expect(authority.keepForRun("r1", made.surfaceId)).toBe(true);
    // the 30 s clock is gone; the run's hold is not. EY-1 (C6): the kept page has its own clock, which its run's use
    // of the page carries on (the run asks for it here as that clock runs out, so it stands)
    expect(timers.map((timer) => [timer.ms, timer.cleared])).toEqual([
      [ADOPT_GRACE_MS, true],
      [KEPT_UNUSED_MS, false],
    ]);
    clock.now += KEPT_UNUSED_MS;
    asked.set(made.surfaceId, clock.now);
    elapse();
    expect(disposed).toEqual([]);
    expect(gone).toEqual([]);
    expect(authority.madeBy(made.surfaceId)).toBe("r1");
    // kept, it is still no window's: a window's close, with another desk standing, lets nothing go (EY-1 C4: the last
    // desk's going takes it)
    product.add(OTHER_WINDOW);
    authority.releaseAllForWebContents(OTHER_WINDOW);
    product.delete(OTHER_WINDOW);
    expect(authority.state()).toMatchObject({ runtimes: 1, owners: 0 });
    // and it is adopted only by a mint that names it, in its own run's session
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    const adopt = (source: LiveSurfaceBrowserSourceV1): unknown =>
      thrown(() =>
        authority.mint(mint(alice, source, { reuseKey: "pane-1", made: made.surfaceId })),
      );
    expect(adopt(DESK_SOURCE)).toEqual({ kind: "PRECONDITION_FAILED" });
    expect(adopt(runSource("r2"))).toEqual({ kind: "PRECONDITION_FAILED" });
    expect(adopt(runSource("r1"))).toBeUndefined();
    expect(authority.state()).toMatchObject({ runtimes: 1, owners: 1 });
    // adopted, it is its window's: asked again, nothing is kept, and no clock of custody's is left on it
    expect(authority.keepForRun("r1", made.surfaceId)).toBe(false);
    expect(timers.every((timer) => timer.cleared)).toBe(true);
  });

  // EY-1 (C6, 2026-11-24): the keep is set as the answer naming the page leaves main, and that answer may never reach
  // the run. So the keep lasts while the run uses the page: its clock runs from the keep, begins again at each asking
  // for the page's control binding, and at its end the page is let go, said as unused in custody's log.
  it("lets a kept page go when its run has asked nothing of it for thirty minutes, counted from its last asking; said as unused in its log and as grace to the broker's port", () => {
    const said: [string, Record<string, unknown>][] = [];
    const say = (event: string, _message: string, fields?: Record<string, unknown>): void => {
      if (event === "desktop.live_surfaces.made_let_go") said.push([event, { ...fields }]);
    };
    const logger = {
      debug: say,
      info: say,
      warn: say,
      error: say,
      fatal: say,
    } as unknown as Logger;
    const { authority, asked, clock, disposed, elapse, gone, timers } = fixture({ logger });
    expect(KEPT_UNUSED_MS).toBe(30 * 60_000);
    const made = authority.makeForRun(MAKE);
    const keptAt = clock.now;
    authority.keepForRun("r1", made.surfaceId);
    // told again of the same page, nothing moves: one clock, from the first keep
    expect(authority.keepForRun("r1", made.surfaceId)).toBe(true);
    expect(timers.filter((timer) => !timer.cleared).map((timer) => timer.ms)).toEqual([
      KEPT_UNUSED_MS,
    ]);
    // the run asked for the page ten minutes before the clock ran out: the clock runs on for the twenty left
    asked.set(made.surfaceId, keptAt + 20 * 60_000);
    clock.now = keptAt + KEPT_UNUSED_MS;
    elapse();
    expect(disposed).toEqual([]);
    expect(timers.filter((timer) => !timer.cleared).map((timer) => timer.ms)).toEqual([
      20 * 60_000,
    ]);
    // an asking from before the keep (the make's own wait) counts for nothing against the keep's own time
    clock.now = keptAt + 50 * 60_000;
    elapse();
    expect(disposed).toEqual([made.surfaceId]);
    expect(gone).toEqual([["r1", made.surfaceId, "grace"]]);
    expect(said).toEqual([
      ["desktop.live_surfaces.made_let_go", { surfaceId: made.surfaceId, why: "unused", kept: 1 }],
    ]);
    expect(authority.madeBy(made.surfaceId)).toBeNull();
  });

  it("lets a kept page go by the desk's decline, by its run's own close, and at its run's end", async () => {
    const { authority, cleared, disposed, gone } = fixture();
    const declined = authority.makeForRun(MAKE);
    const closed = authority.makeForRun(MAKE);
    const ended = authority.makeForRun(MAKE);
    for (const page of [declined, closed, ended]) {
      expect(authority.keepForRun("r1", page.surfaceId)).toBe(true);
    }
    authority.declineMade(WINDOW, declined.surfaceId);
    expect(authority.closeMade("r1", closed.surfaceId)).toBe(true);
    expect(disposed).toEqual([declined.surfaceId, closed.surfaceId]);
    // the decline is said to the run; main's own close tells it nothing
    expect(gone).toEqual([["r1", declined.surfaceId, "declined"]]);
    expect(await authority.endRun("r1")).toEqual({ disposed: 1, clearing: "now" });
    expect(disposed).toEqual([declined.surfaceId, closed.surfaceId, ended.surfaceId]);
    expect(gone.at(-1)).toEqual(["r1", ended.surfaceId, "run-end"]);
    // nothing outlived the run: its session is cleared, and nothing of it is kept again
    expect(cleared).toEqual(["run:r1"]);
    expect(authority.keepForRun("r1", ended.surfaceId)).toBe(false);
    expect(authority.state().runtimes).toBe(0);
  });

  it("keeps a page only for the run that made it: the grace stands for a page no answer named", () => {
    const { authority, disposed, elapse, gone, timers } = fixture();
    const made = authority.makeForRun(MAKE);
    const other = authority.makeForRun({ ...MAKE, run: "r2" });
    expect(authority.keepForRun("r2", made.surfaceId)).toBe(false);
    expect(authority.keepForRun("r9", made.surfaceId)).toBe(false);
    expect(authority.keepForRun("r1", "s-made-404")).toBe(false);
    expect(timers.some((timer) => timer.cleared)).toBe(false);
    elapse();
    expect(disposed).toEqual([made.surfaceId, other.surfaceId]);
    expect(gone).toEqual([
      ["r1", made.surfaceId, "grace"],
      ["r2", other.surfaceId, "grace"],
    ]);
  });

  it("says in its log what became of a made page: kept, let go with why and whether kept, or closed by main", async () => {
    const said: [string, Record<string, unknown>][] = [];
    const say = (event: string, _message: string, fields?: Record<string, unknown>): void => {
      if (event.startsWith("desktop.live_surfaces.made_")) said.push([event, { ...fields }]);
    };
    const logger = {
      debug: say,
      info: say,
      warn: say,
      error: say,
      fatal: say,
    } as unknown as Logger;
    const { authority, elapse } = fixture({ logger });
    const graced = authority.makeForRun(MAKE);
    elapse();
    const kept = authority.makeForRun(MAKE);
    authority.keepForRun("r1", kept.surfaceId);
    authority.declineMade(WINDOW, kept.surfaceId);
    const closed = authority.makeForRun(MAKE);
    authority.closeMade("r1", closed.surfaceId);
    const ended = authority.makeForRun(MAKE);
    authority.keepForRun("r1", ended.surfaceId);
    await authority.endRun("r1");
    expect(said).toEqual([
      ["desktop.live_surfaces.made_let_go", { surfaceId: graced.surfaceId, why: "grace", kept: 0 }],
      ["desktop.live_surfaces.made_kept", { surfaceId: kept.surfaceId }],
      [
        "desktop.live_surfaces.made_let_go",
        { surfaceId: kept.surfaceId, why: "declined", kept: 1 },
      ],
      ["desktop.live_surfaces.made_closed", { surfaceId: closed.surfaceId, adopted: 0 }],
      ["desktop.live_surfaces.made_kept", { surfaceId: ended.surfaceId }],
      [
        "desktop.live_surfaces.made_let_go",
        { surfaceId: ended.surfaceId, why: "run-end", kept: 1 },
      ],
    ]);
  });

  // EY-1 (C7, C8, 2026-11-24): a held page that fails has nobody attached to start it again, so custody lets it go.
  // EY-1 (C8, the word, 2026-11-24): its log and the pages broker's port are both told `failed`. Told `grace`, the
  // port's "no window took it", a failed open sent its run to ask for a window that was open.
  it("lets a held page that failed go, kept or not: said as failed in its log and to the broker's port; an adopted one is not custody's to end", () => {
    const said: [string, Record<string, unknown>][] = [];
    const say = (event: string, _message: string, fields?: Record<string, unknown>): void => {
      if (event === "desktop.live_surfaces.made_let_go") said.push([event, { ...fields }]);
    };
    const logger = {
      debug: say,
      info: say,
      warn: say,
      error: say,
      fatal: say,
    } as unknown as Logger;
    const { authority, disposed, failures, gone, timers, windows } = fixture({ logger });
    const waited = authority.makeForRun(MAKE);
    const kept = authority.makeForRun(MAKE);
    const adopted = authority.makeForRun(MAKE);
    authority.keepForRun("r1", kept.surfaceId);
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-3", made: adopted.surfaceId }));
    for (const page of [waited, kept, adopted]) failures.get(page.surfaceId)?.();
    expect(disposed).toEqual([waited.surfaceId, kept.surfaceId]);
    expect(gone).toEqual([
      ["r1", waited.surfaceId, "failed"],
      ["r1", kept.surfaceId, "failed"],
    ]);
    expect(said).toEqual([
      [
        "desktop.live_surfaces.made_let_go",
        { surfaceId: waited.surfaceId, why: "failed", kept: 0 },
      ],
      ["desktop.live_surfaces.made_let_go", { surfaceId: kept.surfaceId, why: "failed", kept: 1 }],
    ]);
    // no clock of either is left, and a second word of the same failure is nothing
    expect(timers.every((timer) => timer.cleared)).toBe(true);
    failures.get(waited.surfaceId)?.();
    expect(gone).toHaveLength(2);
    expect(authority.madeBy(adopted.surfaceId)).toBe("r1");
    expect(authority.state()).toMatchObject({ runtimes: 1, owners: 1 });
  });

  // EY-1 (C5, 2026-11-24): a held page has no face, so the desk's own count never sees it: under a cover every run
  // could hold its five, bounded across runs only by custody's 64 of every kind, which is the person's too. Held pages
  // have a bound of their own, 16 across all runs: at it a make is refused as the desk's room, and the person's own
  // pages are not what pays.
  it("bounds the pages held across runs at 16, below custody's own cap: the next make is refused, the person's own mint is not, and room returns as one is adopted or goes", () => {
    const { authority, built, windows } = fixture();
    expect(HELD_PAGES_MAX).toBe(16);
    const made: string[] = [];
    // four runs, the last with one page: three at their full five and one more
    for (let page = 0; page < 16; page += 1) {
      made.push(authority.makeForRun({ ...MAKE, run: `r${Math.floor(page / 5) + 1}` }).surfaceId);
    }
    for (const surfaceId of made)
      authority.keepForRun(authority.madeBy(surfaceId) ?? "", surfaceId);
    expect(authority.state().runtimes).toBe(16);
    const full = { kind: "RESOURCE_EXHAUSTED", state: "desk-full" };
    expect(thrown(() => authority.makeForRun({ ...MAKE, run: "r9" }))).toEqual(full);
    expect(thrown(() => authority.makeForRun(MAKE))).toEqual(full);
    // the early word the pages broker asks before a make, and for a pop-up, says the same
    expect(authority.deskHasRoom()).toBe(false);
    expect(built).toHaveLength(16);
    // the person's own page is made all the same: custody's 64 is not what the held pages reached
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    expect(
      thrown(() => authority.mint(mint(alice, DESK_SOURCE, { reuseKey: "own-1" }))),
    ).toBeUndefined();
    // a page a window adopts is held no more, and one that goes is not counted: each gives a place back
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-1", made: made[0] ?? "" }));
    expect(authority.deskHasRoom()).toBe(true);
    authority.makeForRun({ ...MAKE, run: "r9" });
    expect(thrown(() => authority.makeForRun(MAKE))).toEqual(full);
    expect(authority.closeMade("r1", made[1] ?? "")).toBe(true);
    expect(thrown(() => authority.makeForRun(MAKE))).toBeUndefined();
    expect(authority.deskHasRoom()).toBe(false);
  });

  // EY-1 (C4, 2026-11-24): the id of a made page reaches a window's document once, with its pane's place, and lives in
  // that document's memory alone. A document loaded since (a reload, a crash, a boot fence) cannot name the page, and
  // custody adopts a page only for a mint that names it: its pane's mint was refused bare, so the pane stood on a
  // failure for good while the page lived on unseen. Custody now reads the mint itself: a pane of a live run, under a
  // key never adopted, naming no page, from a document newer than the one a held page was made under, can never be
  // given that page. The page goes, and the pane is told it is gone for good, the one word it leaves on.
  describe("a pane whose document cannot name its page (EY-1 C4)", () => {
    const bare = { kind: "PRECONDITION_FAILED" };
    const closed = { kind: "PRECONDITION_FAILED", state: "made-closed" };

    it("from a document loaded since the page was made: the page is let go, its run told, and the pane leaves", () => {
      const { authority, disposed, gone, generations, windows } = fixture();
      generations.set(WINDOW, 1);
      const made = authority.makeForRun(MAKE);
      authority.keepForRun("r1", made.surfaceId);
      // the window's document is replaced: nothing tells custody, and the page stands (its run works on it)
      generations.set(WINDOW, 2);
      expect(disposed).toEqual([]);
      const reloaded = participant("alice", "2");
      windows.set(reloaded.incarnation, { webContentsId: WINDOW });
      const orphan = () => authority.mint(mint(reloaded, runSource("r1"), { reuseKey: "pane-1" }));
      expect(thrown(orphan)).toEqual(closed);
      expect(disposed).toEqual([made.surfaceId]);
      expect(gone).toEqual([["r1", made.surfaceId, "grace"]]);
      // asked again, the same word; and the run, still alive, makes another page
      expect(thrown(orphan)).toEqual(closed);
      expect(thrown(() => authority.makeForRun(MAKE))).toBeUndefined();
    });

    it("from the document that stood at the make, or with another desk's document unchanged, the page stays held and the refusal stays bare", () => {
      const { authority, disposed, generations, windows } = fixture();
      generations.set(WINDOW, 1);
      const made = authority.makeForRun(MAKE);
      authority.keepForRun("r1", made.surfaceId);
      const alice = participant("alice");
      windows.set(alice.incarnation, { webContentsId: WINDOW });
      // the same document: it may yet name the page (a copy of the pane, a mint that raced its place)
      const orphan = (who: RendererParticipantIdentity) =>
        thrown(() => authority.mint(mint(who, runSource("r1"), { reuseKey: "pane-9" })));
      expect(orphan(alice)).toEqual(bare);
      expect(disposed).toEqual([]);
      // a second desk stood at the make too, and its document is the one it was: it may hold the id
      const two = fixture();
      two.product.add(OTHER_WINDOW);
      two.generations.set(WINDOW, 1);
      two.generations.set(OTHER_WINDOW, 4);
      two.authority.keepForRun("r1", two.authority.makeForRun(MAKE).surfaceId);
      two.generations.set(WINDOW, 2);
      const reloaded = participant("alice", "2");
      two.windows.set(reloaded.incarnation, { webContentsId: WINDOW });
      expect(
        thrown(() => two.authority.mint(mint(reloaded, runSource("r1"), { reuseKey: "pane-9" }))),
      ).toEqual(bare);
      expect(two.disposed).toEqual([]);
      // a window whose host says no generation is unknown, never newer
      const unknown = fixture();
      unknown.authority.keepForRun("r1", unknown.authority.makeForRun(MAKE).surfaceId);
      unknown.windows.set(alice.incarnation, { webContentsId: WINDOW });
      expect(
        thrown(() => unknown.authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-9" }))),
      ).toEqual(bare);
      expect(unknown.disposed).toEqual([]);
      // still held, the page is adopted by the mint that names it
      expect(
        thrown(() =>
          authority.mint(
            mint(alice, runSource("r1"), { reuseKey: "pane-1", made: made.surfaceId }),
          ),
        ),
      ).toBeUndefined();
    });

    it("lets go only the pages told of under the older document: one told of under the new one stays, and is adopted by name", () => {
      const { authority, disposed, generations, windows } = fixture();
      generations.set(WINDOW, 1);
      const old = authority.makeForRun(MAKE);
      authority.keepForRun("r1", old.surfaceId);
      generations.set(WINDOW, 2);
      const fresh = authority.makeForRun(MAKE);
      authority.keepForRun("r1", fresh.surfaceId);
      const reloaded = participant("alice", "2");
      windows.set(reloaded.incarnation, { webContentsId: WINDOW });
      // the old page's pane asks, naming nothing: the old page goes, and the pane stays on its bare refusal while the
      // run still holds a page this document may name
      expect(
        thrown(() => authority.mint(mint(reloaded, runSource("r1"), { reuseKey: "pane-1" }))),
      ).toEqual(bare);
      expect(disposed).toEqual([old.surfaceId]);
      expect(
        thrown(() =>
          authority.mint(
            mint(reloaded, runSource("r1"), { reuseKey: "pane-2", made: fresh.surfaceId }),
          ),
        ),
      ).toBeUndefined();
      // now the run holds none: the old pane, asking again, leaves
      expect(
        thrown(() => authority.mint(mint(reloaded, runSource("r1"), { reuseKey: "pane-1" }))),
      ).toEqual(closed);
    });

    // EY-1 (C4, the pane about to adopt, 2026-11-24): the rule read the window's document at the page's MAKE. A
    // page's pane is placed only after its run is told of the page, which is after the make by as long as the open's
    // own navigation takes, and its place lands in the document that stands THEN. So a page made before a reload and
    // placed after it, and one made while the window's first load had not ended, were each let go by another pane's
    // nameless mint, with their own pane about to adopt them by name.
    it("never lets go a page its run was not told of yet: no pane of it is placed anywhere, so no nameless mint is its pane's", () => {
      const { authority, disposed, generations, windows } = fixture();
      generations.set(WINDOW, 1);
      const told = authority.makeForRun(MAKE);
      authority.keepForRun("r1", told.surfaceId);
      // a second page of the run is being opened (its answer has not left main) as the window reloads
      const opening = authority.makeForRun(MAKE);
      generations.set(WINDOW, 2);
      const reloaded = participant("alice", "2");
      windows.set(reloaded.incarnation, { webContentsId: WINDOW });
      // the first page's pane asks, naming nothing: its own page goes, and the page still being opened stays
      expect(
        thrown(() => authority.mint(mint(reloaded, runSource("r1"), { reuseKey: "pane-1" }))),
      ).toEqual(bare);
      expect(disposed).toEqual([told.surfaceId]);
      // told of it now, its pane is placed in the new document and adopts it by name
      authority.keepForRun("r1", opening.surfaceId);
      expect(
        thrown(() =>
          authority.mint(
            mint(reloaded, runSource("r1"), { reuseKey: "pane-2", made: opening.surfaceId }),
          ),
        ),
      ).toBeUndefined();
    });

    it("reads a window's document when the run is told of the page, not when the page is made: made before a reload and told after it, the page stays and is adopted by name", () => {
      const { authority, disposed, generations, windows } = fixture();
      generations.set(WINDOW, 1);
      const made = authority.makeForRun(MAKE);
      // the window reloads while the open is still under way (its engine is navigating the page)
      generations.set(WINDOW, 2);
      authority.keepForRun("r1", made.surfaceId);
      const reloaded = participant("alice", "2");
      windows.set(reloaded.incarnation, { webContentsId: WINDOW });
      // another pane of the run, placed before the reload, asks with no name: this page is not what it lost
      expect(
        thrown(() => authority.mint(mint(reloaded, runSource("r1"), { reuseKey: "pane-9" }))),
      ).toEqual(bare);
      expect(disposed).toEqual([]);
      expect(
        thrown(() =>
          authority.mint(
            mint(reloaded, runSource("r1"), { reuseKey: "pane-1", made: made.surfaceId }),
          ),
        ),
      ).toBeUndefined();
    });

    it("a window with no standing document when the run is told (its first load not ended, or between two documents) is unknown: the pane's place lands in its next document, and the page stays", () => {
      // the app has just opened: the window's first load has not ended (its host says generation 0, no document)
      const first = fixture();
      first.generations.set(WINDOW, 0);
      first.loading.add(WINDOW);
      const early = first.authority.makeForRun(MAKE);
      first.authority.keepForRun("r1", early.surfaceId);
      first.generations.set(WINDOW, 1);
      first.loading.delete(WINDOW);
      const alice = participant("alice");
      first.windows.set(alice.incarnation, { webContentsId: WINDOW });
      expect(
        thrown(() => first.authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-9" }))),
      ).toEqual(bare);
      expect(first.disposed).toEqual([]);
      // between two documents: a navigation began, and its load has not ended (the host still says the old number)
      const between = fixture();
      between.generations.set(WINDOW, 3);
      between.loading.add(WINDOW);
      const late = between.authority.makeForRun(MAKE);
      between.authority.keepForRun("r1", late.surfaceId);
      between.generations.set(WINDOW, 4);
      between.loading.delete(WINDOW);
      const reloaded = participant("alice", "2");
      between.windows.set(reloaded.incarnation, { webContentsId: WINDOW });
      expect(
        thrown(() =>
          between.authority.mint(mint(reloaded, runSource("r1"), { reuseKey: "pane-9" })),
        ),
      ).toEqual(bare);
      expect(between.disposed).toEqual([]);
      // and such a window, standing beside the one that asks, may hold the id: nothing is let go on the other's word
      const beside = fixture();
      beside.product.add(OTHER_WINDOW);
      beside.generations.set(WINDOW, 1);
      beside.generations.set(OTHER_WINDOW, 0);
      beside.loading.add(OTHER_WINDOW);
      beside.authority.keepForRun("r1", beside.authority.makeForRun(MAKE).surfaceId);
      beside.generations.set(OTHER_WINDOW, 1);
      beside.loading.delete(OTHER_WINDOW);
      beside.generations.set(WINDOW, 2);
      beside.windows.set(reloaded.incarnation, { webContentsId: WINDOW });
      expect(
        thrown(() =>
          beside.authority.mint(mint(reloaded, runSource("r1"), { reuseKey: "pane-9" })),
        ),
      ).toEqual(bare);
      expect(beside.disposed).toEqual([]);
    });

    it("a pane of a run this main never had, or under a key adopted into another run, never leaves on this word", () => {
      const { authority, windows } = fixture();
      const made = authority.makeForRun(MAKE);
      authority.makeForRun({ ...MAKE, run: "r2" });
      const alice = participant("alice");
      windows.set(alice.incarnation, { webContentsId: WINDOW });
      authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-1", made: made.surfaceId }));
      // r1 holds no page now. A pane synced from another device names a run this main never had: bare
      expect(
        thrown(() => authority.mint(mint(alice, runSource("r9"), { reuseKey: "pane-9" }))),
      ).toEqual(bare);
      // a key adopted into r1 asking for r2's session: bare, and nothing of either run moves
      expect(
        thrown(() => authority.mint(mint(alice, runSource("r2"), { reuseKey: "pane-1" }))),
      ).toEqual(bare);
      expect(authority.state()).toMatchObject({ runtimes: 2, owners: 1 });
    });
  });

  it("keeps a resumed run's page under the id fieldd names it by now", () => {
    const { authority, disposed, elapse } = fixture();
    const made = authority.makeForRun(MAKE);
    expect(authority.rebindRun("r1", "r2")).toBe(true);
    expect(authority.keepForRun("r2", made.surfaceId)).toBe(true);
    elapse();
    expect(disposed).toEqual([]);
    expect(authority.madeBy(made.surfaceId)).toBe("r2");
  });
});

// EY-1 (C3, 2026-11-24): main heard a run's end from one place, fieldd's pages room, and a fieldd that restarted has
// no room that knows the run: its kept pages stood hidden, its adopted panes went on minting into its session, and
// nothing was cleared, until the app quit. Main now holds one rule by itself: a run is of the fieldd that named it.
// When a fieldd with another boot identity attaches, main ends every run it holds (custody's half is `endEveryRun`).
describe("main's own end of the runs a gone fieldd named (EY-1 C3)", () => {
  const bare = { kind: "PRECONDITION_FAILED" };
  const closed = { kind: "PRECONDITION_FAILED", state: "made-closed" };

  it("ends every live run: its held pages let go and its run told, its adopted pages closed, its session cleared at once; a run fieldd had ended is not touched", async () => {
    const { authority, cleared, disposed, gone, windows } = fixture();
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    const kept = authority.makeForRun(MAKE);
    authority.keepForRun("r1", kept.surfaceId);
    const adopted = authority.makeForRun(MAKE);
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-1", made: adopted.surfaceId }));
    const waited = authority.makeForRun({ ...MAKE, run: "r2" });
    // a run the old fieldd ended itself, with a page still in the person's window
    const old = authority.makeForRun({ ...MAKE, run: "r3" });
    authority.mint(mint(alice, runSource("r3"), { reuseKey: "pane-3", made: old.surfaceId }));
    await authority.endRun("r3");
    expect(authority.endEveryRun()).toEqual({ runs: ["r1", "r2"], pages: 3 });
    expect(disposed).toEqual([kept.surfaceId, adopted.surfaceId, waited.surfaceId]);
    expect(gone).toEqual([
      ["r1", kept.surfaceId, "run-end"],
      ["r2", waited.surfaceId, "run-end"],
    ]);
    await Promise.resolve();
    expect(cleared).toEqual(["run:r1", "run:r2"]);
    // the ended run's page is the person's until its window lets it go, as before
    expect(authority.state()).toMatchObject({ runtimes: 1, owners: 1 });
    expect(authority.madeBy(old.surfaceId)).toBe("r3");
    // asked again, there is nothing to end; and fieldd's own word for a run main ended is nothing
    expect(authority.endEveryRun()).toEqual({ runs: [], pages: 0 });
    expect(await authority.endRun("r1")).toEqual({ disposed: 0, clearing: "none" });
    expect(cleared).toEqual(["run:r1", "run:r2"]);
  });

  it("the same run, named again by the new fieldd, starts clean; the old panes leave, and never enter its session or the desk's", () => {
    const { authority, built, windows } = fixture();
    const alice = participant("alice");
    windows.set(alice.incarnation, { webContentsId: WINDOW });
    const adopted = authority.makeForRun(MAKE);
    authority.mint(mint(alice, runSource("r1"), { reuseKey: "pane-1", made: adopted.surfaceId }));
    authority.makeForRun(MAKE);
    authority.endEveryRun();
    // every document was replaced with the fieldd; the old panes ask again
    const reloaded = participant("alice", "2");
    windows.set(reloaded.incarnation, { webContentsId: WINDOW });
    const ask = (source: LiveSurfaceBrowserSourceV1, reuseKey: string, made?: string) =>
      thrown(() =>
        authority.mint(
          mint(reloaded, source, made === undefined ? { reuseKey } : { reuseKey, made }),
        ),
      );
    // the adopted pane, and the pane of the page that was held: each is told it is gone for good
    expect(ask(runSource("r1"), "pane-1")).toEqual(closed);
    expect(ask(runSource("r1"), "pane-2")).toEqual(closed);
    // a key that was the run's never opens the desk's own session
    expect(ask(DESK_SOURCE, "pane-1")).toEqual(bare);
    // the run lives on under the new fieldd and opens a page: a new record, in the run's own session
    const again = authority.makeForRun(MAKE);
    expect(built.at(-1)?.source.profile).toEqual({ mode: "memory", ref: "run:r1" });
    expect(authority.madeBy(again.surfaceId)).toBe("r1");
    // an old pane's key never adopts the new page, and still leaves
    expect(ask(runSource("r1"), "pane-1", again.surfaceId)).toEqual(closed);
    expect(ask(runSource("r1"), "pane-1")).toEqual(closed);
    // the new pane, naming it, does
    expect(ask(runSource("r1"), "pane-7", again.surfaceId)).toBeUndefined();
    expect(authority.state()).toMatchObject({ runtimes: 1, owners: 1 });
  });

  it("names a resumed run by the id fieldd named it by last, and forgets every id it had", () => {
    const { authority } = fixture();
    const made = authority.makeForRun(MAKE);
    expect(authority.rebindRun("r1", "r2")).toBe(true);
    expect(authority.endEveryRun()).toEqual({ runs: ["r2"], pages: 1 });
    expect(authority.madeBy(made.surfaceId)).toBeNull();
    expect(authority.rebindRun("r1", "r5")).toBe(false);
    expect(authority.rebindRun("r2", "r5")).toBe(false);
    expect(authority.keepForRun("r2", made.surfaceId)).toBe(false);
  });
});
