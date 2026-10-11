// PT-5b2 — what PT-5b's grade found in the last still (surfaces/live/desk-live.ts), each row the probe that proved it:
//  - ruling 1: a still is filed under the address ITS PIXELS are of — the address the page said when the frame now in
//    the texture was consumed. A url that moves with no frame since makes the texture "of the address before": nothing
//    is taken of it under the new address (a put-down, a rest's take, the at-rest timer alike), a rest's own still says
//    the address its pixels are of (a pane that has moved shows its film), and nothing is taken while the page says it
//    is loading — on every path.
//  - ruling 5: one still a pane every 30 s, WHATEVER lands while it is taken; a take that rejects is owed again; a still
//    is counted taken when it is kept, not before.
//  - ruling 9: a frame in flight when a seen page is put to rest does not unsay its still; a still's own size is held to
//    1600 px before a texture is made of it.
import { describe, expect, it, vi } from "vitest";
import { PAGE_STILL_EVERY_MS, PAGE_STILL_SETTLE_MS } from "../src/surfaces/live/desk-live";
import { PAGE_STILL_MAX_PX } from "../src/surfaces/live/page-stills";
import { browserAt, DOC, HELD, KEY, PAGE, SEEN, stage, stillOf, UNSEEN } from "./desk-live-fixture";

const NEXT = "http://127.0.0.1:4321/next";
/** The address the shelf's still of the first pane says it is a photograph of — null: none kept. */
const keptOf = (s: ReturnType<typeof stage>): string | null =>
  s.shelf.shelf.get(`${DOC}/${KEY}`)?.address ?? null;

describe("PT-5b2 — a still is filed under the address its pixels are of (ruling 1)", () => {
  it("a pane PUT DOWN between a navigation's commit and the new page's first frame keeps no photograph of the old page under the new address — and the new page's first frame is photographed under its own", async () => {
    const s = stage();
    const { face, frame, handle } = s.open();
    face.demand(HELD);
    expect(frame()).toBe(true);
    // the page goes elsewhere: its address commits, and no frame of the new document has landed
    handle.set({ browser: browserAt(NEXT) as never });
    face.take();
    face.demand(SEEN);
    await s.live.settled();
    expect(keptOf(s)).toBeNull();
    expect(s.shelf.takeStill).not.toHaveBeenCalled();
    // the new page's first frame: its still is its own address's
    face.demand(HELD);
    frame();
    face.demand(SEEN);
    await s.live.settled();
    expect(keptOf(s)).toBe(NEXT);
  });

  it("the same at a REST: the page put to rest between two addresses keeps nothing under the new one, and its pane shows its FILM — never the page it left as a still of where it is", async () => {
    const s = stage();
    s.live.cap(1);
    const a = s.open();
    a.face.demand(SEEN);
    await s.pump();
    expect(a.frame()).toBe(true);
    a.handle.set({ browser: browserAt(NEXT) as never });
    a.face.take();
    // another pane picked up: the first, seen, gives its slot
    const b = s.open("13918995204487956201-2", true, "created");
    b.face.demand(HELD);
    await s.pump();
    await s.live.settled();
    expect(a.wire()).toBe("hibernated");
    expect(keptOf(s)).toBeNull();
    expect(a.face.texture()).toBeUndefined();
    expect(a.face.info().extra?.still).toBeUndefined();
    expect(a.face.state()).toEqual({ is: "paused" });
  });

  it("an UNSEEN pane whose page goes elsewhere (a peer's `go` to a paused page; a script's redirect) keeps no photograph of the old page under the new address — and seen again it shows its film, not the page it left", async () => {
    const s = stage();
    const { face, frame, handle, presentation } = s.open();
    face.demand(SEEN);
    expect(frame()).toBe(true);
    // out of view before its still's moment: its frames are taken and closed from here
    face.demand(UNSEEN);
    handle.set({ browser: browserAt(NEXT) as never });
    presentation.land();
    face.take();
    s.clock.advance(PAGE_STILL_SETTLE_MS + PAGE_STILL_EVERY_MS);
    await s.live.settled();
    expect(keptOf(s)).toBeNull();
    expect(s.shelf.takeStill).not.toHaveBeenCalled();
    // seen again: what its texture holds is the page it LEFT — let go (the film) until the new page's own frame
    expect(face.texture()).toBeDefined();
    face.demand(SEEN);
    expect(face.texture()).toBeUndefined();
    expect(frame()).toBe(true);
    expect(face.texture()).toBeDefined();
    s.clock.advance(PAGE_STILL_SETTLE_MS);
    await s.live.settled();
    expect(keptOf(s)).toBe(NEXT);
  });

  it("no still is taken while the page says it is LOADING, on every path: not at a put-down, not at a rest's take — the frame stays owed to the timer", async () => {
    const s = stage();
    const { face, frame, handle } = s.open();
    face.demand(HELD);
    handle.set({ browser: browserAt(PAGE.url, { loading: true }) as never });
    expect(frame()).toBe(true);
    face.demand(SEEN);
    await s.live.settled();
    expect(s.shelf.takeStill).not.toHaveBeenCalled();
    // its load over, the timer takes the frame it was owed
    handle.set({ browser: browserAt(PAGE.url) as never });
    s.clock.advance(PAGE_STILL_SETTLE_MS);
    await s.live.settled();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(1);
    expect(keptOf(s)).toBe(PAGE.url);
    // a rest while loading: put to rest all the same, nothing read back
    const t = stage();
    t.live.cap(1);
    const a = t.open();
    a.face.demand(SEEN);
    await t.pump();
    a.handle.set({ browser: browserAt(PAGE.url, { loading: true }) as never });
    a.frame();
    const b = t.open("13918995204487956201-2", true, "created");
    b.face.demand(HELD);
    await t.pump();
    await t.live.settled();
    expect(a.wire()).toBe("hibernated");
    expect(t.shelf.takeStill).not.toHaveBeenCalled();
    expect(t.live.stats().rests).toBe(1);
  });
});

