/**
 * The identity's constants (DESIGN.md §14): the voice, the spaces, the masters and the family. This file is §14 made
 * code: a number changes in DESIGN.md first, then here, and `test/design-md.test.ts` holds the two equal.
 */
import type { Bend, Chorus } from "./dsp.ts";
import { TRAPPIST } from "./field.ts";

// ------------------------------------------------------------------ the voice

/** One mode of a struck body: its ratio to the fundamental, its amplitude, and its t60 at 880 Hz (s). */
export interface Mode {
  readonly r: number;
  readonly a: number;
  readonly t60: number;
}

/** The physics of the struck thing. */
export interface CoreSpec {
  readonly modes: readonly Mode[];
  /** Each mode is two nearly equal modes this many cents apart, beating slowly, the way a real bowl breathes. */
  readonly doublet: number;
  /** The mallet's contact (ms: the brightness) and its onset (ms: the softness of the attack). */
  readonly mallet: { readonly contact: number; readonly attack: number };
  /** The contact's tick of noise: level, length (ms) and band (Hz). */
  readonly noise: {
    readonly level: number;
    readonly ms: number;
    readonly hp: number;
    readonly lp: number;
  };
  /** Higher notes ring shorter by (880/f)^pitchDecay. */
  readonly pitchDecay: number;
}

/** Chord tones sung softly under a landing. Levels in dB against the strike. */
export interface BloomSpec {
  readonly level: number;
  readonly attack: number;
  readonly t60: number;
  readonly harmonics: readonly number[];
  /** The two voices' spread in cents. */
  readonly detune: number;
  readonly width: number;
  readonly send: number;
  readonly chorus: Chorus;
}

export interface SubSpec {
  readonly level: number;
  readonly t60: number;
  /** Cents it settles into pitch from above. */
  readonly drop: number;
  readonly h2: number;
  readonly h3: number;
}

export interface StarsSpec {
  readonly level: number;
  readonly count: number;
  readonly spread: number;
  readonly ms: number;
}

export interface SwellSpec {
  readonly level: number;
  readonly ms: number;
}

export interface ThumpSpec {
  readonly level: number;
  readonly t60: number;
  readonly fall: number;
  readonly noise: number;
  readonly noiseLp: number;
}

export interface AshSpec {
  readonly level: number;
  readonly ms: number;
  readonly lo: number;
  readonly hi: number;
}

/** An instrument for the whole family: its core and the field's answer around it (levels in dB vs the strike). */
export interface VoiceSpec {
  /** Also the voice's seed: renders are seeded from the cue's label and this. */
  readonly label: string;
  readonly core: CoreSpec;
  readonly bloom: BloomSpec;
  readonly sub: SubSpec;
  readonly stars: StarsSpec;
  readonly swell: SwellSpec;
  readonly thump: ThumpSpec;
  readonly ash: AshSpec;
  readonly shimmer: number;
}

/**
 * Starlight (SD-D1): struck crystal, harmonic where it rings (1 2 3, pure in a chord) with a bell's inharmonic modes
 * only in the strike; a sung glow under every landing; stars when something arrives.
 */
export const STARLIGHT: VoiceSpec = {
  label: "Starlight",
  core: {
    modes: [
      { r: 1, a: 1, t60: 2.6 },
      { r: 2, a: 0.16, t60: 1.4 },
      { r: 3, a: 0.05, t60: 0.8 },
      { r: 2.756, a: 0.16, t60: 0.3 },
      { r: 5.404, a: 0.07, t60: 0.12 },
      { r: 8.933, a: 0.025, t60: 0.05 },
    ],
    doublet: 2.2,
    mallet: { contact: 0.3, attack: 1.4 },
    noise: { level: 0.018, ms: 1.6, hp: 6000, lp: 14000 },
    pitchDecay: 0.55,
  },
  bloom: {
    level: -16,
    attack: 120,
    t60: 3.4,
    harmonics: [1, 0.32, 0.11, 0.05],
    detune: 6,
    width: 0.35,
    send: 1,
    chorus: { base: 11, depth: 0.5, rate: 0.43 },
  },
  sub: { level: -21, t60: 1.5, drop: 35, h2: 0.32, h3: 0.1 },
  stars: { level: -31, count: 9, spread: 1.7, ms: 10 },
  swell: { level: -15, ms: 260 },
  thump: { level: -14, t60: 0.28, fall: 0.4, noise: 0.35, noiseLp: 260 },
  ash: { level: -10, ms: 90, lo: 700, hi: 3000 },
  shimmer: -10,
};

