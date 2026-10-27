import { UiSwitch } from "@vibefield/design-kit/primitives";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import type { ReactElement } from "react";
import { formatBytes } from "../format/bytes";
import { firstReadingSentence, type HistoryAgentRow } from "./history-consent";
import { HISTORY_WORDS } from "./history-words";
import type { HistoryCensus } from "./use-history-census";
import "./history-consent.css";

// The History pane (track AO, AO-3; DESIGN.md §8 "The Setup Assistant's agent
// chapter" — History). One face for every door that asks whose history is
// read: the Setup Assistant's pane, History's own consent slot, Finish setting
// up's sheet and Settings → History. Each host gives it its chrome; this is the
// question itself — the rows, their switches, and the two sentences under them.

/** "today", "yesterday", "in August", "in 2025": when an agent was last used,
 * as a person says it (the census knows the newest file, nothing finer). */
export function lastUsedWords(newestModifiedMs: number, now: number): string {
  const day = 86_400_000;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (newestModifiedMs >= startOfToday.getTime()) return "today";
  if (newestModifiedMs >= startOfToday.getTime() - day) return "yesterday";
  if (newestModifiedMs >= startOfToday.getTime() - 6 * day) return "this week";
  const then = new Date(newestModifiedMs);
  if (then.getFullYear() === new Date(now).getFullYear()) {
    return `in ${then.toLocaleString("en-US", { month: "long" })}`;
  }
  return `in ${then.getFullYear()}`;
}

export function HistoryConsentRows({
  rows,
  chosen,
  onToggle,
  now,
  disabled = false,
}: {
  rows: readonly HistoryAgentRow[];
  /** the kinds whose switch is on */
  chosen: ReadonlySet<string>;
  onToggle: (kind: string, on: boolean) => void;
  now: number;
  disabled?: boolean;
}): ReactElement {
  return (
    <ul className="vf-history-consent-rows" aria-label="Past sessions on this Mac">
      {rows.map((row) => {
        const on = chosen.has(row.kind);
        return (
          <li key={row.kind} className="vf-history-consent-row">
            <span className="vf-history-consent-mark" aria-hidden="true">
              {row.agent !== null && <AgentIcon providerId={row.agent} />}
            </span>
            <span className="vf-history-consent-text">
              <span className="vf-history-consent-label">{row.label}</span>
              <span className="vf-history-consent-facts">
                {formatBytes(row.bytes)} · last used {lastUsedWords(row.newestModifiedMs, now)} ·{" "}
                <span className="vf-ui-mono">{row.root}</span>
              </span>
            </span>
            <UiSwitch
              label={`Bring in ${row.label}'s history`}
              checked={on}
              disabled={disabled}
              onChange={(checked) => onToggle(row.kind, checked)}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** The two sentences under the rows: how long, and where it stays. */
export function HistoryConsentSummary({ bytes }: { bytes: number }): ReactElement {
  return (
    <div className="vf-history-consent-summary">
      <p>{firstReadingSentence(bytes)}</p>
      <p>{HISTORY_WORDS.privacy}</p>
    </div>
  );
}

/** The pane's body for every census state: what it is doing, why it cannot
 * ask, or the rows with their switches and — while anything is on — the two
 * sentences. Controller-free, so the catalog mounts the shipping face. */
export function HistoryConsentBody({
  census,
  chosen,
  onToggle,
  now,
  disabled = false,
}: {
  census: HistoryCensus;
  chosen: ReadonlySet<string>;
  onToggle: (kind: string, on: boolean) => void;
  now: number;
  disabled?: boolean;
}): ReactElement {
  if (census.kind === "looking") {
    return <p className="vf-history-consent-note">{HISTORY_WORDS.looking}</p>;
  }
  if (census.kind === "unavailable") {
    return <p className="vf-history-consent-note">{HISTORY_WORDS.unavailable}</p>;
  }
  const bytes = census.rows
    .filter((row) => chosen.has(row.kind))
    .reduce((sum, row) => sum + row.bytes, 0);
  return (
    <>
      <HistoryConsentRows
        rows={census.rows}
        chosen={chosen}
        now={now}
        disabled={disabled}
        onToggle={onToggle}
      />
      {chosen.size > 0 && <HistoryConsentSummary bytes={bytes} />}
    </>
  );
}
