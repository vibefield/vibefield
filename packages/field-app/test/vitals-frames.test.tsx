// @vitest-environment happy-dom

// VT-3c (track VT, 2026-11-24; VT-D10 A) — the desk window's long frames in the Vitals window (DESIGN.md §8 "Vitals",
// the Loop lane's "Long frames"; §9 "Vitals' words"): the marks, the reading and the words. The readings are the
// catalog's own fixture, so the plate a person looks at and these rows are one page.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vitalsFixtureSnapshot } from "../src/design-system/vitals-fixtures";
import { frameMarks } from "../src/vitals/frame-marks";
import { VitalsView } from "../src/vitals/VitalsView";
import { modelFromSnapshot } from "../src/vitals/vitals-model";
import { ownWords } from "../src/vitals/vitals-words";

const here = dirname(fileURLToPath(import.meta.url));
const design = readFileSync(join(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");

const snapshot = vitalsFixtureSnapshot();
const desk = snapshot.processes.find((process) => process.role === "window");
if (desk === undefined) throw new Error("the fixture names the desk's window");

describe("VT-3c — the desk window's long frames, in the model and the words", () => {
  it("marks each second in which a process said a long frame, and no other", () => {
    const marks = frameMarks(modelFromSnapshot(snapshot));
    expect(marks.length).toBeGreaterThan(0);
    expect(new Set(marks.map((mark) => mark.key))).toEqual(new Set([desk.key]));
    const seconds = new Set(marks.map((mark) => mark.time));
    expect(seconds.size).toBe(marks.length);
    const silent = modelFromSnapshot({
      ...snapshot,
      samples: snapshot.samples.map((sample) => ({
        ...sample,
        points: sample.points.map(({ own: _own, ...point }) => point),
      })),
    });
    expect(frameMarks(silent)).toEqual([]);
  });

  it("says the count and the longest in §9's words, and nothing for none", () => {
    expect(ownWords("Desk window", { longFrames: 3, longFrameMaxMs: 180 })).toBe(
      "Desk window · 3 long frames · longest 180 ms",
    );
    expect(ownWords("Desk window", { longFrames: 1, longFrameMaxMs: 1_240 })).toBe(
      "Desk window · 1 long frame · longest 1.2 s",
    );
    expect(ownWords("Desk window", { longFrames: 0 })).toBeNull();
    for (const words of ['"3 long frames"', '"1 long frame"', '"longest 180 ms"'])
      expect(design).toContain(words);
    expect(design).toContain('"Desk window · 3 long frames · longest 180 ms"');
  });
});

describe("VT-3c — the Loop lane marks them", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (element: Parameters<Root["render"]>[0]): void => act(() => root.render(element));
  const reading = (): string | undefined =>
    host.querySelector('[data-lane="loop"] .vf-vitals__reading')?.textContent ?? undefined;
  const row = (name: string): HTMLButtonElement | undefined =>
    [...host.querySelectorAll<HTMLButtonElement>("button.vf-vitals__row")].find((button) =>
      button.textContent?.startsWith(name),
    );

  it("draws one tick a second with a long frame, standing on the lane's foot", () => {
    const model = modelFromSnapshot(snapshot);
    render(createElement(VitalsView, { model, logs: [] }));
    const ticks = [...host.querySelectorAll('[data-lane="loop"] line.vf-vitals__frame')];
    expect(ticks).toHaveLength(frameMarks(model).length);
    for (const tick of ticks) {
      expect(Number(tick.getAttribute("y2")) - Number(tick.getAttribute("y1"))).toBe(6);
      expect(tick.getAttribute("x1")).toBe(tick.getAttribute("x2"));
    }
  });

  it("reads the Desk window when its row is chosen: what it said at the moment, and nothing at a moment it said none", () => {
    const marks = frameMarks(modelFromSnapshot(snapshot));
    const last = marks.at(-1);
    if (last === undefined) throw new Error("the fixture says a long frame");
    // the newest sample is the second of the last mark: the list reads it
    const upTo = snapshot.samples.findIndex((sample) => sample.time === last.time);
    const at = modelFromSnapshot({ ...snapshot, samples: snapshot.samples.slice(0, upTo + 1) });
    render(createElement(VitalsView, { model: at, logs: [] }));
    expect(reading()).toMatch(/^Main · /);
    act(() => row("Desk window")?.click());
    expect(reading()).toBe("Desk window · 3 long frames · longest 182 ms");

    const after = modelFromSnapshot({ ...snapshot, samples: snapshot.samples.slice(0, upTo + 2) });
    render(createElement(VitalsView, { model: after, logs: [] }));
    expect(reading()).toBeUndefined();
  });

  it("stands the lane for long frames alone, and has none when nobody says either", () => {
    const framesOnly = modelFromSnapshot({
      ...snapshot,
      samples: snapshot.samples.map((sample) => ({
        ...sample,
        points: sample.points.map((point) => {
          if (point.key === desk.key) return point;
          const { own: _own, ...rest } = point;
          return rest;
        }),
      })),
    });
    render(createElement(VitalsView, { model: framesOnly, logs: [] }));
    const lane = host.querySelector('[data-lane="loop"]');
    expect(lane).not.toBeNull();
    expect(lane?.querySelectorAll("path.vf-vitals__trace")).toHaveLength(0);
    expect(lane?.querySelectorAll("line.vf-vitals__frame").length).toBeGreaterThan(0);
  });
});
