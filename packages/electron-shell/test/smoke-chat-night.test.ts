/**
 * ES-6 — `smoke:chat-night` (desk-gates; VF-PM 2026-11-09 02:26:07Z, V1–V3; James's "ES-6 first", 03:04:05Z). The rows
 * that need a real GPU run only in the smoke, so what can be held here is held here: every judge, red and green; the
 * recorder over a page's attributes; the pixel arithmetic; and the wiring, in the source. The row exists for the GPU,
 * so the wiring's first fact is that the flag keeps it, which `smoke-godview` alone never does (modes.test.ts).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type Box,
  belowTheStar,
  CHAT_NIGHT_RECORDER,
  captureOf,
  judgeClose,
  judgeFold,
  judgeHandOff,
  judgeLean,
  judgeNightStands,
  movedBetween,
  type NightFacts,
  type NightSeen,
  type NightStep,
  outsideHush,
  spreadOf,
  windowVisibleBox,
} from "../src/testing/smoke-chat-night";

const PANEL: Box = { x: 100, y: 50, w: 1164, h: 640 };
const SKY: Box = { x: 422, y: 120, w: 520, h: 300 };

const facts = (over: Partial<NightFacts> = {}): NightFacts => ({
  view: "assistant",
  chat: PANEL,
  drawn: true,
  newSpark: { x: 600, y: 400, w: 160, h: 40 },
  newSparkOff: false,
  hit: true,
  nightClip: "none",
  sheet: false,
  open: null,
  portal: null,
  lean: null,
  lent: null,
  sky: null,
  window: null,
  windowClip: "none",
  wordsOpacity: 1,
  ...over,
});

const steps = (...pairs: readonly (readonly [string | null, number])[]): NightStep[] =>
  pairs.map(([value, at]) => ({ value, at }));
const seen = (over: Partial<NightSeen> = {}): NightSeen => ({
  lean: [],
  portal: [],
  lent: [],
  ...over,
});

describe("the recorder", () => {
  /** A page of one chat panel and one sheet layer, whose attributes a test moves. */
  function page() {
    const attrs = {
      chat: new Map<string, string>(),
      sheet: new Map<string, string>(),
      night: new Map<string, string>(),
    };
    const box = (of: Map<string, string>) => ({
      getAttribute: (name: string) => of.get(name) ?? null,
    });
    const nodes: Record<string, unknown> = {
      ".vf-chat-empty": box(attrs.chat),
      "body > .vf-new-spark": box(attrs.sheet),
      ".vf-chat-empty .vf-spark-night": box(attrs.night),
    };
    let heard: () => void = () => undefined;
    let options: { attributeFilter?: string[]; subtree?: boolean } = {};
    class Observer {
      constructor(callback: () => void) {
        heard = callback;
      }
      observe(_root: unknown, given: { attributeFilter?: string[]; subtree?: boolean }) {
        options = given;
      }
    }
    let now = 0;
    const host: { __vfChatNight?: NightSeen } = {};
    new Function(
      "document",
      "MutationObserver",
      "performance",
      "globalThis",
      `return ${CHAT_NIGHT_RECORDER};`,
    )(
      { querySelector: (s: string) => nodes[s] ?? null, documentElement: {} },
      Observer,
      { now: () => now },
      host,
    );
    return {
      attrs,
      host,
      options: () => options,
      move(at: number) {
        now = at;
        heard();
      },
    };
  }

  it("hears the lean, the portal and the lend in order, each change once", () => {
    const p = page();
    p.attrs.chat.set("data-lean", "true");
    p.move(10);
    p.move(11);
    p.attrs.sheet.set("data-portal", "closing");
    p.move(20);
    p.attrs.night.set("data-lent", "true");
    p.move(30);
    p.attrs.sheet.set("data-portal", "open");
    p.move(40);
    expect(p.host.__vfChatNight?.lean.map((s) => s.value)).toEqual([null, "true"]);
    expect(p.host.__vfChatNight?.portal).toEqual(steps([null, 0], ["closing", 20], ["open", 40]));
    expect(p.host.__vfChatNight?.lent).toEqual(steps([null, 0], ["true", 30]));
  });

  it("watches every attribute it reads, under the whole page", () => {
    const given = page().options();
    expect(given.subtree).toBe(true);
    expect([...(given.attributeFilter ?? [])].sort()).toEqual([
      "data-lean",
      "data-lent",
      "data-open",
      "data-portal",
    ]);
  });
});

