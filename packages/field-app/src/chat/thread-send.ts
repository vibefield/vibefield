import {
  COMPOSE_TEXT_MAX,
  type ComposeSparksSayResult,
  type ObjectRef,
  type ObjectsHandResult,
} from "@vibefield/contracts";
import { HAND_OVER_WORDS } from "../frame/cards/hand-over";
import { getRendererLogger } from "../logging";
import { askAgain } from "../reconnect";
import type { DraftMessage, SendCarried } from "./composer-draft";

// SEND, QUEUED (TH-1; DESIGN.md §8 "Chat's composer": Send, a message wakes it, each send once, when the send is not
// taken). Send queues the message to the spark's input as yours through `compose.sparks.say` (IOS-12a's door), its
// chips as spans of its words: nothing is pasted and nothing waits on a pane, and fieldd submits it at the spark's
// next idle moment, one input at a time (CP2-D2), so a menu in its terminal never reads it as an answer. An asleep or
// unstarted spark is woken first through the feed's one wake, so a refusal is said in the wake's words. Each send
// carries its own request id: a say whose answer was lost (the socket closed under it) is asked once more with that
// id, which reads the first one's receipt instead of queueing the words twice. Every effect comes through `deps`, so
// the order and the outcome are pinned without a window.
// *Amended 2026-11-05 (TH-1; ER-C10–C12):* Send pasted the message into the thread's pane by ⌘V's road, waiting up to
// 20 s for the spark to be heard and its pane to appear and 1.5 s for its input, and pasted nothing while its own run
// waited on you in its pane. That road is in git.

/** What one Send came to. */
export type ThreadSendOutcome =
  /** fieldd queued it: the receipt says the rest, under its bubble */
  | { readonly state: "queued"; readonly receipt: ComposeSparksSayResult }
  /** longer than the door takes (COMPOSE_TEXT_MAX, TH-Q34 (a)) */
  | { readonly state: "too-large" }
  /** main no longer keeps a still a card's path names */
  | { readonly state: "still-gone" }
  /** a picture or file written at the play that the hand no longer keeps (OB-D10 A) */
  | { readonly state: "file-gone" }
  /** fieldd would not hand a Live chip's object to the spark, in its own words (OB-L1) */
  | { readonly state: "not-handed"; readonly reason: string }
  /** fieldd refused the wake, in its own words */
  | { readonly state: "wake-refused"; readonly reason: string }
  /** fieldd refused the say, or a step threw, in its own words: a send that breaks is never a blank */
  | { readonly state: "failed"; readonly reason: string };

/** What the say asks of fieldd, besides the spark. */
export interface SayAsk {
  readonly text: string;
  readonly chips: DraftMessage["chips"];
  readonly requestId: string;
}

