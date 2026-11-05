import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLEAR_AFTER_S,
  CUE_IDS,
  CUES,
  FUNDAMENTAL,
  haptics,
  harmonicOf,
  hz,
  layout,
  PAN_LIMIT,
  PAN_POSITIONS,
  PROFILES,
  QUIET,
  SPACES,
  STARLIGHT,
  TAIL_FLOOR_DB,
  TRAPPIST,
  tuned,
  VOICE,
} from "../src/index.ts";

// SD-1 — DESIGN.md §14 is the authority and this package its projection (§10's review ritual: the doc moves first,
// then the code). Every number §14 states is read back here from the package's own constants, so a constant that
// moves without its section, or a section that moves without its constant, is red.

const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8");
const start = design.indexOf("\n## 14. Sound");
const next = design.indexOf("\n## ", start + 1);
const section = design.slice(start, next === -1 ? undefined : next);
/** §14 with every run of whitespace one space (its lines wrap at 120). */
const text = section.replace(/\s+/g, " ");

/** §14 says this, word for word (a failure names the words, not the whole section). */
const says = (words: string): void => {
  expect(text.includes(words), `DESIGN.md §14 should say: ${words}`).toBe(true);
};
const minus = (x: number): string => (x < 0 ? `−${-x}` : `${x}`);
const signed = (x: number): string => (x < 0 ? `−${-x}` : `+${x}`);
const flat = (n: string): string => n.replace("b", "♭");
const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];
const gaps = (cue: (typeof CUE_IDS)[number]): number[] => {
  const s = layout(cue).strikes;
  return s.slice(1).map((t, i) => Math.round((t - s[i]!) * 1000));
};
/** A harmonic of D♭1 as its ratio to D♭5's (the 16th): 18 → "9/8". */
const fraction = (h: number): string => {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(h, 16);
  return 16 / g === 1 ? `${h / g}` : `${h / g}/${16 / g}`;
};

it("§14 exists, after §13", () => {
  expect(start).toBeGreaterThan(design.indexOf("\n## 13. Glyphs"));
  says("`@vibefield/sound` (`packages/sound`) is this section in code");
});

describe("the field and its chord", () => {
  it("D♭1 and the five notes, just", () => {
    says(`D♭1 (${FUNDAMENTAL.toFixed(3)} Hz)`);
    const notes = ["Db5", "Eb5", "F5", "Ab5", "C6"];
    says(`harmonics ${notes.map((n) => harmonicOf(n).toFixed(0)).join(" · ")} of D♭1`);
    says(notes.map((n) => fraction(harmonicOf(n))).join(" · "));
    says(`(${notes.map((n) => `${flat(n)} ${tuned(n).toFixed(2)} Hz`).join(" · ")})`);
    const cents = (n: string) => (1200 * Math.log2(hz(n) / tuned(n))).toFixed(1);
    says(`F sits ${cents("F5")} ¢ and C ${cents("C6")} ¢ under a piano's`);
  });
  it("TRAPPIST-1's chord", () => {
    says(
      `${TRAPPIST.map((p) => flat(p.n)).join(" ")}, harmonics ${TRAPPIST.map((p) => harmonicOf(p.n).toFixed(0)).join(" · ")} of D♭1`,
    );
  });
});

describe("the laws' numbers", () => {
  it("S4: the four status sounds within 1.5 LU; S7: the strike over its tail by day and by night", () => {
    const status = (["failed", "done", "question", "approval"] as const).map((c) => CUES[c].target);
    says(`sit within ${Math.max(...status) - Math.min(...status)} LU of each other`);
    says(
      `A strike carries ${-SPACES.day.wet} dB (day) and ${-SPACES.night.wet} dB (night) more energy than its tail`,
    );
  });
});

