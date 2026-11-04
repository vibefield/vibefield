/**
 * PG-5 — THE LIST VIEW'S GOLDEN, read for what it says (`perf/lib/phone-goldens-list.ts`): puppeteer-views' list as it
 * draws the home's window over PG-3a's witness, step by step. These rows never read the golden's bytes (the byte row
 * is `phone-parity.test.ts`'s, over every registered view), so a re-bless cannot carry a behaviour past them. Each
 * expectation is written from the list's own rules (`AgentList.js:16-26` at puppeteer-views 0.3.3): what the host shows
 * before what it recedes, agents before bare terminals, blocked before working before idle, then by birth.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  computePhoneGoldens,
  PHONE_BODY_NOW_MS,
  readWitnessInputs,
} from "../perf/lib/phone-goldens";
import { golden, type ListRowRecord, type ListStep } from "../perf/lib/phone-goldens-list";

let steps: ListStep[];
beforeAll(async () => {
  const goldens = await computePhoneGoldens(readWitnessInputs());
  steps = (await golden.compute({
    steps: structuredClone(goldens.windowRows),
    nowMs: PHONE_BODY_NOW_MS,
  })) as ListStep[];
});

const stepAt = (at: ListStep["at"]): ListStep => {
  const found = steps.find((step) => step.at === at);
  if (found === undefined) throw new Error(`no list step at ${at}`);
  return found;
};
const idsAt = (at: ListStep["at"]): string[] => (stepAt(at).rows ?? []).map((row) => row.id);
const rowAt = (at: ListStep["at"], id: string): ListRowRecord | undefined =>
  (stepAt(at).rows ?? []).find((row) => row.id === id);

describe("PG-5 — the list view's golden: puppeteer-views' list over the home's window", () => {
  it("LG1 — orders by attention, never by the window's order: blocked, working, idle, then by birth; terminals last", () => {
    // the open: pty-p3 (Loft, born …200000) and pty-h3 (…650000) block; run-h-partial and run-h-quiet work; the
    // idle agents by birth, Attic's run-a-idle (1 790 650 000 000) first; then the bare terminals, working first
    expect(idsAt("open")).toEqual([
      "pty-p3",
      "pty-h3",
      "run-h-partial",
      "run-h-quiet",
      "run-a-idle",
      "pty-h1",
      "run-h-nocwd",
      "run-p-done",
      "run-h-root",
      "pty-h2",
      "pty-p1",
    ]);
    // frame 0 promotes pty-h2 to a working agent born at 1 790 803 190 000: it joins the working, after the two
    expect(idsAt(0)).toEqual([
      "pty-p3",
      "pty-h3",
      "run-h-partial",
      "run-h-quiet",
      "pty-h2",
      "run-a-idle",
      "pty-h1",
      "run-h-nocwd",
      "run-p-done",
      "run-h-root",
      "pty-p1",
    ]);
    // frame 1: run-h-partial goes idle, and takes its birth's place among the idle
    expect(idsAt(1)).toEqual([
      "pty-p3",
      "pty-h3",
      "run-h-quiet",
      "pty-h2",
      "run-a-idle",
      "pty-h1",
      "run-h-partial",
      "run-h-nocwd",
      "run-p-done",
      "run-h-root",
      "pty-p1",
    ]);
    // frame 4: Loft's re-attach answers pty-p3 working (its question gone) and drops pty-p1
    expect(idsAt(4)).toEqual([
      "pty-h3",
      "pty-p3",
      "run-h-quiet",
      "pty-h2",
      "run-a-idle",
      "pty-h1",
      "run-h-partial",
      "run-h-nocwd",
      "run-p-done",
      "run-h-root",
    ]);
  });

  it("LG2 — counts every session it draws, row for row with the window", () => {
    const counts = steps
      .filter((step) => step.gap !== true)
      .map((step) => [step.at, step.section?.count]);
    expect(counts).toEqual([
      ["open", "11 SESSIONS"],
      [0, "11 SESSIONS"],
      [1, "11 SESSIONS"],
      [2, "11 SESSIONS"],
      [3, "11 SESSIONS"],
      [4, "10 SESSIONS"],
      [5, "10 SESSIONS"],
      [6, "9 SESSIONS"],
      [7, "8 SESSIONS"],
      ["resync", "8 SESSIONS"],
    ]);
  });

  it("LG3 — a home terminal says `terminal`; a peer's terminal wears its desktop's name where a model would stand", () => {
    expect(rowAt("open", "pty-h2")).toMatchObject({
      agent: { terminal: "terminal" },
      remote: false,
      context: "—",
      label: "notes, terminal, working: notes",
    });
    expect(rowAt("open", "pty-p1")).toMatchObject({
      agent: { host: "Loft" },
      remote: true,
      context: "—",
      label: "on Loft, notes, remote session, idle: notes",
    });
    // promoted at frame 0, pty-h2 is an agent: its mark and its model, its context measured
    expect(rowAt(0, "pty-h2")).toMatchObject({
      agent: { mark: "svg", model: "Opus 5.5", account: null },
      context: "3%",
    });
  });

  it("LG4 — a peer's agent leads its line with its desktop and names it first, with no chip", () => {
    const row = rowAt("open", "pty-p3");
    expect(row).toMatchObject({
      status: "blocked",
      remote: true,
      agent: { mark: "svg", model: "Opus 5.5", account: null },
      detail: "Loft · Keep each desktop's rows in the board's order, or sort them by birth?",
      context: "41%",
    });
    expect(row?.label.startsWith("on Loft, puppeteer, Opus 5.5, blocked: Loft · ")).toBe(true);
    // a home agent names no desktop
    expect(rowAt("open", "pty-h1")?.label.startsWith("vibe-field, Opus 5.5, idle: ")).toBe(true);
  });

  it("LG5 — the list's own words: a home failure says its kind as it came; an idle agent with no reply, `idle`", () => {
    expect(rowAt("open", "pty-h3")).toMatchObject({
      detail: "failure",
      stale: true,
      branch: "main",
    });
    expect(rowAt("open", "run-h-nocwd")).toMatchObject({ detail: "idle", branch: null });
    expect(rowAt("open", "run-a-idle")).toMatchObject({ detail: "Attic · idle", stale: true });
  });

  it("LG6 — a peer greys by its desktop's standing: Loft at frames 3 and 4, live again at 5", () => {
    expect(rowAt(2, "pty-p3")?.stale).toBe(false);
    expect(rowAt(3, "pty-p3")?.stale).toBe(true);
    expect(rowAt(4, "run-p-done")?.stale).toBe(true);
    expect(rowAt(5, "pty-p3")?.stale).toBe(false);
  });

  it("LG7 — every drawn step: the defaults' sizes, nothing receded, nothing lit, the toolbar; the gap draws nothing", () => {
    for (const step of steps.filter((each) => each.gap !== true)) {
      expect(step.section, `step ${step.at}`).toMatchObject({
        allReceded: false,
        rowHeight: "38px",
        projectWidth: "150px",
      });
      expect(step.toolbar, `step ${step.at}`).toBe("＋ TERMINAL");
      expect(step.empty, `step ${step.at}`).toBeNull();
      for (const row of step.rows ?? []) {
        expect([row.active, row.current, row.linked, row.receded], `${step.at} ${row.id}`).toEqual([
          false,
          false,
          false,
          false,
        ]);
      }
    }
    const last = steps.at(-1);
    expect(last).toEqual({ at: 8, frame: "delta", gap: true });
  });

  it("LG8 — the note says what it is and refuses a defect", () => {
    expect(golden.note).toMatch(/never over a defect/);
    expect(golden.note).toMatch(/listMonitorView/);
  });
});
