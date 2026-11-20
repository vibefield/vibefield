// @vitest-environment happy-dom

import {
  FREE_FACE_ROOM,
  flatStar,
  loadSparklings,
  SPARK_FRAME,
  SparkFace,
  SparkFaceRenderer,
  type Sparklings,
  type StillFace,
  sparkFaceScale,
  sparkPicture,
  stillKey,
} from "@vibefield/design-kit/spark-face";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// DESIGN.md §2.10 — a face as a picture a host draws (TH-3, 2026-11-19): Godview's views draw a host's
// picture inside their own box, and only from a `data:image/…` URL, so the face reaches them as its still,
// or as the flat star where the window has no WebGL2 (this window has none), free faces edge to edge with
// no room for their props. Never a blank, its palette's colours alone, one drawing with the face the window
// draws, and every still's key in use before TH-3 kept.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SVG = "data:image/svg+xml;charset=utf-8,";

let engines: Sparklings;
beforeAll(async () => {
  engines = await loadSparklings();
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

const face = (fields: Partial<StillFace> & { readonly seed: number }): StillFace => ({
  status: "ready",
  size: 20,
  framed: true,
  cut: [0, 0, 0],
  ...fields,
});

/** The picture's SVG document, held to be one. */
function svgOf(image: string | undefined): string {
  expect(image?.startsWith(SVG), "an SVG picture").toBe(true);
  return decodeURIComponent((image ?? "").slice(SVG.length));
}

const valuesOf = (svg: string, name: string): string[] =>
  [...svg.matchAll(new RegExp(` ${name}="([^"]*)"`, "gu"))].map((match) => match[1] ?? "");

/** A fresh kit in a window that has WebGL2: its one stills canvas takes an engine that draws, and hands
 * back `still` as the canvas's picture. */
async function paintingKit(still: string) {
  vi.resetModules();
  const kit = await import("@vibefield/design-kit/spark-face");
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(still);
  class PaintingEngine {
    add<T>(buddy: T): T {
      return buddy;
    }
    remove(): void {}
    clear(): void {}
    resize(): void {}
    render(): void {}
  }
  class PaintingBuddy {
    x = 0;
    y = 0;
    R = 0;
    faceScale = 1;
  }
  const painting = {
    ...engines,
    Engine: PaintingEngine,
    Buddy: PaintingBuddy,
  } as unknown as Sparklings;
  return { kit, painting };
}

describe("DESIGN.md §2.10 — a face as a picture (TH-3)", () => {
  it("is the flat star where the window has no WebGL2: its disc, its points, two pill eyes", () => {
    const svg = svgOf(sparkPicture(engines, face({ seed: 7 }))?.image);
    const dna = engines.agentDNA(7);
    const shape = flatStar(
      engines.makeBody(dna.seed, dna.body),
      engines.makeEyes(dna.seed, dna.eyes),
      sparkFaceScale(20),
    );
    expect(valuesOf(svg, "d")).toEqual([shape.outline]);
    expect(svg.match(/<circle /gu)).toHaveLength(1);
    expect(valuesOf(svg, "width").slice(1)).toEqual(shape.eyes.map((eye) => String(eye.width)));
  });

  it("wears its palette's colours and nothing else (S-2)", () => {
    const dna = engines.agentDNA(4211);
    const palette = engines.PALETTES[dna.palette];
    const svg = svgOf(sparkPicture(engines, face({ seed: 4211, status: "thinking" }))?.image);
    expect(valuesOf(svg, "stop-color")).toEqual([
      palette?.c[1],
      palette?.c[2],
      palette?.c[3],
      ...(palette?.deep ?? []),
    ]);
    expect(valuesOf(svg, "fill")).toEqual([
      "url(#disc)",
      "url(#body)",
      palette?.c[3],
      palette?.c[3],
    ]);
  });

  it("is the star alone when free, edge to edge in its own box, with no room for its props", () => {
    const svg = svgOf(sparkPicture(engines, face({ seed: 7, size: 14, framed: false }))?.image);
    expect(svg).not.toContain("<circle");
    expect(valuesOf(svg, "width")[0]).toBe("14");
    expect(valuesOf(svg, "viewBox")).toEqual([
      [
        -SPARK_FRAME.frameH,
        -SPARK_FRAME.frameH,
        SPARK_FRAME.frameH * 2,
        SPARK_FRAME.frameH * 2,
      ].join(" "),
    ]);
  });

  it("is a data:image URL that fetches nothing: no reference but the picture's own gradients", () => {
    const image = sparkPicture(engines, face({ seed: 7 }))?.image;
    expect(typeof image).toBe("string");
    expect(image).toMatch(/^data:image\//iu);
    const svg = svgOf(image);
    expect(svg).not.toMatch(/href/iu);
    expect(svg.match(/url\(/gu)).toHaveLength(svg.match(/url\(#(?:body|disc)\)/gu)?.length ?? -1);
  });

  it("is the still the window's canvas drew where it has WebGL2, a free face's edge to edge", async () => {
    const still = "data:image/png;base64,iVBORw0KGgo=";
    const { kit, painting } = await paintingKit(still);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const framed = kit.sparkPicture(painting, face({ seed: 7 }));
    expect(framed?.image).toBe(still);
    expect(framed?.key).toBe(
      `still|${["7", "ready", "20", "framed", "0,0,0", pixelRatio].join("|")}`,
    );
    const free = kit.sparkPicture(painting, face({ seed: 7, size: 14, framed: false }));
    expect(free?.image).toBe(still);
    expect(free?.key).toBe(
      `still|${["7", "ready", "14", "free", "0,0,0", pixelRatio, "room=1"].join("|")}`,
    );
    const canvas = [
      ...document.querySelectorAll<HTMLCanvasElement>("canvas.vf-spark-still-canvas"),
    ].at(-1);
    expect(canvas?.style.getPropertyValue("--vf-spark-still-box")).toBe("14px");
  });

  it("keeps every still's key in use before TH-3: a face that names no room keys as it did", () => {
    expect(stillKey(face({ seed: 7, size: 40 }), 1)).toBe("7|ready|40|framed|0,0,0|1");
    expect(stillKey(face({ seed: 7, size: 104, framed: false, cut: [1, 1, 1] }), 2)).toBe(
      "7|ready|104|free|255,255,255|2",
    );
    // the default said, and a room on a framed face (which has none), key as nothing said
    expect(stillKey(face({ seed: 7, framed: false, room: FREE_FACE_ROOM }), 1)).toBe(
      stillKey(face({ seed: 7, framed: false }), 1),
    );
    expect(stillKey(face({ seed: 7, room: 1 }), 1)).toBe(stillKey(face({ seed: 7 }), 1));
    expect(stillKey(face({ seed: 7, framed: false, room: 1 }), 1)).toBe(
      "7|ready|20|free|0,0,0|1|room=1",
    );
  });

  it("promises the same picture by its key; a new seed, size or frame is a new one, a status not (flat)", () => {
    const first = sparkPicture(engines, face({ seed: 7 }));
    expect(sparkPicture(engines, face({ seed: 7 }))).toEqual(first);
    const keys = [
      first,
      sparkPicture(engines, face({ seed: 8 })),
      sparkPicture(engines, face({ seed: 7, size: 14 })),
      sparkPicture(engines, face({ seed: 7, framed: false })),
    ].map((picture) => picture?.key);
    expect(new Set(keys).size).toBe(4);
    // the flat star draws no status, so a status change re-makes no flat picture
    expect(sparkPicture(engines, face({ seed: 7, status: "asking" }))?.key).toBe(first?.key);
  });

  it("is the face's own flat drawing: one figure for the face in the window and for its picture", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        createElement(SparkFaceRenderer, {
          renderer: "flat",
          children: createElement(SparkFace, { seed: 7, status: "ready", size: 20 }),
        }),
      ),
    );
    const drawn = container.querySelector("svg.vf-spark-face-flat");
    const svg = svgOf(sparkPicture(engines, face({ seed: 7 }))?.image);
    expect(valuesOf(svg, "d")).toEqual([
      drawn?.querySelector("path.vf-spark-face-star")?.getAttribute("d"),
    ]);
    expect(valuesOf(svg, "viewBox")).toEqual([drawn?.getAttribute("viewBox")]);
    expect(valuesOf(svg, "width").slice(1)).toEqual(
      [...(drawn?.querySelectorAll("rect.vf-spark-face-eye") ?? [])].map((eye) =>
        eye.getAttribute("width"),
      ),
    );
  });
});