// ------------------------------------------------------------------ the spaces

export type SpaceId = "day" | "night" | "far";

/**
 * Where a sound rings. rt60 (s); size scales the network's lines; damp is the loop's high loss; wet is the tail's
 * energy against the strike's (dB); pre (ms); mod is the lines' slow wander; shimmer (dB) and stars (×) adjust the
 * voice's own; tilt (dB above 3 kHz); soften multiplies the mallet; gain (dB); lp (Hz, 0 = none).
 */
export interface SpaceSpec {
  readonly label: string;
  readonly rt60: number;
  readonly size: number;
  readonly damp: number;
  readonly wet: number;
  readonly pre: number;
  readonly mod: number;
  readonly shimmer: number;
  readonly stars: number;
  readonly tilt: number;
  readonly soften: number;
  readonly gain: number;
  readonly lp: number;
}

/** The space follows the theme (day = light, night = dark); far is another desktop's agent (SD-D6, SD-D14). */
export const SPACES: Readonly<Record<SpaceId, SpaceSpec>> = {
  day: {
    label: "Day",
    rt60: 2.0,
    size: 0.85,
    damp: 0.4,
    wet: -9,
    pre: 22,
    mod: 0.6,
    shimmer: 0,
    stars: 0.8,
    tilt: 0,
    soften: 1,
    gain: 0,
    lp: 0,
  },
  night: {
    label: "Night",
    rt60: 3.4,
    size: 1,
    damp: 0.56,
    wet: -6.5,
    pre: 34,
    mod: 1,
    shimmer: 3,
    stars: 1.3,
    tilt: -2,
    soften: 1.25,
    gain: -2,
    lp: 0,
  },
  // nearly as much tail as strike (any wetter and Approval's knocks blur into one), and the reflections close behind
  // the direct sound: at a distance the extra path of a reflection is small against the direct one
  far: {
    label: "Far",
    rt60: 3.0,
    size: 1,
    damp: 0.74,
    wet: -1.5,
    pre: 18,
    mod: 0.8,
    shimmer: -4,
    stars: 0.3,
    tilt: -4,
    soften: 1.35,
    gain: -6,
    lp: 2800,
  },
};

// ------------------------------------------------------------------ the masters

export type ProfileId = "desktop" | "phone";

/**
 * Where the sound is played decides its master, never its score: hp (Hz); shelf (dB above 2.5 kHz); offset (dB on
 * the cue's target); ceiling (linear peak); wet (dB on the space's); rt and ring (× the space's ring and the voice's);
 * trim (dB under its peak where the file ends); stars (×).
 */
export interface ProfileSpec {
  readonly label: string;
  readonly hp: number;
  readonly shelf: number;
  readonly offset: number;
  readonly ceiling: number;
  readonly wet: number;
  readonly rt: number;
  readonly ring: number;
  readonly trim: number;
  readonly stars: number;
}

export const PROFILES: Readonly<Record<ProfileId, ProfileSpec>> = {
  // beside macOS's own alerts (−22.6 to −29 LUFS, measured); keeps the sub for headphones and speakers that play it
  desktop: {
    label: "Desktop",
    hp: 30,
    shelf: 0,
    offset: 0,
    ceiling: 0.89,
    wet: 0,
    rt: 1,
    ring: 1,
    trim: -66,
    stars: 1,
  },
  // beside iOS's tones (mastered about 20 dB hotter), through a speaker that loses everything under ~300 Hz: louder,
  // brighter, drier, shorter (iOS turns other audio down while a notification's file plays) and without stars (its
  // speaker and its limiter turn glints into extra strikes)
  phone: {
    label: "Phone",
    hp: 320,
    shelf: 3.5,
    offset: 20,
    ceiling: 0.84,
    wet: -3,
    rt: 0.65,
    ring: 0.6,
    trim: -46,
    stars: 0,
  },
};

/** Where the file's tail may end on the desktop's quiet masters, at the lowest: −72 dBFS. */
export const TAIL_FLOOR_DB = -72;

// ------------------------------------------------------------------ the family

