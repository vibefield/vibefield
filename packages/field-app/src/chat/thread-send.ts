import { OUTCOME_WORDS } from "../frame/cards/cards-words";
import { claimingRefusals, inputRefusalNote } from "../frame/line-door";
import { PANE_INPUT_WAIT_MS } from "../godview/pane-card-target";
import { getRendererLogger } from "../logging";
import { hearTerminalInputRefusals, type RoutedInputRefusal } from "../terminal/pool";
import { SPARKS_UNREADABLE, type SparksReading } from "./sparks-feed";
import {
  SPARK_WAKE_WAIT_MS,
  type SparkPaneDoor,
  type SparkPaneReport,
  type SparkPaste,
} from "./thread-pane-door";

// SEND, INTO THE THREAD'S PANE (SP-1d; DESIGN.md §8 "Chat's composer": Send, a message wakes it, while the spark waits
// on you, when the paste is not taken). Send pastes the message into the spark's own pane by the road ⌘V takes —
// bracketed when its program asked for it, Return never pressed (HN's line road; "Return is James's"). Nothing new
// rides a wire: the bytes go by the mounted pane's routed input (EL2). Every effect comes through `deps`, so the
// order and the outcome are pinned without a window, and the note is said once (HN-L5): the refusal hearer runs only
// around the paste, which claims what it hears. Where it cannot go on, it says why as Chat stands then, read again to
// the paste: never as it stood at the press.

/** What one Send came to, as its note says it. */
export type ThreadSendOutcome =
  | { readonly state: "pasted" }
  /** Asking you, Needs your OK or Stuck: a menu in the pane would read a paste as its answer */
  | { readonly state: "waiting-on-you" }
  /** its input did not open within 1.5 s, the pane's handler did not take the paste, or a spark that is awake was not
   * heard in the 20 s — Chat reading its list, the spark awake and its pane still drawn, then */
  | { readonly state: "not-taking" }
  /** main no longer keeps a still a card's path names */
  | { readonly state: "still-gone" }
  /** D6: its terminal refused the paste for its size */
  | { readonly state: "too-large"; readonly refusal: RoutedInputRefusal }
  /** a spark this send woke was not heard in the 20 s */
  | { readonly state: "no-wake" }
  /** the floor holds no such terminal, or none was named in the 20 s — its thread on screen with its pane not drawn
   * yet when they ran out is a pane still being found */
  | { readonly state: "off-floor" }
  /** no pane of its thread had settled when the 20 s ran out, or the pane found was no longer drawn when a wait ended
   * or at the paste, and its thread was not on screen then: Chat was left, or another thread chosen, while the send
   * waited — and a pane is found only while its thread is shown */
  | { readonly state: "thread-left" }
  /** the spark read asleep where the send could not go on (no pane at the 20 s or at the paste, not heard, its input
   * closed): it fell asleep while the send waited, and an asleep thread draws no pane */
  | { readonly state: "fell-asleep" }
  /** Chat's list was not read where the send could not go on, said as the list stands: opening again (its feed
   * started again, as fieldd restarts) or unreadable (its list refused). No thread is drawn and no spark is heard then,
   * so why cannot be told */
  | { readonly state: "sparks-unread"; readonly reading: Exclude<SparksReading["state"], "ready"> }
  /** the floor did not answer, or this window's terminals could not start, in their own words */
  | { readonly state: "fault"; readonly reason: string }
  /** a window with no terminals (the catalog, a browser) */
  | { readonly state: "no-terminals" }
  /** fieldd refused the wake, in its own words */
  | { readonly state: "wake-refused"; readonly reason: string }
  /** a step threw (main's still door, the pane's paste), in its own words: a send that breaks is never a blank */
  | { readonly state: "failed"; readonly reason: string };

