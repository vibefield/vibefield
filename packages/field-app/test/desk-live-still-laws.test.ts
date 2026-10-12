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
// PT-5b3 — what PT-5b2's grade found in those fixes (ruling 4): "the address its pixels are of" was wider than its case.
//    A texture is "of the document before" when the DOCUMENT moved with no frame since — the producer's serial
//    (`browser.document`: it moves at a commit, never at a move within a document). An address that moved WITHIN one
//    document (a hash, a script's `replaceState`) leaves the texture of this document: it is photographed under the
//    address NOW, a rest shows it, seen again it stands. A frame says the document it is of (its producer's stamp), else
//    it is the document that stood when it ARRIVED — never the one that stands when it is consumed. A producer that
//    counts no documents is read by the address, as before.
import { describe, expect, it, vi } from "vitest";
import { PAGE_STILL_EVERY_MS, PAGE_STILL_SETTLE_MS } from "../src/surfaces/live/desk-live";
import { PAGE_STILL_MAX_PX } from "../src/surfaces/live/page-stills";
import {
  browserAt,
  DOC,
  documentOf,
  HELD,
  KEY,
  PAGE,
  SEEN,
  stage,
  stillOf,
  UNSEEN,
} from "./desk-live-fixture";

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
    const began = s.clock.now();
    // the read is under way: nothing is counted yet
    expect(s.live.stats().stillsTaken).toBe(0);
    takes[0]?.fail();
    await s.live.settled();
    expect(s.live.stats().stillsTaken).toBe(0);
    // (PT-5b3: the moment it was asked stands — the clock of the take that failed runs from it)
    expect(s.live.faces()[0]?.stillAt).toBe(began);
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

