// THE COMMITTED WORDS (src/face-words.ts, face-words.gen.ts — the orchestrator's R2 Q1, 2026-10-29; the pane's committed heads
// its model): the rasters of a face's words a phone draws where no host lends its words' raster — a still on Node. Every face
// with words the playground stages has ITS raster committed, under the very key the phone asks — so the committed words say
// DESIGN.md §9's words exactly (face.ts quotes them; design.test.ts reads that table), and a change of a word, a device, the
// ink or the layout turns this red until `scripts/make-face-words.ts` is run again — and nothing else is committed. Each
// unpacks to the words' light over black at its block's texels; a phone with no raster lent draws the committed one that says
// exactly its words, and none for words nothing committed says (never another's); a lent raster always draws its own.
import { type Entity, kindPalette, type LiveSimulatorState } from "@vibefield/plugin-sdk/desk";
import { productPalette } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { FIXTURE_MAC, stagedWords } from "../playground/fixture-mac";
import {
  createSimulatorLocal,
  deviceName,
  facePlan,
  faceWords,
  NOTICE_LINES,
  NOTICE_SCALE,
  type NoticeSpec,
  noticeKey,
  packWords,
  phoneById,
  phoneLook,
  shapeOf,
  simulatorKind,
  stillWords,
  unpackWords,
} from "../src";
import { STILL_WORDS } from "../src/face-words.gen";
import { boundTo, ctxOf, fakeHost, fakeWords } from "./fakes";

/** What each staged face asks its words' raster for, by day and by night — as the record asks it (kind.ts, face.ts `faceWords`). */
function stagedSpecs(): Map<
  string,
  { readonly spec: NoticeSpec; readonly is: LiveSimulatorState }
> {
  const specs = new Map<string, { readonly spec: NoticeSpec; readonly is: LiveSimulatorState }>();
  for (const palette of [productPalette.light, productPalette.dark]) {
    const look = phoneLook(kindPalette(palette));
    for (const staged of FIXTURE_MAC) {
      const model = phoneById(staged.deviceType);
      if (model === undefined) throw new Error(`no ${staged.deviceType} in the catalog`);
      const plan = facePlan(
        { extra: { simulator: stagedWords(staged.is) } },
        { is: "live" },
        deviceName({ deviceType: staged.deviceType, runtime: staged.runtime }, model),
        true,
      );
      const said = faceWords(plan, look);
      if (said === undefined) continue;
      const spec: NoticeSpec = { points: shapeOf(model).points, scale: NOTICE_SCALE, ...said };
      specs.set(noticeKey(spec), { spec, is: staged.is });
    }
  }
  return specs;
}

