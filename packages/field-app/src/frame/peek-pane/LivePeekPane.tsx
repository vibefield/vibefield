import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import { GhostteaProvider, TerminalSurface, type TerminalTheme } from "@vibecook/ghosttea-react";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import {
  terminalPoolConfigured,
  useTerminalPool,
  useTerminalPoolOpen,
  useTerminalSessionViews,
} from "../../terminal/pool";
import { watchOnlyRuntime } from "./watch-only";

// THE LIVE PEEK (P2; DESIGN.md §8 "Search — the Peek"; One Frame §23, GV-D8:
// "the live session's real pane, resting"). What opening a live row would
// show: the run's own terminal, watched through the window's terminal pool —
// a second `TerminalSurface` on the floor session a pane owns (one decode, two
// presents), addressed by that session id and nothing else. It WATCHES, by
// construction: the five layers of the canvas mirror DK-17 retired (`0afeed47`;
// wall R25 keeps that mirror's names), restored here off the canvas —
//
//   1. the runtime it is handed refuses every geometry and input verb, and
//      forces its view's input policy to read-only (`watch-only.ts`);
//   2. `inert` on the surface's box: no tab stop, no `.focus()`, no click;
//   3. `pointer-events: none` (peek.css): it consumes no gesture;
//   4. `active={false}`: the surface's auto-focus never runs;
//   5. `readWrite={false}` and a read-only projection of the summary.
//
// So it makes no geometry claim — the authority pane keeps the PTY's size, and
// this one draws what fits — takes no focus, and types nothing. Its demand is
// declared through the pool's ledger while it shows and released when it goes.
// The pool is opened idempotently (History's Peek may be the first to ask).

/** How the pane stands: the honest ladder, never a blank. */
export type LivePeekState = "resolving" | "unavailable" | "watching";

/** What the facade hands the surface for a theme it must not apply: `setTheme`
 * repaints the session for every viewer (`watch-only.ts`, finding 3), so it is
 * refused and the worker keeps the authority's theme. The prop is required. */
const WATCHING_THEME: TerminalTheme = Object.freeze({
  foreground: [0.85, 0.85, 0.85, 1] as const,
  background: [0, 0, 0, 0] as const,
  cursor: [0.85, 0.85, 0.85, 1] as const,
  selection: [0.35, 0.42, 0.55, 0.45] as const,
  selectionForeground: [0.95, 0.95, 0.95, 1] as const,
});

function useWatchedSession(
  guarded: ReturnType<typeof watchOnlyRuntime> | null,
  sessionId: string,
): SessionSummary | null | undefined {
  const [session, setSession] = useState<SessionSummary | null | undefined>(undefined);
  useEffect(() => {
    if (guarded === null) {
      setSession(undefined);
      return;
    }
    let live = true;
    setSession(undefined);
    guarded.runtime
      .listSessions()
      .then((sessions) => {
        if (live) setSession(sessions.find((candidate) => candidate.id === sessionId) ?? null);
      })
      .catch(() => {
        if (live) setSession(null);
      });
    return () => {
      live = false;
    };
  }, [guarded, sessionId]);
  return session;
}

/** The pool's side of the pane, mounted only where a pool can exist. */
function WatchingPane({ sessionId }: { sessionId: string }): ReactElement {
  useTerminalPoolOpen(useFielddClient());
  const pool = useTerminalPool();
  // one facade per runtime incarnation: a recovery replaces the runtime
  const guarded = useMemo(
    () => (pool.runtime === null ? null : watchOnlyRuntime(pool.runtime)),
    [pool.runtime],
  );
  const session = useWatchedSession(guarded, sessionId);
  useTerminalSessionViews(session == null ? [] : [sessionId], "live");
  const state: LivePeekState =
    session === undefined ? "resolving" : session === null ? "unavailable" : "watching";
  return (
    <div className="vf-peek-livepane" data-live-peek={state}>
      {session == null || guarded === null ? (
        <p className="vf-peek-livepane-words">
          {session === undefined
            ? "Finding its terminal…"
            : "Its terminal is not on this desktop's floor any more."}
        </p>
      ) : (
        <div className="vf-peek-livepane-surface" inert>
          <GhostteaProvider runtime={guarded.runtime}>
            <TerminalSurface
              session={{ ...session, readWrite: false }}
              theme={WATCHING_THEME}
              active={false}
              controlsResize={false}
              readWrite={false}
              inputPolicy="read-only"
              visible
            />
          </GhostteaProvider>
        </div>
      )}
    </div>
  );
}

/** The live peek for one floor session; honest words where no pool can be
 * (a browser, the catalog). */
export function LivePeekPane({ sessionId }: { sessionId: string }): ReactElement {
  if (!terminalPoolConfigured()) {
    return (
      <div className="vf-peek-livepane" data-live-peek="unavailable">
        <p className="vf-peek-livepane-words">This window has no terminals to show it with.</p>
      </div>
    );
  }
  return <WatchingPane key={sessionId} sessionId={sessionId} />;
}
