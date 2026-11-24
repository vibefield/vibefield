// @vitest-environment happy-dom

// VT-2 (track VT, 2026-11-24) — the Vitals window (DESIGN.md §8 "Vitals"): its model, its chart rules, its words, its
// feed and its view. The readings are the catalog's own fixture (`design-system/vitals-fixtures.ts`), so the plate a
// person looks at and the rows below are one page.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VitalsPlate } from "../src/design-system/VitalsPreview";
import {
  VITALS_FIXTURE_END,
  vitalsFixtureLogs,
  vitalsFixtureModel,
  vitalsFixtureSnapshot,
  vitalsFixtureUnavailable,
  vitalsFixtureWaiting,
} from "../src/design-system/vitals-fixtures";
import { niceBytesMax, niceMax, timeAt, tracePath, xOf, yOf } from "../src/vitals/trace-geometry";
import { Vitals } from "../src/vitals/Vitals";
import { VitalsView } from "../src/vitals/VitalsView";
import {
  EMPTY_FEED,
  lineTone,
  reduceFeed,
  VITALS_LOG_LINES_MAX,
  type VitalsFeedEvent,
} from "../src/vitals/vitals-feed";
import {
  applyDelta,
  EMPTY_VITALS,
  groupRows,
  groupSeries,
  modelFromSnapshot,
  processSeries,
  sampleAt,
  seriesPeak,
  vibeFieldTotal,
} from "../src/vitals/vitals-model";
import {
  clockWords,
  cpuScaleWords,
  cpuWords,
  groupWord,
  memoryScaleWords,
  memoryWords,
  rowName,
  stateWords,
} from "../src/vitals/vitals-words";

const MB = 1024 * 1024;
const BOX = { x: 0, width: 300, top: 0, bottom: 100 } as const;
const SCALE = { from: 0, to: 300_000, max: 1 } as const;

describe("VT-2 — a trace's geometry (the first chart rules)", () => {
  it("draws a reading where it was taken: by its time, never its place in the list", () => {
    // a missed second is a wider step, so the third reading stands at its own time
    expect(tracePath([0, 100_000, 300_000], [0, 0.5, 1], BOX, SCALE)).toBe("M0 100L100 50L300 0");
  });

  it("lifts over what was not measured and never crosses it at zero", () => {
    const path = tracePath([0, 100_000, 200_000, 300_000], [0.5, null, 0.5, 1], BOX, SCALE);
    // the lone first reading is a hair of line; the pen comes down again after the gap
    expect(path).toBe("M0 50h0.1M200 50L300 0");
    expect(path).not.toContain("100 100");
  });

  it("is empty when nothing was measured, and leaves out readings outside the span", () => {
    expect(tracePath([0, 100_000], [null, null], BOX, SCALE)).toBe("");
    expect(tracePath([-1_000, 100_000, 400_000], [1, 0.5, 1], BOX, SCALE)).toBe("M100 50h0.1");
  });

  it("is linear from zero and never cuts a peak: a value over the scale stands at the top", () => {
    expect(yOf(0, BOX, SCALE)).toBe(100);
    expect(yOf(0.25, BOX, SCALE)).toBe(75);
    expect(yOf(4, BOX, SCALE)).toBe(0);
    expect(xOf(150_000, BOX, SCALE)).toBe(150);
    expect(timeAt(150, BOX, SCALE)).toBe(150_000);
    expect(timeAt(-40, BOX, SCALE)).toBe(0);
    expect(timeAt(900, BOX, SCALE)).toBe(300_000);
  });

  it("says a scale's top as a round figure a person can read", () => {
    expect(niceMax(0.05)).toBe(0.05);
    expect(niceMax(0.37)).toBe(0.5);
    expect(niceMax(0.94)).toBe(1);
    expect(niceMax(1.3)).toBe(2);
    expect(niceMax(2.2)).toBe(2.5);
    expect(niceMax(0)).toBe(1);
    expect(niceBytesMax(611 * MB)).toBe(1024 * MB);
    expect(niceBytesMax(300 * MB)).toBe(512 * MB);
    expect(niceBytesMax(1_900 * MB)).toBe(2 * 1024 * MB);
    expect(cpuScaleWords(0.5)).toBe("50%");
    expect(cpuScaleWords(1)).toBe("1 core");
    expect(cpuScaleWords(2.5)).toBe("2.5 cores");
    expect(memoryScaleWords(512 * MB)).toBe("512 MB");
    expect(memoryScaleWords(4 * 1024 * MB)).toBe("4 GB");
  });
});

