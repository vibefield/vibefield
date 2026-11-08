import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NIGHT_EASE_OUT_S,
  NIGHT_REST_AFTER_S,
  nightRestRate,
  nightRestTarget,
  SparkNight,
} from "@vibefield/design-kit/spark-face";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// THE NIGHT BEFORE THE FIRST SPARK (track ES; ES-D7 A, ruled by James on the ES page 2026-11-08 04:27:25Z; DESIGN.md
// §2.10 "the night before the first spark", §6 "The night, at rest, under the pointer, and through the portal") — the
// kit's night: the star engine's own night with no star dealt, under the field's idle rule. Its rest is pure (the rate
// the night's clock runs at, from the last pointer), so the rule is held here without a GPU.

const KIT = join(dirname(fileURLToPath(import.meta.url)), "../../design-kit");

let root: Root | null = null;
let container: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('the night at rest (DESIGN.md §6; ES-D7 A "Alive while you\'re here, still after 20 s")', () => {
  it("is live while the pointer is about, and 20 s after the last pointer eases still over 2 s — an ease, never a cut", () => {
    expect(NIGHT_REST_AFTER_S).toBe(20);
    expect(NIGHT_EASE_OUT_S).toBe(2);
    expect(nightRestTarget(0, false)).toBe(1);
    expect(nightRestTarget(19.9, false)).toBe(1);
    expect(nightRestTarget(20.1, false)).toBe(0);
    const step = 1 / 60;
    let rate = 1;
    let t = 0;
    for (; t < 0.3; t += step) rate = nightRestRate(rate, 0, step);
    // a third of a second in it still moves: it eases out, as the desk's ambient does (M5)
    expect(rate).toBeGreaterThan(0.5);
    for (; t < NIGHT_EASE_OUT_S; t += step) rate = nightRestRate(rate, 0, step);
    expect(rate).toBeLessThan(0.05);
    for (; t < NIGHT_EASE_OUT_S + 1; t += step) rate = nightRestRate(rate, 0, step);
    // still: its clock stands and it draws no frame
    expect(rate).toBe(0);
    // the pointer wakes it, quicker than it rests
    for (t = 0; t < 0.6; t += step) rate = nightRestRate(rate, 1, step);
    expect(rate).toBeGreaterThan(0.9);
  });

  it("holds still under reduced motion: the night is drawn once (M6)", () => {
    expect(nightRestTarget(0, true)).toBe(0);
    expect(nightRestTarget(30, true)).toBe(0);
  });
});

describe('the night where the window has no WebGL2 (DESIGN.md §8 "Chat\'s list", Empty: the night)', () => {
  it("is its ground, never a blank: the kit's night, its class handed through, on `--vf-spark-night`", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(SparkNight, { className: "vf-test-night" })));
    const night = container.querySelector<HTMLElement>(".vf-spark-night");
    if (night === null) throw new Error("no night drawn");
    expect(night.classList.contains("vf-test-night")).toBe(true);
    expect(night.getAttribute("aria-hidden")).toBe("true");
    // its engine loads on demand; a window with no WebGL2 has none, and the night says so
    for (let tries = 0; tries < 50 && night.dataset.night === "loading"; tries += 1)
      await act(async () => new Promise((settle) => setTimeout(settle, 10)));
    expect(night.dataset.night).toBe("ground");
    expect(night.querySelector("canvas")).toBeNull();
  });

  it("stands on the night's token alone — the kit's spark-face styling names no colour (§2.10)", () => {
    const css = readFileSync(join(KIT, "src/spark-face/spark-face.css"), "utf8");
    const rule = css.match(/^\.vf-spark-night \{([^}]*)\}/mu)?.[1] ?? "";
    expect(rule).toMatch(/background: var\(--vf-spark-night\);/u);
    expect(rule).toMatch(/position: absolute;/u);
  });
});
