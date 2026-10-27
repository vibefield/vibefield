import { UiButton } from "@vibefield/design-kit";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useState } from "react";
import { enrollmentFor } from "../setup/consent-act";
import { HistoryConsentRows } from "../setup/HistoryConsentView";
import type { HistoryAgentRow } from "../setup/history-consent";
import { HISTORY_WORDS } from "../setup/history-words";
import { answerSetupStep } from "../setup/ledger";
import { type HistoryCensus, useHistoryCensus } from "../setup/use-history-census";
import { SettingsSection } from "./settings-ui";

// Settings → History (track AO, AO-3; AO-D9; DESIGN.md §8 "Settings → History"):
// the home of whose history is read. The History pane's rows, each switch
// meaning what it says — on: read; off: Stop reading, which keeps what was
// read and says so, asked once — and Look again for an agent installed since.
// A change applies at once, as Settings' changes do: one `index.enroll` with
// the complete set, so the history service restarts once.

const NO_ROWS: readonly HistoryAgentRow[] = [];

export function HistorySettingsView({
  census,
  consented,
  stopping,
  busy,
  error,
  now,
  onToggle,
  onConfirmStop,
  onCancelStop,
  onLookAgain,
}: {
  census: HistoryCensus;
  /** the listed kinds History reads now */
  consented: ReadonlySet<string>;
  /** the agent whose Stop reading is being asked, or null */
  stopping: HistoryAgentRow | null;
  busy: boolean;
  error: string | null;
  now: number;
  onToggle: (kind: string, on: boolean) => void;
  onConfirmStop: () => void;
  onCancelStop: () => void;
  onLookAgain: () => void;
}): ReactElement {
  const rows = census.kind === "found" ? census.rows : NO_ROWS;
  return (
    <SettingsSection
      title="Past sessions"
      description="Whose past sessions History reads on this Mac. They stay on your devices; VibeField never uploads them."
      action={
        <UiButton onClick={onLookAgain} disabled={census.kind === "looking"}>
          Look again
        </UiButton>
      }
    >
      {census.kind === "looking" ? (
        <p className="vf-history-settings-note">{HISTORY_WORDS.looking}</p>
      ) : census.kind === "unavailable" ? (
        <p className="vf-history-settings-note">History isn't available right now.</p>
      ) : rows.length === 0 ? (
        <p className="vf-history-settings-note">
          No past sessions on this Mac yet. New ones appear in History as you work.
        </p>
      ) : (
        <HistoryConsentRows
          rows={rows}
          chosen={consented}
          now={now}
          disabled={busy || stopping !== null}
          onToggle={onToggle}
        />
      )}
      {stopping !== null && (
        <div className="vf-history-settings-stop" role="alertdialog" aria-label="Stop reading">
          <p>
            Stop reading {stopping.label}'s history? What was read stays in History; new sessions
            won't come in.
          </p>
          <div className="vf-history-settings-stop-acts">
            <UiButton variant="danger" onClick={onConfirmStop} disabled={busy}>
              Stop reading
            </UiButton>
            <UiButton onClick={onCancelStop} disabled={busy}>
              Cancel
            </UiButton>
          </div>
        </div>
      )}
      {error !== null && (
        <p className="vf-history-settings-error" role="alert">
          {error}
        </p>
      )}
    </SettingsSection>
  );
}

export function HistorySettings(): ReactElement {
  const client = useFielddClient();
  const { census, lookAgain } = useHistoryCensus(client);
  const [consented, setConsented] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (census.kind === "found") setConsented(new Set(census.consented));
  }, [census]);
  const [stopping, setStopping] = useState<HistoryAgentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (next: ReadonlySet<string>): void => {
    if (census.kind !== "found") return;
    setBusy(true);
    setError(null);
    const listed = census.rows.map((row) => row.kind);
    client
      .request("index.enroll", {
        kinds: enrollmentFor({ consented: census.consented, listed, chosen: next }),
      })
      .then(
        () => {
          setConsented(next);
          setStopping(null);
          setBusy(false);
          // a choice made here answers the Setup Assistant's question too
          answerSetupStep(client, "history", "answered").catch(() => undefined);
        },
        (cause: unknown) => {
          setBusy(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
  };

  return (
    <HistorySettingsView
      census={census}
      consented={consented}
      stopping={stopping}
      busy={busy}
      error={error}
      now={Date.now()}
      onToggle={(kind, on) => {
        if (on) {
          apply(new Set([...consented, kind]));
          return;
        }
        const row = census.kind === "found" ? census.rows.find((r) => r.kind === kind) : undefined;
        if (row !== undefined) setStopping(row);
      }}
      onConfirmStop={() => {
        if (stopping === null) return;
        const next = new Set(consented);
        next.delete(stopping.kind);
        apply(next);
      }}
      onCancelStop={() => setStopping(null)}
      onLookAgain={lookAgain}
    />
  );
}