describe("VT-2 — the words", () => {
  it("says a share of one core, and never a zero for what was not measured", () => {
    expect(cpuWords(null)).toBe("–");
    expect(cpuWords(0)).toBe("0%");
    expect(cpuWords(0.004)).toBe("0.4%");
    expect(cpuWords(0.14)).toBe("14%");
    expect(cpuWords(1.3)).toBe("130%");
    expect(cpuWords(2.31, true)).toBe("2.3 cores");
    expect(cpuWords(0.6, true)).toBe("60%");
  });

  it("says memory as Activity Monitor does", () => {
    expect(memoryWords(null)).toBe("–");
    expect(memoryWords(611 * MB)).toBe("611 MB");
    expect(memoryWords(1.9 * 1024 * MB)).toBe("1.9 GB");
    expect(memoryWords(300 * 1024)).toBe("300 KB");
  });

  it("names a row by fieldd's label, else its role, and counts a tree", () => {
    expect(rowName({ role: "fieldd" })).toBe("fieldd");
    expect(rowName({ role: "terminal" }, 8)).toBe("Terminal · 8 processes");
    expect(rowName({ role: "terminal" }, 1)).toBe("Terminal");
    expect(rowName({ role: "terminal", label: "Vela" }, 3)).toBe("Vela · 3 processes");
    expect(rowName({ role: "a-role-from-a-newer-fieldd" })).toBe("a-role-from-a-newer-fieldd");
    expect(groupWord("agents")).toBe("Your terminals");
    expect(groupWord("a-new-group")).toBe("a-new-group");
  });

  it("says one state line, and only recording is green", () => {
    expect(stateWords("recording")).toEqual({ words: "Recording · every second", recording: true });
    for (const state of ["waiting", "connecting", "unavailable", "unreachable", "something-new"]) {
      expect(stateWords(state).recording, state).toBe(false);
    }
    expect(stateWords("something-new").words).toBe("Waiting for the floor's meter");
    expect(clockWords(new Date(2026, 10, 24, 14, 2, 10, 45).getTime(), "milli")).toBe(
      "14:02:10.045",
    );
    expect(clockWords(new Date(2026, 10, 24, 14, 2, 10).getTime(), "minute")).toBe("14:02");
  });
});