export type CueId = "done" | "question" | "approval" | "failed" | "settle" | "mark";

/**
 * A note: t (s), n (its name), v (velocity 0–1); land (the note it comes home on); damp (× its ring); hard (< 1: a
 * shorter, brighter contact, a knock); bend (a glide after the strike).
 */
export interface Note {
  readonly t: number;
  readonly n: string;
  readonly v: number;
  readonly land?: boolean;
  readonly damp?: number;
  readonly hard?: number;
  readonly bend?: Bend;
}

/** The field's answer to a cue. Times in seconds from the first strike. */
export interface CueLayers {
  readonly bloom?: {
    readonly at: number;
    readonly notes: readonly (readonly [string, number])[];
    readonly v: number;
  };
  readonly sub?: { readonly at: number; readonly n: string; readonly v: number };
  readonly stars?: { readonly from: number; readonly v: number };
  readonly thump?: { readonly at: readonly number[]; readonly n: string; readonly v: number };
  readonly ash?: { readonly at: number; readonly v: number };
  /** The space breathing in before a note (reversed reverb): it ends at `into`. */
  readonly swell?: readonly {
    readonly into: number;
    readonly n: string;
    readonly v: number;
    readonly ms: number;
  }[];
  /** The cue's own adjustments to the space. */
  readonly space?: {
    readonly damp?: number;
    readonly wet?: number;
    readonly shimmer?: number;
    readonly stars?: number;
  };
}

export interface CueSpec {
  /** Also the cue's seed (with the voice's label). */
  readonly label: string;
  /** What it says, in the family table's words. */
  readonly says: string;
  /** Desktop loudness, LUFS (BS.1770 momentary maximum). */
  readonly target: number;
  readonly notes: readonly Note[];
  /** Seconds of space before the first strike (the mark's swell). */
  readonly lead?: number;
  /** Pickups ring this much shorter than the note they lead to (default 0.5). */
  readonly pickupDamp?: number;
  /** Semitones up on a master whose speaker plays nothing low (the phone). */
  readonly phoneShift?: number;
  readonly layers: CueLayers;
}

const TRAPPIST_BLOOM: readonly (readonly [string, number])[] = TRAPPIST.map(
  (p, i) => [p.n, [1, 0.8, 0.75, 0.6, 0.5, 0.32, 0.22][i]!] as const,
);

/**
 * The family (DESIGN.md §14). Every sound is cut from one phrase, the mark: D♭–A♭–E♭ climbs the field in open fifths
 * and stops on the ninth, open (the question); C–A♭–D♭ falls home through it (the answer). Each state keeps its NUMBER
 * of strikes and its own RATE: rate is the urgency, and loudness never is.
 */
