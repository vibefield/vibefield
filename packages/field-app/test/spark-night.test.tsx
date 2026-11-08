import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  lendNight,
  NIGHT_EASE_OUT_S,
  NIGHT_REST_AFTER_S,
  nightRestRate,
  nightRestTarget,
  SparkNight,
  skyPointOf,
  startNight,
} from "@vibefield/design-kit/spark-face";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("the night lent to the sheet's window (DESIGN.md §6, the portal; ES-3b)", () => {
  // the night's core over a stand-in engine: the kit's own SparkNight drives it over James's star engine
  const opened: { close(): void }[] = [];
  const boxes: HTMLElement[] = [];
  afterEach(() => {
    for (const night of opened.splice(0)) night.close();
    for (const box of boxes.splice(0)) box.remove();
  });
  function aNight(shown = true) {
    const box = document.createElement("div");
    box.className = "vf-spark-night";
    document.body.appendChild(box);
    boxes.push(box);
    const engine = { render: vi.fn(), clear: vi.fn() };
    const night = startNight(engine, box, shown);
    opened.push(night);
    return { box, engine, night };
  }
  const frames = () => act(async () => new Promise((done) => setTimeout(done, 60)));

  it("lends no night where none stands, nor one whose view is not shown", () => {
    expect(lendNight()).toBeNull();
    const { night } = aNight(false);
    expect(lendNight()).toBeNull();
    night.show(true);
    const lend = lendNight();
    expect(lend).not.toBeNull();
    lend?.cancel();
    night.close();
    expect(lendNight()).toBeNull();
  });

  it("lends the shown night at its own moment and place, still while it is lent, and to one window at a time", async () => {
    const { box, engine } = aNight();
    await frames();
    const lend = lendNight();
    if (lend === null) throw new Error("no night lent");
    expect(Number.isFinite(lend.t)).toBe(true);
    expect(lend.rect).toEqual(box.getBoundingClientRect());
    // its edge as it stands: at rest, or leaning as the pointer left it
    expect(typeof lend.clip).toBe("string");
    expect(lendNight()).toBeNull();
    const drawn = engine.render.mock.calls.length;
    window.dispatchEvent(new Event("pointermove"));
    await frames();
    // still: the window draws its first frame at this moment, so the night draws none
    expect(engine.render.mock.calls.length).toBe(drawn);
    lend.cancel();
  });

  it("steps aside once the window has drawn, and takes it back at the window's own moment", async () => {
    const { box, engine } = aNight();
    await frames();
    const lend = lendNight();
    if (lend === null) throw new Error("no night lent");
    expect(box.dataset.lent).toBeUndefined();
    lend.give();
    expect(box.dataset.lent).toBe("true");
    lend.takeBack(12.5);
    expect(box.dataset.lent).toBeUndefined();
    // drawn at once, at the window's moment: the hand-back shows no blank and moves no star
    expect(engine.render).toHaveBeenLastCalledWith(12.5);
    const again = lendNight();
    expect(again).not.toBeNull();
    again?.cancel();
  });

  it("carries on as it was when the window could not draw", async () => {
    const { box, engine } = aNight();
    await frames();
    lendNight()?.cancel();
    expect(box.dataset.lent).toBeUndefined();
    const drawn = engine.render.mock.calls.length;
    window.dispatchEvent(new Event("pointermove"));
    await frames();
    expect(engine.render.mock.calls.length).toBeGreaterThan(drawn);
  });

  it("hides a night that has stepped aside by the kit's own rule, and the hatch lands its star at the window's sky", () => {
    const css = readFileSync(join(KIT, "src/spark-face/spark-face.css"), "utf8");
    expect(css).toMatch(/^\.vf-spark-night\[data-lent="true"\] \{\s*visibility: hidden;/mu);
    expect(css).toMatch(/^\.vf-spark-hatch\[data-sky="lent"\] \{\s*background: transparent;/mu);
    // the face's place, 520 × 300 in the sheet, on a sky canvas the panel's size: the star lands at the face's place's
    // centre, in the sky canvas's own pixels
    expect(
      skyPointOf(
        { left: 330, top: 146, width: 520, height: 300 },
        { left: 8, top: 52, width: 1164, height: 640 },
      ),
    ).toEqual({ x: 582, y: 244 });
  });
});