describe("VT-2 — the model", () => {
  const model = vitalsFixtureModel();

  it("lists the groups in the window's order and keeps a row's place while numbers change", () => {
    const now = groupRows(model, sampleAt(model, null));
    expect(now.map((group) => group.group)).toEqual([
      "shell",
      "fieldd",
      "floor",
      "agents",
      "observer",
    ]);
    expect(now[0]?.rows.map((row) => row.process.role)).toEqual([
      "main",
      "window",
      "gpu",
      "utility",
    ]);
    const earlier = groupRows(model, sampleAt(model, VITALS_FIXTURE_END - 60_000));
    for (const group of now) {
      const before = earlier.find((entry) => entry.group === group.group);
      expect(before?.rows.map((row) => row.key)).toEqual(group.rows.map((row) => row.key));
    }
  });

  it("never counts the person's terminals into VibeField's total", () => {
    const groups = groupRows(model, sampleAt(model, null));
    const total = vibeFieldTotal(groups);
    const agents = groups.find((group) => group.group === "agents");
    const all = groups.reduce((sum, group) => sum + group.memBytes, 0);
    expect(agents?.memBytes).toBeGreaterThan(1_000 * MB);
    expect(total.memBytes).toBe(all - (agents?.memBytes ?? 0));
  });

  it("reads the moment held: the newest sample at or before it", () => {
    const start = model.samples[0]?.time ?? 0;
    expect(sampleAt(model, null)?.time).toBe(VITALS_FIXTURE_END);
    expect(sampleAt(model, start + 10_400)?.time).toBe(start + 10_000);
    expect(sampleAt(model, start - 5_000)?.time).toBe(start);
    expect(sampleAt(EMPTY_VITALS, null)).toBeNull();
    // the terminal that began 96 s in is not listed before it began
    const before = groupRows(model, sampleAt(model, start + 50_000));
    expect(before.find((group) => group.group === "agents")?.rows).toHaveLength(1);
  });

  it("keeps a process's first second a gap, and a group's sum null only where none was measured", () => {
    const start = model.samples[0]?.time ?? 0;
    const born = [...model.processes.values()].find(
      (process) => process.role === "terminal" && process.startedAt > start,
    );
    const series = processSeries(model, "cpu").get(born?.key ?? "");
    expect(series?.values[95]).toBeNull(); // before it began
    expect(series?.values[96]).toBeNull(); // its first reading: a rate needs two
    expect(series?.values[97]).toBeGreaterThan(0);
    expect(processSeries(model, "memBytes").get(born?.key ?? "")?.values[96]).toBeGreaterThan(0);
    const fieldd = groupSeries(model, "fieldd", "cpu");
    expect(fieldd.values.every((value) => value !== null)).toBe(true);
    expect(seriesPeak([fieldd], 0.05)).toBeGreaterThan(0.9); // the bad ten seconds are not averaged away
    expect(groupSeries(model, "no-such-group", "cpu").values.every((value) => value === null)).toBe(
      true,
    );
  });

  it("folds a delta in, forgets a process when its last kept sample leaves, and bounds what it keeps", () => {
    const snapshot = vitalsFixtureSnapshot();
    let folded = modelFromSnapshot(snapshot);
    const last = snapshot.samples.at(-1);
    if (last === undefined) throw new Error("the fixture has samples");
    const gone = (model: typeof folded): boolean =>
      ![...model.processes.keys()].some((key) => key.startsWith("4140:"));
    const survivors = last.points.filter((point) => !point.key.startsWith("4140:"));
    const step = (count: number): void => {
      for (let n = 0; n < count; n++) {
        const newest = folded.samples.at(-1);
        if (newest === undefined) throw new Error("a sample is kept");
        folded = applyDelta(folded, {
          sample: { seq: newest.seq + 1, time: newest.time + 1_000, points: survivors },
        });
      }
    };
    // the helper ended: it keeps its name while a kept sample still draws it
    step(299);
    expect(folded.samples).toHaveLength(300);
    expect(gone(folded)).toBe(false);
    // and is forgotten when the last such sample leaves the five minutes
    step(1);
    expect(folded.samples).toHaveLength(300);
    expect(folded.samples.at(-1)?.time).toBe(last.time + 300_000);
    expect(gone(folded)).toBe(true);
    // a state alone moves nothing else, and an empty delta is the same model
    expect(applyDelta(folded, {})).toBe(folded);
    const stopped = applyDelta(folded, { state: "unavailable", detail: "no reading" });
    expect(stopped.state).toBe("unavailable");
    expect(stopped.samples).toBe(folded.samples);
  });
});

