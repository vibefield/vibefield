import { UiButton } from "@vibefield/design-kit";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useState } from "react";
import { HistorySpace } from "../frame/HistorySpace";
import { requestHistoryRoomRefresh } from "../history/room-refresh";
import { enrollmentFor } from "../setup/consent-act";
import { HistoryConsentRows } from "../setup/HistoryConsentView";
import type { HistoryAgentRow } from "../setup/history-consent";
import { HISTORY_WORDS } from "../setup/history-words";
import { answerSetupStep } from "../setup/ledger";
import { type HistoryCensus, useHistoryCensus } from "../setup/use-history-census";
import { type HistoryKept, useHistoryKept } from "./history-space";
import { SettingsSection } from "./settings-ui";

// Settings → History (track AO, AO-3; AO-D9; DESIGN.md §8 "Settings → History"):
// the home of whose history is read. The History pane's rows, each with its
// switch, and Look again for an agent installed since. Turning one on applies
// at once, as Settings' changes do: one `index.enroll` with the complete set,
// so the history service restarts once.
//
// *2026-11-24 (track HD, HD-1):* under the rows stands **On this Mac**: what
// History keeps here, drawn as the import sign's panel draws it (the one
// `HistorySpace`), and **Clear History…**, asked once. Clearing removes
// everything History read and withdraws every switch, so History is back where
// it was before its first import and asks before it reads again. It is the one
// way to remove what was read: rosetta can drop no single agent's sessions
// (RO-8).
//
// *2026-11-24 (HD-2, DECISIONS HD: once on, a switch is gray and there is no
// turning it off):* A SWITCH THAT IS ON STAYS ON. It is drawn off
// (§7 "Off": `disabled`, the kit's dimmed switch) and takes no press, and a
// line under the rows says where the way back is. Stop reading, and its
// question, are gone: turning one agent off kept everything it had read, which
// a switch does not say. Clear History… turns them all off.
//
// *2026-11-24 (HD-7):* WHILE AN AGENT IS BROUGHT IN its row says so where its
// last use stood ("Importing · 188 MB read"), from the same `index.status` the
// page reads its space from, asked every 2 s while one imports.

const NO_ROWS: readonly HistoryAgentRow[] = [];

export function HistorySettingsView({
  census,
  consented,
  busy,
  error,
  now,
  importing,
  onTurnOn,
  onLookAgain,
}: {
  census: HistoryCensus;
  /** the listed kinds History reads now: each one's switch is on, and stays on */
  consented: ReadonlySet<string>;
  busy: boolean;
  error: string | null;
  now: number;
  /** HD-7 — by kind, what the row of an agent being read for the first time says ("Importing · 188 MB read") */
  importing?: ReadonlyMap<string, string> | undefined;
  /** a switch that was off was pressed */
  onTurnOn: (kind: string) => void;
  onLookAgain: () => void;
}): ReactElement {
  const rows = census.kind === "found" ? census.rows : NO_ROWS;
  const anyOn = rows.some((row) => consented.has(row.kind));
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
        <>
          <HistoryConsentRows
            rows={rows}
            chosen={consented}
            locked={consented}
            notes={importing}
            now={now}
            disabled={busy}
            onToggle={(kind, on) => {
              if (on) onTurnOn(kind);
            }}
          />
          {anyOn && (
            <p className="vf-history-settings-note vf-history-settings-locked">
              An agent History reads stays on. Clear History, below, removes what was read and turns
              them all off.
            </p>
          )}
        </>
      )}
      {error !== null && (
        <p className="vf-history-settings-error" role="alert">
          {error}
        </p>
      )}
    </SettingsSection>
  );
}

