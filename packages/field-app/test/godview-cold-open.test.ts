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
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLD_OPEN_PHASES, type ColdOpenPhase, ColdOpenTrace } from "../src/godview/cold-open";

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

  it("splits the first interval into a SEND edge and an ANSWER, so a wait is not read as work (TP-S1m)", () => {
    // The shape TP-S0c could not see. Before the split there was one station
    // between `open` and `connected` — `ticket` at 210 — and the whole 210 ms
    // was attributed to minting. The send edges say where it actually went:
    // 15 ms of React, an 8 ms control round trip that proves the socket is
    // fast, and then 185 ms in which a mint that fieldd answered in 38 ms was
    // not read by a busy page.
    const trace = tracing();
    trace.mark("open", 0);
    trace.mark("claim", 15);
    trace.mark("rosterAsk", 17);
    trace.mark("roster", 25);
    trace.mark("mintAsk", 25.5);
    trace.mark("ticket", 210);
    trace.mark("connected", 218);
    trace.mark("mounted", 330);
    trace.mark("frame", 340);

    const { phases } = trace.report();
    // The NULL ARM: a fieldd round trip with no audit append and no mint.
    expect((phases.roster ?? 0) - (phases.rosterAsk ?? 0)).toBe(8);
    // The mint's own interval, measured from the send rather than from the
    // previous station — which is the whole correction.
    expect((phases.ticket ?? 0) - (phases.mintAsk ?? 0)).toBe(184.5);
  });

  it("orders the send edges before the answers they belong to", () => {
    // A station list out of order would silently produce negative hops in every
    // reduction downstream, and the reductions round rather than validate.
    const order = (phase: string): number => COLD_OPEN_PHASES.indexOf(phase as ColdOpenPhase);
    expect(order("claim")).toBeGreaterThan(order("open"));
    expect(order("roster")).toBeGreaterThan(order("rosterAsk"));
    expect(order("ticket")).toBeGreaterThan(order("mintAsk"));
    expect(order("mintAsk")).toBeGreaterThan(order("roster"));
    expect(order("connected")).toBeGreaterThan(order("ticket"));
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

/**
 * A stylesheet and everything it `@import`s by relative path, in load order —
 * the way the renderer's bundler flattens it. A bare specifier (tailwind, the
 * design kit's tokens) is another sheet's audit and is left alone.
 */
function importedSheets(entry: string): string[] {
  const seen = new Set<string>();
  const sheets: string[] = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const css = readFileSync(file, "utf8");
    sheets.push(css);
    for (const match of css.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
      const target = match[1] as string;
      if (target.startsWith(".")) visit(join(dirname(file), target));
    }
  };
  visit(entry);
  return sheets;
}

describe("the ambient-animation audit (GT-D15.1)", () => {
  const godviewRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "godview");
  // The views package's sheet, resolved through the very export the app's
  // manifest imports (`@vibecook/puppeteer-views/styles/views.css`), so the
  // audit reads what the overlay loads rather than a path it remembers.
  const packageSheet = createRequire(import.meta.url).resolve(
    "@vibecook/puppeteer-views/styles/views.css",
  );
  const packageSheets = importedSheets(packageSheet);
  const css = [
    readFileSync(join(godviewRoot, "godview.css"), "utf8"),
    readFileSync(join(godviewRoot, "deck-zoom.css"), "utf8"),
    ...packageSheets,
  ].join("\n");

  it("reads the package's sheet through the manifest's export, and follows its imports", () => {
    // Guards the audit against a moved file: the bundle must resolve and must
    // pull the swarm's own sheet in, or every assertion below would pass over
    // a stylesheet that is not the one the overlay wears.
    expect(packageSheets.length).toBeGreaterThanOrEqual(6);
    expect(css).toContain(".vf-monitor-swarm");
  });

  it("runs NO keyframe loop in the DOM — the ambient motion left with the bodies (AR-5)", () => {
    // GT-3p's ignition loops and shadow cross-fades were the DOM bubble's.
    // Since AR-5 the bodies are drawn by the views package's WebGPU renderer
    // (RFC 005) and their motion is the shader's, gated by the same
    // reduced-motion and animations switches. A keyframe that reappears here
    // is ambient DOM work on every frame the overlay is open — the cost
    // GT-D15.1 measured — and is argued back in by name, not by accident.
    expect(keyframeBlocks(css).map((block) => block.name)).toEqual([]);
  });

  it("animates filter in NO keyframe, anywhere in the overlay's stylesheets", () => {
    // The law with no carve-outs, kept for the day a keyframe is argued back
    // in: `filter` may be SET — a pre-blurred layer is the whole technique —
    // but never interpolated, because a blur that changes is a blur recomputed
    // on every frame it is alive.
    const offenders = keyframeBlocks(css)
      .filter((block) => /(^|[;{\s])(-webkit-)?(backdrop-)?filter\s*:/.test(block.body))
      .map((block) => block.name);

    expect(offenders).toEqual([]);
  });
});