describe("the family table", () => {
  it.each(CUE_IDS)(
    "%s: what it says, its strikes, its loudness on the desktop and the phone",
    (cue) => {
      const c = CUES[cue];
      says(`| ${c.label} | ${c.says} | ${layout(cue).strikes.length} |`);
      says(`| ${minus(c.target)} LUFS | ${minus(c.target + PROFILES.phone.offset)} LUFS |`);
    },
  );
  it("the rates", () => {
    says(`| A♭5 → D♭5 | ${gaps("done")[0]} ms |`);
    expect(new Set(gaps("question"))).toEqual(new Set([150]));
    says("the last lifting 30 ¢ | 150 ms |");
    expect(CUES.question.notes[2]!.bend!.cents).toBe(30);
    says(`| ${gaps("approval").join(" · ")} ms |`);
    const settle = gaps("settle");
    says(`| ${settle[0]} → ${settle.at(-1)} ms, slowing |`);
    const mark = gaps("mark");
    says(`| ${mark[0]} ms; a breath; ${mark[3]} · ${mark[4]} ms |`);
    says(`the space breathes in (${CUES.mark.lead} s)`);
  });
  it("a Done chord strums 22 ms apart", () => {
    const s = layout("done", { count: 2 }).strikes;
    says(`strummed ${Math.round((s[2]! - s[1]!) * 1000)} ms apart`);
  });
});

describe("Starlight", () => {
  const core = STARLIGHT.core;
  it("its core", () => {
    const [m1, m2, m3, i1, i2, i3] = core.modes;
    says(
      `modes ${[m1, m2, m3].map((m) => m!.r).join(" · ")}, ringing ${[m1, m2, m3].map((m) => m!.t60.toFixed(1)).join(" · ")} s at 880 Hz`,
    );
    says(`(880/f)^${core.pitchDecay}`);
    says(
      `(${[i1, i2, i3].map((m) => m!.r).join(" · ")}, gone in ${[i1, i2, i3].map((m) => m!.t60).join(" · ")} s)`,
    );
    says(`a doublet ${core.doublet} ¢ wide`);
    says(`contact is ${core.mallet.contact} ms and its onset ${core.mallet.attack} ms`);
  });
  it("the field's answer around it", () => {
    const v = STARLIGHT;
    says(
      `the bloom ${minus(v.bloom.level)} (organ harmonics ${v.bloom.harmonics.join(" · ")}, a ${v.bloom.attack} ms attack, ringing ${v.bloom.t60} s, two voices ${v.bloom.detune} ¢ apart`,
    );
    says(`the sub ${minus(v.sub.level)} (D♭2 settling ${v.sub.drop} ¢ into pitch`);
    const byDay = Math.round(v.stars.count * SPACES.day.stars);
    const byNight = Math.round(v.stars.count * SPACES.night.stars);
    says(`the stars ${minus(v.stars.level)}`);
    says(`${WORDS[byDay]} after a Done by day, ${WORDS[byNight]} by night`);
    says(
      `the knock ${minus(v.thump.level)}, the ash ${minus(v.ash.level)} (a noise puff whose band falls from ${v.ash.hi / 1000} kHz to ${v.ash.lo} Hz`,
    );
    says(`swell ${minus(v.swell.level)} (the mark only) and the shimmer ${minus(v.shimmer)}`);
  });
});

describe("the spaces table", () => {
  const WHEN = {
    day: "the light theme",
    night: "the dark theme",
    far: "another desktop's agent",
  } as const;
  it.each(["day", "night", "far"] as const)("%s", (id) => {
    const s = SPACES[id];
    says(
      `| ${s.label} | ${WHEN[id]} | ${s.rt60.toFixed(1)} s | ${minus(s.wet)} dB | ${s.pre} ms |`,
    );
    says(`stars ×${s.stars}`);
  });
  it("night and far's own colour", () => {
    const n = SPACES.night;
    says(
      `shimmer ${signed(n.shimmer)} dB, stars ×${n.stars}, ${minus(n.tilt)} dB above 3 kHz, a softer mallet, ${minus(n.gain)} dB |`,
    );
    const f = SPACES.far;
    says(
      `shimmer ${signed(f.shimmer)} dB, stars ×${f.stars}, ${minus(f.tilt)} dB above 3 kHz, low-passed at ${f.lp / 1000} kHz, ${minus(f.gain)} dB |`,
    );
  });
});

