// @vitest-environment happy-dom

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSparklings,
  SPARK_NEEDS_YOU,
  SPARK_STATUSES,
  SparkFace,
  type SparkFaceProps,
  SparkFaceRenderer,
  type Sparklings,
  SparkStage,
} from "@vibefield/design-kit/spark-face";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

// DESIGN.md §2.10 — a spark's face, pinned where a regression would be silent: the engine is
// James's file byte for byte and loads only on demand; the statuses are the table's; a face is
// never a blank, wears its palette's colours and nothing else, and is decorative beside its words;
// and reduced motion sets the engine's motions aside without patching the engine.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PACKAGE_ROOT, "../..");
const KIT = join(REPO_ROOT, "packages/design-kit");

// James's research/spark, agent-sparks/sparks.js. A newer version is copied over the file and moves
// these two with DESIGN.md §2.10's revision in one commit; an edit in place fails here.
const VENDORED = {
  file: "src/spark-face/vendor/sparks.js",
  revision: "025b495c11406509389421d9c603d2fe08482469",
  sha256: "baa846eecc702dc4f7bcf3d1f7da20d1eb01051c87ce20685a29de1de6e67716",
} as const;

// The reduced-motion query is the test's to turn; every other query is the default's.
const reduce = {
  matches: false,
  listeners: new Set<() => void>(),
  turn(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) listener();
  },
};
let engines: Sparklings;
beforeAll(async () => {
  const matchMedia = (query: string): MediaQueryList =>
    ({
      media: query,
      get matches() {
        return query === "(prefers-reduced-motion: reduce)" ? reduce.matches : false;
      },
      addEventListener: (_type: string, listener: () => void) => {
        if (query === "(prefers-reduced-motion: reduce)") reduce.listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        reduce.listeners.delete(listener);
      },
    }) as unknown as MediaQueryList;
  Object.assign(globalThis, { matchMedia });
  engines = await loadSparklings();
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function draw(element: ReactElement): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
  const face = container.querySelector<HTMLElement>(".vf-spark-face");
  if (!face) throw new Error("no face drawn");
  return face;
}
const face = (props: SparkFaceProps): ReactElement => createElement(SparkFace, props);

describe("the vendored engine (DESIGN.md §2.10)", () => {
  it("is James's file byte for byte, at the revision §2.10 names", () => {
    const bytes = readFileSync(join(KIT, VENDORED.file));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(VENDORED.sha256);
    const design = readFileSync(join(REPO_ROOT, "DESIGN.md"), "utf8");
    expect(design).toContain(`(\`agent-sparks/sparks.js\` at \`${VENDORED.revision.slice(0, 7)}\``);
  });

  it("loads only on demand: one dynamic import, no static one, and the kit names it a side effect", () => {
    const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8")) as {
      sideEffects: string[];
      exports: Record<string, string>;
    };
    expect(pkg.sideEffects).toContain("./src/spark-face/vendor/sparks.js");
    expect(pkg.exports["./spark-face"]).toBe("./src/spark-face/index.ts");
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? entry.name === "node_modules"
            ? []
            : sources(join(dir, entry.name))
          : /\.tsx?$/u.test(entry.name)
            ? [join(dir, entry.name)]
            : [],
      );
    let dynamic = 0;
    for (const file of [...sources(join(KIT, "src")), ...sources(join(PACKAGE_ROOT, "src"))]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/(?:from|import)\s+"[^"]*vendor\/sparks(?:\.js)?"/u);
      dynamic += (text.match(/import\("\.\/vendor\/sparks\.js"\)/gu) ?? []).length;
    }
    expect(dynamic).toBe(1);
  });

  it("knows every status a spark wears, and a spark wears neither Coding nor Debugging", () => {
    const known = new Set(engines.STATUSES.map((status) => status.id));
    for (const { id } of SPARK_STATUSES) expect(known.has(id), id).toBe(true);
    const worn = new Set<string>(SPARK_STATUSES.map((status) => status.id));
    expect(worn.has("coding")).toBe(false);
    expect(worn.has("debugging")).toBe(false);
  });
});

describe("the statuses", () => {
  it("are §2.10's table: the same nineteen, the same words, the same four that need you", () => {
    const design = readFileSync(join(REPO_ROOT, "DESIGN.md"), "utf8");
    const from = design.indexOf("**The nineteen statuses.**");
    const to = design.indexOf("**Framed and free.**", from);
    expect(from).toBeGreaterThan(0);
    const rows = [
      ...design.slice(from, to).matchAll(/^\| `([a-z]+)` \| ([^|]+?) \| ([^|]+?) \|$/gmu),
    ];
    expect(rows.map(([, id, word]) => ({ id, word }))).toEqual(
      SPARK_STATUSES.map(({ id, word }) => ({ id, word })),
    );
    expect(
      rows.filter(([, , , means]) => means?.includes("(needs you)")).map(([, id]) => id),
    ).toEqual([...SPARK_NEEDS_YOU]);
  });
});

