// PT-5b (rulings 1, 2) — THE LAST STILL in the desk's LIVE service (surfaces/live/desk-live.ts), with the fixture's fakes: a
// clock and its timers, the shelf, and the host's two hands on a page's pixels (the texture read back; a kept still decoded).
//  - TAKEN: a held pane put down; at rest at most once every 30 s and only where a frame arrived since; never per frame, never
//    in the hand, never of a still, never of a failed page; kept under the document and the object with the page's address
//    and logical size.
//  - SHOWN through the face's own writer where no live frame has landed — at open, under a failure's words where the
//    address that failed is the still's — and never passed off as the page (`info().extra.still`); gone with the page's
//    first frame, the texture never undefined between. A still of another address is not shown.
//  - FORGOTTEN: a deleted pane's when its page's grace lapses; an undo within the grace keeps it.
import { liveBrowserFailure } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it, vi } from "vitest";
import {
  PAGE_STILL_EVERY_MS,
  PAGE_STILL_SETTLE_MS,
  sameAddress,
} from "../src/surfaces/live/desk-live";
import {
  browserAt,
  DOC,
  fakePresentation,
  HELD,
  KEY,
  PAGE,
  SEEN,
  says,
  stage,
  stillOf,
  UNSEEN,
} from "./desk-live-fixture";

const OTHER = "http://127.0.0.1:4321/elsewhere";

describe("PT-5b — the last still is TAKEN by the host (ruling 1)", () => {
  it("a held pane PUT DOWN: its texture is read back once and kept under the document and the object, with the page's address and its logical size — and a quiet page writes nothing", async () => {
    const s = stage();
    const { face, frame } = s.open();
    face.demand(HELD);
    expect(frame()).toBe(true);
    // in the hand nothing is taken, whatever lands
    frame();
    expect(s.shelf.takeStill).not.toHaveBeenCalled();
    face.demand(SEEN);
    await s.live.settled();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(1);
    const [device, read] = s.shelf.takeStill.mock.calls[0] ?? [];
    expect(device).toBe(s.device);
    expect(read).toMatchObject({ width: 2560, height: 1600 });
    expect(s.shelf.stills.keep).toHaveBeenCalledWith(DOC, KEY, {
      address: PAGE.url,
      logical: [1280, 800],
      size: [2560, 1600],
      type: "image/webp",
      image: new Uint8Array([7, 7, 7]),
      takenAt: s.clock.now(),
    });
    expect(s.live.stats().stillsTaken).toBe(1);
    expect(s.live.faces()[0]?.stillAt).toBe(s.clock.now());
    // picked up and put down again with no frame between: the shelf's still is what the page shows — nothing is written
    face.demand(HELD);
    face.demand(SEEN);
    await s.live.settled();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(1);
    // put down out of view (unseen) after a frame: taken as well
    face.demand(HELD);
    frame();
    face.demand(UNSEEN);
    await s.live.settled();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(2);
  });

  it("AT REST in view: a still at most once every 30 s a pane, a moment after the first frame since the last — and only where a frame arrived since", async () => {
    const s = stage();
    const { face, frame } = s.open();
    face.demand(SEEN);
    frame();
    // never per frame: more frames arm nothing more
    frame();
    frame();
    s.clock.advance(PAGE_STILL_SETTLE_MS - 1);
    expect(s.shelf.takeStill).not.toHaveBeenCalled();
    s.clock.advance(1);
    await s.live.settled();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(1);
    // a frame a second later: not before the thirty seconds are over
    s.clock.advance(1_000);
    frame();
    s.clock.advance(PAGE_STILL_EVERY_MS - 1_001);
    await s.live.settled();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(1);
    s.clock.advance(1);
    await s.live.settled();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(2);
    // a quiet page writes nothing, however long it stands
    s.clock.advance(10 * PAGE_STILL_EVERY_MS);
    await s.live.settled();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(2);
    expect(s.clock.pending()).toBe(0);
  });

  it("not while the page says it is loading (asked again in a moment); not in the hand (its put-down takes it); and nothing is taken with no document or no shelf", async () => {
    const s = stage();
    const { face, handle, frame } = s.open();
    handle.set({ browser: browserAt(PAGE.url, { loading: true }) as never });
    face.demand(SEEN);
    frame();
    s.clock.advance(PAGE_STILL_SETTLE_MS);
    await s.live.settled();
    expect(s.shelf.takeStill).not.toHaveBeenCalled();
    handle.set({ browser: browserAt(PAGE.url) as never });
    s.clock.advance(PAGE_STILL_SETTLE_MS);
    await s.live.settled();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(1);
    // in the hand when its time comes: left to the put-down
    frame();
    face.demand(HELD);
    s.clock.advance(PAGE_STILL_EVERY_MS);
    await s.live.settled();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(1);
    face.demand(SEEN);
    await s.live.settled();
    expect(s.shelf.takeStill).toHaveBeenCalledTimes(2);
    // no document: nothing is taken, kept or shown
    const none = stage({ docId: () => undefined });
    const b = none.open();
    b.face.demand(HELD);
    b.frame();
    b.face.demand(SEEN);
    none.clock.advance(PAGE_STILL_EVERY_MS);
    await none.live.settled();
    expect(none.shelf.takeStill).not.toHaveBeenCalled();
    expect(none.shelf.stills.kept).not.toHaveBeenCalled();
  });

  it("a still that could not be taken (a device lost under the read) keeps nothing and is owed again; a failed page's frames are never kept", async () => {
    const s = stage();
    const { face, handle, frame } = s.open();
    s.shelf.takeStill.mockResolvedValueOnce(undefined as never);
    face.demand(HELD);
    frame();
    face.demand(SEEN);
    await s.live.settled();
    expect(s.shelf.stills.keep).not.toHaveBeenCalled();
    expect(s.live.stats().stillsTaken).toBe(0);
    // owed: the next put-down takes it, with no frame between
    face.demand(HELD);
    face.demand(SEEN);
    await s.live.settled();
    expect(s.shelf.stills.keep).toHaveBeenCalledTimes(1);
    // the page's load fails (the engine's own error page behind it): its frames are not shown — and not kept
    face.demand(HELD);
    handle.set({
      browser: browserAt(OTHER, { failure: { reason: "connection-refused" } }) as never,
    });
    frame();
    face.demand(SEEN);
    await s.live.settled();
    expect(s.shelf.stills.keep).toHaveBeenCalledTimes(1);
  });
});

