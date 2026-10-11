// PT-5b (rulings 3, 4) — SIX PAGES ALIVE AT MOST, done by the desk's LIVE service (surfaces/live/desk-live.ts; the policy is
// live-cap.ts's, its own rows live-cap.test.ts) — with the fixture's fakes, each page's producer answering its asks as LSF's
// does (`pump`):
//  - a page is made alive only when the cap lets it; one that waits is paused as it was made (nothing is made of it), says
//    `paused`, and shows its still;
//  - the HELD page comes alive at once and is never rested; the page that gives its slot has its STILL TAKEN FIRST, then is
//    asked `hibernated` — and reads `paused` with its still;
//  - a rested pane comes back into a free slot, or an unseen page's; where every alive page is seen it waits;
//  - a page woken is asked what its pane asks (a rested page is never asked `paused`: no window is born under that);
//  - a window reloaded: a page alive all along keeps its slot — no page is woken in its place;
//  - a page let go of (a deleted pane's, kept by the pool's grace) is alive and counted, and rested first;
//  - the budget's eviction lets the face's texture go: the film, then its still when next seen.
import { describe, expect, it, vi } from "vitest";
import {
  LIVE_ATTACH_HOLD_MS,
  liveDemandIntent,
  PAGE_STILL_TAKE_MAX_MS,
} from "../src/surfaces/live/desk-live";
import { DOC, HELD, KEY, PAGE, SEEN, stage, stillOf, UNSEEN } from "./desk-live-fixture";

const PAUSED = {
  mode: "paused",
  targetFps: 0,
  priority: 0,
  interactive: false,
  logicalViewport: { width: 1280, height: 800 },
};
const RESTED = { ...PAUSED, mode: "hibernated" };

/** How far each pane lies from the view's centre: a the nearest. */
const FAR: Record<string, number> = { a: 1, b: 2, c: 3, d: 4 };
const far = (key: string): number => FAR[key] ?? Number.POSITIVE_INFINITY;
/** A few turns of the microtask queue: a tick's end, and what the plan began there. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

/** Three panes on a desk whose cap is two, none of their pages made yet; all three seen in one tick: the two nearest the
 * view's centre come alive, the third waits. */
async function three() {
  const s = stage({ far });
  expect(s.live.cap(2)).toBe(2);
  const a = s.open("a", true, "created");
  const b = s.open("b", true, "created");
  const c = s.open("c", true, "created");
  for (const p of [a, b, c]) {
    s.clock.advance(100);
    p.face.demand(SEEN);
  }
  await s.pump();
  return { s, a, b, c };
}