describe("the night stands", () => {
  it("passes a drawn night with New spark live", () => {
    expect(judgeNightStands(facts(), 40)).toEqual([]);
  });

  it.each([
    ["Chat is not the view", facts({ view: "godview" }), 40, /view/i],
    ["a spark is here", facts({ chat: null }), 40, /vf-chat-empty/],
    ["the night is its ground", facts({ drawn: false }), 40, /ground/i],
    ["New spark is Off", facts({ newSparkOff: true }), 40, /Off/],
    ["nothing reaches New spark", facts({ hit: false }), 40, /reach/i],
    ["the panel is flat", facts(), 2, /flat/i],
  ])("is red where %s", (_why, f, spread, says) => {
    expect(judgeNightStands(f, spread).join(" ")).toMatch(says);
  });
});

describe("the lean", () => {
  const leaned = "inset(6px round 16px)";
  const held = seen({ lean: steps([null, 0], ["true", 100], [null, 500]) });

  it("passes a lean that lets go after its 90ms", () => {
    expect(judgeLean(held, leaned, 400)).toEqual([]);
  });

  it("is red where it never leaned", () => {
    expect(judgeLean(seen({ lean: steps([null, 0]) }), leaned, 400).join(" ")).toMatch(/never/i);
  });

  it("is red where the night did not draw in by 6px", () => {
    expect(judgeLean(held, "none", 400).join(" ")).toMatch(/6px/);
  });

  it("is red where it let go inside its 90ms", () => {
    expect(judgeLean(held, leaned, 450).join(" ")).toMatch(/90/);
  });

  it("is red where it never let go", () => {
    const stuck = seen({ lean: steps([null, 0], ["true", 100]) });
    expect(judgeLean(stuck, leaned, 400).join(" ")).toMatch(/let go/i);
  });
});

describe("the window's visible box", () => {
  const panel = { x: 100, y: 50, w: 1000, h: 600 };

  it("reads the four-value inset", () => {
    expect(windowVisibleBox(panel, "inset(10px 20px 30px 40px round 30px)")).toEqual({
      x: 140,
      y: 60,
      w: 940,
      h: 560,
    });
  });

  it("reads the one-value inset", () => {
    expect(windowVisibleBox(panel, "inset(5px)")).toEqual({ x: 105, y: 55, w: 990, h: 590 });
  });

  it("answers null for a clip it cannot read", () => {
    expect(windowVisibleBox(panel, "none")).toBeNull();
    expect(windowVisibleBox(null, "inset(5px)")).toBeNull();
  });
});

describe("the close", () => {
  const closed = facts({
    sheet: true,
    open: "true",
    portal: "open",
    lent: "true",
    sky: SKY,
    window: PANEL,
    windowClip: "inset(70px 322px 270px 322px round 30px)",
  });
  const good = seen({
    portal: steps([null, 0], ["drawing", 10], ["closing", 40], ["open", 640]),
    lent: steps([null, 0], ["true", 220]),
  });

  it("passes drawing, closing, open, the night lent, the window on the sky's place", () => {
    expect(judgeClose(good, closed)).toEqual([]);
  });

  it("is red where it opened without closing", () => {
    const skipped = seen({ ...good, portal: steps([null, 0], ["open", 40]) });
    expect(judgeClose(skipped, closed).join(" ")).toMatch(/closing/);
  });

  it("is red where the night was never lent", () => {
    expect(judgeClose(seen({ ...good, lent: steps([null, 0]) }), closed).join(" ")).toMatch(/lent/);
  });

  it("is red where the window stands off the sky's place", () => {
    const off = { ...closed, windowClip: "inset(90px 322px 270px 322px round 30px)" };
    expect(judgeClose(good, off).join(" ")).toMatch(/sky/);
  });

  it("is red where its corners are not the sky's", () => {
    const off = { ...closed, windowClip: "inset(70px 322px 270px 322px round 22px)" };
    expect(judgeClose(good, off).join(" ")).toMatch(/30px/);
  });
});