describe("PT-5b3 — a take that FAILED has a clock of its own (ruling 7)", () => {
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

  it("a QUIET page whose take failed is asked again ONCE, thirty seconds after that take BEGAN — with no frame since (before: by nothing, until its next frame, a put-down or a rest)", async () => {
    const { s, takes } = slow();
    const { face, frame } = s.open();
    face.demand(SEEN);
    expect(frame()).toBe(true);
    s.clock.advance(PAGE_STILL_SETTLE_MS);
    expect(takes).toHaveLength(1);
    const began = s.clock.now();
    takes[0]?.fail();
    await s.live.settled();
    s.clock.advance(began + PAGE_STILL_EVERY_MS - s.clock.now() - 1);
    expect(takes).toHaveLength(1);
    s.clock.advance(1);
    expect(takes).toHaveLength(2);
    // that one answers: kept, counted — and nothing more is asked of a page that paints nothing
    takes[1]?.finish();
    await s.live.settled();
    expect(s.live.stats().stillsTaken).toBe(1);
    s.clock.advance(5 * PAGE_STILL_EVERY_MS);
    expect(takes).toHaveLength(2);
  });

  it("a page that PAINTS under a failure that lasts (a shelf that cannot be written — a full disk) is read back once each thirty seconds, never each 1.5 s: each failed take asked again once, thirty seconds after IT began", async () => {
    const { s, takes } = slow();
    const { face, frame } = s.open();
    face.demand(SEEN);
    expect(frame()).toBe(true);
    s.clock.advance(PAGE_STILL_SETTLE_MS);
    expect(takes).toHaveLength(1);
    let began = s.clock.now();
    for (let failure = 1; failure <= 3; failure += 1) {
      takes[failure - 1]?.fail();
      await s.live.settled();
      // the page paints every second meanwhile: none of its frames asks for a still before the clock
      while (s.clock.now() < began + PAGE_STILL_EVERY_MS - 1_000) {
        s.clock.advance(1_000);
        frame();
      }
      expect(takes).toHaveLength(failure);
      s.clock.advance(began + PAGE_STILL_EVERY_MS - s.clock.now());
      expect(takes).toHaveLength(failure + 1);
      began = s.clock.now();
    }
    // a PUT-DOWN still asks at once — its frame is the best the page will have
    takes[3]?.fail();
    await s.live.settled();
    face.demand(HELD);
    face.demand(SEEN);
    expect(takes).toHaveLength(5);
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

describe("PT-5b3 — a still is of a DOCUMENT, and the engine says which (ruling 4)", () => {
  /** The page's address after a script tidied it (`replaceState`: another path, the SAME document). */
  const TIDIED = "http://127.0.0.1:4321/tidied";
  const tidied = () => browserAt(TIDIED, { document: documentOf(PAGE.url) }) as never;

  it("an address that moves WITHIN one document (a hash, a script's replaceState: no load, no frame) does not cost the pane its photograph: a PUT-DOWN files it under the address NOW — and so does the at-rest timer", async () => {
    const s = stage();
    const { face, frame, handle } = s.open();
    face.demand(HELD);
    expect(frame()).toBe(true);
    handle.set({ browser: tidied() });
    face.take();
    face.demand(SEEN);
    await s.live.settled();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(1);
    expect(keptOf(s)).toBe(TIDIED);
    // a hash alone, at rest in view: the timer's take, under the address now
    const t = stage();
    const b = t.open();
    b.face.demand(SEEN);
    expect(b.frame()).toBe(true);
    b.handle.set({ browser: browserAt(`${PAGE.url}#section`) as never });
    b.face.take();
    t.clock.advance(PAGE_STILL_SETTLE_MS);
    await t.live.settled();
    expect(keptOf(t)).toBe(`${PAGE.url}#section`);
  });

  it("…and put to REST the pane shows its PICTURE, under the address now — not its film; seen again after being out of view its texture stands", async () => {
    const s = stage();
    s.live.cap(1);
    const a = s.open();
    a.face.demand(SEEN);
    await s.pump();
    expect(a.frame()).toBe(true);
    a.handle.set({ browser: tidied() });
    a.face.take();
    const b = s.open("13918995204487956201-2", true, "created");
    b.face.demand(HELD);
    await s.pump();
    await s.live.settled();
    expect(a.wire()).toBe("hibernated");
    expect(keptOf(s)).toBe(TIDIED);
    expect(a.face.texture()).toBeDefined();
    expect(a.face.info().extra?.still).toBeDefined();
    expect(a.face.state()).toEqual({ is: "paused" });
    // out of view, its address tidied, and seen again: the texture is of this document — it stands
    const t = stage();
    const c = t.open();
    c.face.demand(SEEN);
    expect(c.frame()).toBe(true);
    c.face.demand(UNSEEN);
    c.handle.set({ browser: tidied() });
    c.face.take();
    c.face.demand(SEEN);
    expect(c.face.texture()).toBeDefined();
  });

  it("ANOTHER DOCUMENT at the same address (a reload that committed, no frame since) makes the texture the document before's: nothing is photographed of it, and seen again it is let go", async () => {
    const s = stage();
    const { face, frame, handle } = s.open();
    face.demand(HELD);
    expect(frame()).toBe(true);
    handle.set({
      browser: browserAt(PAGE.url, { document: documentOf(PAGE.url) + 1_000 }) as never,
    });
    face.take();
    face.demand(SEEN);
    await s.live.settled();
    expect(s.shelf.takeStill).not.toHaveBeenCalled();
    expect(keptOf(s)).toBeNull();
    face.demand(UNSEEN);
    face.demand(SEEN);
    expect(face.texture()).toBeUndefined();
  });

  it("a frame is of the document that stood when it ARRIVED — never the one that stands when it is consumed; and where its producer stamps it, of the document it SAYS", async () => {
    const s = stage();
    const { face, frame, handle, presentation } = s.open();
    face.demand(HELD);
    expect(frame()).toBe(true);
    // a frame of the page as it was arrives — and before it is drawn the page commits elsewhere (never `loading`: a
    // navigation told in one state)
    presentation.land();
    handle.set({ browser: browserAt(NEXT) as never });
    expect(face.take()).toBe(true);
    face.demand(SEEN);
    await s.live.settled();
    expect(keptOf(s)).toBeNull();
    // a frame that SAYS its document (the producer's stamp, at its paint) is that document's, whatever the state said
    // when it arrived: the new page's first frame, landed a moment before the summary that names its document
    const t = stage();
    const b = t.open();
    b.face.demand(HELD);
    expect(b.frame()).toBe(true);
    b.presentation.land(documentOf(NEXT));
    b.handle.set({ browser: browserAt(NEXT) as never });
    expect(b.face.take()).toBe(true);
    b.face.demand(SEEN);
    await t.live.settled();
    expect(keptOf(t)).toBe(NEXT);
  });

  it("a producer that counts NO documents is read by the address, as before: an address that moved with no frame since is the address before's — a hash too (it cannot be told from a page that went elsewhere)", async () => {
    const none = (url: string) => browserAt(url, { document: undefined }) as never;
    const s = stage();
    const { face, frame, handle } = s.open();
    handle.set({ browser: none(PAGE.url) });
    face.demand(HELD);
    expect(frame()).toBe(true);
    handle.set({ browser: none(NEXT) });
    face.take();
    face.demand(SEEN);
    await s.live.settled();
    expect(keptOf(s)).toBeNull();
    // …and its new page's frame is photographed under its own address
    face.demand(HELD);
    frame();
    face.demand(SEEN);
    await s.live.settled();
    expect(keptOf(s)).toBe(NEXT);
    const t = stage();
    const b = t.open();
    b.handle.set({ browser: none(PAGE.url) });
    b.face.demand(HELD);
    expect(b.frame()).toBe(true);
    b.handle.set({ browser: none(`${PAGE.url}#section`) });
    b.face.take();
    b.face.demand(SEEN);
    await t.live.settled();
    expect(keptOf(t)).toBeNull();
  });

  it("a pane SENT elsewhere and put to rest before its page has said so does not show the page it is leaving as a still of where it is headed: its film", async () => {
    const s = stage();
    s.live.cap(1);
    const a = s.open();
    a.face.demand(SEEN);
    await s.pump();
    expect(a.frame()).toBe(true);
    expect(s.live.navigation.navigate(KEY, { action: "go", url: NEXT })).toBe(true);
    // (its producer has not answered the rest yet — the summary that follows would let the still go by itself: this is
    // the rest's OWN check, at the moment it makes the photograph)
    a.deaf();
    const b = s.open("13918995204487956201-2", true, "created");
    b.face.demand(HELD);
    await s.pump();
    await s.live.settled();
    expect(a.wire()).toBe("hibernated");
    expect(a.face.texture()).toBeUndefined();
    expect(a.face.info().extra?.still).toBeUndefined();
  });
});

// PT-5c (ruling 3) — WHERE NO DOCUMENT OF THE PAGE STANDS the producer says no serial (a window made anew before its first
// commit, a page at rest sent elsewhere, a page headed elsewhere before its first commit). The desk's rule stands as
// built: with no serial it reads the address of the frame's arrival against the page's. WITNESSES, written with the
// producer's new word (the third grade's P1a, P1b — whose probes gave the desk the OLD document's serial at the new
// address, which the producer no longer says).
describe("PT-5c — where no document of the page stands the producer says none, and the desk reads the address (ruling 3)", () => {
  it("a page HEADED elsewhere with nothing of it standing (a window made anew, then a go) is not this document: put to REST its pane shows its film — never the page it left, labelled as where it is headed (P1a)", async () => {
    const s = stage();
    s.live.cap(1);
    const a = s.open();
    a.face.demand(SEEN);
    await s.pump();
    expect(a.frame()).toBe(true);
    // what the producer says now: the new address, loading, NO serial
    a.handle.set({ browser: browserAt(NEXT, { document: undefined, loading: true }) as never });
    const b = s.open("13918995204487956201-2", true, "created");
    b.face.demand(HELD);
    await s.pump();
    await s.live.settled();
    expect(a.face.info().extra?.still).toBeUndefined();
    expect(a.face.texture()).toBeUndefined();
    expect(keptOf(s)).not.toBe(NEXT);
  });

  it("…and an UNSEEN pane whose page was sent elsewhere at rest (a peer's go; no serial said) is not photographed onto the shelf under the new address by its timer — and seen again it lets go (P1b)", async () => {
    const s = stage();
    const { face, frame, handle } = s.open();
    face.demand(SEEN);
    expect(frame()).toBe(true);
    face.demand(UNSEEN);
    handle.set({ browser: browserAt(NEXT, { document: undefined, loading: false }) as never });
    s.clock.advance(PAGE_STILL_SETTLE_MS + PAGE_STILL_EVERY_MS);
    await s.live.settled();
    expect(s.shelf.takeStill).not.toHaveBeenCalled();
    expect(keptOf(s)).toBeNull();
    face.demand(SEEN);
    await s.live.settled();
    expect(face.texture()).toBeUndefined();
  });

  it("at the SAME address with nothing of it standing (a page woken; a window made anew by a density switch) the texture of the page as it was stays its picture until the new document's first frame — no film between two pictures of one address", async () => {
    const s = stage();
    const { face, frame, handle } = s.open();
    face.demand(SEEN);
    expect(frame()).toBe(true);
    face.demand(UNSEEN);
    handle.set({ browser: browserAt(PAGE.url, { document: undefined, loading: true }) as never });
    face.demand(SEEN);
    await s.live.settled();
    expect(face.texture()).toBeDefined();
  });
});
