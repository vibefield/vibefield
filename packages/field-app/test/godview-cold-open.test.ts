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

  /** The two the slice measured and deliberately did not convert. A drop-shadow
   * is cast by the bubble's own translucent silhouette and painted beneath it;
   * the prescribed static-layer cross-fade is a box-shadow, which is clipped
   * under the border box and unscaled by the fill — measured at 46-80/255 peak
   * channel difference, 26-57 even with the alpha pre-multiplied. Named here so
   * the exception is a recorded decision rather than an oversight, and so any
   * NEW filter animation fails this test. */
  const MEASURED_EXCEPTIONS = ["vf-godview-agent-breathe", "vf-godview-agent-waiting"];

  it("finds keyframes to audit at all", () => {
    // Guards the whole check against a moved file or a broken parser: a
    // stylesheet that yields no blocks would pass every assertion below while
    // asserting nothing.
    expect(keyframeBlocks(css).length).toBeGreaterThan(8);
  });

  it("animates filter in exactly the two measured exceptions and nowhere else", () => {
    const offenders = keyframeBlocks(css)
      .filter((block) => /(^|[;{\s])(-webkit-)?(backdrop-)?filter\s*:/.test(block.body))
      .map((block) => block.name)
      .sort();

    expect(offenders).toEqual([...MEASURED_EXCEPTIONS].sort());
  });

  it("keeps the ignition loops compositor-only", () => {
    // These three run on every working bubble forever, and they are the ones
    // the law is really about: they were already opacity/transform and this
    // pins them there.
    for (const name of [
      "vf-godview-agent-ignition-core",
      "vf-godview-agent-ignition-particle",
      "vf-godview-agent-ignition-glyph",
    ]) {
      const block = keyframeBlocks(css).find((entry) => entry.name === name);
      expect(block, `${name} should exist`).toBeTruthy();
      expect(/(^|[;{\s])filter\s*:/.test(block?.body ?? "")).toBe(false);
    }
  });
});
