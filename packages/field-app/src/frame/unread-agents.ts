import type { FielddClient } from "@vibefield/fieldd-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestHistoryRoomRefresh } from "../history/room-refresh";
import { bringInAgent } from "../setup/consent-act";
import type { HistoryAgentRow } from "../setup/history-consent";
import { readHistoryCensus } from "../setup/use-history-census";

// THE AGENTS NOT IN HISTORY, AS THE IMPORT SIGN'S PANEL LISTS THEM (track HD, HD-7; DESIGN.md §8 "History", the
// import's sign — "Agents not in History"). The room's sign names only what the index reads; the agents with past
// sessions on this Mac that it does not read are fieldd's census (`index.discoveries`: sizes, never content), asked
// while the panel is open: when it opens, when the agents the sign names change, and after a switch. Turning one on
// is Settings → History's own act (`bringInAgent`: one `index.enroll` with the complete set, read afresh, so nothing
// already consented is revoked by omission), and the room is asked to look again at once, since the history service
// restarted under it.

/** What the panel draws under the agents History reads. */
export interface UnreadAgents {
  /** the agents with past sessions here that History does not read, in the catalog's order */
  readonly rows: readonly HistoryAgentRow[];
  /** the kind whose switch was turned on and is being taken; null when none */
  readonly bringing: string | null;
  /** a refusal, in fieldd's words; null when none */
  readonly error: string | null;
  readonly onBringIn: (kind: string) => void;
}

/** The census is asked again this often while the index does not answer (it restarts after a switch). */
const ASK_AGAIN_MS = 1_000;
const GIVE_UP_MS = 15_000;

/** The rows the panel lists: the census's, less what is consented and what the sign already names as read. */
export function unreadRowsOf(
  rows: readonly HistoryAgentRow[],
  read: ReadonlySet<string>,
): readonly HistoryAgentRow[] {
  return rows.filter((row) => !row.consented && !read.has(row.kind));
}

/** The agents not in History while `active` (the panel is open). `readKinds` is the kinds the sign names, in its
 * order, joined: a change asks the census again. */
export function useUnreadAgents(
  client: FielddClient,
  active: boolean,
  readKinds: string,
): UnreadAgents {
  const [rows, setRows] = useState<readonly HistoryAgentRow[]>([]);
  const [bringing, setBringing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `readKinds` and `asked` are the reasons to ask again
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const ask = async (): Promise<void> => {
      try {
        const found = await readHistoryCensus(client);
        if (stopped) return;
        setRows(found.rows);
        // the switch that was taken shows on until the census says its agent is read
        setBringing((kind) => (kind !== null && found.consented.includes(kind) ? null : kind));
      } catch {
        if (stopped || Date.now() - startedAt >= GIVE_UP_MS) return;
        // what was listed stays listed while the index is away
        timer = setTimeout(() => void ask(), ASK_AGAIN_MS);
      }
    };
    void ask();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [client, active, readKinds, asked]);

  const onBringIn = useCallback(
    (kind: string): void => {
      const row = rows.find((candidate) => candidate.kind === kind);
      if (row === undefined || bringing !== null) return;
      setBringing(kind);
      setError(null);
      bringInAgent(client, row).then(
        () => {
          // the history service restarted with the set: the room reads its state now, and so does this list
          requestHistoryRoomRefresh();
          if (alive.current) setAsked((count) => count + 1);
        },
        (cause: unknown) => {
          if (!alive.current) return;
          setBringing(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    },
    [client, rows, bringing],
  );

  const read = new Set(readKinds === "" ? [] : readKinds.split("\n"));
  return {
    rows: unreadRowsOf(rows, read),
    bringing,
    error,
    onBringIn,
  };
}