describe("VT-2 — the feed", () => {
  const record = (seq: number, time: number, severity: string): Record<string, unknown> => ({
    v: 1,
    time,
    level: severity === "ERROR" ? 50 : severity === "WARN" ? 40 : 30,
    severity,
    event: "fieldd.test.line",
    msg: `line ${seq}`,
    service: "fieldd",
    role: "daemon",
    component: "test",
    pid: 4212,
    bootId: "boot-1",
    instanceId: "instance-1",
    seq,
  });
  const logSnapshot = (records: unknown[]): unknown => ({
    v: 1,
    producers: [],
    records,
    nextCursor: "c1",
    droppedBefore: 0,
  });

  it("folds a snapshot and its deltas, and drops a frame that does not parse without guessing", () => {
    let feed = reduceFeed(EMPTY_FEED, {
      kind: "vitals",
      event: "snapshot",
      payload: vitalsFixtureSnapshot(),
    });
    expect(feed.model.state).toBe("recording");
    expect(feed.model.samples).toHaveLength(300);
    feed = reduceFeed(feed, {
      kind: "vitals",
      event: "delta",
      payload: { sample: "not a sample" },
    });
    expect(feed.rejected).toBe(1);
    expect(feed.model.samples).toHaveLength(300);
    feed = reduceFeed(feed, { kind: "vitals", event: "snapshot", payload: null });
    expect(feed.rejected).toBe(2);
  });

  it("keeps what was measured when the door shuts, and says so", () => {
    let feed = reduceFeed(EMPTY_FEED, {
      kind: "vitals",
      event: "snapshot",
      payload: vitalsFixtureSnapshot(),
    });
    feed = reduceFeed(feed, { kind: "vitals", event: "down" });
    expect(feed.model.state).toBe("unreachable");
    expect(feed.model.samples).toHaveLength(300);
  });

  it("orders two producers' lines by their own time, once each, and replaces one origin's on its snapshot", () => {
    const events: VitalsFeedEvent[] = [
      {
        kind: "logs",
        origin: "fieldd",
        event: "snapshot",
        payload: logSnapshot([record(1, 1_000, "INFO"), record(2, 3_000, "WARN")]),
      },
      {
        kind: "logs",
        origin: "shell",
        event: "snapshot",
        payload: logSnapshot([{ ...record(1, 2_000, "INFO"), service: "desktop", role: "main" }]),
      },
      {
        kind: "logs",
        origin: "fieldd",
        event: "delta",
        payload: {
          v: 1,
          cursor: "c2",
          records: [record(2, 3_000, "WARN"), record(3, 4_000, "ERROR")],
          droppedSincePrevious: 0,
        },
      },
    ];
    let feed = events.reduce(reduceFeed, EMPTY_FEED);
    expect(feed.logs.map((line) => `${line.origin}:${line.time}`)).toEqual([
      "fieldd:1000",
      "shell:2000",
      "fieldd:3000",
      "fieldd:4000",
    ]);
    expect(feed.logs.map((line) => lineTone(line.severity))).toEqual([
      "plain",
      "plain",
      "warning",
      "error",
    ]);
    // fieldd came back: its lines are replaced, the shell's stay
    feed = reduceFeed(feed, {
      kind: "logs",
      origin: "fieldd",
      event: "snapshot",
      payload: logSnapshot([record(9, 9_000, "INFO")]),
    });
    expect(feed.logs.map((line) => `${line.origin}:${line.time}`)).toEqual([
      "shell:2000",
      "fieldd:9000",
    ]);
  });

  it("bounds the lines it keeps, the oldest leaving first", () => {
    const records = Array.from({ length: VITALS_LOG_LINES_MAX }, (_, index) =>
      record(index + 1, index + 1, "INFO"),
    );
    let feed = reduceFeed(EMPTY_FEED, {
      kind: "logs",
      origin: "fieldd",
      event: "snapshot",
      payload: logSnapshot(records.slice(0, 2_000)),
    });
    feed = reduceFeed(feed, {
      kind: "logs",
      origin: "fieldd",
      event: "delta",
      payload: {
        v: 1,
        cursor: "c3",
        records: [record(5_000, 5_000, "INFO"), record(5_001, 5_001, "INFO")],
        droppedSincePrevious: 0,
      },
    });
    expect(feed.logs).toHaveLength(VITALS_LOG_LINES_MAX);
    expect(feed.logs[0]?.time).toBe(3);
    expect(feed.logs.at(-1)?.time).toBe(5_001);
  });
});

