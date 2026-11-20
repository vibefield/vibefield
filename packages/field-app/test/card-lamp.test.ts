import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAPER_TEX, paperTexture } from "@vibecook/ice/desk/kit";
import { describe, expect, it, vi } from "vitest";
import { WINDOW } from "../src/frame/cards/card-fit";
import { type LampCanvas, type LampDeps, lampSize, lightLamp } from "../src/frame/cards/lamp/lamp";
import { LAMP_FS } from "../src/frame/cards/lamp/lamp-shader";
import { frameOf, TURN } from "../src/frame/cards/lamp/turn";
import { LIGHT_GLSL } from "../src/frame/cards/press/light-glsl";
import { PRESS } from "../src/frame/cards/press/press-numbers";
import { PRESS_FS } from "../src/frame/cards/press/press-shader";

// THE LAMP (DESIGN.md §5 "The lamp, live"; item 596): the light on a card picked up, live as it turns. One small WebGL2
// surface over the side that is up, lit in the press's own light, drawn when the turn moves and let go with the card.
// The GPU itself is not here; a recording stand-in for WebGL2 holds what the lamp asks of it, and a reader over
// tokens.css stands in for the root.

const TOKENS = readFileSync(join(process.cwd(), "../design-kit/src/tokens.css"), "utf8");

/** One theme's block of tokens.css, as written. */
function block(theme: ":root" | ".dark"): string {
  const start = TOKENS.indexOf(`\n${theme} {`);
  return start < 0 ? "" : TOKENS.slice(start, TOKENS.indexOf("\n}", start));
}

/** A token as the root holds it by day: its value in tokens.css's `:root`, a `var()` followed to its own. */
function tokenOf(name: string): string {
  const value = new RegExp(`\\s${name}:\\s*([^;]+);`).exec(block(":root"))?.[1]?.trim() ?? "";
  const alias = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  return alias === undefined ? value : tokenOf(alias);
}

/** A WebGL2 stand-in: every call is a no-op that is counted; shaders compile and programs link. */
function fakeGl() {
  const calls: string[] = [];
  const log: Array<readonly [string, unknown[]]> = [];
  const uploads: unknown[][] = [];
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
          log.push([name, args]);
          if (name === "texImage2D") uploads.push(args);
          return name.startsWith("create") || name.startsWith("get") ? { name, args } : undefined;
        };
      },
    },
  );
  return { gl, calls, lose, uploads, log };
}

/** A uniform's value as the lamp set it: the last `uniform*` call at `name`'s location. */
function uniform(made: ReturnType<typeof fakeGl> | undefined, name: string): unknown[] | undefined {
  const sets = made?.log.filter(
    ([call, args]) =>
      call.startsWith("uniform") && (args[0] as { args?: unknown[] } | null)?.args?.[1] === name,
  );
  return sets?.at(-1)?.[1].slice(1);
}

function bench(webgl2 = true, token: (name: string) => string = tokenOf) {
  const made: Array<ReturnType<typeof fakeGl>> = [];
  const asked: Array<WebGLContextAttributes | undefined> = [];
  const canvas: LampCanvas = {
    width: 0,
    height: 0,
    getContext: (kind, options) => {
      asked.push(options);
      if (kind !== "webgl2" || !webgl2) return null;
      const f = fakeGl();
      made.push(f);
      return f.gl as unknown as WebGL2RenderingContext;
    },
  };
  const paint = vi.fn((_scale: number) => ({ color: {}, mask: {}, height: {} }) as never);
  const deps: LampDeps = { paintBack: paint, token };
  return { canvas, deps, made, asked, paint };
}

const FRONT = { side: "front", density: 4.8, night: false, photo: false } as const;

