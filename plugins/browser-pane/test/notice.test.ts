// PT-5a (ruling 3) — A FAILED PAGE'S NOTICE: what the film says for each of the host's words for a failure (the SDK's
// `LIVE_BROWSER_FAILURES` — every one in a person's words, never the host's detail, never an engine's error code), where
// its lines and its "Try again" capsule lie on a phone's page, a laptop's and the smallest a pane is cut to (the hit test
// reads the capsule back from the same layout the raster draws it by), the texels it is drawn at, and its drawing — the
// words' LIGHT over black, the capsule only where there is something to try.
import { LIVE_BROWSER_FAILURES, liveBrowserFailureReason } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import {
  drawNotice,
  failureWords,
  headKey,
  headStateOf,
  MIN_VIEWPORT,
  NOTICE_WORDS,
  type NoticeContext,
  type NoticeSpec,
  noticeBytes,
  noticeKey,
  noticeLayout,
  noticeTexels,
  PAGE_TEXELS_MAX,
  PANE_SIZE,
  pageRefusal,
  REFUSAL_WORDS,
  RETRY_LABEL,
  retryAt,
  shapeOf,
  wrapTwo,
} from "../src";

const LAPTOP: readonly [number, number] = [1280, 800];
const PHONE: readonly [number, number] = [402, 874];

describe("PT-5a — what a failed page's film says", () => {
  it("every failure the host can say has its words — a headline and a line of detail, a person's — and no two failures say the same", () => {
    const seen = new Set<string>();
    for (const word of LIVE_BROWSER_FAILURES) {
      const said = NOTICE_WORDS[word];
      expect(said.headline.length, word).toBeGreaterThan(8);
      expect(said.detail.length, word).toBeGreaterThan(8);
      // never an engine's word
      for (const text of [said.headline, said.detail]) {
        expect(text, word).not.toMatch(/ERR_|net::|chrome-error|producer|renderer|LSF/i);
        expect(text.trim(), word).toBe(text);
      }
      seen.add(said.headline);
    }
    expect(seen.size).toBe(LIVE_BROWSER_FAILURES.length);
    expect(Object.keys(NOTICE_WORDS).sort()).toEqual([...LIVE_BROWSER_FAILURES].sort());
  });

  it("the film says the host's WORD — whatever detail follows it is a diagnostic's, never shown — and an unknown reason is `failed`'s", () => {
    for (const word of LIVE_BROWSER_FAILURES) {
      expect(failureWords(word), word).toBe(NOTICE_WORDS[word]);
      expect(
        failureWords(liveBrowserFailureReason(word, "net::ERR_SOMETHING (-102) at 0x1f")),
        word,
      ).toBe(NOTICE_WORDS[word]);
    }
    for (const reason of ["", "the page failed", "FORBIDDEN_SCOPE: plugin x", "stoppedish"])
      expect(failureWords(reason), reason).toBe(NOTICE_WORDS.failed);
    expect(failureWords("connection-refused").headline).toBe("This site refused to connect");
    expect(failureWords("certificate").detail).toMatch(/was not opened/);
    expect(failureWords("stopped: Browser page stopped").headline).toBe("This page stopped");
  });
});

