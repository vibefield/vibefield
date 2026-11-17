// Item 489 (2026-11-16) — an agent adapter's own sentence never reaches a
// face (DESIGN.md §9; AR-L1, VibeField knows no vendor's words). Where a read
// failed, the page says VibeField's own sentence, and the adapter's sentence
// comes here: the renderer log, local to the person's machine, cut at 500
// characters. A read a person's act asked for (a press, a picker opened on
// purpose) logs at warn; one that came by itself (a page's opening read, a
// feed's push, a re-read behind an old answer) logs at debug, which the
// renderer log does not keep by default. Item 488's rule, at more sites.

import { getRendererLogger } from "./logging";

/** How much of an adapter's sentence the log keeps. */
export const ADAPTER_WORDS_LOGGED = 500;

/** An adapter's failure as the doors carry it: its own sentence and status. */
export interface AdapterFailure {
  readonly status: string;
  readonly message: string;
  readonly code?: string;
  readonly retryable?: boolean;
}

/** The adapter's sentence, bounded for the log. */
export function adapterWords(words: string): string {
  return words.length <= ADAPTER_WORDS_LOGGED ? words : `${words.slice(0, ADAPTER_WORDS_LOGGED)}…`;
}

/** One failed read to the log: who asked, which agent, and the adapter's own words as `reason`. */
export function logAdapterFailure(
  component: string,
  event: string,
  pressed: boolean,
  failure: AdapterFailure,
  fields: Readonly<Record<string, unknown>>,
): void {
  const log = getRendererLogger().child({ component });
  log[pressed ? "warn" : "debug"](event, "An agent's read came back without an answer", {
    ...fields,
    status: failure.status,
    ...(failure.code !== undefined ? { code: failure.code } : {}),
    ...(failure.retryable !== undefined ? { retryable: failure.retryable } : {}),
    reason: adapterWords(failure.message),
  });
}
