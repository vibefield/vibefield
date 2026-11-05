/**
 * The field (DESIGN.md §14 "The field", SD-D2). Every note VibeField plays is a harmonic of one fundamental, D♭1
 * (34.648 Hz, too low for a laptop to play): D♭5 is its 16th harmonic, A♭5 its 24th, C6 its 30th, E♭6 its 36th.
 * Tuned that way (just intonation), any number of sounds ringing at once line up as partials of one tone and do not
 * beat against each other. The tonic is equal-tempered at A4 = 440 Hz; every other degree is the just ratio above it.
 */

const STEP: Readonly<Record<string, number>> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };

/** A note's distance in semitones from A4: "F5" → 8. Sharps and flats: "C#6", "Bb5". */
export function semisOf(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return STEP[m[1]!]! + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) - 4) * 12;
}

/** A note in equal temperament (A4 = 440 Hz): "F5" → 698.456 Hz. */
export function hz(name: string): number {
  return 440 * 2 ** (semisOf(name) / 12);
}

/** The key, chosen by measurement against Apple's own alert tones (the record's collision sweep). */
export const TONIC = "Db";
/** Each scale degree as the ratio a harmonic of the tonic gives it (just intonation). */
const JUST: readonly number[] = [
  1,
  16 / 15,
  9 / 8,
  6 / 5,
  5 / 4,
  4 / 3,
  45 / 32,
  3 / 2,
  8 / 5,
  5 / 3,
  9 / 5,
  15 / 8,
];
const ROOT0 = semisOf(`${TONIC}0`);

/** A note as the field tunes it: the tonic equal-tempered, every other degree just above it. */
export function tuned(name: string): number {
  const s = semisOf(name) - ROOT0;
  const oct = Math.floor(s / 12);
  return hz(`${TONIC}0`) * 2 ** oct * JUST[s - oct * 12]!;
}

/** D♭1, the field's unheard fundamental. */
export const FUNDAMENTAL = tuned(`${TONIC}1`);

/** Which harmonic of the field a note is: D♭5 → 16, A♭5 → 24, E♭6 → 36. */
export const harmonicOf = (name: string): number => tuned(name) / FUNDAMENTAL;

const NAMES: readonly string[] = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** The note `semis` semitones above another, by name: ("Db5", 7) → "Ab5". */
export function above(name: string, semis: number): string {
  const s = semisOf(name) + 57 + semis;
  return NAMES[((s % 12) + 12) % 12]! + Math.floor(s / 12);
}

/** The field's notes: D♭ E♭ F A♭ C, harmonics 16 18 20 24 30 of D♭1 (a major ninth chord). */
export const SCALE: readonly string[] = ["Db", "Eb", "F", "Ab", "C"];

/** A planet of TRAPPIST-1 and the note its orbit sounds in the field. */
export interface Planet {
  readonly planet: "b" | "c" | "d" | "e" | "f" | "g" | "h";
  readonly n: string;
}

/**
 * TRAPPIST-1's chord (SD-D3), outermost planet (h) to innermost (b): seven planets locked in a resonant chain whose
 * orbital frequencies, sped up about 225 million times so that h sounds D♭3, are harmonics 4 6 8 12 18 30 48 of D♭1.
 */
export const TRAPPIST: readonly Planet[] = [
  { planet: "h", n: "Db3" },
  { planet: "g", n: "Ab3" },
  { planet: "f", n: "Db4" },
  { planet: "e", n: "Ab4" },
  { planet: "d", n: "Eb5" },
  { planet: "c", n: "C6" },
  { planet: "b", n: "Ab6" },
];
