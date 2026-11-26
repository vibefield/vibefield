// EY-1 (1f, 2026-11-19) — A RUN'S PANE ON THE DESK (desk-live's half of the adopt seam), with the fixture's fakes:
//  - the desk says its room for an agent's pages on the window's port at the mount and whenever it moves, never at
//    dispose (the desk-room ruling);
//  - a pane whose object names a run mints into that run's own session, and its first mint adopts the page main made;
//  - the face is an agent's at the cap only once main ACCEPTED that mint (item 581: never by the prop alone);
//  - a run's page gone for good is known by a refusal that says so alone (`made-closed`): one probe after a loss, never
//    a loop. Then the pane leaves by the host's one path, or, held or at rest, shows the closed still (DESIGN.md §8).
import {
  PAGES_RUN_PROFILE_PREFIX,
  SHELL_SURFACES_MADE_CLOSED,
  SHELL_SURFACES_SERVICE,
} from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DESK_PROFILE,
  forgetMadeForTest,
  type MadePaneGone,
  RUN_PANES_KEPT_MAX,
} from "../src/surfaces/live/desk-live";
import { fakePresentation, HELD, PAGE, SEEN, SIM, setup, UNSEEN } from "./desk-live-fixture";

const MADE = "surface_fedcba9876543210";
const RUN = "run-01J8Z3K9";
const GRANT = {
  surfaceId: "surface_0123456789abcdef",
  ticket: { v: 1, token: "abcdefghijklmnopqrstuvwxyz_0123456789-ABCDE" },
};
// F10: the window's shelf of made pages is the module's: no row's page reaches the next row
afterEach(() => forgetMadeForTest());

/** Main's (or fieldd's) word that the run's page is closed for good. */
const closedForGood = (): FielddRpcError =>
  new FielddRpcError("PRECONDITION_FAILED", "the desktop operation failed", false, {
    service: SHELL_SURFACES_SERVICE,
    state: SHELL_SURFACES_MADE_CLOSED,
  });
/** A refusal that says no such thing: a forged run, a key never adopted into it. */
const wordless = (): FielddRpcError =>
  new FielddRpcError("PRECONDITION_FAILED", "the desktop operation failed", false);

/** A desk whose pane "a" names RUN (any other key: none, the person's); each mint answered by the next of `answers`, else granted. */
function runDesk() {
  const requests: Record<string, unknown>[] = [];
  const answers: (() => unknown)[] = [];
  const left: [string, MadePaneGone][] = [];
  const t = setup({
    runOf: (key) => (key === "a" ? { is: "run", run: RUN } : { is: "none" }),
    leave: (key, why) => {
      left.push([key, why]);
    },
    mintClient: () => ({
      async request(method: string, params?: unknown) {
        if (method !== "surface.open") return {};
        requests.push(params as Record<string, unknown>);
        const next = answers.shift();
        return next === undefined ? GRANT : next();
      },
    }),
  });
  const open = (key: string) => {
    const face = t.live.open(key, PAGE, () => {});
    const handle = t.handles[t.handles.length - 1];
    if (handle === undefined) throw new Error("no handle");
    return { face, handle, mint: () => handle.opts.tickets.mint() };
  };
  return { ...t, open, requests, answers, left };
}

/** The pane's page alive and its lane live: the plan takes it as it stands. */
const live = (handle: ReturnType<ReturnType<typeof runDesk>["open"]>["handle"]): void =>
  handle.set({ status: "live", presentation: fakePresentation() as never });
const lost = (handle: ReturnType<ReturnType<typeof runDesk>["open"]>["handle"]): void =>
  handle.set({
    status: "lost",
    presentation: null,
    error: new Error(`the host closed live surface attachment for "${handle.key}"`),
  });

describe("EY-1 (1f): the desk's room for an agent's pages", () => {
  it("is said at the mount, said again only when it moves, and never at dispose", () => {
    const t = setup();
    expect(t.said.rooms).toEqual([6]);
    const face = t.live.open("p", PAGE, () => {});
    const handle = t.handles[0];
    if (handle === undefined) throw new Error("no handle");
    handle.set({ status: "live", presentation: fakePresentation() as never });
    face.demand(SEEN);
    // the person's page holds one of the six: five are left for an agent's
    expect(t.said.rooms).toEqual([6, 5]);
    expect(t.live.agentRoom()).toBe(5);
    face.demand(SEEN);
    expect(t.said.rooms).toEqual([6, 5]);
    t.live.dispose();
    expect(t.said.rooms).toEqual([6, 5]);
  });

  it("declines a made page on the window's port, for main to let it go", () => {
    const t = setup();
    t.live.declineMade(MADE);
    expect(t.said.declined).toEqual([MADE]);
  });
});

