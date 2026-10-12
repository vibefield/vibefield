/**
 * PT-5d (rulings 1, 3, 4) — the hand reaches every frame: which of a page's targets takes each event, and the point
 * carried into it (main/live-surfaces/browser-frames.ts). A frame of another site is reached on its OWN session (the
 * offscreen view forwards everything to the root widget — PT-5d's probe); where it is drawn is its cached quad; the focus
 * is what each document says of its own window and follows the hand's press; a gesture ends where it began.
 */
import { describe, expect, it } from "vitest";
import {
  BrowserFrames,
  type FocusWhere,
  type FrameQuad,
} from "../src/main/live-surfaces/browser-frames";

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
    f.where("A", "here");
    f.keyDown("KeyQ");
    f.detached("A");
    expect(f.release("left", 180, 120)).toBeNull();
    // (where the focus went is unknown: the native waits for a word; once the page says it holds it, the up is nowhere)
    f.where(undefined, "here");
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

  it("the PAGE commits another document: every frame goes with the one before, what was held in them is forgotten with it (M7 H5 — the producer forgets it, no release follows; one that still came is the new document's, as any release no press was seen for), and the focus is the page's", () => {
    const f = page();
    f.press("left", 180, 120);
    f.where("A", "here");
    f.keyDown("KeyQ");
    f.pageCommitted(2);
    expect(f.frames()).toEqual([]);
    expect(f.release("left", 180, 120)).toEqual({
      target: { session: undefined, document: 2 },
      x: 180,
      y: 120,
    });
    expect(f.keyUp("KeyQ")).toEqual({ session: undefined, document: 2 });
    expect(f.focused()).toEqual({ session: undefined, document: 2 });
  });
});

