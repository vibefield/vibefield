import type { AgentInterruptResult } from "@vibefield/contracts";
import { interruptRefusal } from "../interrupt-refusal";
import { getRendererLogger } from "../logging";
import type { SparkEntry } from "./spark-status";

// THE HEAD'S ACT (TH-2; DESIGN.md §8 "Chat's thread", the head's act; §9 "A Stop's words"; TH-Q3 (b), TH-Q28 (b)).
// One place at the head's end holds the thread's act: Jump to while the spark is awake, Wake while it sleeps, none
// before it started. While the spark's own run works, Pause current turn stands before it: the run's own turn
// cancellation, sent once through `agent.pause`, as Godview's pane sends it. Pause never ends the run, never escalates,
// and is never sent twice for one turn. fieldd answers `accepted` when the cancellation was DELIVERED, never when the
// agent obeyed it, so the head reads what came of it from the board: the row's `stop`, held as sent until fieldd hears
// the turn stop, and marked `unheardAt` when it never does. Chat has no End run: ending a spark's run is its terminal's,
// in Godview. A refused Wake is said in the same place, Wake standing (TH-1, when the line under the head left).

/** The head's own Pause, for the shown spark: in flight, sent (accepted) or refused, each for the turn it was pressed
 * in, so the next turn starts clean. */
export type PauseAct =
  | { readonly state: "idle" }
  | { readonly state: "busy"; readonly turn: string }
  | { readonly state: "sent"; readonly turn: string }
  | { readonly state: "refused"; readonly turn: string; readonly reason: string };

export const NO_PAUSE: PauseAct = { state: "idle" };

/** The status's place when fieldd could not confirm the cancellation (§9 "A Stop's words", without End run). */
export const STILL_RUNNING = "Still running · the cancellation was not confirmed";

export interface HeadAct {
  /** the one place: Jump to awake, Wake asleep, none before the spark started */
  readonly main: "jump" | "wake" | null;
  /** Pause current turn while the spark's own run works: ready, pausing (pressed, or held as sent), or held under a
   * cancellation fieldd could not confirm, when a press would send nothing more */
  readonly pause: "ready" | "pausing" | "held" | null;
  /** what the status's place says instead of the status word, in the attention ink, or null */
  readonly says: string | null;
}

/** The turn Pause would stop: the spark's own run at work while its session runs, by when its status turned working;
 * else null. */
export function turnOf(entry: SparkEntry): string | null {
  const run = entry.run;
  if (!entry.awake || run === null || !run.alive || run.status !== "working") return null;
  return run.statusSince;
}

export function pauseWords(name: string, reason: string): string {
  return `Couldn't pause ${name}'s turn: ${reason}`;
}

export function wakeWords(name: string, reason: string): string {
  return `Couldn't wake ${name}: ${reason}`;
}

/** The head's act for the shown spark, with its own Pause and the reason its Wake was refused, if it was: said in the
 * status's place while it sleeps, Wake standing (TH-1: the line under the head said it until the pane left Chat). */
export function headActOf(
  entry: SparkEntry,
  pause: PauseAct = NO_PAUSE,
  wakeRefused: string | null = null,
): HeadAct {
  const main =
    entry.run === null && entry.spark.session === undefined ? null : entry.awake ? "jump" : "wake";
  const turn = turnOf(entry);
  if (turn === null)
    return {
      main,
      pause: null,
      says:
        main === "wake" && wakeRefused !== null ? wakeWords(entry.spark.name, wakeRefused) : null,
    };
  const stop = entry.run?.stop;
  const holding = stop !== undefined && stop.stage !== "heard";
  if (holding && stop.unheardAt !== undefined) return { main, pause: "held", says: STILL_RUNNING };
  const mine = pause.state !== "idle" && pause.turn === turn ? pause : NO_PAUSE;
  if (holding || mine.state === "busy" || mine.state === "sent")
    return { main, pause: "pausing", says: null };
  return {
    main,
    pause: "ready",
    says: mine.state === "refused" ? pauseWords(entry.spark.name, mine.reason) : null,
  };
}

/** The door Pause rides: `agent.pause` for a run, fieldd's answer parsed (`SparksPort.pause`). */
export type SparkPauser = (runtimeRunId: string) => Promise<AgentInterruptResult>;

export type PauseOutcome =
  | { readonly state: "sent" }
  | { readonly state: "refused"; readonly reason: string };

/** Pause `runtimeRunId`'s current turn, once. Sent is delivered, never obeyed. A refusal is fieldd's word: the floor's
 * (`no-terminal-host`, `not-working`, …), the state fieldd threw (`not-alive`), or the error of a daemon that could
 * not be reached. */
export async function pauseTurn(pauser: SparkPauser, runtimeRunId: string): Promise<PauseOutcome> {
  const log = () => getRendererLogger().child({ component: "chat" });
  try {
    const answer = await pauser(runtimeRunId);
    if (answer.accepted) return { state: "sent" };
    log().info("renderer.chat.pause_refused", "fieldd would not pause this turn", {
      runtimeRunId,
      reason: answer.reason,
    });
    return { state: "refused", reason: answer.reason };
  } catch (cause) {
    const state = interruptRefusal(cause);
    if (state !== undefined) {
      log().info("renderer.chat.pause_refused", "fieldd would not pause this turn", {
        runtimeRunId,
        reason: state,
      });
      return { state: "refused", reason: state };
    }
    log().error("renderer.chat.pause_failed", "Pause could not reach fieldd", cause, {
      runtimeRunId,
    });
    return { state: "refused", reason: cause instanceof Error ? cause.message : String(cause) };
  }
}