describe("EY-1 (1f): a pane whose object names a run", () => {
  it("mints into that run's own session; its first mint adopts the made page, and no later one names it", async () => {
    const r = runDesk();
    const a = r.open("a");
    r.live.adoptMade("a", MADE);
    await a.mint();
    await a.mint();
    const session = { mode: "memory", ref: `${PAGES_RUN_PROFILE_PREFIX}${RUN}` };
    expect(r.requests[0]).toMatchObject({
      reuseKey: "a",
      made: MADE,
      source: { profile: session },
    });
    expect(r.requests[1]).toMatchObject({ reuseKey: "a", source: { profile: session } });
    expect(r.requests[1]).not.toHaveProperty("made");
    // the person's own page: the desk's profile, never a run's
    const p = r.open("p");
    await p.mint();
    expect(r.requests[2]).toMatchObject({
      reuseKey: "p",
      source: { profile: { mode: "persistent", ref: DESK_PROFILE } },
    });
    expect(r.requests[2]).not.toHaveProperty("made");
  });

  it("mints nothing for a made page whose object names no run: never the desk's profile, and the pane leaves", async () => {
    const r = runDesk();
    const b = r.open("b");
    r.live.adoptMade("b", MADE);
    await expect(b.mint()).rejects.toThrow();
    expect(r.requests).toEqual([]);
    expect(r.left).toEqual([["b", "never-reached"]]);
    expect(b.face.state()).toEqual({ is: "failed", reason: "never-opened" });
  });

  it("PI-2 (2026-11-24): mints nothing while the pane's run cannot be read, and is not taken off the desk for it", async () => {
    const left: [string, MadePaneGone][] = [];
    const requests: unknown[] = [];
    const t = setup({
      runOf: () => ({ is: "unknown" }),
      leave: (key, why) => {
        left.push([key, why]);
      },
      mintClient: () => ({
        async request(method: string, params?: unknown) {
          if (method === "surface.open") requests.push(params);
          return GRANT;
        },
      }),
    });
    t.live.open("c", PAGE, () => {});
    const handle = t.handles[t.handles.length - 1];
    if (handle === undefined) throw new Error("no handle");
    await expect(handle.opts.tickets.mint()).rejects.toThrow();
    // never the desk's signed-in profile on "cannot tell": nothing is asked of main at all
    expect(requests).toEqual([]);
    // a read that may answer later is no loss: the pane stays, and a later mint asks again
    expect(left).toEqual([]);
  });

  it("is an agent's at the cap only once main accepted its mint: never by the prop alone", async () => {
    const r = runDesk();
    expect(r.live.cap(2)).toBe(2);
    const p = r.open("p");
    const a = r.open("a");
    live(p.handle);
    live(a.handle);
    p.face.demand(SEEN);
    a.face.demand(UNSEEN);
    // the run's page counts as a person's unseen one until main says it is the run's: no agent page fits
    expect(r.live.agentRoom()).toBe(0);
    await a.mint();
    // an agent's unseen page gives its slot to another agent's: one fits
    expect(r.live.agentRoom()).toBe(1);
  });
});