describe("PT-5b — six pages alive at most (ruling 3)", () => {
  it("a page is made alive only when the cap lets it: of three seen under a cap of two, two are asked live — the third WAITS, paused as it was made, saying `paused`, counted not alive", async () => {
    const { s, a, b, c } = await three();
    expect(a.handle.demands.at(-1)).toEqual(liveDemandIntent(SEEN));
    expect(b.handle.demands.at(-1)).toEqual(liveDemandIntent(SEEN));
    // nothing but a paused ask ever reached the third: no page is made of it
    expect(c.handle.demands).toEqual([PAUSED]);
    expect(c.presentation.summary.state).toBe("created");
    expect(c.face.state()).toEqual({ is: "paused" });
    expect(a.face.state()).toEqual({ is: "live" });
    expect(s.live.stats()).toMatchObject({ cap: 2, alive: 2, wakes: 2, rests: 0 });
    expect(s.live.faces().map((f) => [f.key, f.alive, f.rested])).toEqual([
      ["a", true, false],
      ["b", true, false],
      ["c", false, false],
    ]);
  });

  it("a waiting pane shows its STILL: the shelf's, laid at its open — `paused`, `extra.still`", async () => {
    const s = stage();
    s.live.cap(1);
    s.shelf.shelf.set(`${DOC}/c`, stillOf());
    const a = s.open("a", true, "created");
    const c = s.open("c", true, "created");
    a.face.demand(SEEN);
    c.face.demand(SEEN);
    await s.pump();
    expect(c.wire()).toBe("paused");
    expect(c.face.state()).toEqual({ is: "paused" });
    expect(c.face.texture()).toBeDefined();
    expect(c.face.info().extra?.still).toBeDefined();
  });

  it("the third PICKED UP comes alive AT ONCE; the page that gives its slot has its still TAKEN FIRST and is then asked `hibernated` — it reads `paused` with its still, and nothing says it failed", async () => {
    const { s, a, b, c } = await three();
    a.frame();
    b.frame();
    c.face.demand(HELD);
    // at once, before anything is awaited: the held page is asked live…
    expect(c.handle.demands.at(-1)).toEqual(liveDemandIntent(HELD));
    // …and of the two seen ones the farther from the view's centre is being put to rest: its texture is being read, its
    // page not yet let go
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(1);
    expect(b.wire()).toBe("live");
    expect(s.shelf.stills.keep).not.toHaveBeenCalled();
    await s.live.settled();
    expect(s.log).toEqual(["take", "keep b"]);
    expect(b.handle.demands.at(-1)).toEqual(RESTED);
    expect(a.wire()).toBe("live");
    // (no second page went for the one that was leaving)
    await s.pump();
    expect(s.log).toEqual(["take", "keep b"]);
    expect(b.presentation.summary.state).toBe("hibernated");
    expect(b.face.state()).toEqual({ is: "paused" });
    expect(b.face.texture()).toBeDefined();
    expect(b.face.info().extra?.still).toEqual({ takenAt: s.clock.now(), age: 0 });
    expect(s.live.faces().find((f) => f.key === "b")).toMatchObject({
      alive: false,
      rested: true,
      still: s.clock.now(),
    });
    expect(s.live.stats()).toMatchObject({ alive: 2, rests: 1, wakes: 3, stillsTaken: 1 });
    // a press on a rested pane's still goes nowhere
    b.face.input?.({ kind: "wheel", x: 1, y: 1, dx: 0, dy: 9 });
    expect(b.handle.inputs).toHaveLength(0);
  });

  it("HELD-NEVER: the held page is never the one put to rest — the cap lowered under it, the others go", async () => {
    const { s, a, b, c } = await three();
    c.face.demand(HELD);
    await s.pump();
    const from = c.handle.demands.length;
    expect(s.live.cap(1)).toBe(1);
    await s.pump();
    expect(c.wire()).toBe("live");
    expect(c.presentation.summary.state).toBe("live");
    expect([a.wire(), b.wire()]).toEqual(["hibernated", "hibernated"]);
    // never, not for a moment (a rest is a LOAD when it ends): nothing but live was asked of it under the lowered cap,
    // and the rests are the two others'
    expect((c.handle.demands.slice(from) as { mode: string }[]).map((d) => d.mode)).not.toContain(
      "hibernated",
    );
    expect(s.live.stats().rests).toBe(2);
    expect(s.live.faces().find((f) => f.key === "c")).toMatchObject({ alive: true, rested: false });
    expect(s.live.stats().alive).toBe(1);
    // a second pane cannot be held with it; put down, it is a seen page like another — and stays, the only one alive
    c.face.demand(SEEN);
    await s.pump();
    expect(c.wire()).toBe("live");
  });

  it("a rested pane SEEN AGAIN waits on its still while every alive page is seen; an unseen page gives it its slot (its own still first); and a slot that comes free is taken", async () => {
    const { s, a, b, c } = await three();
    a.frame();
    b.frame();
    c.face.demand(HELD);
    await s.pump();
    // put down: all three seen, two alive — the rested one waits (a seen page is never rested for another seen one)
    c.face.demand(SEEN);
    await s.pump();
    expect([a.wire(), b.wire(), c.wire()]).toEqual(["live", "hibernated", "live"]);
    expect(s.live.stats().rests).toBe(1);
    // a is panned off the view: unseen, alive — it gives its slot to the rested pane that is seen, its own still first
    a.frame();
    s.clock.advance(100);
    a.face.demand(UNSEEN);
    await flush();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(2);
    await s.pump();
    expect([a.wire(), b.wire(), c.wire()]).toEqual(["hibernated", "live", "live"]);
    expect(b.presentation.summary.state).toBe("live");
    expect(s.live.stats()).toMatchObject({ alive: 2, rests: 2 });
    // b's first frame replaces its still
    expect(b.face.info().extra?.still).toBeDefined();
    b.frame();
    expect(b.face.info().extra?.still).toBeUndefined();
    // a seen again waits; the cap raised (a slot free): it comes back
    a.face.demand(SEEN);
    await s.pump();
    expect(a.wire()).toBe("hibernated");
    s.live.cap(3);
    await s.pump();
    expect(a.wire()).toBe("live");
  });

  it("a page woken is born AS ITS ASK SAYS: a rested page is never asked `paused` (no window is made under an ask that is not live) — unseen, or under a parked desk, it stays hibernated; seen again with a slot free it is asked LIVE", async () => {
    const { s, a, b, c } = await three();
    c.face.demand(HELD);
    await s.pump();
    expect(b.wire()).toBe("hibernated");
    const from = b.handle.demands.length;
    // at rest, its pane goes out of view and comes back; the desk parks and runs
    b.face.demand(UNSEEN);
    await flush();
    b.face.demand(SEEN);
    await flush();
    s.live.park(true);
    s.live.park(false);
    await s.pump();
    const modes = (b.handle.demands.slice(from) as { mode: string }[]).map((d) => d.mode);
    expect(modes.length).toBeGreaterThan(0);
    expect(modes.filter((m) => m !== "hibernated")).toEqual([]);
    expect(b.presentation.summary.state).toBe("hibernated");
    // a's pane leaves the mount (its page let go of, rested for the slot): b comes back — asked LIVE
    a.face.close();
    await s.pump();
    expect(b.handle.demands.at(-1)).toEqual(liveDemandIntent(SEEN));
    expect(b.presentation.summary.state).toBe("live");
    expect(s.live.stats().alive).toBe(2);
  });

  it("AT BOOT a desk of twenty panes makes at most six pages — the six nearest the view's centre; the rest wait", async () => {
    const far = new Map<string, number>();
    const s = stage({ far: (key) => far.get(key) ?? Number.POSITIVE_INFINITY });
    expect(s.live.cap()).toBe(6);
    const panes = Array.from({ length: 20 }, (_, i) => {
      const key = `p${String(i).padStart(2, "0")}`;
      far.set(key, (i * 7) % 20);
      return s.open(key, true, "created");
    });
    for (const p of panes) p.face.demand(SEEN);
    await s.pump();
    const alive = panes.filter((p) => p.presentation.summary.state === "live").map((p) => p.key);
    expect(alive).toHaveLength(6);
    expect(alive.map((key) => far.get(key)).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(panes.filter((p) => p.wire() === "paused")).toHaveLength(14);
    expect(s.live.stats()).toMatchObject({ cap: 6, alive: 6, wakes: 6, rests: 0 });
    // the view moves: the pane now nearest is seen in the place of none — every alive page is seen, so it waits
    far.set("p19", -1);
    panes[19]?.face.demand({ ...SEEN, fps: 15 });
    await s.pump();
    expect(s.live.stats().alive).toBe(6);
  });

  it("a window RELOADED: a page alive all along keeps its slot — while a lane has not said, no page is woken in its place; a lane that never attaches holds its slot three seconds at most", async () => {
    const s = stage({ far });
    s.live.cap(2);
    // main kept a and b alive (paused, nobody attached) and c at rest; the reloaded window opens all three and asks
    const a = s.open("a", false, "paused");
    const b = s.open("b", false, "paused");
    const c = s.open("c", false, "hibernated");
    for (const p of [a, b, c]) {
      s.clock.advance(10);
      p.face.demand(SEEN);
    }
    await s.live.settled();
    // nobody has said: nobody is asked live
    expect([a.wire(), b.wire(), c.wire()]).toEqual(["paused", "paused", "paused"]);
    a.attach();
    await s.pump();
    expect(a.wire()).toBe("live");
    // c says it is at rest — b has not said: c is NOT woken in b's place
    c.attach();
    await s.pump();
    expect(c.wire()).toBe("paused");
    b.attach();
    await s.pump();
    expect([a.wire(), b.wire(), c.wire()]).toEqual(["live", "live", "paused"]);
    expect(c.presentation.summary.state).toBe("hibernated");
    expect(c.face.state()).toEqual({ is: "paused" });
    expect(s.live.stats()).toMatchObject({ alive: 2, rests: 0 });

    // a lane that never attaches: the page that waits on it is woken when its hold lapses
    const t = stage();
    t.live.cap(1);
    t.open("stuck", false, "created");
    const d = t.open("d", true, "created");
    d.face.demand(SEEN);
    await t.pump();
    expect(d.wire()).toBe("paused");
    t.clock.advance(LIVE_ATTACH_HOLD_MS - 1);
    await t.pump();
    expect(d.wire()).toBe("paused");
    t.clock.advance(100);
    await t.pump();
    expect(d.wire()).toBe("live");
  });

  it("a page LET GO OF (a deleted pane's — the pool's grace keeps it) is alive and counted; when its slot is wanted it is put to rest first: asked hibernated through a lane of the service's own, let go again", async () => {
    const s = stage();
    s.live.cap(2);
    const a = s.open("a", true, "created");
    const b = s.open("b", true, "created");
    a.face.demand(SEEN);
    b.face.demand(SEEN);
    await s.pump();
    // a's pane is deleted: its face closes, its lane is released — the pool keeps its page through the grace
    s.exists.value = false;
    a.face.close();
    s.exists.value = true;
    expect(a.handle.released).toBe(1);
    expect(s.live.stats()).toMatchObject({ open: 1, alive: 2 });
    // a new pane, seen: the let-go page is the unseen one that gives its slot
    const before = s.handles.length;
    const c = s.open("c", true, "created");
    c.face.demand(SEEN);
    const ghost = s.handles[before + 1];
    expect(ghost?.key).toBe("desk:a");
    expect(ghost?.opts.initialDemand).toEqual({
      mode: "hibernated",
      targetFps: 0,
      priority: 0,
      interactive: false,
    });
    // (a page at rest is never minted by the service's own hand)
    await expect(ghost?.opts.tickets.mint()).rejects.toThrow("not minted");
    // c waits until the page says it is gone
    expect(c.wire()).toBe("paused");
    expect(ghost?.released).toBe(0);
    await s.pump();
    expect(ghost?.released).toBe(1);
    expect(c.wire()).toBe("live");
    expect(s.live.stats()).toMatchObject({ alive: 2, rests: 1 });
    // a page let go of that was at rest already is not counted
    const t = stage();
    t.live.cap(1);
    const d = t.open("d", true, "hibernated");
    d.face.close();
    expect(t.live.stats().alive).toBe(0);
    // …and one that will not say it rested is taken to have, after a bound
    const u = stage();
    u.live.cap(1);
    const e = u.open("e", true, "created");
    e.face.demand(SEEN);
    await u.pump();
    e.deaf();
    e.face.close();
    const f = u.open("f", true, "created");
    f.face.demand(SEEN);
    await u.pump();
    // asked to rest, the page says nothing: the pane that wants its slot waits — two seconds, no longer
    expect(e.presentation.summary.state).toBe("live");
    expect(f.wire()).toBe("paused");
    u.clock.advance(1_999);
    await u.pump();
    expect(f.wire()).toBe("paused");
    u.clock.advance(1);
    await u.pump();
    expect(f.wire()).toBe("live");
  });

  it("a PARKED desk plans nothing and wakes nothing; running again the plan is made and each page asked, within the cap", async () => {
    const s = stage();
    s.live.cap(1);
    const a = s.open("a", true, "created");
    a.face.demand(SEEN);
    await s.pump();
    s.live.park(true);
    await s.pump();
    expect(a.wire()).toBe("paused");
    const b = s.open("b", true, "created");
    const sent = b.handle.demands.length;
    b.face.demand(SEEN);
    // (the ask of a pane over the cap is planned at its tick's end: read after it)
    await flush();
    expect(b.handle.demands).toHaveLength(sent);
    s.live.park(false);
    await s.pump();
    expect(a.wire()).toBe("live");
    expect(b.wire()).toBe("paused");
    expect(s.live.stats()).toMatchObject({ alive: 1, wakes: 1 });
    // parked, the cap lowered under two alive pages: nobody is put to rest until the desk runs again
    const t = stage({ far });
    t.live.cap(2);
    const c = t.open("a", true, "created");
    const d = t.open("b", true, "created");
    c.face.demand(SEEN);
    d.face.demand(SEEN);
    await t.pump();
    c.frame();
    d.frame();
    t.live.park(true);
    await t.pump();
    t.live.cap(1);
    await t.pump();
    expect([c.wire(), d.wire()]).toEqual(["paused", "paused"]);
    expect(t.shelf.takeStill).not.toHaveBeenCalled();
    expect(t.live.stats()).toMatchObject({ rests: 0, alive: 2 });
    t.live.park(false);
    await t.pump();
    expect([c.wire(), d.wire()]).toEqual(["live", "hibernated"]);
    expect(t.live.stats()).toMatchObject({ rests: 1, alive: 1 });
  });

  it("a page that STOPPED holds no slot: a waiting page comes alive — and when the stopped one is loaded again, the cap holds", async () => {
    const s = stage({ far });
    s.live.cap(1);
    const a = s.open("a", true, "created");
    const b = s.open("b", true, "created");
    a.face.demand(SEEN);
    s.clock.advance(10);
    b.face.demand(SEEN);
    await s.pump();
    expect([a.wire(), b.wire()]).toEqual(["live", "paused"]);
    a.say("failed");
    await s.pump();
    expect(b.wire()).toBe("live");
    expect(s.live.stats().alive).toBe(1);
    // nothing is planned for a stopped page: it is not "woken" again by the plan
    expect(s.live.stats().wakes).toBe(2);
    // ↻: a's producer starts again — two alive over a cap of one: the least recently seen of the seen ones rests
    a.say("starting");
    await s.pump();
    expect(s.live.stats().alive).toBe(1);
    expect(s.live.stats().rests).toBe(1);
  });

  it("a rest never hangs on its still: one that cannot be read in time, the page is put to rest all the same; a page seen again WHILE its still is taken stays", async () => {
    /** One page alive and unseen under a cap of one, a frame of it not yet photographed. */
    const one = async () => {
      const s = stage({ far });
      s.live.cap(1);
      const a = s.open("a", true, "created");
      a.face.demand(SEEN);
      await s.pump();
      a.frame();
      a.face.demand(UNSEEN);
      await s.pump();
      expect(a.wire()).toBe("paused");
      return { s, a };
    };
    const { s, a } = await one();
    // the read never answers
    s.shelf.takeStill.mockImplementation(() => new Promise(() => {}));
    const b = s.open("b", true, "created");
    b.face.demand(SEEN);
    await flush();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(1);
    expect([a.wire(), b.wire()]).toEqual(["paused", "paused"]);
    s.clock.advance(PAGE_STILL_TAKE_MAX_MS);
    await flush();
    expect(a.wire()).toBe("hibernated");
    expect(s.live.stats().rests).toBe(1);

    // seen again while its still is being taken: it stays, and the pane that wanted its slot waits
    const t = await one();
    let taken: () => void = () => {};
    t.s.shelf.takeStill.mockImplementationOnce(
      () =>
        new Promise<never>((resolve) => {
          taken = resolve as never;
        }),
    );
    const d = t.s.open("d", true, "created");
    d.face.demand(SEEN);
    await flush();
    expect(t.s.shelf.takeStill).toHaveBeenCalledTimes(1);
    t.a.face.demand(SEEN);
    await flush();
    taken();
    await t.s.pump();
    expect(t.a.wire()).toBe("live");
    expect(d.wire()).toBe("paused");
    expect(t.s.live.stats().rests).toBe(0);
  });

  it("a still being READ when the page's frame lands is void: the page put to rest before the read ends, its texture stays the page as it was — the shelf's older photograph is never laid over it", async () => {
    const s = stage({ far });
    s.live.cap(1);
    s.shelf.shelf.set(`${DOC}/a`, stillOf({ takenAt: 5 }));
    // every read of the shelf's picture is slow: none ends before the test lets it
    const reads: ((bitmap: ImageBitmap) => void)[] = [];
    const old = { width: 800, height: 500, close: vi.fn() };
    s.shelf.decodeStill.mockImplementation(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          reads.push(resolve);
        }),
    );
    const a = s.open("a", true, "created");
    a.face.demand(SEEN);
    await s.pump();
    expect(reads.length).toBeGreaterThan(0);
    // the page's own frame lands first…
    a.frame();
    expect(a.face.info().extra?.still).toBeUndefined();
    // …and the page is put to rest for a held one: what its texture holds is the page as it was
    s.clock.advance(1_000);
    const b = s.open("b", true, "created");
    b.face.demand(HELD);
    await s.pump();
    expect(a.wire()).toBe("hibernated");
    const rested = a.face.info().extra?.still;
    expect(rested).toEqual({ takenAt: s.clock.now(), age: 0 });
    const presented = s.writers[0]?.presented.length;
    // the reads end now
    for (const read of reads) read(old as unknown as ImageBitmap);
    await s.live.settled();
    expect(old.close).toHaveBeenCalledTimes(reads.length);
    expect(s.live.stats().stillsShown).toBe(0);
    expect(s.writers[0]?.presented).toHaveLength(presented ?? -1);
    expect(a.face.info().extra?.still).toEqual(rested);
  });

  it("PT-5b2 (ruling 8) — least recently SEEN, not least recently asked: a pane watched for ten minutes outlives one glanced at eight minutes ago", async () => {
    const s = stage();
    s.live.cap(2);
    // a comes into view at 0 s and stays; b is glanced at from 100 s to 110 s
    const a = s.open("a", true, "created");
    a.face.demand(SEEN);
    s.clock.advance(100_000);
    const b = s.open("b", true, "created");
    b.face.demand(SEEN);
    await s.pump();
    s.clock.advance(10_000);
    b.face.demand(UNSEEN);
    // a leaves the view at 601 s — seen a moment ago; b was last seen eight minutes ago
    s.clock.advance(491_000);
    a.face.demand(UNSEEN);
    await s.pump();
    expect([a.wire(), b.wire()]).toEqual(["paused", "paused"]);
    // a slot is wanted: the page that gives it is the one seen LONGEST ago
    s.clock.advance(1_000);
    const c = s.open("c", true, "created");
    c.face.demand(SEEN);
    await s.pump();
    expect([a.wire(), b.wire(), c.wire()]).toEqual(["paused", "hibernated", "live"]);
  });

  it("the test door: `cap()` reads it; lowered or raised, the plan is made again; a number that is none is nothing", async () => {
    const { s, a, b, c } = await three();
    expect(s.live.cap()).toBe(2);
    expect(s.live.cap(0)).toBe(2);
    expect(s.live.cap(Number.NaN)).toBe(2);
    expect(s.live.cap(3.9)).toBe(3);
    await s.pump();
    expect([a.wire(), b.wire(), c.wire()]).toEqual(["live", "live", "live"]);
    expect(s.live.stats()).toMatchObject({ cap: 3, alive: 3 });
  });
});