describe("the face", () => {
  it("is the flat star where the window has no WebGL2 — its disc, its points, two pill eyes", async () => {
    const drawn = await draw(face({ seed: 7, status: "ready", size: 40 }));
    expect(drawn.dataset.drawn).toBe("flat");
    expect(drawn.dataset.framed).toBe("true");
    expect(drawn.style.getPropertyValue("--vf-spark-face-size")).toBe("40px");
    const svg = drawn.querySelector("svg.vf-spark-face-flat");
    expect(svg?.querySelector("circle.vf-spark-face-disc")).not.toBeNull();
    expect(svg?.querySelector("path.vf-spark-face-star")?.getAttribute("d")).toMatch(/^M.+Z$/u);
    expect(svg?.querySelectorAll("rect.vf-spark-face-eye")).toHaveLength(2);
    // its points are its DNA's: one curve per point
    const points = engines.makeBody(7, engines.agentDNA(7).body).pts.length;
    expect(svg?.querySelector("path")?.getAttribute("d")?.match(/Q/gu)).toHaveLength(points);
  });

  it("wears its palette's colours and nothing else (S-2)", async () => {
    const dna = engines.agentDNA(4211);
    const palette = engines.PALETTES[dna.palette];
    const drawn = await draw(face({ seed: 4211, status: "thinking", size: 64 }));
    const stops = [...drawn.querySelectorAll("stop")].map((stop) =>
      stop.getAttribute("stop-color"),
    );
    expect(stops).toEqual([palette?.c[1], palette?.c[2], palette?.c[3], ...(palette?.deep ?? [])]);
    expect(drawn.getAttribute("style")).not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgba?|hsla?)\(/iu);
  });

  it("is the star alone when free: no disc", async () => {
    const drawn = await draw(face({ seed: 7, status: "hello", size: 104, framed: false }));
    expect(drawn.dataset.framed).toBe("false");
    expect(drawn.querySelector("circle")).toBeNull();
    expect(drawn.querySelector("path.vf-spark-face-star")).not.toBeNull();
  });

  it("draws its eyes 1.25× at 32 px and below, and 1.12× up to 48 (they still read)", async () => {
    const eyeWidth = async (size: number): Promise<number> => {
      const drawn = await draw(face({ seed: 90210, status: "ready", size }));
      const width = Number(drawn.querySelector("rect")?.getAttribute("width"));
      await act(async () => root?.unmount());
      container?.remove();
      root = null;
      return width;
    };
    const full = await eyeWidth(64);
    expect((await eyeWidth(32)) / full).toBeCloseTo(1.25, 2);
    expect((await eyeWidth(40)) / full).toBeCloseTo(1.12, 2);
    expect((await eyeWidth(49)) / full).toBeCloseTo(1, 2);
  });

  it("is decorative beside its words, and named where it stands alone (S-3)", async () => {
    const beside = await draw(face({ seed: 7, status: "asking", size: 40 }));
    expect(beside.getAttribute("aria-hidden")).toBe("true");
    expect(beside.getAttribute("role")).toBeNull();
    await act(async () => root?.unmount());
    container?.remove();
    const alone = await draw(
      face({ seed: 7, status: "asking", size: 24, label: "Vela, Asking you" }),
    );
    expect(alone.getAttribute("role")).toBe("img");
    expect(alone.getAttribute("aria-label")).toBe("Vela, Asking you");
    expect(alone.getAttribute("aria-hidden")).toBeNull();
  });

  it("draws as the flat star inside its one adapter, and live on a stage that cannot move it", async () => {
    const flat = await draw(
      createElement(SparkFaceRenderer, {
        renderer: "flat",
        children: face({ seed: 7, status: "running", size: 40, live: true }),
      }),
    );
    expect(flat.dataset.drawn).toBe("flat");
    await act(async () => root?.unmount());
    container?.remove();
    const staged = await draw(
      createElement(SparkStage, {
        children: face({ seed: 7, status: "running", size: 40, live: true }),
      }),
    );
    expect(
      staged.closest(".vf-spark-stage")?.querySelector("canvas.vf-spark-stage-layer"),
    ).not.toBeNull();
    expect(staged.dataset.drawn).toBe("flat");
  });
});

describe("reduced motion (M6)", () => {
  it("sets the engine's motions aside while the preference holds, and gives them back when it lifts", () => {
    const hop = (): object => engines.MOTION.hop?.(0.4, 0.4, 0) ?? {};
    expect(Object.keys(hop()).length).toBeGreaterThan(0);
    reduce.turn(true);
    expect(hop()).toEqual({});
    reduce.turn(false);
    expect(Object.keys(hop()).length).toBeGreaterThan(0);
  });
});

describe("the kit's spark-face sources", () => {
  it("hold no colour literal of any spelling: the palettes are the engine's data", () => {
    const dir = join(KIT, "src/spark-face");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
      (file) => /\.(?:tsx?|css)$/u.test(file) && !file.startsWith("vendor/sparks.js"),
    );
    expect(files.length).toBeGreaterThan(5);
    for (const file of files)
      expect(readFileSync(join(dir, file), "utf8"), file).not.toMatch(
        /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/iu,
      );
  });
});