describe("VT-2 — the view", () => {
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
  const text = (selector: string): string[] =>
    [...host.querySelectorAll(selector)].map((element) => element.textContent ?? "");

  it("lists every process under its group, with VibeField's total and the terminals apart from it", () => {
    render(createElement(VitalsView, { model: vitalsFixtureModel(), logs: vitalsFixtureLogs() }));
    expect(text(".vf-vitals__group-head")).toEqual([
      "VibeField",
      "fieldd",
      "The floor",
      "Your terminals",
      "Vitals",
    ]);
    expect(text(".vf-vitals__when")).toEqual(["Now"]);
    const names = text(".vf-vitals__group .vf-vitals__name");
    expect(names).toContain("Desk window");
    expect(names).toContain("rosettad");
    expect(names).toContain("Terminal · 8 processes");
    expect(names).toContain("Vitals window");
    expect(text(".vf-vitals__row--total .vf-vitals__name")).toEqual(["All of VibeField"]);
    expect(text(".vf-vitals__note")).toEqual(["Your terminals aren't counted in it."]);
    expect(text(".vf-vitals__state")).toEqual(["Recording · every second"]);
    expect(host.querySelector(".vf-vitals__dot")?.hasAttribute("data-recording")).toBe(true);
    // every number that can change is a figure with its unit, never a bare zero for the unmeasured
    for (const figure of text(".vf-vitals__group .vf-vitals__num")) {
      expect(figure).toMatch(/^(–|\d+(\.\d)?%|\d+(\.\d)? (KB|MB|GB))$/);
    }
  });

  it("draws three groups' traces in each lane, the terminals as an area in CPU alone, and a scale in words", () => {
    render(createElement(VitalsView, { model: vitalsFixtureModel(), logs: vitalsFixtureLogs() }));
    const lane = (name: string): Element | null => host.querySelector(`[data-lane="${name}"]`);
    for (const name of ["cpu", "memory"]) {
      const groups = [...(lane(name)?.querySelectorAll("path.vf-vitals__trace[data-group]") ?? [])];
      expect(groups.map((path) => path.getAttribute("data-group"))).toEqual([
        "shell",
        "fieldd",
        "floor",
      ]);
      for (const path of groups) expect(path.getAttribute("d")).toMatch(/^M/);
    }
    expect(lane("cpu")?.querySelector(".vf-vitals__area")?.getAttribute("d")).toMatch(/Z$/);
    expect(lane("memory")?.querySelector(".vf-vitals__area")).toBeNull();
    // fieldd's bad ten seconds reach nearly a core, and the terminals' area passes half of one
    expect(text('[data-lane="cpu"] .vf-vitals__scale')).toEqual(["1 core"]);
    expect(text('[data-lane="memory"] .vf-vitals__scale')).toEqual(["2 GB"]);
    // the axis says each whole minute of the five
    expect(text(".vf-vitals__tick").length).toBeGreaterThanOrEqual(4);
    // the strip marks every line on the same axis, a warning and an error in their own tone
    const tones = [...host.querySelectorAll(".vf-vitals__mark")].map((mark) =>
      mark.getAttribute("data-tone"),
    );
    expect(tones.filter((tone) => tone === "warning")).toHaveLength(2);
    expect(tones.filter((tone) => tone === "error")).toHaveLength(1);
    expect(tones).toHaveLength(vitalsFixtureLogs().length);
  });

  it("chooses a row on a press: its own trace joins both lanes, and a second press lets it go", () => {
    render(createElement(VitalsView, { model: vitalsFixtureModel(), logs: [] }));
    const row = [...host.querySelectorAll<HTMLButtonElement>("button.vf-vitals__row")].find(
      (button) => button.textContent?.startsWith("rosettad"),
    );
    if (row === undefined) throw new Error("rosettad's row is listed");
    expect(host.querySelectorAll(".vf-vitals__trace--chosen")).toHaveLength(0);
    act(() => row.click());
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelectorAll(".vf-vitals__trace--chosen")).toHaveLength(2);
    expect(host.querySelectorAll(".vf-vitals__lane[data-chosen]")).toHaveLength(2);
    act(() => row.click());
    expect(row.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelectorAll(".vf-vitals__trace--chosen")).toHaveLength(0);
    act(() => row.click());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelectorAll(".vf-vitals__trace--chosen")).toHaveLength(0);
  });

  it("says its lines newest last, a warning's and an error's level in their own tone", () => {
    render(createElement(VitalsView, { model: vitalsFixtureModel(), logs: vitalsFixtureLogs() }));
    const lines = [...host.querySelectorAll(".vf-vitals__line")];
    expect(lines).toHaveLength(vitalsFixtureLogs().length);
    expect(text(".vf-vitals__reading")).toEqual([`${lines.length} lines`]);
    const error = lines.find((line) => line.getAttribute("data-tone") === "error");
    expect(error?.querySelector(".vf-vitals__line-msg")?.textContent).toContain("did not answer");
    expect(error?.querySelector(".vf-vitals__line-level")?.textContent).toBe("error");
    expect(lines.at(-1)?.querySelector(".vf-vitals__line-msg")?.textContent).toBe(
      vitalsFixtureLogs().at(-1)?.msg,
    );
  });

  it("says one sentence and draws no line while nothing is measured: never a zero, never a flat trace", () => {
    render(createElement(VitalsView, { model: vitalsFixtureWaiting(), logs: [] }));
    expect(text(".vf-vitals__list .vf-vitals__empty")).toEqual(["Nothing has been measured yet."]);
    expect(text(".vf-vitals__state")).toEqual(["Waiting for the floor's meter"]);
    expect(host.querySelector(".vf-vitals__dot")?.hasAttribute("data-recording")).toBe(false);
    expect(host.querySelectorAll("path")).toHaveLength(0);
    expect(host.querySelectorAll(".vf-vitals__num")).toHaveLength(0);
    render(createElement(VitalsView, { model: vitalsFixtureUnavailable(), logs: [] }));
    expect(text(".vf-vitals__list .vf-vitals__empty")).toEqual([
      "The floor has no process reading on this platform yet.",
    ]);
    expect(text(".vf-vitals__state")).toEqual(["Not measured on this computer"]);
  });

  it("hears its door: the controller folds the host's stream into the same view, and lets go on unmount", () => {
    let handler: ((event: VitalsFeedEvent) => void) | null = null;
    let released = 0;
    const door = {
      subscribe(next: (event: VitalsFeedEvent) => void): () => void {
        handler = next;
        return () => {
          released += 1;
        };
      },
    };
    render(createElement(Vitals, { door }));
    expect(text(".vf-vitals__state")).toEqual(["Connecting to fieldd…"]);
    act(() => handler?.({ kind: "vitals", event: "snapshot", payload: vitalsFixtureSnapshot() }));
    expect(text(".vf-vitals__state")).toEqual(["Recording · every second"]);
    expect(text(".vf-vitals__group-head")).toHaveLength(5);
    act(() => handler?.({ kind: "vitals", event: "down" }));
    expect(text(".vf-vitals__state")).toEqual(["fieldd isn't answering"]);
    expect(text(".vf-vitals__group-head")).toHaveLength(5);
    act(() => root.unmount());
    expect(released).toBe(1);
    root = createRoot(host);
  });

  it("says no scale and no figure for a lane with nothing in it, and keeps a minute at the axis's edge inside it", () => {
    // one mounted view, so the width it was first given stands for both renders
    render(
      createElement(VitalsView, { model: vitalsFixtureWaiting(), logs: [], initialWidth: 600 }),
    );
    expect(host.querySelectorAll(".vf-vitals__scale")).toHaveLength(0);
    expect(host.querySelectorAll(".vf-vitals__tick")).toHaveLength(0);
    render(createElement(VitalsView, { model: vitalsFixtureModel(), logs: [], initialWidth: 600 }));
    const ticks = [...host.querySelectorAll<HTMLElement>(".vf-vitals__tick")];
    // the fixture's five minutes end on a whole minute: the last label stands at the right edge, turned inward
    expect(ticks.at(-1)?.getAttribute("data-edge")).toBe("end");
    expect(ticks.at(-1)?.style.left).toBe("600px");
    expect(ticks.slice(1, -1).every((tick) => tick.getAttribute("data-edge") === null)).toBe(true);
  });

  it("projects the control room's ground into the window's pre-paint (UI_SYSTEM.md: a colour main needs)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const tokens = readFileSync(join(here, "..", "..", "design-kit", "src", "tokens.css"), "utf8");
    const ground = /--vf-godview-dark-monitor-bg:\s*(#[0-9a-f]{6});/i.exec(tokens)?.[1];
    expect(ground).toBeDefined();
    const windows = readFileSync(
      join(here, "..", "..", "electron-shell", "src", "main", "windows.ts"),
      "utf8",
    );
    const factory = windows.slice(windows.indexOf("export function createVitalsWindow"));
    expect(factory.slice(0, factory.indexOf("\n}\n"))).toContain(
      `backgroundColor: "${ground?.toLowerCase()}"`,
    );
    // and the view's own ground is that token, so the pre-paint and the page are one colour
    const sheet = readFileSync(join(here, "..", "src", "vitals", "vitals.css"), "utf8");
    expect(sheet).toContain("background: var(--vf-godview-dark-monitor-bg);");
  });

  it("stands the catalog's plates on the shipping view", () => {
    render(createElement(VitalsPlate, { state: "recording" }));
    expect(host.querySelector(".vf-ds-vitals-plate > .vf-vitals")).not.toBeNull();
    expect(text(".vf-vitals__group-head")).toHaveLength(5);
  });
});