describe("PT-5b — the face's texture let go at the budget's word (ruling 4)", () => {
  it("evicted: the writer is destroyed — the film; seen again, the pane's still is laid again from the shelf; the page's next frame takes its place", async () => {
    const s = stage();
    const { face, frame } = s.open();
    face.demand(HELD);
    frame();
    face.demand(SEEN);
    await s.live.settled();
    face.demand(UNSEEN);
    expect(s.live.navigation.evict?.(KEY)).toBe(true);
    expect(s.writers[0]?.destroyed).toBe(1);
    expect(face.texture()).toBeUndefined();
    expect(s.live.stats().evictions).toBe(1);
    // the kind is told its words moved
    expect(face.take()).toBe(true);
    // nothing more to let go; and no page under another key
    expect(s.live.navigation.evict?.(KEY)).toBe(false);
    expect(s.live.navigation.evict?.("nobody")).toBe(false);
    expect(s.live.stats().evictions).toBe(1);
    // seen again: its still, decoded again from the shelf
    face.demand(SEEN);
    await s.live.settled();
    expect(s.writers).toHaveLength(2);
    expect(face.texture()).toBeDefined();
    expect(face.info().extra?.still).toMatchObject({ takenAt: expect.any(Number) });
    frame();
    expect(face.info().extra?.still).toBeUndefined();
    expect(s.writers).toHaveLength(2);
  });

  it("a face that shows the film (no still on the shelf) after an eviction makes its texture again at its page's next frame", async () => {
    const s = stage({ docId: () => undefined });
    const { face, frame } = s.open(KEY, true, "live", PAGE);
    face.demand(SEEN);
    frame();
    s.live.navigation.evict?.(KEY);
    expect(face.texture()).toBeUndefined();
    frame();
    expect(face.texture()).toBeDefined();
    expect(s.writers).toHaveLength(2);
  });
});