describe("PT-5d (rulings 1, M3; M7 H2) — keys, text, a composition and a command go to the FOCUSED document's session — which is its own word alone; nothing key-like on the page's while a frame of another site may hold the focus", () => {
  /** A hint sent to a document and answered, then the words said after it. */
  const hinted = (f: BrowserFrames, ...words: [string | undefined, FocusWhere][]): void => {
    f.handSent();
    f.handAnswered();
    for (const [session, where] of words) f.where(session, where);
  };

  it("a press is a HINT: the focus in doubt until its document says where it went — A's `here`: keys, text go to A; a press on the page and the page's `here`: the page's", () => {
    const f = page();
    expect(f.focused().session).toBeUndefined();
    f.press("left", 180, 120);
    hinted(f);
    expect(f.inDoubt()).toBe(true);
    f.where("A", "here");
    expect(f.inDoubt()).toBe(false);
    f.release("left", 180, 120);
    expect(f.keyDown("KeyH")).toEqual({ session: "A", document: 0 });
    expect(f.keyUp("KeyH")).toEqual({ session: "A", document: 0 });
    expect(f.focused()).toEqual({ session: "A", document: 0 });
    f.press("left", 20, 20);
    hinted(f, [undefined, "here"]);
    expect(f.keyDown("KeyH").session).toBeUndefined();
  });

  it("the focus as each document SAYS it: B's `here` (a script focused its field), the page's own; a word of a session the page does not hold is nothing; a word heard BEFORE a hint's answer is kept, and settles it at the answer", () => {
    const f = page();
    f.where("B", "here");
    expect(f.focused().session).toBe("B");
    f.where("elsewhere", "here");
    expect(f.focused().session).toBe("B");
    f.where(undefined, "here");
    expect(f.focused().session).toBeUndefined();
    // a press's own word can come before its answer (another channel): kept, then the answer settles it
    f.handSent();
    f.where("A", "here");
    expect(f.inDoubt()).toBe(true);
    f.handAnswered();
    expect(f.focused().session).toBe("A");
    // no word heard by the answer: still in doubt — the next word settles it
    f.handSent();
    f.handAnswered();
    expect(f.inDoubt()).toBe(true);
    f.where("A", "here");
    expect(f.focused().session).toBe("A");
  });

  it("M6.2 under H2 — the focus going from A's own document to its own child of its site: both say `here` on A's session — A throughout, never in doubt; the whole page losing it: A says `away` — in doubt, nothing key-like sent until a word", () => {
    const f = page();
    f.where("A", "here");
    f.where("A", "here");
    expect(f.inDoubt()).toBe(false);
    expect(f.focused().session).toBe("A");
    f.where("A", "away");
    expect(f.inDoubt()).toBe(true);
    f.where(undefined, "away");
    expect(f.inDoubt()).toBe(true);
    f.where("A", "here");
    expect(f.focused().session).toBe("A");
  });

  it("M6.2 under H2 — a frame's COMMIT takes the frames of its document before: B focused in A, A commits — B is no target, and where the focus is is unknown (in doubt); a press where B was is A's new document's", () => {
    const f = page();
    f.where("B", "here");
    f.committed("A");
    expect(f.frames().map((x) => x.session)).toEqual(["A"]);
    expect(f.inDoubt()).toBe(true);
    expect(f.press("left", 360, 285).target).toEqual({ session: "A", document: 1 });
  });

  it("a key's UP goes to the CURRENT focus when that is a frame of another site (as a browser delivers it), else where its down went if it stands — gone or of another document since: nowhere", () => {
    const f = page();
    f.where("A", "here");
    f.keyDown("KeyQ");
    f.where("B", "here");
    expect(f.keyUp("KeyQ")).toEqual({ session: "B", document: 0 });
    // a down in A, the focus to the PAGE since: the up where the down went
    f.where("A", "here");
    f.keyDown("KeyW");
    f.where(undefined, "here");
    expect(f.keyUp("KeyW")).toEqual({ session: "A", document: 0 });
    // … unless A committed another document since, or went: nowhere
    f.where("A", "here");
    f.keyDown("KeyE");
    f.where(undefined, "here");
    f.committed("A");
    expect(f.keyUp("KeyE")).toBeNull();
    f.where("A", "here");
    f.keyDown("KeyR");
    f.where(undefined, "here");
    f.detached("A");
    expect(f.keyUp("KeyR")).toBeNull();
  });

  it("M7 H2 (a) — the Tab whose DOWN moved the focus into A: its UP goes to A, never the page's session", () => {
    const f = page();
    expect(f.keyDown("Tab").session).toBeUndefined();
    f.handSent();
    f.where("A", "here");
    f.handAnswered();
    f.where(undefined, "inner");
    expect(f.inDoubt()).toBe(false);
    expect(f.keyUp("Tab")).toEqual({ session: "A", document: 0 });
  });

  it("M7 H2 (b) — a press on the page that does NOT take A's focus (its mousedown prevented, the page's scrollbar): the page says `inner` — A kept it; keys go to A", () => {
    const f = page();
    f.press("left", 180, 120);
    hinted(f, ["A", "here"]);
    f.release("left", 180, 120);
    f.press("left", 20, 20);
    hinted(f);
    expect(f.inDoubt()).toBe(true);
    f.where(undefined, "inner");
    expect(f.keyDown("KeyH").session).toBe("A");
  });

  it("M7 H2 (c, d) — the page says `inner` with the focus its own before (its element focused A, a script's `iframe.focus()`): in doubt until A's own word — never the page's", () => {
    const f = page();
    f.press("left", 180, 120);
    hinted(f, [undefined, "inner"]);
    expect(f.inDoubt()).toBe(true);
    f.where("A", "here");
    expect(f.focused().session).toBe("A");
    // a script moved it into B: the page's `inner` first (A no frame of it… it is: A stays), then B's own word
    f.where(undefined, "inner");
    expect(f.focused().session).toBe("A");
    f.where("A", "inner");
    expect(f.focused().session).toBe("A");
    f.where("B", "here");
    expect(f.focused().session).toBe("B");
  });

  it("M7 H2 (e, f, g) — A's `away` (the focus to another frame, or the whole page lost it), A's session gone or swapped, the page's own `away`: each in doubt — until a word says where", () => {
    const f = page();
    f.where("A", "here");
    f.where("A", "away");
    expect(f.inDoubt()).toBe(true);
    f.where("B", "here");
    expect(f.focused().session).toBe("B");
    f.detached("B");
    expect(f.inDoubt()).toBe(true);
    f.where(undefined, "here");
    expect(f.focused().session).toBeUndefined();
    f.where(undefined, "away");
    expect(f.inDoubt()).toBe(true);
    // the PAGE's commit: its new document holds the focus
    f.pageCommitted(2);
    expect(f.inDoubt()).toBe(false);
    expect(f.focused()).toEqual({ session: undefined, document: 2 });
  });
});

