// @vitest-environment node
/**
 * THE COLD-OPEN TRACE and THE ANIMATION AUDIT (GT-3p).
 *
 * Node rather than the package's happy-dom default: the audit READS the
 * stylesheet off disk, and under the DOM environment `import.meta.url` is not a
 * file URL. Neither subject needs a document — the trace is arithmetic over an
 * injected clock, and the audit is a source scan.
 *
 * Two subjects in one file because both are the same kind of claim: a number or
 * a rule this slice must be able to state about itself and keep stating.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ColdOpenTrace } from "../src/godview/cold-open";

/** A trace whose clock never advances on its own: every stamp below passes the
 * instant explicitly, which is what makes these cases arithmetic rather than
 * timing. */
function tracing(): ColdOpenTrace {
  return new ColdOpenTrace(() => 0);
}

describe("the cold-open trace (GT-D15.4)", () => {
  it("reports each station's wait from the open", () => {
    const trace = tracing();
    trace.mark("open", 1_000);
    trace.mark("ticket", 1_040);
    trace.mark("connected", 1_310);
    trace.mark("device", 1_600);
    trace.mark("consent", 1_640);
    trace.mark("mounted", 1_700);
    trace.mark("frame", 1_724);

    const report = trace.report();
    expect(report.complete).toBe(true);
    expect(report.totalMs).toBe(724);
    expect(report.phases).toMatchObject({ ticket: 40, connected: 310, device: 600, frame: 724 });
    expect(report.warm).toEqual([]);
  });

  it("counts a station reached BEFORE the open as warm, never as elapsed time", () => {
    const trace = tracing();
    // The prewarm's stations, stamped while the overlay was still shut.
    trace.mark("ticket", 200);
    trace.mark("connected", 480);
    trace.mark("device", 900);
    // ...and then a user pressed the key.
    trace.mark("open", 9_000);
    trace.mark("consent", 9_030);
    trace.mark("mounted", 9_070);
    trace.mark("frame", 9_088);

    const report = trace.report();
    expect(report.warm).toEqual(["ticket", "connected", "device"]);
    // Warm stations report zero wait rather than a negative one — the user did
    // not travel back in time to redeem a ticket.
    expect(report.phases.ticket).toBe(0);
    expect(report.phases.device).toBe(0);
    expect(report.totalMs).toBe(88);
  });

  it("keeps the FIRST stamp for a station, so a recovery cannot rewrite history", () => {
    const trace = tracing();
    trace.mark("open", 0);
    trace.mark("connected", 120);
    // A bridge rebuild re-runs the connect; the number the user waited through
    // is still 120.
    trace.mark("connected", 5_000);
    expect(trace.report().phases.connected).toBe(120);
  });

  it("is incomplete, not zero, when the open never reached a frame", () => {
    const trace = tracing();
    trace.mark("open", 0);
    trace.mark("ticket", 30);
    const report = trace.report();
    expect(report.complete).toBe(false);
    expect(report.phases.ticket).toBe(30);
  });
});

