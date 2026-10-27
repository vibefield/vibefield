import type { FielddClient } from "@vibefield/fieldd-client";
import { answerSetupStep } from "./ledger";

// History's consent act (track AO, AO-3; AO-D3, AO-L5): one `index.enroll` with
// the COMPLETE set — the kinds already brought in that the pane does not list,
// plus every switch the person left on — so the history service restarts once
// and nothing already consented is revoked by omission. The ledger records the
// answer: "answered" whether the set grew or stayed empty (a no is an answer);
// "later" only for Not now, which sends nothing.

export interface ConsentChoice {
  /** every kind the record consents to now, listed or not */
  readonly consented: readonly string[];
  /** the kinds the pane lists */
  readonly listed: readonly string[];
  /** the listed kinds whose switch is on */
  readonly chosen: ReadonlySet<string>;
}

/** The complete set Bring in history sends. */
export function enrollmentFor(choice: ConsentChoice): string[] {
  const listed = new Set(choice.listed);
  const kept = choice.consented.filter((kind) => !listed.has(kind));
  return [...new Set([...kept, ...choice.listed.filter((kind) => choice.chosen.has(kind))])].sort();
}

/** Bring in history (or Continue without it, every switch off): the set, then
 * the ledger's answer. A refused enroll throws to the pane, which says it. */
export async function bringInHistory(client: FielddClient, choice: ConsentChoice): Promise<void> {
  await client.request("index.enroll", { kinds: enrollmentFor(choice) });
  await answerSetupStep(client, "history", "answered").catch(() => undefined);
}

/** Not now: nothing is read, and Finish setting up lists the step. */
export async function bringInLater(client: FielddClient): Promise<void> {
  await answerSetupStep(client, "history", "later");
}