export const CUES: Readonly<Record<CueId, CueSpec>> = {
  failed: {
    // The tone drained out (SD-D4): a knock, a puff of noise where the chord would be, and only a trace of the
    // chord itself — F minor, harmonics 10 and 12, muted.
    label: "Failed",
    says: "An agent stopped on an error.",
    target: -26,
    notes: [
      { t: 0, n: "Ab4", v: 0.5, damp: 0.22, hard: 0.85 },
      { t: 0, n: "F4", v: 0.62, damp: 0.22, hard: 0.85 },
      { t: 0, n: "F3", v: 0.4, damp: 0.2 },
    ],
    layers: {
      thump: { at: [0], n: "F3", v: 1 },
      ash: { at: 0, v: 1 },
      // the light goes out: no stars, no shimmer, a darker and drier space
      space: { damp: 0.14, wet: -4, shimmer: -60, stars: 0 },
    },
  },
  done: {
    label: "Done",
    says: "An agent finished. Your turn.",
    target: -27,
    notes: [
      { t: 0, n: "Ab5", v: 0.5 },
      { t: 0.32, n: "Db5", v: 0.85, land: true },
    ],
    layers: {
      bloom: {
        at: 0.32,
        notes: [
          ["Db4", 1],
          ["Ab4", 0.6],
        ],
        v: 1,
      },
      // half the sub of the rare sounds: felt, not dropped, dozens of times a day
      sub: { at: 0.32, n: "Db2", v: 0.5 },
      stars: { from: 0.32, v: 1 },
    },
  },
  question: {
    label: "Question",
    says: "An agent is asking you something.",
    target: -26,
    notes: [
      { t: 0, n: "Db5", v: 0.55 },
      { t: 0.15, n: "Ab5", v: 0.62 },
      { t: 0.3, n: "Eb6", v: 0.8, bend: { cents: 30, at: 0.05, ms: 170 } },
    ],
    layers: {
      bloom: {
        at: 0.3,
        notes: [
          ["Ab4", 0.8],
          ["Eb5", 1],
        ],
        v: 0.6,
      },
    },
  },
  approval: {
    label: "Approval",
    says: "An agent is stopped until you allow something.",
    target: -25.5,
    // a knock is short: the hand stays on the bar, so each knock stands clear of the last
    notes: [
      { t: 0, n: "Ab5", v: 0.7, damp: 0.18, hard: 0.65 },
      { t: 0.1, n: "Ab5", v: 0.78, damp: 0.18, hard: 0.65 },
      { t: 0.36, n: "Ab5", v: 0.72, damp: 0.18, hard: 0.65 },
      { t: 0.46, n: "Ab5", v: 0.8, damp: 0.18, hard: 0.65 },
    ],
    layers: {
      thump: { at: [0, 0.1, 0.36, 0.46], n: "Ab3", v: 0.55 },
      space: { shimmer: -6, stars: 0 },
    },
  },
  settle: {
    // All quiet: TRAPPIST-1 struck planet by planet, innermost first, each step a little slower (outer orbits are
    // slower), landing in three octaves led by D♭4, the octave a laptop plays.
    label: "All quiet",
    says: "The last working agent stopped. Every agent is waiting for you.",
    target: -27,
    pickupDamp: 0.45,
    phoneShift: 12,
    notes: [
      { t: 0, n: "Ab6", v: 0.3 },
      { t: 0.09, n: "C6", v: 0.36 },
      { t: 0.2, n: "Eb5", v: 0.44 },
      { t: 0.335, n: "Ab4", v: 0.52 },
      { t: 0.5, n: "Db4", v: 0.62 },
      { t: 0.7, n: "Ab3", v: 0.9, hard: 0.8 },
      { t: 0.945, n: "Db3", v: 0.5, land: true },
      { t: 0.945, n: "Db4", v: 0.75 },
      { t: 0.945, n: "Db5", v: 0.35 },
    ],
    layers: {
      bloom: { at: 0.945, notes: TRAPPIST_BLOOM, v: 0.9 },
      sub: { at: 0.945, n: "Db2", v: 0.7 },
      stars: { from: 0.945, v: 1.3 },
    },
  },
  mark: {
    // the question's last note is stopped short, so the breath before the answer is quiet (Monument Valley 3: "a
    // little bit of silence just before the big impact")
    label: "The mark",
    says: "VibeField's own phrase: a question, and its answer.",
    target: -23,
    lead: 0.55,
    pickupDamp: 0.7,
    notes: [
      { t: 0, n: "Db5", v: 0.5 },
      { t: 0.15, n: "Ab5", v: 0.56 },
      { t: 0.3, n: "Eb6", v: 0.7, damp: 0.25 },
      { t: 0.7, n: "C6", v: 0.55 },
      { t: 0.88, n: "Ab5", v: 0.6 },
      { t: 1.2, n: "Db5", v: 0.85, land: true },
      { t: 1.2, n: "Db4", v: 0.4 },
    ],
    layers: {
      swell: [{ into: 0, n: "Db5", v: 0.9, ms: 550 }],
      bloom: { at: 1.2, notes: TRAPPIST_BLOOM, v: 1 },
      sub: { at: 1.2, n: "Db2", v: 1 },
      stars: { from: 1.2, v: 1.6 },
    },
  },
};

/** The family in the table's order. */
export const CUE_IDS: readonly CueId[] = [
  "failed",
  "done",
  "question",
  "approval",
  "settle",
  "mark",
];

/** A sound has said itself this long after its last strike (SD-D10): the next may start then. */
export const CLEAR_AFTER_S = 0.45;

/** Never further than 60% of the way to a side, so headphones never feel lopsided (SD-D11). */
export const PAN_LIMIT = 0.6;

/** The five places the system-sound path bakes into the file, left to right (SD-D21). */
export const PAN_POSITIONS: readonly number[] = [-0.6, -0.3, 0, 0.3, 0.6];