/** Every `@keyframes` block in a stylesheet, by name, with its body. */
function keyframeBlocks(css: string): Array<{ name: string; body: string }> {
  const blocks: Array<{ name: string; body: string }> = [];
  const opener = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{/g;
  let match = opener.exec(css);
  while (match !== null) {
    let index = opener.lastIndex;
    let depth = 1;
    while (index < css.length && depth > 0) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({ name: match[1] as string, body: css.slice(opener.lastIndex, index - 1) });
    opener.lastIndex = index;
    match = opener.exec(css);
  }
  return blocks;
}

describe("the ambient-animation audit (GT-D15.1)", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "styles.css"),
    "utf8",
  );

  it("finds keyframes to audit at all", () => {
    // Guards the whole check against a moved file or a broken parser: a
    // stylesheet that yields no blocks would pass every assertion below while
    // asserting nothing.
    expect(keyframeBlocks(css).length).toBeGreaterThan(8);
  });

  it("animates filter in NO keyframe, anywhere in the app's stylesheet", () => {
    // The law with no carve-outs. `filter` may be SET — the shadow layers and
    // the ignition glow are pre-blurred, and that is the whole technique — but
    // never interpolated by a keyframe, because a blur that changes is a blur
    // recomputed on every frame it is alive.
    const offenders = keyframeBlocks(css)
      .filter((block) => /(^|[;{\s])(-webkit-)?(backdrop-)?filter\s*:/.test(block.body))
      .map((block) => block.name);

    expect(offenders).toEqual([]);
  });

  /** James's tuned drop-shadows, as they read before GT-3p rebuilt them as
   * layers. They are the REFERENCE, not history: a rebuild is only allowed to
   * change the mechanism, so every number below must still be derivable from
   * the stylesheet. Offset survives as a `translateY`, radius as a blur at HALF
   * its value (`drop-shadow()`'s third length is 2σ, `blur()` takes σ), and
   * alpha as a factor pre-multiplied by the bubble's fill opacity. */
  const TUNED = [
    { layer: "working-shadow-rest", theme: "light", dy: 8, radius: 10, alpha: 0.18 },
    { layer: "working-shadow-peak", theme: "light", dy: 12, radius: 17, alpha: 0.34 },
    { layer: "waiting-shadow-rest", theme: "light", dy: 9, radius: 13, alpha: 0.24 },
    { layer: "waiting-shadow-peak", theme: "light", dy: 17, radius: 24, alpha: 0.4 },
    { layer: "working-shadow-rest", theme: "dark", dy: 8, radius: 12, alpha: 0.12 },
    { layer: "working-shadow-peak", theme: "dark", dy: 12, radius: 20, alpha: 0.3 },
    { layer: "waiting-shadow-rest", theme: "dark", dy: 9, radius: 13, alpha: 0.16 },
    { layer: "waiting-shadow-peak", theme: "dark", dy: 17, radius: 24, alpha: 0.25 },
  ] as const;

  /** Whitespace-insensitive, including inside parentheses: these declarations
   * are long enough that the formatter wraps some of them and not others, and
   * an assertion about NUMBERS should not also be an assertion about where
   * biome chose to break a line. */
  function flatten(source: string): string {
    return source.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  }

  it("carries James's shadow numbers through the rebuild, both themes", () => {
    const themeBlock = (theme: string): string => {
      const start = css.indexOf(`.vf-godview.theme-${theme},`);
      expect(start, `the ${theme} theme block should exist`).toBeGreaterThan(-1);
      return flatten(css.slice(start, css.indexOf("\n}", start)));
    };

    for (const { layer, theme, radius, alpha } of TUNED) {
      const block = themeBlock(theme);
      // The blur is the radius halved — the one arithmetic step in the port,
      // and the one a careless edit would silently get wrong.
      expect(block, `${theme}/${layer} blur`).toContain(`--${layer}-blur: ${radius / 2}px;`);
      // The alpha rides a `calc` against the live fill-opacity knob rather than
      // a frozen number, which is how the shadow keeps tracking the lab's
      // bubble-fill slider exactly as a real drop-shadow did.
      expect(block, `${theme}/${layer} alpha`).toContain(
        `--${layer}-fill: rgb(${theme === "light" ? "0 0 0" : "255 255 255"} / ` +
          `calc(${alpha} * var(--vf-monitor-bubble-fill-opacity, 72%)));`,
      );
    }
  });

  it("offsets each shadow layer by the drop-shadow's own dy", () => {
    for (const state of ["working", "waiting"] as const) {
      for (const [slot, pseudo] of [
        ["rest", "::before"],
        ["peak", "::after"],
      ] as const) {
        const selector = `.vf-monitor-bubble-positioner.is-${state}${pseudo} {`;
        // The LAST occurrence: the same selector also ends the grouped rule
        // that gives all four layers their shared box, and that rule carries no
        // offset. The standalone rules follow it.
        const start = css.lastIndexOf(selector);
        expect(start, `${selector} should exist`).toBeGreaterThan(-1);
        const rule = css.slice(start, css.indexOf("\n}", start));
        const expected = TUNED.find(
          (entry) => entry.layer === `${state}-shadow-${slot}` && entry.theme === "light",
        );
        expect(rule, `${state} ${slot} offset`).toContain(`translateY(${expected?.dy}px)`);
      }
    }
  });

  it("keeps the loops that run forever on opacity and transform alone", () => {
    // The ambient set: three ignition loops on every working bubble, and the
    // two shadow cross-fades that replaced the breathe and wait drop-shadows.
    // Named individually so a rename cannot quietly empty this check.
    for (const name of [
      "vf-godview-agent-ignition-core",
      "vf-godview-agent-ignition-particle",
      "vf-godview-agent-ignition-glyph",
      "vf-godview-agent-shadow-rest",
      "vf-godview-agent-shadow-peak",
    ]) {
      const block = keyframeBlocks(css).find((entry) => entry.name === name);
      expect(block, `${name} should exist`).toBeTruthy();
      for (const property of (block?.body ?? "").matchAll(/([a-z-]+)\s*:/g)) {
        expect(["opacity", "transform"]).toContain(property[1]);
      }
    }
  });
});