describe("EY-1 (1f): a run's page gone for good, known by main's refusal alone", () => {
  it("never reached the window: the pane leaves, and a held one says so and leaves when put down", async () => {
    const r = runDesk();
    const a = r.open("a");
    r.live.adoptMade("a", MADE);
    a.face.demand(HELD);
    r.answers.push(() => {
      throw closedForGood();
    });
    await expect(a.mint()).rejects.toThrow();
    expect(r.left).toEqual([]);
    // DESIGN.md §8: its own words, and nothing to try again
    expect(a.face.state()).toEqual({ is: "failed", reason: "never-opened" });
    a.face.demand(UNSEEN);
    expect(r.left).toEqual([["a", "never-reached"]]);
    a.face.demand(SEEN);
    a.face.demand(UNSEEN);
    expect(r.left).toHaveLength(1);
    // gone, it is never minted again
    await expect(a.mint()).rejects.toThrow();
    expect(r.requests).toHaveLength(1);
  });

  it("takes nothing off the desk on a refusal that does not say the page is closed for good", async () => {
    const r = runDesk();
    const a = r.open("a");
    r.live.adoptMade("a", MADE);
    r.answers.push(() => {
      throw wordless();
    });
    await expect(a.mint()).rejects.toThrow();
    expect(r.left).toEqual([]);
    expect(JSON.stringify(a.face.state())).not.toContain("never-opened");
  });

  it("closed by main (the run's end, or the run's own close): ONE probe, and the pane leaves on its refusal", async () => {
    const r = runDesk();
    const a = r.open("a");
    await a.mint();
    live(a.handle);
    a.face.demand(SEEN);
    lost(a.handle);
    expect(a.handle.retried).toBe(1);
    r.answers.push(() => {
      throw closedForGood();
    });
    await expect(a.mint()).rejects.toThrow();
    expect(r.left).toEqual([["a", "closed"]]);
    // the closed still: its words, and nothing to try again
    expect(a.face.state()).toEqual({ is: "failed", reason: "run-ended" });
  });

  it("held at the loss, it stays on the closed still, and stays when put down", async () => {
    const r = runDesk();
    const a = r.open("a");
    await a.mint();
    live(a.handle);
    a.face.demand(HELD);
    lost(a.handle);
    r.answers.push(() => {
      throw closedForGood();
    });
    await expect(a.mint()).rejects.toThrow();
    expect(r.left).toEqual([]);
    expect(a.face.state()).toEqual({ is: "failed", reason: "run-ended" });
    a.face.demand(UNSEEN);
    expect(r.left).toEqual([]);
  });

  it("one probe per loss, never a loop: a dead window's loss removes nothing, and a blip comes back", async () => {
    const r = runDesk();
    const a = r.open("a");
    await a.mint();
    live(a.handle);
    a.face.demand(SEEN);
    lost(a.handle);
    expect(a.handle.retried).toBe(1);
    // the probe is granted, and its attach fails (the window's live surfaces are gone): the same loss
    await a.mint();
    a.handle.set({ status: "attaching", presentation: null, error: null });
    lost(a.handle);
    expect(a.handle.retried).toBe(1);
    expect(r.left).toEqual([]);
    // a blip: live again, then a new loss is probed again
    live(a.handle);
    lost(a.handle);
    expect(a.handle.retried).toBe(2);
    expect(r.left).toEqual([]);
  });
});

// F10 (2026-11-24) — THE MADE PAGE OUTLIVES THE MOUNT: the window keeps which page main made for a pane until that pane's
// first mint adopts it (or main says it is gone), on its own shelf (sessionStorage: the window's own, outliving its
// renderer), not in the mount. A desk remounted, or a window reloaded, between the place and the first mint (a covered
// desk mints nothing) still adopts the page; before, its mint named no made page, main refused it bare, and the pane
// stood on its failure film for good while the agent worked the page behind it.
describe("F10: a made page waits for its pane's first mint across a remount and a reload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** A mount over the fixture's fakes: pane `key` names RUN, on document `doc`; each mint's params recorded. */
  function mountOn(key: string, doc: string, requests: Record<string, unknown>[]) {
    return setup({
      docId: () => doc,
      runOf: (k) => (k === key ? { is: "run", run: RUN } : { is: "none" }),
      mintClient: () => ({
        async request(method: string, params?: unknown) {
          if (method === "surface.open") requests.push(params as Record<string, unknown>);
          return GRANT;
        },
      }),
    });
  }
  const mintOf = (t: ReturnType<typeof setup>, key: string) => {
    t.live.open(key, PAGE, () => {});
    const handle = t.handles[t.handles.length - 1];
    if (handle === undefined) throw new Error("no handle");
    return () => handle.opts.tickets.mint();
  };

  it("a desk remounted before the first mint: the new mount's first mint adopts it, and no later mount names it", async () => {
    const requests: Record<string, unknown>[] = [];
    const first = mountOn("f10-remount", "doc-f10-a", requests);
    first.live.adoptMade("f10-remount", MADE);
    first.live.dispose();
    const second = mountOn("f10-remount", "doc-f10-a", requests);
    await mintOf(second, "f10-remount")();
    expect(requests[0]).toMatchObject({ reuseKey: "f10-remount", made: MADE });
    second.live.dispose();
    const third = mountOn("f10-remount", "doc-f10-a", requests);
    await mintOf(third, "f10-remount")();
    expect(requests[1]).toMatchObject({ reuseKey: "f10-remount" });
    expect(requests[1]).not.toHaveProperty("made");
  });

  it("a window reloaded before the first mint: the page is still adopted, from the window's own session storage", async () => {
    const kept = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, String(v)),
      removeItem: (k: string) => void kept.delete(k),
    });
    const requests: Record<string, unknown>[] = [];
    const before = mountOn("f10-reload", "doc-f10-b", requests);
    before.live.adoptMade("f10-reload", MADE);
    // the renderer is replaced: every module's memory is new, the window's session storage is not
    vi.resetModules();
    const fresh = await import("../src/surfaces/live/desk-live");
    const after = mountOn("f10-reload", "doc-f10-b", requests);
    const live = fresh.createDeskLiveSources(after.deps);
    live.open("f10-reload", PAGE, () => {});
    const handle = after.handles[after.handles.length - 1];
    if (handle === undefined) throw new Error("no handle");
    await handle.opts.tickets.mint();
    expect(requests.at(-1)).toMatchObject({ reuseKey: "f10-reload", made: MADE });
    // adopted: the shelf forgets it
    expect([...kept.values()]).not.toContain(MADE);
  });

  it("names the made page only for its own document's pane", async () => {
    const requests: Record<string, unknown>[] = [];
    const first = mountOn("f10-doc", "doc-f10-c", requests);
    first.live.adoptMade("f10-doc", MADE);
    first.live.dispose();
    const other = mountOn("f10-doc", "doc-f10-d", requests);
    await mintOf(other, "f10-doc")();
    expect(requests[0]).not.toHaveProperty("made");
  });
});

