import { describe, expect, it } from "vitest";
import {
  type AgentObservation,
  type AgentStatus,
  clearOf,
  createVoice,
  type PlayRequest,
  VOICE,
} from "../src/index.ts";

// SD-1 — the voice on a virtual clock (DESIGN.md §14 "When it speaks", SD-D9 … SD-D13): what a person would hear,
// and when. The scenarios are the lab's (draft/sound/tools/voice-test.mjs), now with exact times, plus two the product
// needs: a new prompt while still blocked is a new request, and an unknown blocker never outranks a permission.

interface Heard extends PlayRequest {
  readonly at: number;
}

function field() {
  let t = 0;
  let nextId = 1;
  const timers: { id: number; at: number; fn: () => void }[] = [];
  const heard: Heard[] = [];
  const voice = createVoice<number>(
    {
      now: () => t,
      setTimer: (fn, ms) => {
        const id = nextId++;
        timers.push({ id, at: t + ms, fn });
        return id;
      },
      clearTimer: (id) => {
        const i = timers.findIndex((x) => x.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
    },
    (request) => heard.push({ ...request, at: t }),
  );
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const x = timers[0];
      if (!x || x.at > end) break;
      timers.shift();
      t = x.at;
      x.fn();
    }
    t = end;
  };
  const ev = (
    id: string,
    status: AgentStatus,
    kind?: string,
    extra: Partial<AgentObservation> = {},
  ) => voice.observe({ id, status, ...(kind ? { kind } : {}), ...extra });
  const said = () =>
    heard.map((h) => `${h.at} ${h.cue}${h.count > 1 ? `×${h.count}` : ""} [${h.ids.join(",")}]`);
  return { voice, heard, advance, ev, said, now: () => t };
}

describe("meaning and hold", () => {
  it("the first thing heard about an agent is a fact, not news", () => {
    const f = field();
    f.ev("a", "blocked", "permission");
    f.ev("b", "idle");
    f.advance(700000);
    expect(f.heard).toEqual([]);
  });
  it("one agent finishes: Done, after its 900 ms hold and the moment's 320 ms of quiet", () => {
    const f = field();
    f.ev("a", "working");
    f.ev("b", "working");
    f.advance(100);
    f.ev("a", "idle");
    f.advance(10000);
    expect(f.said()).toEqual(["1320 done [a]"]);
    expect(f.heard[0]).toMatchObject({
      count: 1,
      pan: 0,
      far: false,
      level: 0,
      reminder: false,
      stretch: 1,
      variant: 0,
    });
  });
  it("an idle blip between tool calls (300 ms) is never heard", () => {
    const f = field();
    f.ev("a", "working");
    f.ev("b", "working");
    f.advance(10);
    f.ev("a", "idle");
    f.advance(300);
    f.ev("a", "working");
    f.advance(10000);
    expect(f.heard).toEqual([]);
  });
  it("an auto-approved permission (200 ms) is never heard", () => {
    const f = field();
    f.ev("a", "working");
    f.advance(10);
    f.ev("a", "blocked", "permission");
    f.advance(200);
    f.ev("a", "working");
    f.advance(10000);
    expect(f.heard).toEqual([]);
  });
  it("a permission under a running subagent still sounds: the blocker wins over the headline", () => {
    const f = field();
    f.ev("a", "working");
    f.ev("z", "working");
    f.advance(10);
    f.voice.observe({ id: "a", status: "working", blockers: [{ id: "p1", kind: "permission" }] });
    f.advance(3000);
    expect(f.said()).toEqual(["780 approval [a]"]);
  });
  it("an unknown blocker never outranks a permission", () => {
    const f = field();
    f.ev("a", "working");
    f.ev("z", "working");
    f.advance(10);
    f.voice.observe({
      id: "a",
      status: "blocked",
      blockers: [
        { id: "x1", kind: "something-new" },
        { id: "p1", kind: "permission" },
      ],
    });
    f.advance(3000);
    expect(f.said()).toEqual(["780 approval [a]"]);
  });
  it("a new prompt while still blocked is a new request", () => {
    const f = field();
    f.ev("a", "working");
    f.ev("z", "working");
    f.advance(10);
    f.voice.observe({ id: "a", status: "blocked", blockers: [{ id: "p1", kind: "permission" }] });
    f.advance(5000);
    f.voice.observe({ id: "a", status: "blocked", blockers: [{ id: "p2", kind: "permission" }] });
    f.advance(5000);
    expect(f.said()).toEqual(["780 approval [a]", "5780 approval [a]"]);
  });
});

