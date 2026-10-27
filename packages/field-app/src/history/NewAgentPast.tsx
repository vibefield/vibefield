import { UiButton } from "@vibefield/design-kit/primitives";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import { type ReactElement, useState } from "react";
import { formatBytes } from "../format/bytes";
import { bringInAgent } from "../setup/consent-act";
import { lastUsedWords } from "../setup/HistoryConsentView";
import type { HistoryAgentRow } from "../setup/history-consent";
import { HISTORY_WORDS } from "../setup/history-words";
import { agentPastMoment, retireSetupMoment, useSetupLedger } from "../setup/ledger";
import { newAgentWithAPast } from "../setup/new-agent-past";
import { useHistoryCensus } from "../setup/use-history-census";
import "./history-new-agent.css";

// A new agent with a past (track AO, AO-6b; AO-D15, ruled (a) by James
// 2026-10-27; DESIGN.md §8 "The moments"): an agent installed after History's
// question was answered, whose folder already holds history, gets one row at
// History's head — once per agent. Bring it in adds it to what History reads;
// Not now retires it for good. Both are kept in the setup ledger, so no window
// asks again. VibeField's, in the frame's act slot over the room.

/** The row itself, controller-free, so the catalog mounts the shipping face. */
export function NewAgentPastCard({
  row,
  now,
  busy = false,
  error = null,
  onBringIn,
  onNotNow,
}: {
  row: HistoryAgentRow;
  now: number;
  busy?: boolean;
  /** a refusal, in the daemon's words */
  error?: string | null;
  onBringIn: () => void;
  onNotNow: () => void;
}): ReactElement {
  const title = HISTORY_WORDS.newAgent(row.label);
  return (
    <section className="vf-history-new-agent" aria-label={title}>
      <span className="vf-history-new-agent-mark" aria-hidden="true">
        {row.agent !== null && <AgentIcon providerId={row.agent} />}
      </span>
      <p className="vf-history-new-agent-words">
        <strong>{title}</strong> {formatBytes(row.bytes)}, last used{" "}
        {lastUsedWords(row.newestModifiedMs, now)}.
      </p>
      {error !== null && (
        <p className="vf-history-new-agent-error" role="alert">
          {error}
        </p>
      )}
      <div className="vf-history-new-agent-acts">
        <UiButton variant="primary" disabled={busy} onClick={onBringIn}>
          {HISTORY_WORDS.bringItIn}
        </UiButton>
        <UiButton disabled={busy} onClick={onNotNow}>
          {HISTORY_WORDS.notNow}
        </UiButton>
      </div>
    </section>
  );
}

/** History's head, while an agent with a past waits to be asked about. */
export function HistoryNewAgentPast(): ReactElement | null {
  const client = useFielddClient();
  const { census } = useHistoryCensus(client);
  const ledger = useSetupLedger();
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = newAgentWithAPast(census, ledger, answered);
  if (row === null || row.agent === null) return null;
  const agent = row.agent;
  const leave = (): void => {
    setAnswered((before) => new Set(before).add(agent));
    setError(null);
  };
  return (
    <NewAgentPastCard
      row={row}
      now={Date.now()}
      busy={busy}
      error={error}
      onBringIn={() => {
        setBusy(true);
        setError(null);
        bringInAgent(client, row).then(
          () => {
            setBusy(false);
            leave();
          },
          (cause: unknown) => {
            setBusy(false);
            setError(cause instanceof Error ? cause.message : String(cause));
          },
        );
      }}
      onNotNow={() => {
        leave();
        retireSetupMoment(client, agentPastMoment(agent)).catch(() => undefined);
      }}
    />
  );
}
