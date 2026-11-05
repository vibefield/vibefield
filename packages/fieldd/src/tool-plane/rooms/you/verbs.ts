import type {
  ComposeAskUserInput,
  ComposeAskUserOutput,
  ComposeNotifyInput,
  ComposeNotifyOutput,
  NeedsFrom,
  SparkId,
} from "@vibefield/contracts";
import { RpcCallError } from "../../../native-link";
import type { NeedsQueue } from "./queue";

// CP-3 — the you room (`draft/compose-plane/cp3-the-person.md`, ruled 2026-10-31; MT-D11): reaching the person. A
// spark asks with `ask_user`, which returns at once with the item its question waits in; the answer is a wake through
// its own input queue (CP3-D2 A, CP-L5). Every agent tells with `notify`, said on every window's status line and, while
// no window is in front, as main's OS notice (CP3-D5 A); nothing says the person read it. The needs-you queue
// (queue.ts) is the room's one authority; the plane holds each call to its row first (index.ts, MT-L2).

/** Who a you verb answers: a settled spark, or a settled plain run (notify's audience is every agent). */
export type YouCaller =
  | {
      readonly kind: "spark";
      readonly sparkId: SparkId;
      readonly name: string;
      readonly runtimeRunId: string;
    }
  | { readonly kind: "run"; readonly runtimeRunId: string; readonly name: string };

/** fieldd's own services, as the room needs them (daemon.ts adapts the real ones). */
export interface YouDeps {
  readonly queue: Pick<NeedsQueue, "ask" | "notify">;
  /** a plain run's name, as fieldd names it (daemon's runLabel: its title, else its agent's label in its folder, else
   * that label, else its id) */
  label(runtimeRunId: string): string;
}

export interface YouVerbs {
  ask_user(caller: YouCaller, input: ComposeAskUserInput): Promise<ComposeAskUserOutput>;
  notify(caller: YouCaller, input: ComposeNotifyInput): Promise<ComposeNotifyOutput>;
}

export type YouVerbName = keyof YouVerbs;
export const isYouVerb = (name: string): name is YouVerbName =>
  name === "ask_user" || name === "notify";

/** Run a you verb on input its own schema has already parsed (the one place the union is widened). */
export function runYou(verbs: YouVerbs, name: YouVerbName, caller: YouCaller, input: unknown) {
  return (verbs[name] as (caller: YouCaller, input: unknown) => Promise<unknown>)(caller, input);
}

export function createYouVerbs(deps: YouDeps): YouVerbs {
  return {
    async ask_user(caller, input) {
      // MT-D11: a plain run asks through its harness; the plane refused it at listing, and this holds it again
      if (caller.kind !== "spark")
        throw new RpcCallError("PRECONDITION_FAILED", "ask_user is a spark's", false, {
          fact: "forbidden",
        });
      const item = deps.queue.ask(
        { spark: caller.sparkId, name: caller.name, session: caller.runtimeRunId },
        input,
      );
      return { item, queued: true };
    },

    async notify(caller, input) {
      const from: NeedsFrom =
        caller.kind === "spark"
          ? { name: caller.name, session: caller.runtimeRunId, spark: caller.sparkId }
          : { name: caller.name, session: caller.runtimeRunId };
      deps.queue.notify(from, input.text);
      return { sent: true };
    },
  };
}