describe("gather: one request and one chord per moment (SD-D9)", () => {
  it("three agents finish within 200 ms: one chord", () => {
    const f = field();
    for (const id of "abcd") f.ev(id, "working");
    f.advance(10);
    f.ev("a", "idle");
    f.advance(80);
    f.ev("b", "idle");
    f.advance(90);
    f.ev("c", "idle");
    f.advance(10000);
    // the moment stays open 320 ms past its last change (c's, due at 1080 ms)
    expect(f.said()).toEqual(["1400 done×3 [a,b,c]"]);
    expect(f.heard[0]!.notePans).toEqual([0, 0, 0]);
  });
  it("approval, question and Done in one breath: the most urgent first, the folded request 4 s later, spaced", () => {
    const f = field();
    for (const id of "abcd") f.ev(id, "working");
    f.advance(10);
    f.ev("a", "idle");
    f.ev("b", "blocked", "question");
    f.ev("c", "blocked", "permission");
    f.advance(30000);
    expect(f.said()).toEqual(["780 approval [c]", "1690 done [a]", "5100 question [b]"]);
    // never sooner than 620 ms after the last start, nor before the last has said itself
    for (let i = 1; i < f.heard.length; i++) {
      const prev = f.heard[i - 1]!;
      const gap = f.heard[i]!.at - prev.at;
      expect(gap).toBeGreaterThanOrEqual(VOICE.spacingMs);
      expect(gap).toBeGreaterThanOrEqual(clearOf(prev.cue, prev) * 1000 - 1e-9);
    }
  });
  it("eight agents change within one second: at most two sounds in the first three seconds", () => {
    const f = field();
    const ids = [..."abcdefgh"];
    for (const id of ids) f.ev(id, "working");
    f.ev("z", "working");
    f.advance(10);
    const kinds: [AgentStatus, string?][] = [
      ["idle"],
      ["idle"],
      ["blocked", "question"],
      ["idle"],
      ["blocked", "permission"],
      ["idle"],
      ["blocked", "permission"],
      ["idle"],
    ];
    ids.forEach((id, i) => {
      f.advance(125);
      const [status, kind] = kinds[i]!;
      f.ev(id, status, kind);
    });
    f.advance(30000);
    const first = f.heard[0]!.at;
    expect(f.heard.filter((h) => h.at - first <= 3000)).toHaveLength(2);
  });
  it("every blocked agent is heard at least once, and each is reminded twice", () => {
    const f = field();
    for (const id of "abcdz") f.ev(id, "working");
    f.advance(10);
    f.ev("b", "blocked", "question");
    f.ev("c", "blocked", "permission");
    f.advance(200);
    f.ev("d", "blocked", "failure");
    f.advance(700000);
    for (const id of "bcd") {
      expect(f.heard.some((h) => !h.reminder && h.ids.includes(id))).toBe(true);
      expect(f.heard.filter((h) => h.reminder && h.ids.includes(id))).toHaveLength(2);
    }
  });
});

