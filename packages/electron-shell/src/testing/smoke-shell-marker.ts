// smoke:godview's SHELL MARKERS AND THE ROUTED INPUT GATE, the parts a test can hold. A row that types a line into a routed
// pane proves the shell ran it by a marker file the line writes; it found its first form in the line's send rung (11h; One
// Frame FR-2), which ended six times (2026-10-03 … 10-11) as "the routed pane did not create /tmp/fr2….txt" with nothing
// said of which input never reached the shell — the pane's routed input was closed when an input went out, and ghosttea
// drops input silently while it is. The send left with the line's draft (LN-D3), and its rung was re-aimed at the road
// that replaced it (R-T 2): a CARD played onto the pane (HN-4) — pasted, Return never pressed — through the hand's lab door
// (`__vfCards.playInto`). What lives here: the wait's failure, which tells "never created" from "created empty"; a
// session's input gate, read off the deck's own direct-terminal markers, which the rows that type into a pane wait on;
// and the play's judge and its ONE line of evidence, printed when the rung fails.

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

/** What the hand's lab door answered a play (`__vfCards.playInto`; field-app frame/cards/cards-lab.ts `CardsLabPlay`). */
export interface CardPlaySeen {
  /** where the card was let go — the pane's centre, window px */
  readonly at: { readonly x: number; readonly y: number } | null;
  /** the place on top there, by its kind */
  readonly target: string | null;
  /** what that place said to the card before it was let go */
  readonly answer: { readonly ok: boolean; readonly label: string } | null;
  /** the play's outcome, as the line said it */
  readonly played: { readonly ok: boolean; readonly note: string } | null;
  /** why nothing was played */
  readonly refused: string | null;
}

/** Why a play did not paste into the pane, in words — none when it did: the place on top at the pane's centre was the
 * deck's panes, it answered the card, and the play said "Pasted into …". */
export function judgeCardPlay(play: CardPlaySeen | null): string[] {
  if (play === null) return ["the hand's lab door answered nothing"];
  if (play.played === null) return [`nothing was played: ${play.refused ?? "no reason was said"}`];
  const problems: string[] = [];
  if (play.target !== "pane")
    problems.push(`the place that took the card is ${play.target}, not a pane`);
  if (!play.played.ok || !play.played.note.startsWith("Pasted into "))
    problems.push(`the play said ${JSON.stringify(play.played.note)}`);
  return problems;
}

/** What the play rung saw as it went. Null is "not reached", or no marker named the session when it was sampled. */
export interface CardPlayEvidence {
  /** the floor session played into — the deck's active pane's */
  readonly session: string;
  /** the file the played line writes once the shell runs it */
  readonly path: string;
  /** the session's `inputAllowed`, by its latest marker, sampled just before the play and before the pane's Return */
  readonly inputAllowed: { play: boolean | null; Return: boolean | null };
  /** what the lab door answered the play */
  play: CardPlaySeen | null;
  /** how long the wait for the pane's input before its Return took */
  readonly waitedMs: { inputBeforeReturn: number | null };
}

export function newCardPlayEvidence(session: string, path: string): CardPlayEvidence {
  return {
    session,
    path,
    inputAllowed: { play: null, Return: null },
    play: null,
    waitedMs: { inputBeforeReturn: null },
  };
}

/** The evidence line's prefix in the smoke's log. */
export const CARD_PLAY_EVIDENCE = "SMOKE_GODVIEW_CARD_PLAY ";

/** The one line: why the rung failed, the file, the two samples, the play's answer, the wait, and the gate as it is now. */
export function cardPlayEvidenceLine(
  evidence: CardPlayEvidence,
  cause: unknown,
  file: MarkerFile | null,
  gateNow: RoutedGateFacts | null,
): string {
  return `${CARD_PLAY_EVIDENCE}${JSON.stringify({
    failed: cause instanceof Error ? cause.message : String(cause),
    session: evidence.session,
    file: file === null ? null : { path: evidence.path, ...file },
    inputAllowed: evidence.inputAllowed,
    play: evidence.play,
    waitedMs: evidence.waitedMs,
    gateNow,
  })}`;
}