describe("PT-5b2 — one still a pane every 30 s, whatever lands while it is taken (ruling 5)", () => {
  /** A stage whose taker answers when the row lets it: each take's `finish` (with a picture, or `fail`). */
  const slow = () => {
    const takes: { finish(): void; fail(): void }[] = [];
    const s = stage({
      takeStill: ((_d: GPUDevice, face: { width: number; height: number }) =>
        new Promise((resolve, reject) => {
          takes.push({
            finish: () =>
              resolve({
                type: "image/webp",
                image: new Uint8Array([7]),
                size: [face.width, face.height] as const,
              }),
            fail: () => reject(new Error("the device was lost under the read")),
          });
        })) as never,
    });
    return { s, takes };
  };

  it("a page that paints WHILE its still is taken gets ONE still — not a second 1.5 s after — and its next 30 s after the first", async () => {
    const { s, takes } = slow();
    const { face, frame } = s.open();
    face.demand(SEEN);
    expect(frame()).toBe(true);
    s.clock.advance(PAGE_STILL_SETTLE_MS);
    expect(takes).toHaveLength(1);
    const first = s.clock.now();
    // the page paints while its texture is read back and encoded (a video, an animation: certain)
    s.clock.advance(40);
    frame();
    takes[0]?.finish();
    await s.live.settled();
    s.clock.advance(PAGE_STILL_SETTLE_MS + 500);
    expect(takes).toHaveLength(1);
    expect(s.live.stats().stillsTaken).toBe(1);
    // the frame that landed meanwhile is photographed thirty seconds after the first take, not before
    s.clock.advance(first + PAGE_STILL_EVERY_MS - s.clock.now() - 1);
    expect(takes).toHaveLength(1);
    s.clock.advance(1);
    expect(takes).toHaveLength(2);
  });

  it("a take that REJECTS is owed again, and a still is counted taken when it is KEPT — never before", async () => {
    const { s, takes } = slow();
    const { face, frame } = s.open();
    face.demand(HELD);
    frame();
    face.demand(SEEN);
    expect(takes).toHaveLength(1);
    // the read is under way: nothing is counted yet
    expect(s.live.stats().stillsTaken).toBe(0);
    takes[0]?.fail();
    await s.live.settled();
    expect(s.live.stats().stillsTaken).toBe(0);
    expect(s.live.faces()[0]?.stillAt).toBeNull();
    // owed: the next put-down takes it, with no frame between
    face.demand(HELD);
    face.demand(SEEN);
    expect(takes).toHaveLength(2);
    // …read back, and its KEEP fails (the shelf's disk): not counted, owed again
    s.shelf.stills.keep.mockRejectedValueOnce(new Error("the shelf could not be written"));
    takes[1]?.finish();
    await s.live.settled();
    expect(s.live.stats().stillsTaken).toBe(0);
    expect(keptOf(s)).toBeNull();
    face.demand(HELD);
    face.demand(SEEN);
    expect(takes).toHaveLength(3);
    takes[2]?.finish();
    await s.live.settled();
    expect(s.live.stats().stillsTaken).toBe(1);
    expect(keptOf(s)).toBe(PAGE.url);
    expect(s.live.faces()[0]?.stillAt).toBe(s.clock.now());
  });
});