describe("PT-5b — the still is SHOWN through the one path, and never passed off as the page (ruling 2)", () => {
  it("on OPEN, before any frame: the shelf's still of the pane's address is laid into the face's own writer — the texture is there, the state says what is true, `extra.still` says it is a still, with its age", async () => {
    const s = stage();
    s.shelf.shelf.set(`${DOC}/${KEY}`, stillOf({ takenAt: s.clock.now() - 5_000 }));
    const { face, arrived } = s.open(KEY, false);
    expect(face.texture()).toBeUndefined();
    await s.live.settled();
    expect(s.writers).toHaveLength(1);
    expect(s.writers[0]?.o).toMatchObject({
      label: `vibefield.browser-pane/live ${KEY}`,
      width: 800,
      height: 500,
    });
    // the decoded picture, whole, with the page's LOGICAL size — and the bitmap closed once it is copied
    expect(s.writers[0]?.presented).toEqual([
      { frame: s.shelf.bitmaps[0], rect: undefined, logical: [1280, 800] },
    ]);
    expect(s.shelf.bitmaps[0]?.close).toHaveBeenCalledTimes(1);
    expect(face.texture()).toBeDefined();
    expect(face.state()).toEqual({ is: "starting" });
    expect(face.info()).toEqual({
      extra: { still: { takenAt: s.clock.now() - 5_000, age: 5_000 } },
    });
    // its age is read as the words are
    s.clock.advance(1_000);
    expect(face.info().extra?.still).toEqual({ takenAt: s.clock.now() - 6_000, age: 6_000 });
    // the kind is told once, and its take says the words moved
    expect(arrived).toHaveBeenCalledTimes(1);
    expect(face.take()).toBe(true);
    expect(face.take()).toBe(false);
    expect(s.live.stats().stillsShown).toBe(1);
    expect(s.live.faces()[0]).toMatchObject({ still: s.clock.now() - 6_000, veiled: false });
  });

  it("the still HOLDS until the page's first frame lands — the texture is never gone between — and `extra.still` goes with that frame; the writer is the same one", async () => {
    const s = stage();
    s.shelf.shelf.set(`${DOC}/${KEY}`, stillOf());
    const { face, attach, frame, presentation } = s.open(KEY, false);
    await s.live.settled();
    const seen: boolean[] = [];
    const look = (): void => {
      seen.push(face.texture() !== undefined);
    };
    look();
    attach();
    look();
    face.demand(SEEN);
    await s.live.settled();
    look();
    expect(face.info().extra?.still).toBeDefined();
    // the page's words move (its title, its loading line) with no frame: still a still
    face.take();
    look();
    expect(face.info().extra?.still).toBeDefined();
    // a frame taken while the pane is unseen is drawn nowhere: the still stands
    face.demand(UNSEEN);
    presentation.land();
    face.take();
    look();
    expect(face.info().extra?.still).toBeDefined();
    face.demand(SEEN);
    await s.live.settled();
    // the first frame
    expect(frame()).toBe(true);
    look();
    expect(face.info().extra?.still).toBeUndefined();
    expect(seen).toEqual([true, true, true, true, true, true]);
    expect(s.writers).toHaveLength(1);
    expect(s.writers[0]?.destroyed).toBe(0);
    expect(s.writers[0]?.presented).toHaveLength(2);
    // shown once: seeing it again reads nothing more off the shelf
    expect(s.shelf.decodeStill).toHaveBeenCalledTimes(1);
    expect(s.live.faces()[0]?.still).toBeNull();
  });

  it("a still of ANOTHER address is not shown — the film — and one whose pane is sent elsewhere under it is let go; the same address said two ways is one", async () => {
    expect(sameAddress("http://Example.com", "http://example.com/")).toBe(true);
    expect(sameAddress("http://example.com/a", "http://example.com/b")).toBe(false);
    expect(sameAddress("not an address", "not an address")).toBe(true);
    expect(sameAddress("not an address", "nor this")).toBe(false);
    const s = stage();
    s.shelf.shelf.set(`${DOC}/${KEY}`, stillOf({ address: OTHER }));
    const { face } = s.open(KEY, false);
    await s.live.settled();
    expect(face.texture()).toBeUndefined();
    expect(face.info()).toEqual({});
    expect(s.shelf.decodeStill).not.toHaveBeenCalled();
    expect(s.writers).toHaveLength(0);
    // the pane's still shown, then the pane sent to another address (the document's word, a typed one): let go — the film
    const t = stage();
    t.shelf.shelf.set(`${DOC}/${KEY}`, stillOf());
    const b = t.open(KEY, false);
    await t.live.settled();
    expect(b.face.texture()).toBeDefined();
    b.attach();
    expect(t.live.navigation.navigate(KEY, { action: "go", url: OTHER })).toBe(true);
    expect(b.face.texture()).toBeUndefined();
    expect(b.face.info().extra?.still).toBeUndefined();
    expect(t.writers[0]?.destroyed).toBe(1);
    // …and the page saying it is elsewhere does the same
    const u = stage();
    u.shelf.shelf.set(`${DOC}/${KEY}`, stillOf());
    const c = u.open(KEY, false);
    await u.live.settled();
    c.handle.set({
      status: "live",
      presentation: fakePresentation("paused") as never,
      browser: browserAt(OTHER) as never,
    });
    expect(c.face.texture()).toBeUndefined();
  });

  it("a FAILED face over a still: where the address that failed is the still's, the still is shown under the words — the texture there, the state failed, `extra.still` said; a failure of another address keeps the film; never a frame from before the failure", async () => {
    const s = stage();
    const { face, handle, frame } = s.open();
    face.demand(HELD);
    frame();
    face.demand(SEEN);
    await s.live.settled();
    expect(s.shelf.shelf.get(`${DOC}/${KEY}`)?.address).toBe(PAGE.url);
    frame();
    // the page stops, where it was
    says(handle, "failed", {
      error: { code: "producer-crashed", message: "Browser page stopped", recovery: "user-action" },
    });
    // at once: the frame from before the failure is hidden (the shelf did not keep THAT one)
    expect(face.texture()).toBeUndefined();
    await s.live.settled();
    expect(face.texture()).toBeDefined();
    expect(liveBrowserFailure((face.state() as { reason: string }).reason)).toBe("stopped");
    expect(face.info().extra?.still).toMatchObject({ takenAt: expect.any(Number) });
    // what the texture holds is the SHELF's picture, laid through the same writer
    expect(s.writers[0]?.presented.at(-1)).toMatchObject({ frame: s.shelf.bitmaps[0] });
    expect(s.live.faces()[0]).toMatchObject({ veiled: false });
    // nothing is sent through a still: there is no page under it
    face.input?.({ kind: "wheel", x: 10, y: 10, dx: 0, dy: 40 });
    expect(handle.inputs).toHaveLength(0);
    expect(s.live.stats().inputsUnsent).toBe(1);
    // ↻ — the page loads again: its first frame replaces the still
    const again = fakePresentation();
    handle.set({ presentation: again as never });
    expect(face.info().extra?.still).toBeDefined();
    again.land();
    expect(face.take()).toBe(true);
    expect(face.info().extra?.still).toBeUndefined();
    expect(face.state()).toEqual({ is: "live" });

    // a load of ANOTHER address that fails: PT-5a's film — the still (of the address before) is not shown
    const t = stage();
    const b = t.open();
    b.face.demand(HELD);
    b.frame();
    b.face.demand(SEEN);
    await t.live.settled();
    b.handle.set({
      browser: browserAt(OTHER, { failure: { reason: "name-not-resolved" } }) as never,
    });
    await t.live.settled();
    expect(b.face.texture()).toBeUndefined();
    expect(b.face.info().extra?.still).toBeUndefined();
    expect(t.shelf.decodeStill).not.toHaveBeenCalled();
    // a page that failed with no still on the shelf: the film, as PT-5a's
    const u = stage();
    const c = u.open();
    c.face.demand(SEEN);
    c.frame();
    says(c.handle, "failed", {
      error: { code: "producer-crashed", message: "", recovery: "user-action" },
    });
    await u.live.settled();
    expect(c.face.texture()).toBeUndefined();
  });

  it("a desk opened OFFLINE: the pane's page fails to load its own address — its still stands under the words", async () => {
    const s = stage();
    s.shelf.shelf.set(`${DOC}/${KEY}`, stillOf());
    const { face, handle } = s.open(KEY, false);
    await s.live.settled();
    handle.set({
      status: "live",
      presentation: fakePresentation("live") as never,
      browser: browserAt(PAGE.url, { failure: { reason: "offline" } }) as never,
    });
    await s.live.settled();
    expect(face.texture()).toBeDefined();
    expect(liveBrowserFailure((face.state() as { reason: string }).reason)).toBe("offline");
    expect(face.info().extra?.still).toBeDefined();
  });

  it("a still read before the DEVICE came waits, and is laid at the next take; a live frame that lands first wins — the still is dropped, its bitmap closed", async () => {
    const device = { value: undefined as GPUDevice | undefined };
    const s = stage({ device: () => device.value });
    s.shelf.shelf.set(`${DOC}/${KEY}`, stillOf());
    const { face, arrived } = s.open(KEY, false);
    await s.live.settled();
    expect(s.writers).toHaveLength(0);
    expect(face.texture()).toBeUndefined();
    expect(arrived).toHaveBeenCalledTimes(1);
    device.value = s.device;
    expect(face.take()).toBe(true);
    expect(face.texture()).toBeDefined();
    expect(face.info().extra?.still).toBeDefined();
    // the other order: the page's frame lands while the still is still being read
    const t = stage();
    t.shelf.shelf.set(`${DOC}/${KEY}`, stillOf());
    let release: (bitmap: ImageBitmap) => void = () => {};
    const slow = { width: 800, height: 500, close: vi.fn() };
    t.shelf.decodeStill.mockImplementationOnce(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          release = resolve;
        }),
    );
    const b = t.open();
    b.face.demand(SEEN);
    await Promise.resolve();
    await Promise.resolve();
    b.frame();
    release(slow as unknown as ImageBitmap);
    await t.live.settled();
    expect(slow.close).toHaveBeenCalledTimes(1);
    expect(b.face.info().extra?.still).toBeUndefined();
    expect(t.writers[0]?.presented).toHaveLength(1);
  });

  it("with no still: the film, as before — nothing laid, nothing said", async () => {
    const s = stage();
    const { face } = s.open();
    face.demand(SEEN);
    await s.live.settled();
    expect(face.texture()).toBeUndefined();
    expect(face.info().extra?.still).toBeUndefined();
    expect(s.live.stats().stillsShown).toBe(0);
    // a still that cannot be read is none
    const t = stage();
    t.shelf.shelf.set(`${DOC}/${KEY}`, stillOf());
    t.shelf.decodeStill.mockResolvedValueOnce(undefined as never);
    const b = t.open(KEY, false);
    await t.live.settled();
    expect(b.face.texture()).toBeUndefined();
  });
});

