import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BACK_MARK, markLength } from "../src/frame/cards/press/back-mark";
import { PAPER_TEX, paperTexture } from "../src/frame/cards/press/paper-texture";
import {
  PRESS,
  type PressDeps,
  pressKey,
  printStock,
  resetPressForTest,
} from "../src/frame/cards/press/press";

// THE PRESS (CS-D5 A, CS-D6 C; DESIGN.md §5 "The stock is printed, once — the press"): every card wears one printed stock,
// so it is printed once per size, density and light, by one WebGL2 context that is then let go. The GPU itself is not
// here; a recording stand-in for WebGL2 holds what the press asks of it.

afterEach(() => resetPressForTest());

/** A WebGL2 stand-in: every call is a no-op that is counted; shaders compile and programs link. */
function fakeGl() {
  const calls: string[] = [];
  const lose = vi.fn();
  const gl = new Proxy(
    {},
    {
      get(_target, name: string) {
        if (name === "getShaderParameter" || name === "getProgramParameter") return () => true;
        if (name === "getExtension")
          return (ext: string) => (ext === "WEBGL_lose_context" ? { loseContext: lose } : null);
        if (/^[A-Z_0-9]+$/.test(name)) return 0;
        return (...args: unknown[]) => {
          calls.push(name);
          return name.startsWith("create") || name.startsWith("get") ? { name, args } : undefined;
        };
      },
    },
  );
  return { gl, calls, lose };
}

function deps(webgl2: boolean) {
  const made: Array<ReturnType<typeof fakeGl>> = [];
  const urls: string[] = [];
  const d: PressDeps = {
    canvas: (width, height) => ({
      width,
      height,
      getContext: (kind: string) => {
        if (kind !== "webgl2" || !webgl2) return null;
        const f = fakeGl();
        made.push(f);
        return f.gl as unknown as WebGL2RenderingContext;
      },
      convertToBlob: async () => new Blob([new Uint8Array(4)], { type: "image/png" }),
    }),
    paintBack: () => ({ color: {}, mask: {}, height: {} }) as never,
    url: () => {
      const u = `blob:press/${urls.length + 1}`;
      urls.push(u);
      return u;
    },
  };
  return { d, made, urls };
}

const FRONT = { side: "front", width: 120, height: 168, density: 2, night: false } as const;

describe("the press's numbers are the round's (DESIGN.md §5)", () => {
  it("prints the front's paper, weave, varnish and light", () => {
    expect(PRESS.paper).toBe("#f4efe5");
    expect(PRESS.ink).toBe("#1c1611");
    expect(PRESS.lamp).toEqual([0.78, -0.475, 0.41]);
    expect(PRESS.room).toEqual([0.18, -0.55, 0.82]);
    expect(PRESS.ambient).toEqual({ day: 0.68, night: 0.55 });
    expect(PRESS.linen).toEqual({ pitch: 1.35, tip: 0.11 });
    expect(PRESS.varnish).toEqual({ shininess: 34, strength: 0.22 });
    expect(PRESS.edge).toEqual({ shade: 0.82, width: 1.15 });
    expect(PRESS.corner).toBe(6);
  });

  it("prints the pressed back", () => {
    expect(PRESS.back).toEqual({
      sage: "#2d4824",
      cream: "#eee4c8",
      inset: 5.5,
      corner: 3.6,
      rule: 2.6,
      mark: 60,
    });
    expect(BACK_MARK.lights).toEqual([
      ["#FF0054", 473.28],
      ["#00F59B", 157],
      ["#083CFF", 795.69],
    ]);
  });
});

describe("the press", () => {
  it("keys a print by its side, size, density and light", () => {
    expect(pressKey(FRONT)).toBe("front:120x168@2:day");
    expect(pressKey({ ...FRONT, side: "back", night: true, density: 1 })).toBe(
      "back:120x168@1:night",
    );
  });

  it("answers null where WebGL2 is refused, so the card keeps its flat stock", async () => {
    const { d } = deps(false);
    expect(await printStock(FRONT, d)).toBeNull();
  });

  it("prints at the card's size times the density", async () => {
    const { d } = deps(true);
    const sizes: Array<[number, number]> = [];
    const canvas = d.canvas;
    const watched: PressDeps = {
      ...d,
      canvas: (w, h) => {
        sizes.push([w, h]);
        return canvas(w, h);
      },
    };
    await printStock({ ...FRONT, density: 2 }, watched);
    expect(sizes).toEqual([[240, 336]]);
  });

  it("prints a key once, draws once, and lets its context go", async () => {
    const { d, made, urls } = deps(true);
    const first = await printStock(FRONT, d);
    const again = await printStock(FRONT, d);
    expect(first).toBe("blob:press/1");
    expect(again).toBe(first);
    expect(made).toHaveLength(1);
    expect(made[0]?.calls.filter((c) => c === "drawArrays")).toHaveLength(1);
    expect(made[0]?.lose).toHaveBeenCalledOnce();
    expect(urls).toHaveLength(1);
  });

  it("prints the back from its own prints, and another light as another print", async () => {
    const { d, made } = deps(true);
    const paint = vi.fn(d.paintBack);
    await printStock({ ...FRONT, side: "back" }, { ...d, paintBack: paint });
    await printStock({ ...FRONT, night: true }, d);
    expect(paint).toHaveBeenCalledOnce();
    expect(made).toHaveLength(2);
  });
});

describe("what the cards wear", () => {
  it("the print once it is ready, and the flat stock until then", () => {
    const css = readFileSync(join(process.cwd(), "src/frame/cards/cards.css"), "utf8");
    expect(css).toContain(':root[data-vf-card-print="ready"]');
    expect(css).toContain("var(--vf-card-print-front)");
    expect(css).toContain("var(--vf-card-print-front-held, var(--vf-card-print-front))");
  });
});

describe("what the press prints from", () => {
  it("the mark at rest is the design kit's own, path for path", () => {
    const svg = readFileSync(
      join(process.cwd(), "../design-kit/src/living-mark/living-mark-light.svg"),
      "utf8",
    );
    expect(svg).toContain(BACK_MARK.edge);
    expect(svg).toContain(BACK_MARK.cover);
    expect(svg).toContain(BACK_MARK.hole);
    expect(markLength()).toBeGreaterThan(10000);
    expect(markLength()).toBe(markLength());
  });

  it("the paper is the desk's: 256² rgba, the same every time", () => {
    const a = paperTexture(7);
    expect(PAPER_TEX).toBe(256);
    expect(a.length).toBe(256 * 256 * 4);
    expect(paperTexture(7)).toEqual(a);
    expect(paperTexture(8)).not.toEqual(a);
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) sum += a[i] ?? 0;
    expect(sum / (256 * 256)).toBeGreaterThan(100);
    expect(sum / (256 * 256)).toBeLessThan(156);
  });
});