describe("Cancel's fold", () => {
  const back = facts({ sheet: false, open: null, lent: null, wordsOpacity: 1 });
  const good = seen({
    portal: steps(["open", 640], ["folding", 900], ["folded", 1140], [null, 1600]),
    lent: steps(["true", 220], [null, 1140]),
  });

  it("passes the window folded, the night handed back, the words returned", () => {
    expect(judgeFold(good, back, 40)).toEqual([]);
  });

  it("is red where it never folded", () => {
    const left = seen({ ...good, portal: steps(["open", 640], [null, 900]) });
    expect(judgeFold(left, back, 40).join(" ")).toMatch(/fold/);
  });

  it("is red where the night stays lent", () => {
    expect(judgeFold(seen({ ...good, lent: steps(["true", 220]) }), back, 40).join(" ")).toMatch(
      /handed back/,
    );
  });

  it("is red where the sheet still stands", () => {
    expect(judgeFold(good, { ...back, sheet: true, open: "true" }, 40).join(" ")).toMatch(/sheet/);
  });

  it("is red where the words did not return", () => {
    expect(judgeFold(good, { ...back, wordsOpacity: 0.2 }, 40).join(" ")).toMatch(/words/);
  });

  it("is red where the night came back blank", () => {
    expect(judgeFold(good, back, 1).join(" ")).toMatch(/flat/i);
  });
});

describe("the hand-off", () => {
  it("passes a window within three times the night's own noise", () => {
    expect(
      judgeHandOff({ pixels: 50_000, moved: 100 }, { pixels: 50_000, moved: 250 }, 40),
    ).toEqual([]);
  });

  it("is never stricter than half a percent, where the night barely moved", () => {
    expect(judgeHandOff({ pixels: 50_000, moved: 0 }, { pixels: 50_000, moved: 240 }, 40)).toEqual(
      [],
    );
  });

  it("is red where the stars moved far past the noise", () => {
    expect(
      judgeHandOff({ pixels: 50_000, moved: 100 }, { pixels: 50_000, moved: 4_000 }, 40).join(" "),
    ).toMatch(/star/i);
  });

  it("is red where there was nothing to compare", () => {
    expect(judgeHandOff({ pixels: 10, moved: 0 }, { pixels: 10, moved: 0 }, 40).join(" ")).toMatch(
      /compare/,
    );
    expect(
      judgeHandOff({ pixels: 50_000, moved: 0 }, { pixels: 50_000, moved: 0 }, 1).join(" "),
    ).toMatch(/flat/i);
  });
});

