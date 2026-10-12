/**
 * PT-5d (rulings 1, 3, 4) — the hand reaches every frame: which of a page's targets takes each event, and the point
 * carried into it (main/live-surfaces/browser-frames.ts). A frame of another site is reached on its OWN session (the
 * offscreen view forwards everything to the root widget — PT-5d's probe); where it is drawn is its cached quad; the focus
 * is what each document says of its own window and follows the hand's press; a gesture ends where it began.
 */
import { describe, expect, it } from "vitest";
import { BrowserFrames, type FrameQuad } from "../src/main/live-surfaces/browser-frames";

/** An axis-aligned quad: its left, top, width, height. */
const box = (x: number, y: number, w: number, h: number): FrameQuad => [
  x,
  y,
  x + w,
  y,
  x + w,
  y + h,
  x,
  y + h,
];

/** The page at its first document; frame A (400 × 300 at 100, 80 of the page) and, inside A, frame B (120 × 90 at 250, 190 of A). */
const page = () => {
  const f = new BrowserFrames();
  f.pageCommitted(1);
  f.attached("A", "t-A", undefined);
  f.placed("A", box(100, 80, 400, 300));
  f.attached("B", "t-B", "A");
  f.placed("B", box(250, 190, 120, 90));
  return f;
};

describe("PT-5d (ruling 1) — the frame drawn at a point takes the event, on its own session, at the point in its viewport", () => {
  it("a press over no frame is the page's, its point as sent; over frame A, A's at the point carried into A (the probe's: page 180, 120 → A 80, 40); over B inside A, B's — the quads composed", () => {
    const f = page();
    expect(f.press("left", 20, 20)).toEqual({
      target: { session: undefined, document: 1 },
      x: 20,
      y: 20,
    });
    f.release("left", 20, 20);
    expect(f.press("left", 180, 120)).toEqual({
      target: { session: "A", document: 0 },
      x: 80,
      y: 40,
    });
    f.release("left", 180, 120);
    // B at A's 250, 190 is the page's 350, 270: the page's 360, 285 is B's 10, 15
    expect(f.press("left", 360, 285)).toEqual({
      target: { session: "B", document: 0 },
      x: 10,
      y: 15,
    });
  });

  it("a frame not laid out yet (no quad read) takes nothing — the page's, as before PT-5d; where two overlap the one attached later (drawn later) takes it", () => {
    const f = new BrowserFrames();
    f.pageCommitted(1);
    f.attached("A", "t-A", undefined);
    expect(f.wheel(150, 100).target.session).toBeUndefined();
    f.placed("A", box(100, 80, 400, 300));
    f.attached("C", "t-C", undefined);
    f.placed("C", box(300, 200, 100, 100));
    expect(f.wheel(150, 100).target.session).toBe("A");
    expect(f.wheel(350, 250)).toEqual({ target: { session: "C", document: 0 }, x: 50, y: 50 });
    // laid out no more (`display: none`): nothing lands in it
    f.placed("C", undefined);
    expect(f.wheel(350, 250).target.session).toBe("A");
  });

  it("a frame under a TRANSFORM: its quad is a parallelogram and its document says its own viewport — scaled by 2, a point lands at half its offset; turned a quarter, along its own axes", () => {
    const f = new BrowserFrames();
    f.pageCommitted(1);
    f.attached("S", "t-S", undefined);
    // 200 × 100 of its own drawn at 400 × 200 from the page's 100, 100
    f.sized("S", 200, 100, f.placed("S", box(100, 100, 400, 200)));
    expect(f.press("left", 300, 200)).toEqual({
      target: { session: "S", document: 0 },
      x: 100,
      y: 50,
    });
    f.release("left", 300, 200);
    f.attached("R", "t-R", undefined);
    // 100 × 50 of its own turned a quarter clockwise about its top-left at the page's 600, 100: its top edge points down
    f.sized("R", 100, 50, f.placed("R", [600, 100, 600, 200, 550, 200, 550, 100]));
    const at = f.press("left", 590, 130);
    expect(at.target.session).toBe("R");
    expect(at.x).toBeCloseTo(30, 9);
    expect(at.y).toBeCloseTo(10, 9);
  });

  it("M6.1 — a frame's own viewport is the one READ with its quad: a read for a quad no longer current is dropped; until its size is read, a frame is taken at its quad's own size", () => {
    const f = new BrowserFrames();
    f.pageCommitted(1);
    f.attached("S", "t-S", undefined);
    const first = f.placed("S", box(100, 100, 400, 200));
    // its parent said `moved` before the first read answered: placed again — the first read lands late, for a quad gone
    const second = f.placed("S", box(100, 100, 400, 200));
    f.sized("S", 800, 400, first);
    expect(f.press("left", 300, 200)).toEqual({
      target: { session: "S", document: 0 },
      x: 200,
      y: 100,
    });
    f.release("left", 300, 200);
    f.sized("S", 200, 100, second);
    expect(f.press("left", 300, 200)).toMatchObject({ x: 100, y: 50 });
    f.release("left", 300, 200);
    // only moved (its parent scrolled by 50): its size kept
    f.placed("S", box(100, 50, 400, 200));
    expect(f.press("left", 300, 150)).toMatchObject({ x: 100, y: 50 });
    f.release("left", 300, 150);
    // drawn at another size (its owner resized): its quad's own size again until its own is read with it
    f.placed("S", box(100, 100, 600, 300));
    expect(f.press("left", 400, 250)).toMatchObject({ x: 300, y: 150 });
  });

  it("only the page's tree: a frame said to be in a frame the page does not hold is no target; a frame's going takes the frames in it", () => {
    const f = page();
    f.attached("X", "t-X", "not-ours");
    expect(f.frames().map((x) => x.session)).toEqual(["A", "B"]);
    f.detached("A");
    expect(f.frames()).toEqual([]);
    expect(f.press("left", 360, 285).target.session).toBeUndefined();
  });
});