/** On this Mac: what History keeps, and Clear History… asked once. */
export function HistoryKeptView({
  kept,
  asking,
  clearing,
  error,
  onAsk,
  onConfirm,
  onCancel,
}: {
  kept: HistoryKept;
  /** Clear History… was pressed: the question stands */
  asking: boolean;
  /** the clear runs */
  clearing: boolean;
  error: string | null;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  // nothing to clear: an index that waits for consent and keeps nothing
  const empty = kept.kind === "read" && kept.waiting && (kept.keptBytes ?? 0) === 0;
  const holds = kept.kind === "read" && kept.space !== null && (kept.keptBytes ?? 0) > 0;
  return (
    <SettingsSection
      title="On this Mac"
      description="What History keeps on this Mac from the sessions it read. Your agents' own files are not part of it."
      action={
        <UiButton onClick={onAsk} disabled={kept.kind !== "read" || empty || asking || clearing}>
          Clear History…
        </UiButton>
      }
    >
      {kept.kind === "looking" ? (
        <p className="vf-history-settings-note">Measuring…</p>
      ) : kept.kind === "unavailable" ? (
        <p className="vf-history-settings-note">History isn't available right now.</p>
      ) : holds && kept.space !== null ? (
        <div className="vf-history-settings-space">
          <HistorySpace space={kept.space} />
        </div>
      ) : kept.space === null ? (
        <p className="vf-history-settings-note">History hasn't measured its space yet.</p>
      ) : (
        <p className="vf-history-settings-note">History keeps nothing on this Mac.</p>
      )}
      {(asking || clearing) && (
        <div className="vf-history-settings-stop" role="alertdialog" aria-label="Clear History">
          <p>
            Clear everything History read on this Mac?{" "}
            {kept.kind === "read" && kept.space !== null && (kept.keptBytes ?? 0) > 0
              ? `Its copy of your past sessions (${kept.space.kept}) is removed`
              : "Its copy of your past sessions is removed"}
            , and History asks before it reads again. Your agents' own files stay where they are.
            {kept.kind === "read" && kept.profiles > 0
              ? " Sessions from your agent profiles are read again right away."
              : ""}
          </p>
          <div className="vf-history-settings-stop-acts">
            <UiButton variant="danger" onClick={onConfirm} running={clearing}>
              {clearing ? "Clearing…" : "Clear History"}
            </UiButton>
            <UiButton onClick={onCancel} disabled={clearing}>
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
  const { kept, askNow } = useHistoryKept(client);
  const [askingClear, setAskingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [consented, setConsented] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (census.kind === "found") setConsented(new Set(census.consented));
  }, [census]);
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
          setBusy(false);
          // the history service restarted with the set: the room and this page's space read it now
          requestHistoryRoomRefresh();
          askNow();
          // a choice made here answers the Setup Assistant's question too
          answerSetupStep(client, "history", "answered").catch(() => undefined);
        },
        (cause: unknown) => {
          setBusy(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
  };

  const clear = (): void => {
    setClearing(true);
    setClearError(null);
    client.request("index.clear", {}).then(
      () => {
        setClearing(false);
        setAskingClear(false);
        // every switch is off now, and the room is back before its first import
        setConsented(new Set());
        lookAgain();
        askNow();
        requestHistoryRoomRefresh();
      },
      (cause: unknown) => {
        setClearing(false);
        setClearError(cause instanceof Error ? cause.message : String(cause));
        askNow();
        requestHistoryRoomRefresh();
      },
    );
  };

  return (
    <div className="space-y-4">
      <HistorySettingsView
        census={census}
        consented={consented}
        busy={busy || clearing}
        error={error}
        now={Date.now()}
        importing={kept.kind === "read" ? kept.importing : undefined}
        onTurnOn={(kind) => apply(new Set([...consented, kind]))}
        onLookAgain={lookAgain}
      />
      <HistoryKeptView
        kept={kept}
        asking={askingClear}
        clearing={clearing}
        error={clearError}
        onAsk={() => {
          setClearError(null);
          setAskingClear(true);
        }}
        onConfirm={clear}
        onCancel={() => setAskingClear(false)}
      />
    </div>
  );
}