describe("PT-5a — where the notice lies, and what a press on it is", () => {
  it("its lines and its capsule lie ON the page — a phone's, a laptop's, the smallest pane's — the type a 24th of the page's width, never under 14 px nor over 26", () => {
    for (const viewport of [PHONE, LAPTOP, MIN_VIEWPORT, [2560, 1440]] as const) {
      const [W, H] = viewport;
      const L = noticeLayout(viewport);
      const label = viewport.join("x");
      expect(L.unit, label).toBeGreaterThanOrEqual(14);
      expect(L.unit, label).toBeLessThanOrEqual(26);
      expect(L.small, label).toBeLessThan(L.unit);
      expect(L.cx, label).toBe(W / 2);
      expect(L.width, label).toBeLessThan(W);
      // the headline's cap stands on the page; the capsule's foot too; each line under the one before
      expect(L.headline - L.unit, label).toBeGreaterThan(0);
      expect(L.detail, label).toBeGreaterThan(L.headline);
      const [cx, cy, hx, hy] = L.retry;
      expect(cy - hy, label).toBeGreaterThan(L.detail + L.line);
      expect(cy + hy, label).toBeLessThan(H);
      expect(cx - hx, label).toBeGreaterThan(0);
      expect(cx + hx, label).toBeLessThan(W);
    }
    expect(noticeLayout(PHONE).unit).toBeCloseTo(402 / 24, 9);
    expect(noticeLayout(LAPTOP).unit).toBe(26);
    expect(noticeLayout(MIN_VIEWPORT).unit).toBe(14);
  });

  it("the capsule is read back from the same layout: a press on it is `retry`'s, a press beside it the film's", () => {
    for (const viewport of [PHONE, LAPTOP, MIN_VIEWPORT] as const) {
      const [cx, cy, hx, hy] = noticeLayout(viewport).retry;
      expect(retryAt(viewport, cx, cy)).toBe(true);
      expect(retryAt(viewport, cx - hx + 1, cy)).toBe(true);
      expect(retryAt(viewport, cx + hx - 1, cy + hy - 1)).toBe(true);
      expect(retryAt(viewport, cx - hx * 1.5, cy)).toBe(false);
      expect(retryAt(viewport, cx, cy - hy * 2.2)).toBe(false);
      expect(retryAt(viewport, cx, cy + hy * 2.2)).toBe(false);
      expect(retryAt(viewport, 2, 2)).toBe(false);
    }
  });

  it("is drawn at two texels a CSS px — words read in hand — under the still's cap", () => {
    expect(noticeTexels(PHONE)).toEqual([804, 1748]);
    expect(noticeTexels(LAPTOP)).toEqual([2048, 1280]);
    expect(Math.max(...noticeTexels([2560, 1440]))).toBe(PAGE_TEXELS_MAX);
    expect(noticeTexels([0, 0])).toEqual([1, 1]);
  });

  it("a notice's key moves with everything it is drawn from — its words, whether there is something to try, its size, its ink", () => {
    const spec: NoticeSpec = {
      viewport: LAPTOP,
      texels: noticeTexels(LAPTOP),
      words: NOTICE_WORDS.stopped,
      retry: RETRY_LABEL,
      ink: "rgb(230 232 234)",
    };
    const keys = [
      spec,
      { ...spec, words: NOTICE_WORDS.offline },
      { ...spec, retry: null },
      { ...spec, viewport: PHONE, texels: noticeTexels(PHONE) },
      { ...spec, ink: "rgb(255 255 255)" },
    ].map(noticeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(noticeKey({ ...spec })).toBe(keys[0]);
  });
});

describe("PT-5a — the notice, drawn", () => {
  /** A 2D context that RECORDS what it is asked — each call with the state it was made under — its text 0.5 em a letter. */
  const recorder = () => {
    const calls: {
      name: string;
      args: unknown[];
      alpha: number;
      font: string;
      fill: string;
    }[] = [];
    const state: Record<string, unknown> = { globalAlpha: 1, font: "", fillStyle: "" };
    const size = (): number => Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10);
    const ctx = new Proxy(state, {
      get(target, name: string) {
        if (name in target) return target[name];
        if (name === "measureText") return (t: string) => ({ width: t.length * size() * 0.5 });
        if (name === "getImageData")
          return (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4).fill(7),
          });
        return (...args: unknown[]) => {
          calls.push({
            name,
            args,
            alpha: Number(target.globalAlpha),
            font: String(target.font),
            fill: String(target.fillStyle),
          });
        };
      },
      set(target, name: string, value) {
        target[name] = value;
        return true;
      },
    }) as unknown as NoticeContext;
    return { ctx, calls };
  };
  const spec = (over: Partial<NoticeSpec> = {}): NoticeSpec => ({
    viewport: PHONE,
    texels: noticeTexels(PHONE),
    words: NOTICE_WORDS["connection-refused"],
    retry: RETRY_LABEL,
    ink: "rgb(230 232 234)",
    ...over,
  });

  it("the words' LIGHT over black: the canvas at the notice's texels, black first, then the headline, the detail dimmer, the capsule and its word — each where the layout says, in the page's CSS px", () => {
    const r = recorder();
    const canvas = { width: 0, height: 0 };
    const n = spec();
    expect(drawNotice(canvas, r.ctx, n)).toEqual({ width: 804, height: 1748 });
    expect(canvas).toEqual({ width: 804, height: 1748 });
    const L = noticeLayout(PHONE);
    // black over the whole raster, before anything is said
    const black = r.calls.find((c) => c.name === "fillRect");
    expect(black?.args).toEqual([0, 0, 804, 1748]);
    expect(black?.fill).toBe("black");
    expect(r.calls.findIndex((c) => c.name === "fillRect")).toBeLessThan(
      r.calls.findIndex((c) => c.name === "fillText"),
    );
    // the page's CSS px: two texels each
    const scale = r.calls.filter((c) => c.name === "setTransform").at(-1);
    expect(scale?.args).toEqual([2, 0, 0, 2, 0, 0]);
    const texts = r.calls.filter((c) => c.name === "fillText");
    expect(texts.map((c) => c.args[0])).toEqual([
      "This site refused to connect",
      "It may be down, or the address may be wrong.",
      RETRY_LABEL,
    ]);
    const [headline, detail, label] = texts;
    expect(headline?.args.slice(1, 3)).toEqual([L.cx, L.headline]);
    expect(headline?.font).toContain(`600 ${L.unit}px`);
    expect(headline?.fill).toBe(n.ink);
    expect(headline?.alpha).toBe(1);
    expect(detail?.args.slice(1, 3)).toEqual([L.cx, L.detail]);
    expect(detail?.font).toContain(`400 ${L.small}px`);
    expect(detail?.alpha).toBeLessThan(1);
    // the capsule: an outline round the word, where the hit test reads it
    const [cx, cy, hx, hy] = L.retry;
    const capsule = r.calls.find((c) => c.name === "roundRect");
    expect(capsule?.args).toEqual([cx - hx, cy - hy, 2 * hx, 2 * hy, hy]);
    expect(r.calls.some((c) => c.name === "stroke")).toBe(true);
    expect(label?.args[1]).toBe(cx);
    expect(Math.abs((label?.args[2] as number) - cy)).toBeLessThan(L.small * 0.2);
    expect(retryAt(PHONE, label?.args[1] as number, label?.args[2] as number)).toBe(true);
  });

  it("with nothing to try there is NO capsule and no word for one; a detail too long for the page breaks in two lines, a line under a line", () => {
    const r = recorder();
    drawNotice(
      { width: 0, height: 0 },
      r.ctx,
      spec({
        retry: null,
        words: NOTICE_WORDS.certificate,
        viewport: MIN_VIEWPORT,
        texels: noticeTexels(MIN_VIEWPORT),
      }),
    );
    expect(r.calls.filter((c) => c.name === "roundRect" || c.name === "stroke")).toEqual([]);
    const texts = r.calls.filter((c) => c.name === "fillText");
    expect(texts.map((c) => c.args[0])).not.toContain(RETRY_LABEL);
    const L = noticeLayout(MIN_VIEWPORT);
    expect(texts).toHaveLength(3);
    expect(texts[1]?.args[2]).toBe(L.detail);
    expect(texts[2]?.args[2]).toBe(L.detail + L.line);
    expect(`${texts[1]?.args[0]} ${texts[2]?.args[0]}`.replace("…", "")).toContain("certificate");
  });

  it("two lines at most, broken at a space, the second cut short with an ellipsis; a line that fits is one", () => {
    const six = (s: string): number => s.length * 6;
    expect(wrapTwo(six, "short enough", 100)).toEqual(["short enough"]);
    expect(wrapTwo(six, "one two three four five", 60)).toEqual(["one two", "three fou…"]);
    expect(wrapTwo(six, "alpha beta", 40)).toEqual(["alpha", "beta"]);
    // a word wider than the line stands alone on the first rather than nothing
    expect(wrapTwo(six, "incomprehensibilities end", 60)[0]).toBe("incomprehensibilities");
    const [first, second] = wrapTwo(six, "aa bb cc dd ee ff gg hh ii jj kk", 48);
    expect(first).toBe("aa bb cc");
    expect(six(second ?? "")).toBeLessThanOrEqual(48 + 6);
  });

  it("is read back OPAQUE: sRGB rgba8 rows as the pass lays them, whatever alpha the canvas answers", () => {
    const r = recorder();
    const bytes = noticeBytes(r.ctx, 3, 2);
    expect(bytes).toHaveLength(24);
    expect([...bytes.slice(0, 8)]).toEqual([7, 7, 7, 255, 7, 7, 7, 255]);
  });
});