describe("PT-5d (ruling 1) — a hover that crosses from one target into another tells the one it left", () => {
  it("a move inside A goes to A alone; out onto the page, to A first (the point carried into A — outside it), then the page's; back into A, the page's then A's", () => {
    const f = page();
    expect(f.move(180, 120)).toEqual([{ target: { session: "A", document: 0 }, x: 80, y: 40 }]);
    expect(f.move(190, 120)).toEqual([{ target: { session: "A", document: 0 }, x: 90, y: 40 }]);
    expect(f.move(50, 50)).toEqual([
      { target: { session: "A", document: 0 }, x: -50, y: -30 },
      { target: { session: undefined, document: 1 }, x: 50, y: 50 },
    ]);
    expect(f.move(180, 120)).toEqual([
      { target: { session: undefined, document: 1 }, x: 180, y: 120 },
      { target: { session: "A", document: 0 }, x: 80, y: 40 },
    ]);
  });
});

describe("PT-5d (ruling 3) — a gesture ends where it began", () => {
  it("a press in A, its moves out past A's edge and its release outside it all go to A, at points carried into A (a drag leaves the frame's box and is still A's)", () => {
    const f = page();
    f.press("left", 180, 120);
    expect(f.move(60, 120)).toEqual([{ target: { session: "A", document: 0 }, x: -40, y: 40 }]);
    expect(f.release("left", 40, 120)).toEqual({
      target: { session: "A", document: 0 },
      x: -60,
      y: 40,
    });
    // the next move hovers: nothing pressed — the page's (A told it left)
    expect(f.move(40, 120).map((r) => r.target.session)).toEqual(["A", undefined]);
  });

  it("A's press, then A COMMITS another document: its moves and its release go nowhere (the engine forgot it with its document); A's next press is its new document's", () => {
    const f = page();
    f.press("left", 180, 120);
    f.committed("A");
    expect(f.move(190, 120)).toEqual([]);
    expect(f.release("left", 190, 120)).toBeNull();
    expect(f.press("left", 180, 120).target).toEqual({ session: "A", document: 1 });
  });

  it("A's press, then A's session GOES (the frame removed, its process gone): its release goes nowhere — never a command to a gone session", () => {
    const f = page();
    f.press("left", 180, 120);
    f.keyDown("KeyQ");
    f.detached("A");
    expect(f.release("left", 180, 120)).toBeNull();
    expect(f.keyUp("KeyQ")).toBeNull();
    // and a press on the page while A was down, released: the page's
    f.press("right", 20, 20);
    expect(f.release("right", 20, 20)?.target).toEqual({ session: undefined, document: 1 });
  });

  it("a finger down in B, its moves and its end go to B; once B is gone, its end goes nowhere", () => {
    const f = page();
    expect(f.touchStart(360, 285).target.session).toBe("B");
    expect(f.touchMove(365, 290)).toEqual({ target: { session: "B", document: 0 }, x: 15, y: 20 });
    expect(f.touchEnd()).toEqual({ session: "B", document: 0 });
    expect(f.touchMove(365, 290)).toBeNull();
    f.touchStart(360, 285);
    f.detached("B");
    expect(f.touchEnd()).toBeNull();
  });

  it("the PAGE commits another document: every frame goes with the one before, nothing pressed in them is released anywhere, and the focus is the page's", () => {
    const f = page();
    f.press("left", 180, 120);
    f.keyDown("KeyQ");
    f.pageCommitted(2);
    expect(f.frames()).toEqual([]);
    expect(f.release("left", 180, 120)).toBeNull();
    expect(f.keyUp("KeyQ")).toBeNull();
    expect(f.focused()).toEqual({ session: undefined, document: 2 });
  });
});

