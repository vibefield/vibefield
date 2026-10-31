import { OUTCOME_WORDS } from "../frame/cards/cards-words";
import { claimingRefusals, inputRefusalNote } from "../frame/line-door";
import { PANE_INPUT_WAIT_MS } from "../godview/pane-card-target";
import { getRendererLogger } from "../logging";
import { hearTerminalInputRefusals, type RoutedInputRefusal } from "../terminal/pool";
import { SPARK_WAKE_WAIT_MS, type SparkPaneReport } from "./thread-pane-door";

// SEND, INTO THE THREAD'S PANE (SP-1d; DESIGN.md §8 "Chat's composer": Send, a message wakes it, while the spark waits
// on you, when the paste is not taken). Send pastes the message into the spark's own pane by the road ⌘V takes —
// bracketed when its program asked for it, Return never pressed (HN's line road; "Return is James's"). Nothing new
// rides a wire: the bytes go by the mounted pane's routed input (EL2). Every effect comes through `deps`, so the
// order and the outcome are pinned without a window, and the note is said once (HN-L5): the refusal hearer runs only
// around the paste, which claims what it hears.

/** What one Send came to, as its note says it. */
export type ThreadSendOutcome =
  | { readonly state: "pasted" }
  /** Asking you, Needs your OK or Stuck: a menu in the pane would read a paste as its answer */
  | { readonly state: "waiting-on-you" }
  /** its input did not open within 1.5 s, the pane's handler did not take the paste, or a spark that is awake was not
   * heard in the 20 s */
  | { readonly state: "not-taking" }
  /** main no longer keeps a still a card's path names */
  | { readonly state: "still-gone" }
  /** D6: its terminal refused the paste for its size */
  | { readonly state: "too-large"; readonly refusal: RoutedInputRefusal }
  /** a spark this send woke was not heard in the 20 s */
  | { readonly state: "no-wake" }
  /** the floor holds no such terminal, or none was named in the 20 s */
  | { readonly state: "off-floor" }
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
  /** the spark waits on the person, as the feed reads it now (asked before the wake and again before the paste) */
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
    // only a spark this send woke can be said not to have woken
    if (!(await deps.heard(left()))) return { state: "no-wake" };
  }
  const report = await deps.pane(left());
  if (report === null || report.door === null) {
    if (report?.state === "fault") return { state: "fault", reason: report.reason };
    if (report?.state === "no-terminals") return { state: "no-terminals" };
    // not on the floor; or still being found, or never mounted, when the 20 s ran out: not named in them
    return { state: "off-floor" };
  }
  // nothing is pasted into a spark before it is heard (R-4): just hatched, its program may not have asked for bracketed
  // paste yet, and a line break inside the message would read as Return. A woken spark was heard above; one awake but
  // not heard in the 20 s is not taking input — never "didn't wake", which is said only of a spark this send woke.
  if (!(await deps.heard(left()))) return { state: "not-taking" };
  const door = report.door;
  if (deps.needsYou()) return { state: "waiting-on-you" };
  if (!(await door.whenInputOpen(PANE_INPUT_WAIT_MS))) return { state: "not-taking" };
  // D6 — a paste too large for the terminal is refused INSIDE the call: heard here, it is this send's outcome, and
  // the line's hearer leaves it to it (claimed: said once, HN-L5)
  const heard: { refusal: RoutedInputRefusal | null } = { refusal: null };
  const stop = (deps.inputRefusals ?? hearTerminalInputRefusals)((refusal) => {
    heard.refusal = refusal;
  });
  let took = false;
  try {
    took = claimingRefusals(() => door.paste(text));
  } finally {
    stop();
  }
  if (heard.refusal !== null) return { state: "too-large", refusal: heard.refusal };
  return took ? { state: "pasted" } : { state: "not-taking" };
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