// A run's pane after its run (2026-11-24) — THE APP CAME BACK AND THE PANE'S RUN IS GONE. The pane's object is the
// document's and stands across a restart, naming its run; nothing can serve that run a page again, and its mint is
// answered closed for good. Before, that word at a mount's first mint always left the pane on its closed still, so
// every pane a run placed outlived the app on the desk. A board is carried to other devices, so the run prop alone
// never takes a pane off: only a pane THIS device placed for a run leaves, by the host's one path, never from under
// the hand; a pane it did not place shows the closed still (DESIGN.md §8: "seen on a device that never had the run").
describe("a run's pane after its run: the app came back, and the pane's run is gone (2026-11-24)", () => {
  afterEach(() => vi.resetModules());

  /** A mount of the desk on document `doc`, where pane `key` names RUN and any other names none: each mint answered by
   * the next of `answers` (else granted), what left the desk recorded. `back`: the app stopped and started first, so
   * every module's memory is new and the window's session storage is gone; this device's local storage is not. */
  async function mount(key: string, doc: string, back = false) {
    const requests: Record<string, unknown>[] = [];
    const answers: (() => unknown)[] = [];
    const left: [string, MadePaneGone][] = [];
    const t = setup({
      docId: () => doc,
      runOf: (k) => (k === key ? { is: "run", run: RUN } : { is: "none" }),
      leave: (k, why) => {
        left.push([k, why]);
      },
      mintClient: () => ({
        async request(method: string, params?: unknown) {
          if (method !== "surface.open") return {};
          requests.push(params as Record<string, unknown>);
          const next = answers.shift();
          return next === undefined ? GRANT : next();
        },
      }),
    });
    let live = t.live;
    if (back) {
      vi.resetModules();
      sessionStorage.clear();
      live = (await import("../src/surfaces/live/desk-live")).createDeskLiveSources(t.deps);
    }
    const open = (k = key, spec: Record<string, unknown> = PAGE) => {
      const face = live.open(k, spec, () => {});
      const handle = t.handles[t.handles.length - 1];
      if (handle === undefined) throw new Error("no handle");
      return { face, handle, mint: () => handle.opts.tickets.mint() };
    };
    return { live, open, requests, answers, left };
  }
  const refuse = (answers: (() => unknown)[], word: () => FielddRpcError): void => {
    answers.push(() => {
      throw word();
    });
  };

  /** The app as it ran: the pages room's place put pane `key` on `doc` for RUN, and its first mint adopted the page. */
  async function placedHere(key: string, doc: string) {
    const before = await mount(key, doc);
    before.live.adoptMade(key, MADE);
    const pane = before.open();
    await pane.mint();
    return { before, pane };
  }

  it("a pane this device placed for a run leaves at its first mint's refusal: nobody's hand is on it", async () => {
    const { before } = await placedHere("back-1", "doc-back-1");
    before.live.dispose();
    const after = await mount("back-1", "doc-back-1", true);
    const pane = after.open();
    refuse(after.answers, closedForGood);
    await expect(pane.mint()).rejects.toThrow();
    // the mint named the run's session and no made page: the page was adopted in the app run before
    expect(after.requests[0]).toMatchObject({
      reuseKey: "back-1",
      source: { profile: { mode: "memory", ref: `${PAGES_RUN_PROFILE_PREFIX}${RUN}` } },
    });
    expect(after.requests[0]).not.toHaveProperty("made");
    // by the same path a run's end takes its pane off
    expect(after.left).toEqual([["back-1", "closed"]]);
    expect(pane.face.state()).toEqual({ is: "failed", reason: "run-ended" });
    // gone, it is never minted again
    await expect(pane.mint()).rejects.toThrow();
    expect(after.requests).toHaveLength(1);
  });

  it("in the person's hand at that word it stays on the closed still, when put down, and at the next start too", async () => {
    const { before } = await placedHere("back-2", "doc-back-2");
    before.live.dispose();
    const after = await mount("back-2", "doc-back-2", true);
    const pane = after.open();
    pane.face.demand(HELD);
    refuse(after.answers, closedForGood);
    await expect(pane.mint()).rejects.toThrow();
    expect(after.left).toEqual([]);
    expect(pane.face.state()).toEqual({ is: "failed", reason: "run-ended" });
    pane.face.demand(UNSEEN);
    expect(after.left).toEqual([]);
    after.live.dispose();
    // its run's end was shown on it, and the person kept it: it is not taken off later
    const again = await mount("back-2", "doc-back-2", true);
    const kept = again.open();
    refuse(again.answers, closedForGood);
    await expect(kept.mint()).rejects.toThrow();
    expect(again.left).toEqual([]);
    expect(kept.face.state()).toEqual({ is: "failed", reason: "run-ended" });
  });

  it("a pane this device did not place (another device's run, a pane from before this build) is never taken off: its closed still", async () => {
    const after = await mount("back-3", "doc-back-3", true);
    const pane = after.open();
    refuse(after.answers, closedForGood);
    await expect(pane.mint()).rejects.toThrow();
    expect(after.left).toEqual([]);
    // the closed notice, with nothing to try again: never the film of a page of the person's own
    expect(pane.face.state()).toEqual({ is: "failed", reason: "run-ended" });
  });

  it("the person's own pane is never touched: its mint is the desk's profile, and no word takes it off", async () => {
    const { before } = await placedHere("back-4", "doc-back-4");
    before.live.dispose();
    const after = await mount("back-4", "doc-back-4", true);
    const mine = after.open("mine");
    refuse(after.answers, closedForGood);
    await expect(mine.mint()).rejects.toThrow();
    expect(after.requests[0]).toMatchObject({
      reuseKey: "mine",
      source: { profile: { mode: "persistent", ref: DESK_PROFILE } },
    });
    expect(after.left).toEqual([]);
    expect(JSON.stringify(mine.face.state())).not.toContain("run-ended");
    // and it is asked for again as any page is
    await mine.mint();
    expect(after.requests).toHaveLength(2);
  });

  it("a refusal with no word takes nothing off a pane placed here; the word, when it comes, does", async () => {
    const { before } = await placedHere("back-5", "doc-back-5");
    before.live.dispose();
    const after = await mount("back-5", "doc-back-5", true);
    const pane = after.open();
    refuse(after.answers, wordless);
    await expect(pane.mint()).rejects.toThrow();
    expect(after.left).toEqual([]);
    expect(JSON.stringify(pane.face.state())).not.toContain("run-ended");
    refuse(after.answers, closedForGood);
    await expect(pane.mint()).rejects.toThrow();
    expect(after.left).toEqual([["back-5", "closed"]]);
  });

  it("a pane kept on its closed still (held at its run's end, then put down) is still kept when the window comes back", async () => {
    const { before, pane } = await placedHere("back-6", "doc-back-6");
    live(pane.handle);
    pane.face.demand(HELD);
    lost(pane.handle);
    refuse(before.answers, closedForGood);
    await expect(pane.mint()).rejects.toThrow();
    expect(before.left).toEqual([]);
    pane.face.demand(UNSEEN);
    before.live.dispose();
    const after = await mount("back-6", "doc-back-6", true);
    const kept = after.open();
    refuse(after.answers, closedForGood);
    await expect(kept.mint()).rejects.toThrow();
    expect(after.left).toEqual([]);
    expect(kept.face.state()).toEqual({ is: "failed", reason: "run-ended" });
  });

  it("the same desk shown again in one app run (its run ended while it was covered): the pane placed here leaves too", async () => {
    const { before } = await placedHere("back-7", "doc-back-7");
    before.live.dispose();
    const shown = await mount("back-7", "doc-back-7");
    const pane = shown.open();
    refuse(shown.answers, closedForGood);
    await expect(pane.mint()).rejects.toThrow();
    expect(shown.left).toEqual([["back-7", "closed"]]);
  });

  // An iOS Simulator an agent placed with canvas_place is no run's page: its kind names no run, and its lane has no
  // run path. Nothing here takes it off, whatever became of the run that placed it; it is the person's to keep.
  it("an iOS Simulator an agent placed is never minted into a run's session and never taken off: no word reaches the host's path", async () => {
    // a phone bound to a device, on a host that even reads a run off its key by mistake (`mount` names RUN for it)
    const after = await mount("back-9", "doc-back-9", true);
    const phone = after.open("back-9", SIM);
    refuse(after.answers, closedForGood);
    await expect(phone.mint()).rejects.toThrow();
    // its mint is its device's, by its binding: no run's session, no made page
    expect(after.requests[0]).toMatchObject({ source: { kind: "ios-simulator-device" } });
    expect(JSON.stringify(after.requests[0])).not.toContain(PAGES_RUN_PROFILE_PREFIX);
    expect(after.left).toEqual([]);
    expect(JSON.stringify(phone.face.state())).not.toContain("run-ended");
    // and it is asked for again, as any device is
    await phone.mint();
    expect(after.requests).toHaveLength(2);
  });

  it("the device keeps at most its most panes placed for runs: the oldest past it is kept on its closed still, never guessed at", async () => {
    const first = await mount("back-8-0", "doc-back-8");
    for (let i = 0; i <= RUN_PANES_KEPT_MAX; i += 1) first.live.adoptMade(`back-8-${i}`, MADE);
    first.live.dispose();
    const oldest = await mount("back-8-0", "doc-back-8", true);
    const dropped = oldest.open();
    refuse(oldest.answers, closedForGood);
    await expect(dropped.mint()).rejects.toThrow();
    expect(oldest.left).toEqual([]);
    const newest = await mount(`back-8-${RUN_PANES_KEPT_MAX}`, "doc-back-8", true);
    const marked = newest.open();
    refuse(newest.answers, closedForGood);
    await expect(marked.mint()).rejects.toThrow();
    expect(newest.left).toEqual([[`back-8-${RUN_PANES_KEPT_MAX}`, "closed"]]);
  });
});

