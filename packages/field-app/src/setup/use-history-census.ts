import { AgentCatalogResult } from "@vibefield/contracts/agent-catalog";
import { IndexDiscoveriesResult } from "@vibefield/contracts/agent-index";
import type { FielddClient } from "@vibefield/fieldd-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type HistoryAgentRow, historyAgentRows } from "./history-consent";

// The census behind the History pane (track AO, AO-3): which agents have
// history on this Mac (`index.discoveries` — sizes, never content), labelled by
// the agent catalog. The index answers only once its daemon is up, so a first
// run asks again while it starts, for a bounded while, and then says so in a
// person's words (the record's §4 states: "Looking for past sessions…", then
// "History isn't available right now.").

export type HistoryCensus =
  /** the census has not answered yet */
  | { readonly kind: "looking" }
  /** History could not start in time; the pane says so and moves on */
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "found";
      readonly rows: readonly HistoryAgentRow[];
      /** every kind the record already consents to, listed or not — Bring in
       * history sends the COMPLETE set, so none is revoked by omission */
      readonly consented: readonly string[];
    };

const ASK_EVERY_MS = 1_000;
const GIVE_UP_MS = 15_000;

export function useHistoryCensus(client: FielddClient): {
  census: HistoryCensus;
  /** Look again: the census asked afresh (an agent installed since) */
  lookAgain: () => void;
} {
  const [census, setCensus] = useState<HistoryCensus>({ kind: "looking" });
  const stop = useRef<(() => void) | null>(null);
  const start = useCallback((): void => {
    stop.current?.();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const ask = async (): Promise<void> => {
      try {
        const [catalog, found] = await Promise.all([
          client.request("agent.catalog", {}).then((answer) => AgentCatalogResult.parse(answer)),
          client
            .request("index.discoveries", {})
            .then((answer) => IndexDiscoveriesResult.parse(answer)),
        ]);
        if (stopped) return;
        // The rows that offer history (a declined row never leaves fieldd), in
        // the catalog's order: `index.enroll` refuses any other kind.
        const labels = new Map(
          catalog.catalog
            .filter((row) => row.offers.history === true)
            .map((row) => [row.id, row.label] as const),
        );
        setCensus({
          kind: "found",
          rows: historyAgentRows(found.discoveries, labels),
          consented: found.discoveries.filter((row) => row.consented).map((row) => row.kind),
        });
      } catch {
        if (stopped) return;
        if (Date.now() - startedAt >= GIVE_UP_MS) {
          setCensus({ kind: "unavailable" });
          return;
        }
        timer = setTimeout(() => void ask(), ASK_EVERY_MS);
      }
    };
    stop.current = () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    setCensus({ kind: "looking" });
    void ask();
  }, [client]);
  useEffect(() => {
    start();
    return () => stop.current?.();
  }, [start]);
  return { census, lookAgain: start };
}
