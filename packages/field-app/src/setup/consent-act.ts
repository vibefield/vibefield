import { IndexDiscoveriesResult } from "@vibefield/contracts/agent-index";
import type { FielddClient } from "@vibefield/fieldd-client";
import type { HistoryAgentRow } from "./history-consent";
import { agentPastMoment, answerSetupStep, retireSetupMoment } from "./ledger";

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
  /** AO-6b — the agents the pane asked about (catalog ids): none of them is
   * "a new agent with a past" afterwards, whatever its switch said */
  readonly asked?: readonly string[];
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
  // AO-6b (AO-D15) — an agent this pane asked about is never offered again as
  // new: its moment is retired here
  await Promise.all(
    (choice.asked ?? []).map((agent) =>
      retireSetupMoment(client, agentPastMoment(agent)).catch(() => undefined),
    ),
  );
}

/** AO-6b — Bring it in, for the one agent History's head offers: the complete
 * set read afresh (another door — Settings → History — may have changed it since
 * the census), plus its kind; then its moment is retired. */
export async function bringInAgent(
  client: FielddClient,
  row: Pick<HistoryAgentRow, "kind" | "agent">,
): Promise<void> {
  const now = IndexDiscoveriesResult.parse(await client.request("index.discoveries", {}));
  await bringInHistory(client, {
    consented: now.discoveries.filter((found) => found.consented).map((found) => found.kind),
    listed: [row.kind],
    chosen: new Set([row.kind]),
    asked: row.agent === null ? [] : [row.agent],
  });
}

/** Not now: nothing is read, and Finish setting up lists the step. */
export async function bringInLater(client: FielddClient): Promise<void> {
  await answerSetupStep(client, "history", "later");
}