describe("the committed words — what a Node still's faces say", () => {
  it("commits every staged face's words under the very key the phone asks, and nothing else — re-run the maker when this is red", () => {
    const specs = stagedSpecs();
    // the six faces that say something (no Simulator, no permission, no device, off, no window, stopped) in the one ink
    expect([...specs.values()].map((s) => s.is).sort()).toEqual(
      ["no-device", "no-permission", "no-simulator", "no-window", "off", "stopped"].sort(),
    );
    expect(STILL_WORDS.map((s) => s.key).sort()).toEqual([...specs.keys()].sort());
    for (const key of specs.keys()) expect(stillWords(key), key).toBeDefined();
  });

  it("each unpacks to the words' light over black at its block's texels — opaque, lit, its margin dark, on its screen, in 1–3 lines", () => {
    const specs = stagedSpecs();
    for (const still of STILL_WORDS) {
      const spec = specs.get(still.key)?.spec;
      if (spec === undefined) throw new Error(`nothing asks ${still.key}`);
      const bm = unpackWords(still);
      expect(bm.bytes.length, still.key).toBe(still.width * still.height * 4);
      expect([bm.width, bm.height]).toEqual([
        Math.max(1, Math.round(2 * still.block[2] * NOTICE_SCALE)),
        Math.max(1, Math.round(2 * still.block[3] * NOTICE_SCALE)),
      ]);
      let lit = 0;
      let opaque = true;
      for (let o = 0; o < bm.bytes.length; o += 4) {
        if (bm.bytes[o + 3] !== 255) opaque = false;
        if ((bm.bytes[o + 1] ?? 0) > 128) lit += 1;
      }
      expect(opaque, still.key).toBe(true);
      expect(lit, still.key).toBeGreaterThan(100);
      // the block's corner is its margin: black
      expect([...bm.bytes.subarray(0, 3)]).toEqual([0, 0, 0]);
      // the block lies on its screen
      const [cx, cy, hx, hy] = still.block;
      expect(cx - hx).toBeGreaterThanOrEqual(0);
      expect(cx + hx).toBeLessThanOrEqual(spec.points[0] + 1e-9);
      expect(cy - hy).toBeGreaterThanOrEqual(0);
      expect(cy + hy).toBeLessThanOrEqual(spec.points[1] + 1e-9);
      expect(still.lines).toBeGreaterThanOrEqual(1);
      expect(still.lines).toBeLessThanOrEqual(NOTICE_LINES);
      // unpacked once: the same bitmap again
      expect(stillWords(still.key)).toBe(stillWords(still.key));
    }
  });

  it("packs a raster's colour in runs of at most 255 and unpacks it byte for byte, opaque", () => {
    // two rows, lit three texels in every 400 — so a dark run of 397 is split across two runs
    const width = 600;
    const height = 2;
    const bytes = new Uint8Array(width * height * 4);
    for (let px = 0; px < width * height; px++)
      bytes.set(px % 400 < 3 ? [230, 232, 234, 255] : [0, 0, 0, 255], px * 4);
    const packed = packWords(bytes);
    const counts = packed.filter((_, i) => i % 4 === 0);
    expect(Math.max(...counts)).toBe(255);
    expect(counts.reduce((a, n) => a + n, 0)).toBe(width * height);
    const runs = Buffer.from(packed).toString("base64");
    const back = unpackWords({ key: "k", width, height, block: [1, 1, 1, 1], lines: 1, runs });
    expect([...back.bytes]).toEqual([...bytes]);
  });

  it("draws words nothing committed says as none — never another's", () => {
    const [first] = STILL_WORDS;
    if (first === undefined) throw new Error("nothing committed");
    expect(stillWords(first.key.replace("|@3|", "|@2|"))).toBeUndefined();
    expect(stillWords(`${first.key} `)).toBeUndefined();
  });

  it("a phone with no raster lent (a Node still) lays the committed raster that says its words; a lent raster draws its own", () => {
    const kind = simulatorKind();
    const staged = FIXTURE_MAC.find((d) => d.is === "off");
    if (staged === undefined) throw new Error("the fixture's Mac stages no `off` face");
    const record = (words?: ReturnType<typeof fakeWords>) => {
      const t = fakeHost(words === undefined ? {} : { words: words.raster });
      const local = createSimulatorLocal(t.host);
      const ctx = ctxOf(boundTo(staged.deviceType), { local });
      kind.record(kind.resolve(ctx), ctx);
      const face = t.faces.get("13918995204487956201-1");
      if (face === undefined) throw new Error("no face");
      face.land();
      face.is(stagedWords("off"));
      local.tick(16);
      return { r: kind.record(kind.resolve(ctx), ctx), local };
    };
    // none lent: the committed raster, under the key the maker drew it for
    const bare = record();
    const committed = STILL_WORDS.find((s) => s.key === bare.r.notice?.key);
    expect(committed?.key).toContain("|iPhone 16 Pro is off|Boot|");
    expect(bare.r.notice?.bytes).toBe(stillWords(committed?.key ?? "")?.bytes);
    expect([bare.r.notice?.width, bare.r.notice?.height]).toEqual([
      committed?.width,
      committed?.height,
    ]);
    expect(bare.local.lines(1 as Entity)).toBe(committed?.lines);
    // lent: the host's raster draws them, whatever is committed
    const words = fakeWords();
    const lent = record(words);
    expect(words.asked.at(-1)?.words).toEqual({ line: "iPhone 16 Pro is off", act: "Boot" });
    expect(lent.r.notice?.key).toBe(bare.r.notice?.key);
    expect(lent.r.notice?.width).toBe(8);
  });
});
