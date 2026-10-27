import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { bringInHistory, bringInLater } from "./consent-act";
import { HistoryConsentBody } from "./HistoryConsentView";
import type { HistoryAgentRow } from "./history-consent";
import { HISTORY_WORDS } from "./history-words";
import type { HistoryCensus } from "./use-history-census";

// The History pane's controller (track AO, AO-3; AO-D3, AO-L5): the census's
// rows with their switches — every switch on at first, the pane being the
// consent and nothing read before the button — and its acts. Each host frames
// it: the Setup Assistant's glass, History's consent slot, Finish setting up's
// sheet. `frame` receives the parts and lays them out.

/** How the pane ended: an answer recorded ("answered" — yes or no — or "later",
 * Not now), or the person moved on before the census could ask anything
 * ("skipped": nothing recorded, History asks again when it can). */
export type HistoryPaneEnd = "answered" | "later" | "skipped";

export interface HistoryPaneParts {
  /** the rows and their switches, or the census's state in words */
  readonly body: ReactNode;
  /** "Bring in history"; "Continue without history" with every switch off;
   * "Continue" while there is nothing to choose yet */
  readonly primaryLabel: string;
  readonly primaryBusy: boolean;
  /** the census has rows to choose from */
  readonly choosing: boolean;
  readonly onPrimary: () => void;
  /** Not now — nothing is read, and the step waits under Finish setting up */
  readonly onLater: () => void;
  /** a refusal, in the daemon's words */
  readonly error: string | null;
}

const NO_ROWS: readonly HistoryAgentRow[] = [];

export function HistoryConsentPane({
  census,
  onDone,
  frame,
  now = Date.now(),
}: {
  census: HistoryCensus;
  onDone: (end: HistoryPaneEnd) => void;
  frame: (parts: HistoryPaneParts) => ReactElement;
  now?: number;
}): ReactElement {
  const client = useFielddClient();
  const rows = census.kind === "found" ? census.rows : NO_ROWS;
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(rows.map((row) => row.kind)),
  );
  // Every switch starts on (AO-D3) — again whenever the census answers anew
  // (Look again), never on an ordinary render.
  useEffect(() => {
    if (census.kind === "found") setChosen(new Set(census.rows.map((row) => row.kind)));
  }, [census]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choosing = census.kind === "found" && rows.length > 0;
  const primaryLabel = !choosing
    ? "Continue"
    : chosen.size === 0
      ? HISTORY_WORDS.without
      : HISTORY_WORDS.bringIn;

  const body: ReactNode = (
    <HistoryConsentBody
      census={census}
      chosen={chosen}
      now={now}
      disabled={busy}
      onToggle={(kind, on) =>
        setChosen((previous) => {
          const next = new Set(previous);
          if (on) next.add(kind);
          else next.delete(kind);
          return next;
        })
      }
    />
  );

  return frame({
    body,
    primaryLabel,
    primaryBusy: busy,
    choosing,
    error,
    onPrimary: () => {
      if (census.kind !== "found") {
        onDone("skipped");
        return;
      }
      setBusy(true);
      setError(null);
      bringInHistory(client, {
        consented: census.consented,
        listed: rows.map((row) => row.kind),
        chosen,
      }).then(
        () => onDone("answered"),
        (cause: unknown) => {
          setBusy(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    },
    onLater: () => {
      bringInLater(client).catch(() => undefined);
      onDone("later");
    },
  });
}