// A run's own close (2026-11-24) — THE SEAM FOR THE APPLIER'S REMOVE. When a run closes its own page (browser_close, a
// tab's close, canvas_remove of the pane) the pages room asks the window to remove the pane's object, and the applier
// destroys it at once: its at-work mark is cut mid-leaving, where a run's end waits the mark out (DESIGN.md §8 "At
// work on the mat"). The applier reaches this mount's live service and nothing else of the stage, so the service
// offers the host's one path to it: `leaveMade`.
describe("a run's own close: the live service hands a pane to the host's one leaving path (2026-11-24)", () => {
  it("hands the pane to the host's leave, as a run's end does; the probe's own word after it reaches the same path", async () => {
    const r = runDesk();
    r.live.adoptMade("a", MADE);
    const a = r.open("a");
    await a.mint();
    expect(r.live.leaveMade("a")).toBe(true);
    expect(r.left).toEqual([["a", "closed"]]);
    // main closed its page too: the loss, the one probe and its refusal ask the host again, which holds one wait a key
    live(a.handle);
    a.face.demand(SEEN);
    lost(a.handle);
    r.answers.push(() => {
      throw closedForGood();
    });
    await expect(a.mint()).rejects.toThrow();
    expect(r.left).toEqual([
      ["a", "closed"],
      ["a", "closed"],
    ]);
  });

  it("answers false where the mount has no host path, or is going: the caller removes the object itself", () => {
    const bare = setup();
    expect(bare.live.leaveMade("a")).toBe(false);
    const r = runDesk();
    r.live.dispose();
    expect(r.live.leaveMade("a")).toBe(false);
    expect(r.left).toEqual([]);
  });
});