describe("the lamp lights one small surface over the side that is up (DESIGN.md §5 'The lamp, live')", () => {
  it("at the held print's own size: a card at the window's density times its 2.4", () => {
    expect(lampSize(4.8)).toEqual({ width: 576, height: 806 });
    const { canvas, deps } = bench();
    expect(lightLamp(canvas, FRONT, deps)).not.toBeNull();
    expect([canvas.width, canvas.height]).toEqual([576, 806]);
  });

  it("premultiplied, with no depth and no smoothing of its own: what it draws is added to the print under it", () => {
    const { canvas, deps, asked } = bench();
    lightLamp(canvas, FRONT, deps);
    expect(asked[0]).toMatchObject({ alpha: true, premultipliedAlpha: true, antialias: false });
  });

  it("in the press's own light: the lamp, the room, the weave and the varnish, on the desk's own paper", () => {
    const { canvas, deps, made } = bench();
    lightLamp(canvas, FRONT, deps);
    const gl = made[0];
    expect(uniform(gl, "uLight")?.[0]).toEqual([...PRESS.lamp]);
    expect(uniform(gl, "uRoom")?.[0]).toEqual([...PRESS.room]);
    expect(uniform(gl, "uAmb")).toEqual([PRESS.ambient.day]);
    expect(uniform(gl, "uPitch")).toEqual([PRESS.linen.pitch]);
    expect(uniform(gl, "uTip")).toEqual([PRESS.linen.tip]);
    expect(uniform(gl, "uShin")).toEqual([PRESS.varnish.shininess]);
    expect(uniform(gl, "uKs")).toEqual([PRESS.varnish.strength]);
    expect(uniform(gl, "uPaperC")?.[0]).toEqual([244 / 255, 239 / 255, 229 / 255]);
    const paper = gl?.uploads.filter((args) => args.length === 9 && args[3] === PAPER_TEX);
    expect(paper).toHaveLength(1);
    expect(paper?.[0]?.[8]).toEqual(paperTexture());
  });

  it("by night in the night's light", () => {
    const { canvas, deps, made } = bench();
    lightLamp(canvas, { ...FRONT, night: true }, deps);
    expect(uniform(made[0], "uAmb")).toEqual([PRESS.ambient.night]);
    expect(uniform(made[0], "uNight")).toEqual([1]);
  });

  it("seen from the turn's own eye, knowing where the face's window is and what it holds", () => {
    const { canvas, deps, made } = bench();
    lightLamp(canvas, { ...FRONT, photo: true }, deps);
    expect(uniform(made[0], "uEye")).toEqual([TURN.eye]);
    expect(uniform(made[0], "uWindow")).toEqual([10, 29, 100, 110]);
    expect(uniform(made[0], "uWindowR")).toEqual([WINDOW.corner]);
    expect(uniform(made[0], "uPhoto")).toEqual([1]);
    const plain = bench();
    lightLamp(plain.canvas, FRONT, plain.deps);
    expect(uniform(plain.made[0], "uPhoto")).toEqual([0]);
  });

  it("draws the whole picture once for each turn it is handed, and nothing between", () => {
    const { canvas, deps, made } = bench();
    const lamp = lightLamp(canvas, FRONT, deps);
    const draws = (): number => made[0]?.calls.filter((c) => c === "drawArrays").length ?? 0;
    // lit, it has drawn nothing: head on, the print is that light already
    expect(draws()).toBe(0);
    const turned = frameOf({ x: 0.3, y: 0.42 });
    lamp?.draw(turned);
    expect(draws()).toBe(1);
    const sent = uniform(made[0], "uFrame") ?? [];
    expect(sent[0]).toBe(false);
    expect([...(sent[1] as Float32Array)]).toEqual([...new Float32Array(turned)]);
    lamp?.draw(frameOf({ x: 0, y: 0 }));
    expect(draws()).toBe(2);
  });

  it("clears to nothing when asked: head on and flat, the print under it is that light already", () => {
    const { canvas, deps, made } = bench();
    const lamp = lightLamp(canvas, FRONT, deps);
    lamp?.draw(frameOf({ x: 0.3, y: 0.42 }));
    lamp?.clear();
    expect(made[0]?.calls.filter((c) => c === "clear")).toHaveLength(1);
    expect(made[0]?.calls.filter((c) => c === "drawArrays")).toHaveLength(1);
    expect(made[0]?.log.find(([call]) => call === "clearColor")?.[1]).toEqual([0, 0, 0, 0]);
  });

  it("lets its context go with the card", () => {
    const { canvas, deps, made } = bench();
    const lamp = lightLamp(canvas, FRONT, deps);
    expect(made[0]?.lose).not.toHaveBeenCalled();
    lamp?.release();
    expect(made[0]?.lose).toHaveBeenCalledOnce();
  });

  it("lights the back from the back's own prints, painted once at the lamp's size", () => {
    const { canvas, deps, made, paint } = bench();
    lightLamp(canvas, { side: "back", density: 4.8, night: false, photo: false }, deps);
    expect(paint).toHaveBeenCalledOnce();
    expect(paint.mock.calls[0]?.[0]).toBe(4.8);
    expect(uniform(made[0], "uSide")).toEqual([1]);
    const front = bench();
    lightLamp(front.canvas, FRONT, front.deps);
    expect(front.paint).not.toHaveBeenCalled();
    expect(uniform(front.made[0], "uSide")).toEqual([0]);
  });
});

describe("where there is no lamp, the card keeps its print", () => {
  it("answers null where WebGL2 is refused", () => {
    const { canvas, deps } = bench(false);
    expect(lightLamp(canvas, FRONT, deps)).toBeNull();
  });

  it("answers null, and makes no context, where a token cannot be read", () => {
    const { canvas, deps, made } = bench(true, () => "");
    expect(lightLamp(canvas, FRONT, deps)).toBeNull();
    expect(made).toHaveLength(0);
  });
});

describe("the lamp's light is the press's (DESIGN.md §5: one piece of shader code prints the stock and lights the turn)", () => {
  it("both shaders draw with the same light", () => {
    expect(PRESS_FS).toContain(LIGHT_GLSL);
    expect(LAMP_FS).toContain(LIGHT_GLSL);
    for (const fn of ["linen(", "paperTooth(", "lampDiffuse(", "lampSpecular("]) {
      expect(LIGHT_GLSL).toContain(fn);
      expect(PRESS_FS.split("void main()")[1]).toContain(fn);
      expect(LAMP_FS.split("void main()")[1]).toContain(fn);
    }
  });

  it("holds the diffuse's three numbers once, for the shader and for the card's own brightness", () => {
    expect(LIGHT_GLSL).toContain(`max(L.z, ${PRESS.diffuse.low})`);
    expect(LIGHT_GLSL).toContain(`* ${PRESS.diffuse.knee})) * ${PRESS.diffuse.over};`);
  });

  it("draws nothing of the card: its picture is light added and shade, premultiplied", () => {
    expect(LAMP_FS).toContain("outColor = vec4((spec + lift + glow) * k, shade * k);");
  });

  it("draws nothing head on and flat: there the light now is the light the print holds and the brightness carries", () => {
    expect(LAMP_FS).toContain("float ratio = nowDiff / (flatDiff * restDiff);");
    expect(LAMP_FS).toContain("float shade = clamp(1.0 - ratio, 0.0, 1.0);");
  });
});
