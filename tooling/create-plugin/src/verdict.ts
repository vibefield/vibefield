// The verdict (P8-D8), the scaffolder speaking the same two registers as the
// rest of the kit: a human line, and `--json` NDJSON for the agent that will
// read it. One object, two renderings — never two code paths that can disagree.
//
// EXIT CODES ARE LAW: 0 the scaffold was written · 1 a refusal (nothing was
// written) · 2 the scaffolder itself failed. Nothing prompts.

import { guidanceFor, type RefusalCode } from "./refusals";

/** `refuse` fails the command; `note` is an honest statement about what the
 * scaffold will and will not do here; `pass` is a step that ran and held. */
export type VerdictLevel = "pass" | "note" | "refuse";

export interface Verdict {
  readonly level: VerdictLevel;
  /** the row this verdict belongs to — `target`, `id`, `write`, `workspace`, … */
  readonly check: string;
  /** stable kebab-case class; the catalog in `refusals.ts` is the enumeration */
  readonly code: string;
  /** the path or flag the verdict is about */
  readonly pointer?: string;
  /** the passing shape, stated concretely — what to make true */
  readonly expected?: string;
  /** the human line */
  readonly detail: string;
}

export const EXIT_OK = 0;
export const EXIT_REFUSED = 1;
export const EXIT_HARNESS = 2;

export function pass(check: string, detail: string, code = "ok"): Verdict {
  return { level: "pass", check, code, detail };
}

/** A note carries guidance too — a statement about the scaffold's limits should
 * say what would lift them. Never affects the exit code. */
export function note(
  check: string,
  code: RefusalCode,
  detail: string,
  extra?: Partial<Verdict>,
): Verdict {
  return {
    level: "note",
    check,
    code,
    detail,
    expected: guidanceFor(code),
    ...stripUndefined(extra),
  };
}

/** A refusal, with the catalog's guidance as the default `expected`. */
export function refuse(
  check: string,
  code: RefusalCode,
  detail: string,
  extra?: Partial<Verdict>,
): Verdict {
  return {
    level: "refuse",
    check,
    code,
    detail,
    expected: guidanceFor(code),
    ...stripUndefined(extra),
  };
}

/** `exactOptionalPropertyTypes` is on: an explicit `pointer: undefined` is a
 * type error, so optional fields are dropped rather than set to undefined. */
function stripUndefined(extra: Partial<Verdict> | undefined): Partial<Verdict> {
  if (extra === undefined) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) out[key] = value;
  return out as Partial<Verdict>;
}

export function exitCodeFor(verdicts: readonly Verdict[]): number {
  return verdicts.some((v) => v.level === "refuse") ? EXIT_REFUSED : EXIT_OK;
}

const GLYPH: Record<VerdictLevel, string> = { pass: "ok  ", note: "note", refuse: "REFUSE" };

/** The human register. One line per verdict, plus the two fields an author acts
 * on (where, and what would have passed) indented beneath a refusal. */
export function formatHuman(verdict: Verdict): string {
  const head = `${GLYPH[verdict.level].padEnd(6)} ${verdict.check.padEnd(10)} ${verdict.detail}`;
  if (verdict.level === "pass") return head;
  const lines = [head];
  if (verdict.pointer !== undefined) lines.push(`         at       ${verdict.pointer}`);
  if (verdict.expected !== undefined) lines.push(`         expected ${verdict.expected}`);
  if (verdict.level === "refuse") lines.push(`         code     ${verdict.code}`);
  return lines.join("\n");
}

/** The agent register: one JSON object per line, no framing, no colour. */
export function formatJson(verdict: Verdict): string {
  return JSON.stringify(verdict);
}

export interface Emitter {
  emit(verdict: Verdict): void;
}

export function createEmitter(opts: {
  json: boolean;
  write: (line: string) => void;
}): Emitter & { verdicts: Verdict[] } {
  const verdicts: Verdict[] = [];
  return {
    verdicts,
    emit(verdict: Verdict): void {
      verdicts.push(verdict);
      opts.write(opts.json ? formatJson(verdict) : formatHuman(verdict));
    },
  };
}