describe("PT-5d (M6.3a) — a frame takes a point only on its VISIBLE part: what an ancestor's overflow clips is drawn by the one it is in", () => {
  it("a press on the part a scroller clips goes to the page; on the part in view, to the frame; a drag out of view stays with its press; a hover and the wheel over the clipped part are the page's; a frame wholly clipped takes nothing", () => {
    const f = new BrowserFrames();
    f.pageCommitted(1);
    f.attached("A", "t-A", undefined);
    // 400 × 300 at 100, 80 — its top half under its scroller's clip edge: in view from halfway down
    f.placed("A", box(100, 80, 400, 300), { visible: [0, 0.5, 1, 1], covers: [] });
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
    f.placed("A", box(100, 80, 400, 300), { visible: [0, 0, 0, 0], covers: [] });
    expect(f.wheel(180, 305).target.session).toBeUndefined();
  });

  it("a frame in a frame, clipped in ITS parent's view: a point over its clipped part is its parent's, carried into it", () => {
    const f = page();
    // B's right half clipped in A's view
    f.placed("B", box(250, 190, 120, 90), { visible: [0, 0, 0.5, 1], covers: [] });
    expect(f.press("left", 360, 285).target.session).toBe("B");
    f.release("left", 360, 285);
    expect(f.press("left", 460, 285)).toEqual({
      target: { session: "A", document: 0 },
      x: 360,
      y: 205,
    });
  });
});

describe("PT-5d (M7 H3) — what the host draws OVER a frame is the host's: a frame takes a point only on its visible part, outside every cover", () => {
  it("a fixed header over A's top 40 px: a press there is the PAGE's, one below it A's; a hover and the wheel the same; a drag out under the header stays A's", () => {
    const f = new BrowserFrames();
    f.pageCommitted(1);
    f.attached("A", "t-A", undefined);
    // A 400 × 300 at 100, 80; covered from its top to 40 px down (a cover, as fractions of its content box)
    f.placed("A", box(100, 80, 400, 300), { visible: [0, 0, 1, 1], covers: [[0, 0, 1, 40 / 300]] });
    expect(f.press("left", 180, 100).target.session).toBeUndefined();
    f.release("left", 180, 100);
    expect(f.press("left", 180, 200)).toEqual({
      target: { session: "A", document: 0 },
      x: 80,
      y: 120,
    });
    expect(f.move(180, 100)).toEqual([{ target: { session: "A", document: 0 }, x: 80, y: 20 }]);
    f.release("left", 180, 100);
    expect(f.wheel(180, 100).target.session).toBeUndefined();
    expect(f.wheel(180, 200).target.session).toBe("A");
  });

  it("two frames overlapping: where B covers A (A's sight says so), B; where nothing covers A, A — whatever order they attached in", () => {
    const f = new BrowserFrames();
    f.pageCommitted(1);
    f.attached("B", "t-B", undefined);
    f.attached("A", "t-A", undefined);
    f.placed("B", box(300, 200, 100, 100), { visible: [0, 0, 1, 1], covers: [] });
    // A attached LATER — before H3 it took the overlap; its sight says B is drawn over its 200..300, 120..220
    f.placed("A", box(100, 80, 400, 300), {
      visible: [0, 0, 1, 1],
      covers: [[0.5, 0.4, 0.75, 0.7333]],
    });
    expect(f.wheel(350, 250).target.session).toBe("B");
    expect(f.wheel(150, 100).target.session).toBe("A");
  });
});

describe("PT-5d (M7 H4, H5) — what the hand holds across a commit", () => {
  it("H4 — a finger's end goes to its SESSION while it stands, whatever its document (the engine holds a touch open across a commit): across A's commit, A's; across the page's commit, the page's; its session gone, nowhere", () => {
    const f = page();
    f.touchStart(180, 120);
    f.committed("A");
    expect(f.touchEnd()?.session).toBe("A");
    f.touchStart(20, 20);
    f.pageCommitted(2);
    expect(f.touchEnd()).toEqual({ session: undefined, document: 2 });
    const g = page();
    g.touchStart(360, 285);
    g.detached("B");
    expect(g.touchEnd()).toBeNull();
  });

  it("H5 — a button and a key held across the PAGE's commit are forgotten with it (the producer forgets them; no release follows): the next document's hover reaches the page", () => {
    const f = page();
    f.press("left", 20, 20);
    f.keyDown("KeyQ");
    f.pageCommitted(2);
    expect(f.move(30, 30)).toEqual([{ target: { session: undefined, document: 2 }, x: 30, y: 30 }]);
    expect(f.keyUp("KeyQ")).toEqual({ session: undefined, document: 2 });
  });
});