describe("PT-5b2 — the smaller laws of a still (ruling 9)", () => {
  it("a frame IN FLIGHT when a seen page is put to rest does not unsay its still: it is taken and closed — the pane stays a photograph, dimmed and marked, until its page is woken", async () => {
    const s = stage();
    s.live.cap(1);
    const a = s.open();
    a.face.demand(SEEN);
    await s.pump();
    a.frame();
    // another pane picked up: a, seen, gives its slot — it reads `paused` on its still
    const b = s.open("13918995204487956201-2", true, "created");
    b.face.demand(HELD);
    await s.pump();
    await s.live.settled();
    expect(a.wire()).toBe("hibernated");
    const said = a.face.info().extra?.still;
    expect(said).toBeDefined();
    const presented = s.writers[0]?.presented.length;
    // a frame that was crossing from main when its page was let go
    const late = a.presentation.land();
    a.face.take();
    expect(a.face.info().extra?.still).toEqual(said);
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(s.writers[0]?.presented).toHaveLength(presented ?? -1);
    expect(a.face.state()).toEqual({ is: "paused" });
    // woken (the other put down and gone out of view), its page's frame is the page again
    b.face.demand(UNSEEN);
    await s.pump();
    expect(a.wire()).toBe("live");
    a.frame();
    expect(a.face.info().extra?.still).toBeUndefined();
  });

  it(`a still's own size is held to ${PAGE_STILL_MAX_PX} px BEFORE a texture is made of it: a picture planted on the shelf is not a texture of any size — the film, its bitmap closed`, async () => {
    const s = stage();
    s.shelf.shelf.set(`${DOC}/${KEY}`, stillOf());
    const planted = { width: 8_192, height: 4_096, close: vi.fn() };
    s.shelf.decodeStill.mockResolvedValueOnce(planted as never);
    const { face } = s.open(KEY, false);
    await s.live.settled();
    expect(s.writers).toHaveLength(0);
    expect(face.texture()).toBeUndefined();
    expect(planted.close).toHaveBeenCalledTimes(1);
    expect(s.live.stats().stillsShown).toBe(0);
    // one at the bound is a still like any other
    const t = stage();
    t.shelf.shelf.set(`${DOC}/${KEY}`, stillOf());
    t.shelf.decodeStill.mockResolvedValueOnce({
      width: PAGE_STILL_MAX_PX,
      height: 1_000,
      close: vi.fn(),
    } as never);
    const b = t.open(KEY, false);
    await t.live.settled();
    expect(b.face.texture()).toBeDefined();
  });
});
