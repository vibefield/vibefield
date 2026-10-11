import {
  createFindRows,
  FIND_DEBOUNCE_MS,
  type FindRow,
  type HistoryPort,
  type HistorySearchHit,
  type HistorySearchStatus,
  type HistorySessionFacts,
  liveScope,
} from "@vibecook/puppeteer-views";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveFindAgent } from "./find-door";

// LIVE NOW'S ORCHESTRATION (P2; DESIGN.md §8 "Search — the Peek"). What
// puppeteer's FindSheet did around its pure model (`find-model.ts`, exported),
// rewritten here because the sheet left VibeField and its model did not: the
// facts (titles) and the index's readiness asked while Live now shows, again
// whenever the live set changes and every 30 s; the words asked once per pause
// in the typing (Find's 120 ms), each ask numbered so only the newest answer
// lands; and an ask nobody answered keeps the hits the last answer showed —
// never "no matches" for a question nobody answered.

/** How often the titles and the index's state are asked again while Live now
 * shows, so a session that gets named shows its name (FindSheet's cadence). */
export const LIVE_FACTS_REFRESH_MS = 30_000;

export interface LiveFind {
  /** find's rows: the runs whose facts or transcript hold every word */
  readonly found: readonly FindRow<LiveFindAgent>[];
  readonly status: HistorySearchStatus | undefined;
  /** words are asked and the newest ask has not answered */
  readonly searching: boolean;
  /** the newest answered ask was answered (false: the hits are the last answer's) */
  readonly answered: boolean;
  readonly clipped: boolean;
}

const NO_FACTS: ReadonlyMap<string, HistorySessionFacts> = new Map();
const NO_HITS: readonly HistorySearchHit[] = Object.freeze([]);

export function useLiveFind({
  active,
  runs,
  history,
  query,
  now = Date.now,
}: {
  /** Live now shows: the popup is open on it */
  active: boolean;
  runs: readonly LiveFindAgent[];
  history: HistoryPort | null;
  query: string;
  now?: () => number;
}): LiveFind {
  const [facts, setFacts] = useState<ReadonlyMap<string, HistorySessionFacts>>(NO_FACTS);
  const [status, setStatus] = useState<HistorySearchStatus>();
  const [hits, setHits] = useState<readonly HistorySearchHit[]>(NO_HITS);
  const [answered, setAnswered] = useState(true);
  const [clipped, setClipped] = useState(false);
  const [searching, setSearching] = useState(false);
  const [clock, setClock] = useState(now);
  const sequence = useRef(0);
  const scope = useMemo(() => liveScope(runs), [runs]);
  // the live set's identity: the array is rebuilt with every publish
  const scopeKey = scope.nativeSessionIds.join("\n");
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  // The clock is read when Live now comes to show, never every render.
  useEffect(() => {
    if (active) setClock(now());
  }, [active, now]);

  // Titles and readiness: on showing, whenever the live set changes, and every
  // 30 s while shown. A refusal keeps what was last read.
  useEffect(() => {
    if (!active || history === null) return;
    let alive = true;
    const load = (): void => {
      void history.status().then(
        (next) => {
          if (alive) setStatus(next);
        },
        () => undefined,
      );
      const ids = scopeRef.current.nativeSessionIds;
      if (ids.length === 0) return;
      void history.facts(ids).then(
        (rows) => {
          if (alive) setFacts(new Map(rows.map((row) => [row.nativeSessionId, row] as const)));
        },
        () => undefined,
      );
    };
    load();
    const timer = window.setInterval(load, LIVE_FACTS_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [active, history, scopeKey]);

  // The words: one debounced ask per pause, numbered; a late answer to an
  // older ask is dropped, and an unanswered one leaves the last hits standing.
  const words = query.trim();
  useEffect(() => {
    if (!active || history === null) return;
    if (words === "") {
      sequence.current += 1;
      setHits(NO_HITS);
      setClipped(false);
      setSearching(false);
      setAnswered(true);
      return;
    }
    sequence.current += 1;
    const mine = sequence.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      const asked = scopeRef.current;
      void history
        .search({
          query: words,
          nativeSessionIds: asked.nativeSessionIds,
          ...(asked.afterMs !== undefined ? { afterMs: asked.afterMs } : {}),
          prefix: true,
        })
        .then(
          (response) => {
            if (mine !== sequence.current) return;
            setStatus(response.status);
            setAnswered(response.answered);
            if (response.answered) {
              setHits(response.hits);
              setClipped(response.clipped);
            }
            setSearching(false);
          },
          () => {
            if (mine !== sequence.current) return;
            setAnswered(false);
            setSearching(false);
          },
        );
    }, FIND_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, history, words, scopeKey]);

  const rowsFor = useMemo(() => createFindRows<LiveFindAgent>(), []);
  const found = useMemo(
    () => rowsFor({ agents: runs, facts, hits, query, nowMs: clock }),
    [rowsFor, runs, facts, hits, query, clock],
  );
  return { found, status, searching, answered, clipped };
}
