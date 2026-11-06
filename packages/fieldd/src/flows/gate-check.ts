import { NEEDS_CHOICE_MAX, NEEDS_CHOICE_WORDS, NEEDS_CHOICES_MAX } from "@vibefield/contracts";

// CP-4a2b (§13a slice 11a; Q6, R34, S9; DESIGN.md §9 "What a flow's read refuses", PROPOSED, ruled
// 2026-11-06) — a gate's ONE rule, held by the read where its script writes it plainly (static-read.ts) and by the run at
// its call (runs.ts), so a card never offers a gate its run would refuse. The unit alone, pure: no I/O, and no import
// but contracts, beside form-check.ts (D12's checker precedent).
// - A gate is a question in words, and one to NEEDS_CHOICES_MAX choices of the script's own (Stop the run takes the
//   item's last place), each one line of at most NEEDS_CHOICE_MAX characters, none of them Stop the run, and no two
//   the same, whatever their case or the spaces around them (a choice's key: trimmed, then lowercased).
// - The rules run in one order, so one gate always gets the same words: its question, then its choices missing, not a
//   list, none, too many, a choice not one line of words, one too long, Stop the run, the same choice twice. Each
//   answer is the read's own lowercase words, said by the read as they are and by the run inside "An ask refused"'s
//   frame (words.ts's askRefused).
// - It covers the needs queue's own `bad-input` (queue.ts's flowItem), so a gate the rule holds never meets it.
// - It checks and never rewrites: a gate is raised exactly as the script wrote it (Q1), so a choice the person picks
//   is the very string the script's `await ask()` resolves to.
// - The read hands a choice it can't see (one not written plainly) as UNSEEN: the rules that count the list still
//   read its length, and the rules of its elements pass it by.

/** A choice the read can't see, not written plainly: the rules of a list's elements pass a list holding one by. */
export const UNSEEN: unique symbol = Symbol("a choice the read can't see");

/** A gate the rule holds: its question and its choices, exactly as its call carried them. */
export interface CheckedGate {
  readonly question: string;
  readonly choices: readonly string[];
}

/** A gate the rule refuses: the read's own words for the first rule it breaks. */
export interface RefusedGate {
  readonly refused: string;
}

const NOT_WORDS = "an ask's question is not words";
const NO_CHOICE = "an ask offers no choice";
const NOT_A_LIST = "an ask's choices are not a list";
const NOT_ONE_LINE = "an ask's choice is not one line of words";
const STOP_OFFERED = "an ask offers Stop the run, which is VibeField's own";
const TWICE = "an ask offers the same choice twice";

/** A choice's key: two choices are the same choice when their keys are. */
const keyOf = (choice: string): string => choice.trim().toLowerCase();

/** Stop the run's key: VibeField's own act, every gate's last (NEEDS_CHOICE_WORDS). */
const STOP_KEY = keyOf(NEEDS_CHOICE_WORDS.stopRun);

/** Words: a string that is not blank once trimmed. */
const isWords = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/** A choice in words on one line. */
const isOneLine = (value: unknown): value is string => isWords(value) && !/[\r\n]/.test(value);

/** Why a gate's question is refused, in the read's words, or nothing: it is not a string, or it is blank. */
export function questionRefusal(question: unknown): string | undefined {
  return isWords(question) ? undefined : NOT_WORDS;
}

/** A gate's choices held to their rules, in their order: the first refusal, or the choices themselves; nothing when
 * the list holds a choice the read can't see (UNSEEN) and breaks no rule that counts it. A missing list (`undefined`:
 * `ask(question)`, which the host sends with no second argument) offers no choice. */
function choicesOf(
  choices: unknown,
): RefusedGate | { readonly choices: readonly string[] } | undefined {
  if (choices === undefined) return { refused: NO_CHOICE };
  if (!Array.isArray(choices)) return { refused: NOT_A_LIST };
  const list: readonly unknown[] = choices;
  if (list.length === 0) return { refused: NO_CHOICE };
  if (list.length > NEEDS_CHOICES_MAX)
    return {
      refused: `an ask offers ${list.length} choices; a gate takes at most ${NEEDS_CHOICES_MAX}`,
    };
  if (list.includes(UNSEEN)) return undefined;
  if (!list.every(isOneLine)) return { refused: NOT_ONE_LINE };
  if (list.some((choice) => choice.length > NEEDS_CHOICE_MAX))
    return { refused: `an ask's choice is longer than ${NEEDS_CHOICE_MAX} characters` };
  const keys = list.map(keyOf);
  if (keys.includes(STOP_KEY)) return { refused: STOP_OFFERED };
  if (new Set(keys).size !== keys.length) return { refused: TWICE };
  return { choices: list };
}

/** Why a gate's choices are refused, in the read's words, or nothing. A list may hold UNSEEN: the read's. */
export function choicesRefusal(choices: unknown): string | undefined {
  const read = choicesOf(choices);
  return read !== undefined && "refused" in read ? read.refused : undefined;
}

/** The run's reading of the rule (R34): a gate's question and choices as its call carries them, the gate itself, or
 * the words of the first rule it breaks. A call carries no UNSEEN (the read's alone); one would be no choice in
 * words. */
export function checkGate(question: unknown, choices: unknown): CheckedGate | RefusedGate {
  if (!isWords(question)) return { refused: NOT_WORDS };
  const read = choicesOf(choices);
  if (read === undefined) return { refused: NOT_ONE_LINE };
  if ("refused" in read) return read;
  return { question, choices: read.choices };
}