/** The world one Send reaches, lent by Chat's controller (`ChatView`). */
export interface ThreadSendDeps {
  /** this window holds a terminal pool (`terminalPoolConfigured`); without one there is no pane to paste into */
  readonly terminals: boolean;
  /** the spark waits on the person, as the feed reads it now (asked as Send starts, and again after the last wait,
   * just before the paste) */
  needsYou(): boolean;
  /** asleep, or not started: Send wakes it first */
  readonly needsWake: boolean;
  /** the feed's one wake (`SparkOpener`): throws its refusal in fieldd's words */
  wake(): Promise<void>;
  /** true once the spark is heard (its status neither Hello nor Asleep; at once for one heard already), false after
   * `timeoutMs`. Every paste waits for it, the woken spark's and the awake one's alike. */
  heard(timeoutMs: number): Promise<boolean>;
  /** the thread's pane once it has settled, else how it stands after `timeoutMs` (`whenSparkPane`) */
  pane(timeoutMs: number): Promise<SparkPaneReport | null>;
  /** the spark reads Asleep now, as the feed reads it (asked where the send cannot go on): its thread draws no pane
   * while it is */
  asleep(): boolean;
  /** its thread is on screen now, the one Chat shows while Chat is the view (asked when no pane of it is drawn): a pane
   * is drawn, and found, only while it is */
  onScreen(): boolean;
  /** how the thread's pane stands now (`sparkPaneOf`), read again after each wait once its pane was found, and at the
   * paste: a pane drawn again for the thread meanwhile is the one pasted into */
  paneNow(): SparkPaneReport | null;
  /** how Chat's list stands now, as its panel draws it (asked where the send cannot go on): while it is not read, no
   * thread is drawn and no spark is heard */
  sparksReading(): SparksReading["state"];
  /** main still keeps this snapshot's still (`screenshotStillKept`; a host with no still door keeps none to lose) */
  stillKept(path: string): Promise<boolean>;
  /** D6 — where a paste the terminal refused is heard (undefined: the window's terminal pool) */
  inputRefusals?: ((hear: (refusal: RoutedInputRefusal) => void) => () => void) | undefined;
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Send `text` into the spark's own pane. `stills`: the snapshot stills the message's cards name (`draftStills`).
 * Never rejects: a step that throws is the send's outcome, in its own words. */
export async function sendToThread(
  deps: ThreadSendDeps,
  text: string,
  stills: readonly string[],
): Promise<ThreadSendOutcome> {
  try {
    return await sendSteps(deps, text, stills);
  } catch (error) {
    getRendererLogger()
      .child({ component: "chat" })
      .error("renderer.chat.send_failed", "A step of Chat's send threw", error);
    return { state: "failed", reason: reasonOf(error) };
  }
}

async function sendSteps(
  deps: ThreadSendDeps,
  text: string,
  stills: readonly string[],
): Promise<ThreadSendOutcome> {
  if (!deps.terminals) return { state: "no-terminals" };
  if (deps.needsYou()) return { state: "waiting-on-you" };
  for (const still of stills) {
    if (!(await deps.stillKept(still))) return { state: "still-gone" };
  }
  // one 20 s for the spark to be heard and its pane to appear (DESIGN.md: "waits up to 20 s … then up to 1.5 s")
  const deadline = Date.now() + SPARK_WAKE_WAIT_MS;
  const left = (): number => Math.max(0, deadline - Date.now());
  if (deps.needsWake) {
    try {
      await deps.wake();
    } catch (error) {
      return { state: "wake-refused", reason: reasonOf(error) };
    }
    // only a spark this send woke can be said not to have woken, and only while Chat reads its list
    if (!(await deps.heard(left()))) return listUnread(deps) ?? { state: "no-wake" };
  }
  const report = await deps.pane(left());
  if (report === null || report.door === null) return paneless(deps, report);
  // nothing is pasted into a spark before it is heard (R-4): just hatched, its program may not have asked for bracketed
  // paste yet, and a line break inside the message would read as Return. A woken spark was heard above; one awake but
  // not heard in the 20 s is not taking input — never "didn't wake", which is said only of a spark this send woke.
  const heard = await deps.heard(left());
  // the pane, read again once that wait ends: its thread may have been left, or left and shown again, meanwhile
  const reached = await paneAfterWait(deps, report.door, left);
  if (reached.door === null) return reached.outcome;
  if (!heard) return unreached(deps) ?? { state: "not-taking" };
  return pasteOnceOpen(deps, reached.door, text, left);
}

/** A pane to paste into, or why there is none. */
type PaneReach =
  | { readonly door: SparkPaneDoor }
  | { readonly door: null; readonly outcome: ThreadSendOutcome };

/** The pane a paste goes to once a wait ends, as its thread stands then (DESIGN.md §8 "Chat's composer": a thread left
 * and shown again is pasted into), or why there is none. Only a drawn pane is pasted into: the one its thread
 * publishes, else, with none published, the one the send `held` while it is still drawn under another view's cover. A
 * pane its thread is drawing again — being found, or not published yet while the thread is on screen — is waited for
 * in what is left of the 20 s, so a pane still being found is never said to be off the floor before they end. Else
 * why, as no pane at the 20 s is said (`paneless`). */
async function paneAfterWait(
  deps: ThreadSendDeps,
  held: SparkPaneDoor,
  left: () => number,
): Promise<PaneReach> {
  let now = deps.paneNow();
  if (now === null ? !held.drawn() && deps.onScreen() : now.state === "finding") {
    now = await deps.pane(left());
  }
  const door = now === null ? held : now.door;
  if (door?.drawn() === true) return { door };
  // a place published says its own words; none, or a pane published but no longer drawn (going), is no pane
  return { door: null, outcome: paneless(deps, now?.door === null ? now : null) };
}

/** Paste into the thread's pane once its input opens (up to 1.5 s), the pane read again after that wait and at the
 * paste: a pane drawn again meanwhile has its own input waited for, and is the one pasted into; one no longer drawn
 * says why (`paneAfterWait`). */
async function pasteOnceOpen(
  deps: ThreadSendDeps,
  found: SparkPaneDoor,
  text: string,
  left: () => number,
): Promise<ThreadSendOutcome> {
  let door = found;
  let open = await door.whenInputOpen(PANE_INPUT_WAIT_MS);
  for (;;) {
    const now = await paneAfterWait(deps, door, left);
    if (now.door === null) return now.outcome;
    if (now.door !== door) {
      door = now.door;
      open = await door.whenInputOpen(PANE_INPUT_WAIT_MS);
      continue;
    }
    if (!open) return unreached(deps) ?? { state: "not-taking" };
    // read again after the last wait, just before the paste: a woken or just-started agent puts up its first menu (a
    // trust or permission ask) as its input opens, and a menu reads pasted characters as its choices
    if (deps.needsYou()) return { state: "waiting-on-you" };
    const took = pasteInto(deps, door, text);
    // no longer drawn as the paste was asked: read again, never into this door (`paneAfterWait` takes a drawn one)
    if (took !== "undrawn") return took;
  }
}

/** The paste itself. D6 — a paste too large for the terminal is refused INSIDE the call: heard here, it is this send's
 * outcome, and the line's hearer leaves it to it (claimed: said once, HN-L5). */
function pasteInto(
  deps: ThreadSendDeps,
  door: SparkPaneDoor,
  text: string,
): ThreadSendOutcome | "undrawn" {
  const heard: { refusal: RoutedInputRefusal | null } = { refusal: null };
  const stop = (deps.inputRefusals ?? hearTerminalInputRefusals)((refusal) => {
    heard.refusal = refusal;
  });
  let took: SparkPaste;
  try {
    took = claimingRefusals(() => door.paste(text));
  } finally {
    stop();
  }
  if (heard.refusal !== null) return { state: "too-large", refusal: heard.refusal };
  if (took === "undrawn") return took;
  return took === "pasted" ? { state: "pasted" } : { state: "not-taking" };
}

/** Chat's list not read now, said as it stands — else null. */
function listUnread(deps: ThreadSendDeps): ThreadSendOutcome | null {
  const reading = deps.sparksReading();
  return reading === "ready" ? null : { state: "sparks-unread", reading };
}

/** Why the spark cannot be reached, as Chat reads it now: its list unread, or the spark asleep — else null. */
function unreached(deps: ThreadSendDeps): ThreadSendOutcome | null {
  return listUnread(deps) ?? (deps.asleep() ? { state: "fell-asleep" } : null);
}

/** No pane of the thread to paste into, at the 20 s or once a wait ends, said as the window stands then. Where the
 * thread draws a place, its words: a fault, no terminals, or not on the floor (still being found when the time ran
 * out is not named in it). Where it draws none: Chat's list unread, the spark asleep, or the person left the thread (a
 * pane is found only while it is shown); the thread still on screen, its pane is not drawn yet (a spark heard just as
 * the 20 s end), which is a pane still being found. */
function paneless(
  deps: ThreadSendDeps,
  place: Extract<SparkPaneReport, { readonly door: null }> | null,
): ThreadSendOutcome {
  if (place !== null) {
    if (place.state === "fault") return { state: "fault", reason: place.reason };
    if (place.state === "no-terminals") return { state: "no-terminals" };
    return { state: "off-floor" };
  }
  return unreached(deps) ?? (deps.onScreen() ? { state: "off-floor" } : { state: "thread-left" });
}

/** What the line's note says of a send (DESIGN.md §8 "Chat's composer", §9 "Chat's words"): in the hand's words where
 * the outcome is the hand's own, so one outcome is never said two ways. */
export function sendNote(outcome: ThreadSendOutcome, name: string): string {
  const pane = `${name}'s pane`;
  switch (outcome.state) {
    case "pasted":
      return `${OUTCOME_WORDS.pasted(pane)} — Return sends it`;
    case "waiting-on-you":
      return `${name} is waiting on you — answer it in its pane`;
    case "not-taking":
      return OUTCOME_WORDS.notTaking(name);
    case "still-gone":
      return OUTCOME_WORDS.pasteGone;
    case "too-large":
      return inputRefusalNote(outcome.refusal, pane);
    case "no-wake":
      return `Not sent — ${name} didn't wake in 20 seconds`;
    case "off-floor":
      return `Not sent — ${name}'s terminal is not on this desktop's floor`;
    case "thread-left":
      return `Not sent — you left ${name}'s thread before its pane was ready`;
    case "fell-asleep":
      return `Not sent — ${name} fell asleep before its pane was ready`;
    case "sparks-unread":
      return outcome.reading === "opening"
        ? "Not sent — Chat is opening again"
        : `Not sent — ${SPARKS_UNREADABLE}`;
    case "fault":
      return `Couldn't find ${pane}: ${outcome.reason}`;
    case "no-terminals":
      return "Not sent — this window has no terminals";
    case "wake-refused":
      return `Couldn't wake ${name}: ${outcome.reason}`;
    case "failed":
      return `Couldn't send to ${name}: ${outcome.reason}`;
  }
}