describe("PT-5a — the head says a refusal for a moment", () => {
  const S = shapeOf(PANE_SIZE);
  it("what the page asked for and may not have is read off the face's words — a known word with a whole, positive serial, or nothing", () => {
    expect(pageRefusal({ extra: { refused: { what: "download", serial: 3 } } })).toEqual({
      what: "download",
      serial: 3,
    });
    for (const refused of [
      undefined,
      null,
      "download",
      { what: "download" },
      { what: "download", serial: 0 },
      { what: "download", serial: 1.5 },
      { what: "toString", serial: 1 },
      { what: "alert", serial: 1 },
    ])
      expect(pageRefusal({ extra: { refused } }), JSON.stringify(refused)).toBeUndefined();
    expect(pageRefusal(undefined)).toBeUndefined();
    expect(pageRefusal({})).toBeUndefined();
    expect(REFUSAL_WORDS.download).toBe("Download blocked");
  });

  it("a head that SAYS something is another raster than the one that says its address — and one that says nothing keeps its key as it was cut", () => {
    const info = { address: "https://example.org/" };
    const plain = headStateOf("https://example.org/", S, info);
    const saying = headStateOf("https://example.org/", S, info, null, REFUSAL_WORDS.download);
    expect(plain).not.toHaveProperty("saying");
    expect(saying.saying).toBe("Download blocked");
    expect(headKey(S, saying, 2)).not.toBe(headKey(S, plain, 2));
    expect(headKey(S, saying, 2)).toContain("say:Download blocked");
    expect(headKey(S, plain, 2)).not.toContain("say:");
  });
});