describe("the masters and the touch", () => {
  it("desktop and phone", () => {
    const d = PROFILES.desktop;
    const p = PROFILES.phone;
    says(`high-passed at ${d.hp} Hz`);
    says(`once it has fallen under ${minus(TAIL_FLOOR_DB)} dBFS`);
    says(`so ${p.offset} dB louder; high-passed at ${p.hp} Hz with +${p.shelf} dB above 2.5 kHz`);
    says(
      `drier (${-p.wet} dB less tail, the space ringing ×${p.rt} and the voice ×${p.ring}); no stars`,
    );
    expect(p.stars).toBe(0);
    says(`limited at ${minus(Number((20 * Math.log10(p.ceiling)).toFixed(1)))} dBFS`);
    says(`the file ends ${-p.trim} dB under its peak`);
    expect(CUES.settle.phoneShift).toBe(12);
    says("All quiet an octave higher");
  });
  it("the phone's touch", () => {
    says("intensity from the strongest note struck then (0.35 + 0.6 × its velocity)");
    says(
      `Approval's knocks are the sharpest taps in the family (${haptics("approval")[0]!.sharpness})`,
    );
    says(`Failed's one tap the dullest (${haptics("failed")[0]!.sharpness})`);
    const q = haptics("question");
    const d = haptics("done");
    says(
      `Question rises (${q[0]!.sharpness} → ${q.at(-1)!.sharpness}) and Done falls (${d[0]!.sharpness} → ${d.at(-1)!.sharpness})`,
    );
  });
});

describe("when it speaks", () => {
  it("the voice's numbers", () => {
    const h = VOICE.holdMs;
    expect(h.question).toBe(h.approval);
    says(`Done ${h.done} ms, Question and Approval ${h.question} ms, Failed ${h.failed} ms`);
    says(
      `It closes after ${VOICE.gatherMs} ms of quiet and never later than ${VOICE.gatherMaxMs / 1000} s after it opened`,
    );
    says(`it plays on its own ${VOICE.deferMs / 1000} s later if it still waits`);
    says(`two agents or more are in the field`);
    expect(WORDS[VOICE.settleMinAgents]).toBe("two");
    says(
      `its last strike plus ${Math.round(CLEAR_AFTER_S * 1000)} ms and never sooner than ${VOICE.spacingMs} ms after it began`,
    );
    expect(VOICE.budget.windowMs).toBe(60000);
    says(`Past ${WORDS[VOICE.budget.max]} sounds a minute, Dones fold silently`);
    expect(VOICE.remindStretch).toBe(1.25);
    says(
      `${-VOICE.remindLevel} dB softer and a quarter slower, at ${VOICE.remindAtMs[0] / 60000} minutes and at ${VOICE.remindAtMs[1] / 60000} minutes, then never again`,
    );
    says(`never more than ${Math.round(PAN_LIMIT * 100)}% of the way to a side`);
    says(`Each sound cycles through ${WORDS[VOICE.takes]} takes, the canonical one first`);
  });
  it("the system path's five places", () => {
    const place = (p: number) =>
      p === 0 ? "the centre" : `${p < 0 ? "−" : "+"}${Math.round(Math.abs(p) * 100)}%`;
    says(`at ${WORDS[PAN_POSITIONS.length]} positions: ${PAN_POSITIONS.map(place).join(", ")}.`);
    expect(PAN_POSITIONS.at(-1)).toBe(PAN_LIMIT);
  });
  it("Quiet's clock (SD-2)", () => {
    expect(QUIET.HOUR_MS).toBe(60 * 60 * 1000);
    says(
      `for an hour or until tomorrow: ${QUIET.MORNING_HOUR}:00 the next morning, by this Mac's clock.`,
    );
  });
});
