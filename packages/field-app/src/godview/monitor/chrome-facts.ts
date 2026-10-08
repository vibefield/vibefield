import type { AgentModelDeskRow } from "@vibefield/contracts";
import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * MV-3d (M35, M19) — THE CHROME'S FACTS, window-side.
 *
 * The views draw the model. The window's own chrome around them — the deck's
 * pane frames and empty-pane launchers, the find sheet, the AR-7 marker —
 * reads facts the model does not carry, by design (MV-D17): a run's working
 * directory as a PATH (EL7 B1), its provider-native session id, its PTY join,
 * where it came from and whether it exited, the mirror's own liveness and
 * clocks. Until MV-3d those came from a second subscription, the fold's `full`
 * board, sent whole every 16 ms while anything moved. They ride the run's own
 * row of the model board now (`AgentModelDeskRow.local`), and the window
 * adapter splits each row as it lands: the model's row to the replica
 * (`model-replica.ts`), the run row whole to this store. The SDK model never
 * carries them; it stays the views'.
 *
 * A reader subscribes to the facts IT states (`useChromeKey`): the store tells
 * every listener that a run moved, and each reader renders again only when its
 * own key over the runs does — the identity rule the fold's readers kept (the
 * deck's frame facts, the marker's runs).
 */

/** One of this desktop's runs as the chrome reads it: its row of the model
 * board — the desk row, the model's row on it, and the chrome's facts (`local`). */
export type ChromeRun = AgentModelDeskRow;

export interface ChromeFacts {
  /** This desktop's runs: every run row its board lists, assembled by the
   * backend or not, in the board's order. The same array until one moves. */
  runs(): readonly ChromeRun[];
  /** Hears a run arrive, move or leave, and the board replaced. */
  subscribe(listener: () => void): () => void;
}

/** No feed, no runs: the `no-door` fact, never an invented row. */
export const NO_RUNS: readonly ChromeRun[] = Object.freeze([]);

const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

/**
 * A chrome reader's subscription: the key `keyOf` states over this desktop's
 * runs, re-read when the store moves, and a render only when the key changes.
 * `keyOf` is the reader's own (a module-level function), computed once per
 * runs array. Null chrome — no door, no model port, Godview closed — reads as
 * no runs.
 */
export function useChromeKey(
  chrome: ChromeFacts | null,
  keyOf: (runs: readonly ChromeRun[]) => string,
): string {
  const held = useRef<{ runs: readonly ChromeRun[] | null; key: string }>({ runs: null, key: "" });
  const subscribe = useCallback(
    (listener: () => void) => (chrome === null ? NO_SUBSCRIPTION() : chrome.subscribe(listener)),
    [chrome],
  );
  const read = (): string => {
    const runs = chrome?.runs() ?? NO_RUNS;
    if (runs !== held.current.runs) held.current = { runs, key: keyOf(runs) };
    return held.current.key;
  };
  return useSyncExternalStore(subscribe, read, read);
}