describe("PT-5d (rulings 1, M3) — keys, text, a composition and a command go to the FOCUSED document's session: nothing key-like on the page's while a frame of another site is focused", () => {
  it("the focus follows the hand's press: a press in A, and a key's down, its up, text go to A; a press on the page, and they are the page's", () => {
    const f = page();
    expect(f.focused().session).toBeUndefined();
    f.press("left", 180, 120);
    f.release("left", 180, 120);
    expect(f.keyDown("KeyH")).toEqual({ session: "A", document: 0 });
    expect(f.keyUp("KeyH")).toEqual({ session: "A", document: 0 });
    expect(f.focused()).toEqual({ session: "A", document: 0 });
    f.press("left", 20, 20);
    expect(f.keyDown("KeyH").session).toBeUndefined();
  });

  it("the focus as each document SAYS it of its own window: B's `focus` (a script focused its field), the page's own; a `blur` moves nothing (M6.2); a word of a session the page does not hold is nothing", () => {
    const f = page();
    f.focus("B", true);
    expect(f.focused().session).toBe("B");
    f.focus("A", false);
    expect(f.focused().session).toBe("B");
    f.focus("B", false);
    expect(f.focused().session).toBe("B");
    f.focus("A", true);
    f.focus("elsewhere", true);
    expect(f.focused().session).toBe("A");
    f.focus(undefined, true);
    expect(f.focused().session).toBeUndefined();
  });

  it("M6.2 — a `blur` moves NOTHING: A's own window's blur as the focus goes to A's own child of its site (its `focus` follows on A's session) — A throughout, never the page between the two words; the whole page losing its focus — A still; the page's own `focus` takes the keys back", () => {
    const f = page();
    f.press("left", 180, 120);
    f.release("left", 180, 120);
    f.focus("A", false);
    expect(f.keyDown("KeyH")).toEqual({ session: "A", document: 0 });
    f.keyUp("KeyH");
    f.focus("A", true);
    expect(f.focused().session).toBe("A");
    // the whole page loses its focus: A's window blurs, no other takes it — the engine still sends keys to A
    f.focus("A", false);
    expect(f.focused().session).toBe("A");
    f.focus(undefined, true);
    expect(f.focused().session).toBeUndefined();
  });

  it("M6.2 — a frame's COMMIT takes the frames of its document before: B focused in A, A commits — B is no target, the keys are the page's, and a press where B was is A's new document's", () => {
    const f = page();
    f.focus("B", true);
    f.committed("A");
    expect(f.frames().map((x) => x.session)).toEqual(["A"]);
    expect(f.focused()).toEqual({ session: undefined, document: 1 });
    expect(f.press("left", 360, 285).target).toEqual({ session: "A", document: 1 });
  });

  it("a key's UP goes where its down went though the focus moved since (R8: a key's up is a release); gone or of another document since — nowhere", () => {
    const f = page();
    f.focus("A", true);
    f.keyDown("KeyQ");
    f.focus("B", true);
    expect(f.keyUp("KeyQ")).toEqual({ session: "A", document: 0 });
    f.keyDown("KeyW");
    f.committed("B");
    expect(f.keyUp("KeyW")).toBeNull();
    f.focus("A", true);
    f.keyDown("KeyE");
    f.detached("A");
    expect(f.keyUp("KeyE")).toBeNull();
    // A's focus went with it: the page's
    expect(f.focused().session).toBeUndefined();
  });
});

describe("PT-5d (M6.3a) — a frame takes a point only on its VISIBLE part: what an ancestor's overflow clips is drawn by the one it is in", () => {
  it("a press on the part a scroller clips goes to the page; on the part in view, to the frame; a drag out of view stays with its press; a hover and the wheel over the clipped part are the page's; a frame wholly clipped takes nothing", () => {
    const f = new BrowserFrames();
    f.pageCommitted(1);
    f.attached("A", "t-A", undefined);
    // 400 × 300 at 100, 80 — its top half under its scroller's clip edge: in view from halfway down
    f.placed("A", box(100, 80, 400, 300), [0, 0.5, 1, 1]);
    expect(f.press("left", 180, 120).target.session).toBeUndefined();
    f.release("left", 180, 120);
    expect(f.press("left", 180, 305)).toEqual({
      target: { session: "A", document: 0 },
      x: 80,
      y: 225,
    });
    expect(f.move(180, 120)).toEqual([{ target: { session: "A", document: 0 }, x: 80, y: 40 }]);
    expect(f.release("left", 180, 120)?.target.session).toBe("A");
    expect(f.wheel(180, 120).target.session).toBeUndefined();
    expect(f.move(180, 121).map((r) => r.target.session)).toEqual(["A", undefined]);
    // scrolled out of its scroller: nothing lands in it
    f.placed("A", box(100, 80, 400, 300), [0, 0, 0, 0]);
    expect(f.wheel(180, 305).target.session).toBeUndefined();
  });

  it("a frame in a frame, clipped in ITS parent's view: a point over its clipped part is its parent's, carried into it", () => {
    const f = page();
    // B's right half clipped in A's view
    f.placed("B", box(250, 190, 120, 90), [0, 0, 0.5, 1]);
    expect(f.press("left", 360, 285).target.session).toBe("B");
    f.release("left", 360, 285);
    expect(f.press("left", 460, 285)).toEqual({
      target: { session: "A", document: 0 },
      x: 360,
      y: 205,
    });
  });
});