describe("all quiet, reminders, focus, far", () => {
  it("the last working agent stops: All quiet", () => {
    const f = field();
    f.ev("a", "working");
    f.ev("b", "working");
    f.advance(10);
    f.ev("a", "idle");
    f.advance(5000);
    f.ev("b", "idle");
    f.advance(10000);
    expect(f.said()).toEqual(["1230 done [a]", "6230 settle [b]"]);
  });
  it("an unanswered request is said again, 6 dB softer and a quarter slower, at 2 and 10 minutes, then never", () => {
    const f = field();
    f.ev("a", "working");
    f.ev("b", "working");
    f.advance(10);
    f.ev("a", "blocked", "question");
    f.advance(3600000);
    expect(f.said()).toEqual(["780 question [a]", "120780 question [a]", "600780 question [a]"]);
    expect(f.heard.map((h) => [h.level, h.stretch, h.reminder])).toEqual([
      [0, 1, false],
      [-6, 1.25, true],
      [-6, 1.25, true],
    ]);
  });
  it("a finished agent is never reminded", () => {
    const f = field();
    f.ev("a", "working");
    f.ev("b", "working");
    f.advance(10);
    f.ev("a", "idle");
    f.advance(3600000);
    expect(f.said()).toEqual(["1230 done [a]"]);
  });
  it("the agent you are typing into never sounds; its reminder waits for you to leave it (SD-D12)", () => {
    const f = field();
    f.ev("a", "working");
    f.ev("b", "working");
    f.voice.attention({ focusedId: "a" });
    f.advance(10);
    f.ev("a", "blocked", "permission");
    f.advance(200000);
    expect(f.heard).toEqual([]);
    f.voice.attention({ focusedId: null });
    f.advance(600000);
    expect(f.said()).toEqual(["600780 approval [a]"]);
    expect(f.heard[0]!.reminder).toBe(true);
  });
  it("another desktop's agent is heard from across the field, in a moment of its own (SD-D14)", () => {
    const f = field();
    f.ev("r", "working", undefined, { remote: true });
    f.ev("b", "working");
    f.advance(10);
    f.ev("r", "idle");
    f.ev("b", "blocked", "question");
    f.advance(10000);
    expect(f.heard.map((h) => [h.cue, h.far])).toEqual([
      ["question", false],
      ["done", true],
    ]);
  });
  it("a sound comes from its agent's side, no further than 60% (SD-D11)", () => {
    const f = field();
    f.ev("a", "working", undefined, { pan: -0.9 });
    f.ev("b", "working", undefined, { pan: 0.4 });
    f.ev("z", "working");
    f.advance(10);
    f.ev("a", "idle");
    f.ev("b", "idle");
    f.advance(10000);
    expect(f.heard[0]).toMatchObject({ cue: "done", count: 2, notePans: [-0.6, 0.4], pan: 0 });
  });
});

describe("budget and takes", () => {
  it("a busy minute: past six sounds, Dones fold silently", () => {
    const f = field();
    for (let i = 0; i < 14; i++) f.ev(`x${i}`, "working");
    for (let i = 0; i < 12; i++) {
      f.advance(4000);
      f.ev(`x${i}`, "idle");
    }
    f.advance(10000);
    expect(f.voice.stats.played).toBe(6);
    expect(f.voice.stats.folded).toBe(6);
    for (const h of f.heard)
      expect(f.heard.filter((x) => x.at >= h.at && x.at - h.at < 60000).length).toBeLessThanOrEqual(
        6,
      );
  });
  it("each sound cycles through its five takes, the canonical one first", () => {
    const f = field();
    f.ev("z", "working");
    f.ev("a", "working");
    for (let i = 0; i < 6; i++) {
      f.advance(20000);
      f.ev("a", "idle");
      f.advance(20000);
      f.ev("a", "working");
    }
    expect(f.heard.map((h) => h.variant)).toEqual([0, 1, 2, 3, 4, 0]);
  });
  it("reset forgets every agent and every pending sound", () => {
    const f = field();
    f.ev("a", "working");
    f.ev("b", "working");
    f.advance(10);
    f.ev("a", "idle");
    f.voice.reset();
    f.advance(10000);
    expect(f.heard).toEqual([]);
    expect(f.voice.stats.events).toBe(0);
  });
});