describe("the pixels", () => {
  /** A capture of `w` × `h` CSS px at `scale`, every pixel the grey `at` gives it. */
  function grey(w: number, h: number, scale: number, at: (x: number, y: number) => number) {
    const pw = w * scale;
    const ph = h * scale;
    const bgra = new Uint8Array(pw * ph * 4);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const v = at(x / scale, y / scale);
        const i = (y * pw + x) * 4;
        bgra[i] = v;
        bgra[i + 1] = v;
        bgra[i + 2] = v;
        bgra[i + 3] = 255;
      }
    }
    const capture = captureOf(bgra, w, h);
    if (capture === null) throw new Error("no capture");
    return capture;
  }

  it("takes a capture's density from its size", () => {
    expect(grey(10, 10, 2, () => 0).scale).toBe(2);
    expect(captureOf(new Uint8Array(0), 10, 10)).toBeNull();
  });

  it("counts the pixels that moved, in the mask alone, by CSS place at any density", () => {
    for (const scale of [1, 2]) {
      const a = grey(10, 10, scale, () => 10);
      const b = grey(10, 10, scale, (x) => (x >= 5 ? 200 : 10));
      const all = movedBetween(a, b, () => true);
      expect(all.pixels).toBe(100 * scale * scale);
      expect(all.moved).toBe(50 * scale * scale);
      expect(movedBetween(a, b, (x) => x < 5).moved).toBe(0);
    }
  });

  it("does not count a small change as a move", () => {
    const a = grey(4, 4, 1, () => 10);
    const b = grey(4, 4, 1, () => 30);
    expect(movedBetween(a, b, () => true).moved).toBe(0);
  });

  it("reads a capture's spread: flat is near nothing", () => {
    expect(
      spreadOf(
        grey(20, 20, 1, () => 12),
        () => true,
      ),
    ).toBe(0);
    const stars = grey(20, 20, 1, (x, y) => (x === 3 && y === 3 ? 240 : 12));
    expect(spreadOf(stars, () => true)).toBeGreaterThan(100);
  });

  it("keeps the hush out of the panel's mask: its ellipse, gone by 72% of 620 by 340", () => {
    const mask = outsideHush(PANEL);
    const cx = PANEL.w / 2;
    const cy = PANEL.h / 2 + 16;
    expect(mask(cx, cy)).toBe(false);
    expect(mask(cx + 400, cy)).toBe(false);
    expect(mask(cx + 460, cy)).toBe(true);
    expect(mask(cx, cy - 200)).toBe(false);
    // the night's own edge is left out, where the lean's clip and the panel's corners stand
    expect(mask(2, 2)).toBe(false);
    expect(mask(30, 30)).toBe(true);
  });

  it("keeps the falling star out of the sky's mask: the lower half, around its landing", () => {
    const mask = belowTheStar(SKY, PANEL);
    const left = SKY.x - PANEL.x;
    const top = SKY.y - PANEL.y;
    const cx = left + SKY.w / 2;
    const cy = top + SKY.h / 2;
    expect(mask(left + 10, cy - 20)).toBe(false);
    expect(mask(cx, cy + 40)).toBe(false);
    expect(mask(left + 20, cy + 40)).toBe(true);
    expect(mask(left - 10, cy + 40)).toBe(false);
    expect(mask(left + 20, top + SKY.h + 10)).toBe(false);
  });
});

describe("the wiring, in the source", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const read = (path: string): string => readFileSync(join(root, path), "utf8");

  it("the launcher admits the flag", () => {
    const launcher = read("scripts/smoke-godview.mjs");
    expect(launcher).toContain('"--chat-night"');
  });

  it("main hands the flag to the smoke", () => {
    expect(read("packages/electron-shell/src/main/index.ts")).toContain(
      "chatNight: process.argv.includes(CHAT_NIGHT_FLAG)",
    );
  });

  it("the smoke branches before the GPU-less desk card it would otherwise assert", () => {
    const smoke = read("packages/electron-shell/src/testing/smoke.ts");
    const start = smoke.indexOf("export async function runSmokeGodview");
    const branch = smoke.indexOf("opts.chatNight === true", start);
    const card = smoke.indexOf("expectDeskUnavailableCard(win)", start);
    expect(branch).toBeGreaterThan(start);
    expect(branch).toBeLessThan(card);
  });

  it("names the script at both package roots, the desktop's reusing Godview's build", () => {
    const desktop = JSON.parse(read("apps/desktop/package.json")) as {
      scripts: Record<string, string>;
    };
    const rootPackage = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(desktop.scripts["smoke:chat-night"]).toBe(
      "node ../../scripts/smoke-godview.mjs --chat-night",
    );
    expect(rootPackage.scripts["smoke:chat-night"]).toBe(
      "pnpm --filter @vibefield/desktop smoke:chat-night",
    );
  });

  it("runs at the landing, right after the row whose build it reuses (V2)", () => {
    const gate = read("scripts/gate-landing.mjs");
    const noRecord = gate.indexOf('name: "smoke:godview:no-record"');
    const night = gate.indexOf('name: "smoke:chat-night"');
    expect(noRecord).toBeGreaterThan(0);
    expect(night).toBeGreaterThan(noRecord);
    expect(gate.slice(noRecord, night)).not.toMatch(/name: "smoke:/);
  });

  it("has its row in desk-gates", () => {
    expect(read("docs/desk-gates.md")).toMatch(/\| smoke:chat-night \| `pnpm smoke:chat-night`/);
  });
});
