/**
 * DK-16 — smoke:canvas's PEERS and FAULT rows and the GPU-less runs' CARD rows, their judges (testing/smoke-peers.ts,
 * testing/smoke-unavailable.ts), and the COVER rows' RIM (testing/smoke-covers.ts): a peer's arrow where B's pointer is
 * through both cameras, the idle hide at 8 s and not before, the chip's contrast measured from its pixels, the lost
 * device's card and the cards no reload can help in the canon's words on the plain ground, a cover over a desk that never
 * drew, and the receded still's rim the cover's tint over the mat's ground.
 */
import { describe, expect, it } from "vitest";
import { CANVAS_BG, COVERS, judgeRim, over, parseColor } from "../src/testing/smoke-covers";
import {
  type CardSeen,
  contrast,
  DEGRADED_SENTENCE,
  expectedBox,
  judgeDegradedBanner,
  judgeIdle,
  judgeLostCard,
  judgePeerPlace,
  LOST_CARD,
  measureChip,
  type PeerSeen,
} from "../src/testing/smoke-peers";
import {
  judgeNeverDrewCover,
  judgeNoDrawCard,
  MAT_GROUND_DAY,
  NO_DRAW_CARDS,
  WITHOUT_WEBGPU,
  withoutWebgpu,
} from "../src/testing/smoke-unavailable";

const peer = (over: Partial<PeerSeen> = {}): PeerSeen => ({
  entity: 7,
  cursor: { x: 1, y: 1 },
  where: null,
  idleMs: 100,
  hidden: null,
  box: { x: 0, y: 0 },
  ...over,
});

describe("the peers' place — B's pointer through B's camera into the world, and through A's back to A's screen", () => {
  it("puts the arrow's box 2 up and left of where the pointer projects", () => {
    // B at (0,0) × 1: (520, 340) is the world (520, 340); A at (100, 40) × 0.5: (210, 150), the box (208, 148)
    expect(
      expectedBox({ x: 520, y: 340 }, { x: 0, y: 0, zoom: 1 }, { x: 100, y: 40, zoom: 0.5 }),
    ).toEqual({
      x: 208,
      y: 148,
    });
  });

  it("holds one peer drawn, its record and its element within a pixel of the place", () => {
    const want = { x: 208, y: 148 };
    expect(judgePeerPlace([peer({ box: want })], want, { left: 208.4, top: 147.6 })).toEqual([]);
    expect(
      judgePeerPlace([peer({ box: { x: 210, y: 148 } })], want, { left: 208, top: 148 })[0],
    ).toMatch(/tip off the pointer/);
    expect(judgePeerPlace([peer({ box: want })], want, { left: 220, top: 148 })[0]).toMatch(
      /element stands/,
    );
    expect(judgePeerPlace([peer({ hidden: "idle" })], want, null)[0]).toMatch(/0 peers drawn/);
    expect(
      judgePeerPlace([peer({ box: want }), peer({ box: want, entity: 8 })], want, null)[0],
    ).toMatch(/2 peers drawn/);
  });
});

describe("the idle hide — at 8 s after the last move, never before", () => {
  it("passes a hide between 8 s and the slack, the peer drawn at 7.5 s", () => {
    expect(judgeIdle(null, 8_120)).toEqual([]);
    expect(judgeIdle("idle", 8_120)[0]).toMatch(/before its 8 s/);
    expect(judgeIdle(null, 7_900)[0]).toMatch(/not at 8 s/);
    expect(judgeIdle(null, 8_600)).toEqual([]);
    expect(judgeIdle(null, 9_000)[0]).toMatch(/not at 8 s/); // an idle of 9 s is not 8
    expect(judgeIdle(null, 9_600)[0]).toMatch(/not at 8 s/);
    expect(judgeIdle(null, null)[0]).toMatch(/never hidden/);
  });
});

describe("the chip's contrast — measured from its pixels", () => {
  it("reads the glass as the ground and the glyphs' cores as the ink, and their WCAG contrast", () => {
    // 100 pixels of glass (232, 235, 230) and 4 of ink (58, 59, 60), BGRA
    const px: number[] = [];
    for (let i = 0; i < 100; i += 1) px.push(230, 235, 232, 255);
    for (let i = 0; i < 4; i += 1) px.push(60, 59, 58, 255);
    const m = measureChip(new Uint8Array(px));
    expect(m.ground).toEqual([232, 235, 230]);
    expect(m.ink).toEqual([58, 59, 60]);
    expect(m.ratio).toBeCloseTo(contrast([232, 235, 230], [58, 59, 60]), 1);
    expect(m.ratio).toBeGreaterThan(7);
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
  });
});