describe("PT-5b — the still is FORGOTTEN with its pane (ruling 1)", () => {
  it("a DELETED pane's still is forgotten when its page's grace lapses — not before; a pane that only left the mount keeps its own", async () => {
    const s = stage();
    s.shelf.shelf.set(`${DOC}/${KEY}`, stillOf());
    const { face } = s.open();
    // the document no longer holds the object: its face closes
    s.exists.value = false;
    face.close();
    s.clock.advance(59_999);
    await s.live.settled();
    expect(s.shelf.stills.forget).not.toHaveBeenCalled();
    s.clock.advance(1);
    await s.live.settled();
    expect(s.shelf.stills.forget).toHaveBeenCalledWith(DOC, KEY);
    expect(s.shelf.shelf.has(`${DOC}/${KEY}`)).toBe(false);
    expect(s.live.stats().stillsForgotten).toBe(1);
    // a pane still on the board whose face closes (a remount; a kind turned off): nothing is forgotten
    const t = stage();
    t.shelf.shelf.set(`${DOC}/${KEY}`, stillOf());
    t.open().face.close();
    t.clock.advance(120_000);
    await t.live.settled();
    expect(t.shelf.stills.forget).not.toHaveBeenCalled();
    // …nor where the document cannot say (it is closing)
    const u = stage();
    const c = u.open();
    u.exists.value = undefined;
    c.face.close();
    u.clock.advance(120_000);
    expect(u.shelf.stills.forget).not.toHaveBeenCalled();
  });

  it("UNDONE within the grace: the pane's face opens again — its still is kept, and shown; the mount going forgets nothing", async () => {
    const s = stage();
    s.shelf.shelf.set(`${DOC}/${KEY}`, stillOf());
    const a = s.open();
    s.exists.value = false;
    a.face.close();
    s.clock.advance(30_000);
    // ⌘Z
    s.exists.value = true;
    const b = s.open(KEY, false);
    await s.live.settled();
    expect(b.face.texture()).toBeDefined();
    s.clock.advance(120_000);
    await s.live.settled();
    expect(s.shelf.stills.forget).not.toHaveBeenCalled();
    expect(s.shelf.shelf.has(`${DOC}/${KEY}`)).toBe(true);
    // a deleted pane whose grace has not lapsed when the mount goes: its still stays (the shelf's bound holds it)
    const t = stage();
    const c = t.open();
    t.exists.value = false;
    c.face.close();
    t.live.dispose();
    t.clock.advance(120_000);
    expect(t.shelf.stills.forget).not.toHaveBeenCalled();
    // the pane deleted, then the object's key back on ANOTHER document's desk meanwhile: not forgotten under the wrong one
    let doc = DOC;
    const u = stage({ docId: () => doc });
    const d = u.open();
    u.exists.value = false;
    d.face.close();
    doc = "doc-2";
    u.clock.advance(60_000);
    expect(u.shelf.stills.forget).not.toHaveBeenCalled();
  });
});
