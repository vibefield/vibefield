// smoke:godview's LINE-SEND RUNG (11h; One Frame FR-2), the parts a test can hold. The rung types `b`, a Backspace, a paste
// and a Return into a routed pane, and ended six times (2026-10-03 … 10-11) as "the routed pane did not create
// /tmp/fr2….txt": one of those four inputs never reached the shell, and nothing said which. Two causes fit by reading —
// (A) the pane's routed input was closed when an input went out, and ghosttea drops input silently while it is; (B) the
// Backspace raced the focus move to the line's draft, so the `b` stayed at the prompt. What lives here: the wait's failure,
// which tells "never created" from "created empty"; the aimed session's input gate, read off the deck's own direct-terminal
// markers; and the ONE line of evidence the rung prints when it fails, whose reading is beside its print in smoke.ts.

import { statSync } from "node:fs";

/** A shell marker's file as the disk holds it. */
export type MarkerFile =
  | { readonly exists: false }
  | { readonly exists: true; readonly bytes: number };

export function markerFile(path: string): MarkerFile {
  try {
    return { exists: true, bytes: statSync(path).size };
  } catch {
    return { exists: false };
  }
}

/**
 * What a wait for a shell marker says when it ends without one. The shell creates a redirect's file before it runs the
 * command, so the three states are three different stories: no file — no line with that redirect ever ran (the line, or
 * its Return, never reached the shell); an empty file — such a line ran and its command printed nothing (a stray key
 * before `echo` makes it another command); other bytes — it printed something that is not the marker.
 */
export function shellMarkerFailure(path: string, file: MarkerFile, marker?: string): string {
  if (!file.exists) {
    return `the routed pane did not create ${path}: the file does not exist (the shell ran no line with that redirect)`;
  }
  const wanted = marker === undefined ? "the marker" : `"${marker}"`;
  if (file.bytes === 0) {
    return (
      `the routed pane never wrote ${wanted} to ${path}: the file exists and is empty (0 bytes) — ` +
      "a line with that redirect ran and its command printed nothing"
    );
  }
  return `the routed pane never wrote ${wanted} to ${path}: the file holds ${file.bytes} bytes without it`;
}

/** What a direct-terminal marker says of a session's routed activation (`GODVIEW_DIRECT_TERMINAL`), as far as the gate. */
export interface RoutedGateFacts {
  readonly sessionId: string;
  readonly presentationReady: boolean;
  readonly inputAllowed: boolean;
}

/** The session's own latest marker in the watch's history — never a later one that speaks of another pane. */
export function latestGate<T extends RoutedGateFacts>(
  history: readonly T[],
  sessionId: string,
): T | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const facts = history[index];
    if (facts !== undefined && facts.sessionId === sessionId) return facts;
  }
  return null;
}

/** Whether the renderer would send a key typed into the pane now: the scene is applied and input is admitted. (The cell
 * holds a gate of its own; this is the renderer's reading of it, and what ghosttea drops input by.) */
export function gateOpen(facts: RoutedGateFacts | null): boolean {
  return facts?.presentationReady === true && facts.inputAllowed;
}

/** The four inputs the rung sends the pane, in order: the letter, its Backspace, the line's send (a paste), the Return. */
export type LineSendInput = "b" | "Backspace" | "send" | "Return";

/** What the rung saw as it went. Null is "not reached", or no marker named the session when it was sampled. */
export interface LineSendEvidence {
  /** the floor session the rung types into and aims at — the deck's active pane's */
  readonly session: string;
  /** the file the sent line writes, once the send has begun */
  path: string | null;
  /** the session's `inputAllowed`, by its latest marker, sampled just before each input went out */
  readonly inputAllowed: Record<LineSendInput, boolean | null>;
  /** whether the pane's probe had heard the Backspace before the draft was given focus */
  backspaceHeardBeforeDraft: boolean | null;
  /** how long each of the rung's waits took */
  readonly waitedMs: {
    inputBeforeB: number | null;
    backspaceHeard: number | null;
    inputBeforeReturn: number | null;
  };
}

export function newLineSendEvidence(session: string): LineSendEvidence {
  return {
    session,
    path: null,
    inputAllowed: { b: null, Backspace: null, send: null, Return: null },
    backspaceHeardBeforeDraft: null,
    waitedMs: { inputBeforeB: null, backspaceHeard: null, inputBeforeReturn: null },
  };
}

/** The evidence line's prefix in the smoke's log. */
export const LINE_SEND_EVIDENCE = "SMOKE_GODVIEW_LINE_SEND ";

/** The one line: why the rung failed, the file, the four samples, the Backspace, the waits, and the gate as it is now. */
export function lineSendEvidenceLine(
  evidence: LineSendEvidence,
  cause: unknown,
  file: MarkerFile | null,
  gateNow: RoutedGateFacts | null,
): string {
  return `${LINE_SEND_EVIDENCE}${JSON.stringify({
    failed: cause instanceof Error ? cause.message : String(cause),
    session: evidence.session,
    file: file === null || evidence.path === null ? null : { path: evidence.path, ...file },
    inputAllowed: evidence.inputAllowed,
    backspaceHeardBeforeDraft: evidence.backspaceHeardBeforeDraft,
    waitedMs: evidence.waitedMs,
    gateNow,
  })}`;
}