describe("the cards — in the canon's words, on the plain ground", () => {
  const BG = "rgb(250, 250, 250)";
  const lost: CardSeen = {
    kind: "lost",
    title: LOST_CARD.title,
    body: LOST_CARD.body,
    buttons: ["Reload"],
    detail: "the device was lost: destroyed: Device was destroyed.",
    ground: BG,
  };
  it("holds the lost device's: its words, ONE Reload, ICE's message, the plain ground", () => {
    expect(judgeLostCard(lost, BG)).toEqual([]);
    expect(judgeLostCard({ ...lost, buttons: [] }, BG)[0]).toMatch(/not ONE Reload/);
    expect(judgeLostCard({ ...lost, body: "Reload." }, BG)[0]).toMatch(/what-to-do/);
    expect(judgeLostCard({ ...lost, ground: "rgb(61, 90, 48)" }, BG)[0]).toMatch(/plain ground/);
    expect(judgeLostCard(null, BG)[0]).toMatch(/no card/);
  });

  it("holds a card no reload can help: no act at all", () => {
    for (const kind of ["no-adapter", "no-webgpu"] as const) {
      const card: CardSeen = {
        kind,
        title: NO_DRAW_CARDS[kind].title,
        body: NO_DRAW_CARDS[kind].body,
        buttons: [],
        detail: `no desk — the adapter, the device or the pipelines were refused: ${NO_DRAW_CARDS[kind].detailEnds}`,
        ground: BG,
      };
      expect(judgeNoDrawCard(card, kind, BG)).toEqual([]);
      expect(judgeNoDrawCard({ ...card, buttons: ["Reload"] }, kind, BG)[0]).toMatch(/won't help/);
      expect(judgeNoDrawCard({ ...card, detail: "something else" }, kind, BG)[0]).toMatch(
        /ICE's message/,
      );
    }
    // the two shapes say different things
    expect(NO_DRAW_CARDS["no-adapter"].body).not.toBe(NO_DRAW_CARDS["no-webgpu"].body);
  });

  it("takes navigator.gpu from the page before its scripts — on a live page, over the window's own DevTools protocol", async () => {
    const asked: string[] = [];
    await withoutWebgpu({
      loadURL: async (url) => {
        asked.push(`load ${url}`);
      },
      webContents: {
        debugger: {
          attach: (version) => asked.push(`attach ${version}`),
          sendCommand: async (method, params) => {
            asked.push(params === undefined ? method : `${method} ${JSON.stringify(params)}`);
          },
        },
      },
    });
    expect(asked).toEqual([
      "load about:blank",
      "attach 1.3",
      "Page.enable",
      `Page.addScriptToEvaluateOnNewDocument ${JSON.stringify({ source: WITHOUT_WEBGPU.script })}`,
    ]);
    // the script itself takes it: a navigator whose prototype carries `gpu` has none after it
    class Nav {}
    Object.defineProperty(Nav.prototype, "gpu", { configurable: true, get: () => ({}) });
    const nav = new Nav() as { gpu?: unknown };
    new Function("Navigator", WITHOUT_WEBGPU.script)(Nav);
    expect(nav.gpu).toBeUndefined();
  });

  it("holds a cover over a desk that never drew: the mat's ground, nothing said, the card standing again", () => {
    const up = {
      face: "ground",
      said: null,
      still: { face: "ground", background: MAT_GROUND_DAY },
      line: null,
      cardUnder: true,
    };
    expect(judgeNeverDrewCover(up, "no-webgpu", "no-webgpu", MAT_GROUND_DAY)).toEqual([]);
    expect(
      judgeNeverDrewCover(
        { ...up, said: "The desk lost its graphics device" },
        "no-webgpu",
        "no-webgpu",
        MAT_GROUND_DAY,
      )[0],
    ).toMatch(/says nothing there/);
    expect(judgeNeverDrewCover(up, null, "no-webgpu", MAT_GROUND_DAY)[0]).toMatch(/standing again/);
    expect(
      judgeNeverDrewCover(
        { ...up, still: { face: "none", background: "rgba(0, 0, 0, 0)" } },
        "no-webgpu",
        "no-webgpu",
        MAT_GROUND_DAY,
      )[0],
    ).toMatch(/mat's ground/);
  });
});

describe("the degraded banner — VibeField's sentence first, ICE's message as its detail (DK-17, plan (75))", () => {
  const message = "an uncaptured GPU error — GPUValidationError: Buffer usages must not be 0.";
  const seen = { text: DEGRADED_SENTENCE, detail: message, act: "Reload" };

  it("passes the sentence, ICE's message verbatim under it, and one Reload", () => {
    expect(DEGRADED_SENTENCE).toBe(
      "The graphics device reported an error. The desk is still drawing — Reload restarts it.",
    );
    expect(judgeDegradedBanner(seen, message)).toEqual([]);
  });

  it("refuses ICE's message as the words, a missing or altered detail, and a missing act", () => {
    // DK-16's banner said ICE's message alone — the words the canon now puts second
    expect(
      judgeDegradedBanner({ text: message, detail: null, act: "Reload" }, message),
    ).toHaveLength(2);
    expect(judgeDegradedBanner({ ...seen, detail: null }, message)[0]).toMatch(/not ICE's message/);
    expect(judgeDegradedBanner({ ...seen, detail: `${message} ` }, message)[0]).toMatch(
      /not ICE's message/,
    );
    expect(judgeDegradedBanner({ ...seen, act: null }, message)[0]).toMatch(/not Reload/);
  });
});

describe("the rim — the cover's tint over the mat's ground (plan addendum (69))", () => {
  it("reads computed colours in both of Chromium's forms", () => {
    expect(parseColor("rgb(61, 90, 48)")).toEqual({ rgb: [61, 90, 48], alpha: 1 });
    expect(parseColor("rgba(28, 28, 28, 0.72)")).toEqual({ rgb: [28, 28, 28], alpha: 0.72 });
    const srgb = parseColor("color(srgb 0.968627 0.968627 0.968627 / 0.72)");
    expect(srgb?.alpha).toBe(0.72);
    expect(srgb?.rgb[0]).toBeCloseTo(247, 0);
    expect(parseColor("transparent")).toBeNull();
  });

  it("passes the tint over the mat's ground and refuses the tint over the canvas's own colour, by day and by night", () => {
    const day = "color(srgb 0.968627 0.968627 0.968627 / 0.72)";
    const ring = `rgb(61, 90, 48) 0px 0px 0px 22px`;
    const mat = over([247, 247, 247], 0.72, [61, 90, 48]);
    expect(judgeRim({ ring, pixel: mat, tint: day }, "light")).toEqual([]);
    const was = over([247, 247, 247], 0.72, CANVAS_BG.light);
    expect(judgeRim({ ring, pixel: was, tint: day }, "light")[0]).toMatch(
      /not the tint over the mat's ground/,
    );
    expect(judgeRim({ ring: "none", pixel: mat, tint: day }, "light")[0]).toMatch(/still's ring/);
    // under Godview the pixels are printed, not judged (its CRT vignette darkens the edge): the ring alone is held
    const vignetted = [170, 177, 167] as [number, number, number];
    expect(judgeRim({ ring, pixel: vignetted, tint: day }, "light")[0]).toMatch(/not the tint/);
    expect(judgeRim({ ring, pixel: vignetted, tint: day }, "light", false)).toEqual([]);
    expect(judgeRim({ ring: "none", pixel: vignetted, tint: day }, "light", false)[0]).toMatch(
      /still's ring/,
    );
    const night = "color(srgb 0.109804 0.109804 0.109804 / 0.72)";
    const nightRing = `${COVERS.ground.dark} 0px 0px 0px 22px`;
    const nightMat = over([28, 28, 28], 0.72, [49, 60, 64]);
    expect(judgeRim({ ring: nightRing, pixel: nightMat, tint: night }, "dark")).toEqual([]);
    expect(
      judgeRim(
        { ring: nightRing, pixel: over([28, 28, 28], 0.72, CANVAS_BG.dark), tint: night },
        "dark",
      )[0],
    ).toMatch(/over the canvas's colour/);
  });
});