/** The world one Send reaches, lent by Chat's controller (`ChatView`). */
export interface ThreadSendDeps {
  /** asleep, or not started: Send wakes it first */
  readonly needsWake: boolean;
  /** the feed's one wake (`SparkOpener`): throws its refusal in fieldd's words */
  wake(): Promise<void>;
  /** `compose.sparks.say` for the thread's spark: the receipt, or fieldd's refusal thrown (`retryable` when the
   * connection closed under it) */
  say(ask: SayAsk): Promise<ComposeSparksSayResult>;
  /** main still keeps this snapshot's still (`screenshotStillKept`; a host with no still door keeps none to lose) */
  stillKept(path: string): Promise<boolean>;
  /** main still keeps this file written at the play (absent: nothing to lose) */
  handFileKept?(path: string): Promise<boolean>;
  /** grant the spark this object: called after any wake, so a spark with no session yet has one (OB-L1) */
  hand?(ref: ObjectRef): Promise<ObjectsHandResult>;
  /** the message passed the window's own checks and goes to fieldd now: the controller stands its bubble */
  sending?(requestId: string): void;
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A fresh request id for one send (`ComposeSayRequestId`: 8 to 64 of letters, digits, `_` and `-`). */
export function sayRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `say-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

const NOTHING_CARRIED: SendCarried = { refs: [], files: [] };

/** The grant to a spark, its run read only when it is needed: after the wake, a spark with no session has one. */
export function handToSpark(
  runNow: () => Promise<string | undefined>,
  handOver: (ref: ObjectRef, run: string) => Promise<ObjectsHandResult>,
): (ref: ObjectRef) => Promise<ObjectsHandResult> {
  return async (ref) => {
    const run = await runNow();
    return run === undefined
      ? { handed: false, reason: HAND_OVER_WORDS.noRun }
      : handOver(ref, run);
  };
}

/** Send `message` to the thread's spark. `stills`: the snapshot stills its cards name (`draftStills`). Never rejects:
 * a step that throws is the send's outcome, in its own words. */
export async function sendToThread(
  deps: ThreadSendDeps,
  message: DraftMessage,
  stills: readonly string[],
  requestId: string = sayRequestId(),
  carried: SendCarried = NOTHING_CARRIED,
): Promise<ThreadSendOutcome> {
  try {
    return await sendSteps(deps, message, stills, requestId, carried);
  } catch (error) {
    getRendererLogger()
      .child({ component: "chat" })
      .error("renderer.chat.send_failed", "A step of Chat's send threw", error);
    return { state: "failed", reason: reasonOf(error) };
  }
}

async function sendSteps(
  deps: ThreadSendDeps,
  message: DraftMessage,
  stills: readonly string[],
  requestId: string,
  carried: SendCarried,
): Promise<ThreadSendOutcome> {
  if (message.text.length > COMPOSE_TEXT_MAX) return { state: "too-large" };
  for (const still of stills) {
    if (!(await deps.stillKept(still))) return { state: "still-gone" };
  }
  for (const file of carried.files) {
    if (deps.handFileKept !== undefined && !(await deps.handFileKept(file))) {
      return { state: "file-gone" };
    }
  }
  deps.sending?.(requestId);
  if (deps.needsWake) {
    try {
      await deps.wake();
    } catch (error) {
      return { state: "wake-refused", reason: reasonOf(error) };
    }
  }
  // the grants, once the spark has a session to hold them (§4.3, OB-L1): a refused one stops the send
  for (const ref of carried.refs) {
    const handed: ObjectsHandResult = await (deps.hand?.(ref) ??
      Promise.resolve({ handed: false as const, reason: HAND_OVER_WORDS.noDoor }));
    if (!handed.handed) return { state: "not-handed", reason: handed.reason };
  }
  const ask: SayAsk = { text: message.text, chips: message.chips, requestId };
  try {
    return { state: "queued", receipt: await deps.say(ask) };
  } catch (error) {
    // its answer lost with the connection: asked once more by its id, which reads its receipt and never queues twice
    if (!askAgain(error)) return { state: "failed", reason: reasonOf(error) };
    try {
      return { state: "queued", receipt: await deps.say(ask) };
    } catch (again) {
      return { state: "failed", reason: reasonOf(again) };
    }
  }
}

/** What the line's note says of a send (DESIGN.md §8 "Chat's composer", §9 "Chat's words"): nothing once it is queued,
 * since its bubble and its receipt say it; else why it was not taken. */
export function sendNote(outcome: ThreadSendOutcome, name: string): string | null {
  switch (outcome.state) {
    case "queued":
      return null;
    case "too-large":
      return "Not sent — a message holds 32,000 characters at most";
    case "still-gone":
      return "Not sent — that snapshot is no longer kept";
    case "file-gone":
      return "Not sent — that picture's file is no longer kept";
    case "not-handed":
      return outcome.reason;
    case "wake-refused":
      return `Couldn't wake ${name}: ${outcome.reason}`;
    case "failed":
      return `Couldn't send to ${name}: ${outcome.reason}`;
  }
}
