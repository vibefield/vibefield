import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { drainPanelMeasures, type MeasureDrainScope } from "../src/renderer-host/dev-measure-drain";

// History QA (2026-11-24): React's development build measures every re-render for the Performance panel and
// never clears it; the Vitals window grew 20 MB a minute by its own redraw.
describe("the development build's measure drain", () => {
  function timeline() {
    const kept: { name: string; detail: unknown }[] = [];
    const cleared: string[] = [];
    type Entry = { name: string; detail: unknown };
    let deliver: ((entries: Entry[]) => void) | null = null;
    let observed: { type: string; buffered?: boolean } | null = null;
    let disconnected = false;
    class FakeObserver {
      constructor(callback: (list: { getEntries(): Entry[] }) => void) {
        deliver = (entries) => callback({ getEntries: () => entries });
      }
      observe(init: { type: string; buffered?: boolean }) {
        observed = init;
      }
      disconnect() {
        disconnected = true;
      }
    }
    const scope: MeasureDrainScope = {
      performance: {
        clearMeasures(name?: string) {
          if (name !== undefined) cleared.push(name);
          for (let at = kept.length - 1; at >= 0; at -= 1)
            if (name === undefined || kept[at]?.name === name) kept.splice(at, 1);
        },
      },
      PerformanceObserver: FakeObserver,
    };
    const measure = (name: string, detail: unknown) => {
      kept.push({ name, detail });
      deliver?.([{ name, detail }]);
    };
    return {
      scope,
      kept,
      cleared,
      measure,
      observed: () => observed,
      disconnected: () => disconnected,
    };
  }

  it("clears a panel-track measure as it is delivered, so a window that redraws on a clock keeps none", () => {
    const t = timeline();
    const stop = drainPanelMeasures(t.scope);
    expect(t.observed()).toEqual({ type: "measure", buffered: true });
    for (let tick = 0; tick < 600; tick += 1)
      for (const name of ["​VitalsView", "​CpuLane", "​MemoryLane", "Update"])
        t.measure(name, { devtools: { track: "Components", properties: [["points", "…"]] } });
    expect(t.kept).toEqual([]);
    stop();
    expect(t.disconnected()).toBe(true);
  });

  it("leaves a measure that is not the panel's alone", () => {
    const t = timeline();
    drainPanelMeasures(t.scope);
    t.measure("vf:something-of-ours", null);
    t.measure("a-library", { rows: 3 });
    t.measure("​Lane", { devtools: { track: "Components" } });
    expect(t.kept.map((entry) => entry.name)).toEqual(["vf:something-of-ours", "a-library"]);
    expect(t.cleared).toEqual(["​Lane"]);
  });

  it("does nothing where the timeline cannot be observed", () => {
    const stop = drainPanelMeasures({ performance: { clearMeasures: () => undefined } });
    expect(() => stop()).not.toThrow();
  });
});

// History QA (2026-11-24): HQ-8 put the drain in `index.ts` and `vitals.ts`, and the document `pnpm dev` shows as
// the desk is neither: it is `studio-product.html`. The window went on growing (2.3 GB in four minutes, 574,861
// measures) until it was measured from inside. So the rule is held here, not remembered: every document of the
// renderer host installs the drain in its own entry, or says why it has no need.
describe("every document of the renderer host drains React's panel measures in development", () => {
  const host = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "renderer-host");
  /** Documents that mount no React tree, each with its reason. */
  const NO_REACT: Record<string, string> = {
    "spike-live-surfaces-lab.html": "the live-surface lab: plain DOM and canvases, no React",
  };
  const documents = readdirSync(host).filter((name) => name.endsWith(".html"));

  it("finds the documents (the product's, Studio's two, the catalog's, Vitals' and the labs)", () => {
    expect(documents).toEqual(
      expect.arrayContaining(["index.html", "studio-product.html", "studio.html", "vitals.html"]),
    );
  });

  for (const document of documents) {
    it(`${document}: its entry installs the drain, behind the literal that folds away in a build`, () => {
      const entry = /<script[^>]*\bsrc="\.\/([^"]+\.ts)"/.exec(
        readFileSync(join(host, document), "utf8"),
      )?.[1];
      expect(entry, "the document's module entry").toBeDefined();
      const source = readFileSync(join(host, entry as string), "utf8");
      if (document in NO_REACT) {
        expect(source).not.toMatch(/from "react|field-app|product-host/);
        return;
      }
      expect(source).toContain('import { drainPanelMeasures } from "./dev-measure-drain";');
      expect(source).toMatch(/^if \(import\.meta\.env\.DEV\) drainPanelMeasures\(\);$/m);
    });
  }
});
