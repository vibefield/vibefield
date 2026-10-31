import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  GhostteaProvider,
  type GhostteaTerminalRuntime,
  TerminalSurface,
} from "@vibecook/ghosttea-react";
import "@vibecook/ghosttea-react/styles.css";
import type { SparkId } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useDeckPaneLook } from "../godview/deck-theme";
import { useGodviewTheme } from "../godview/godview-theme";
import { getHost } from "../host";
import { readClipboardText } from "../terminal/clipboard";
import { pasteIntoInput, whenPaneInputOpen } from "../terminal/paste-road";
import {
  prewarmTerminalPool,
  type TerminalPoolSnapshot,
  terminalPoolConfigured,
  terminalSessionSummary,
  useTerminalPool,
  useTerminalSessionViews,
} from "../terminal/pool";
import { SparkPaneView } from "./SparkPaneView";
import {
  publishSparkPane,
  SPARK_WAKE_WAIT_MS,
  type SparkPaneDoor,
  type SparkPaneReport,
} from "./thread-pane-door";

// THE THREAD'S PANE (SP-1d; DESIGN.md §8 "Chat's thread"; VF-PM's Q4, 2026-10-31): the spark's own floor session,
// mounted in Chat's thread — a second `TerminalSurface` on the session the deck's pane shows (one decode, two
// presents, the Peek's precedent), but READ-WRITE: James presses Return there. It is the bare surface on the window's
// terminal pool, on the sign-in terminal's precedent (`panels/agents/SignInTerminal.tsx`):
//
//   - it never claims the pool: the deck stays the only consumer that opens and restores panes, so this one only
//     warms the window's runtime (a no-op once warm or claimed) and mounts a surface on it;
//   - it is drawn in the deck's own look (`useDeckPaneLook`), because `setTheme` is session-wide: a pane handed a
//     theme of its own would repaint the session for every viewer;
//   - its surface is `active` exactly while it holds the keyboard — on a press in it, a focus inside it, or Send's
//     paste — and Chat is the view. That flag gates the surface's auto-focus (so the caret stays the composer's at
//     mount) AND its focus report, which is how the pane takes the session's size on focus (DS-D5, the deck's policy:
//     `controlsResize` + `takeGeometryOnFocus`). It claims an empty seat only once Chat has shown it, never while it
//     was mounted under another view's cover. It says when it takes the keyboard (`onKeyboard`): the thread's hello,
//     which stands over the agent's input box, leaves then;
//   - its demand is live while Chat shows and none under another view's cover, as the deck's is.
//
// No pane frame: the thread's head is its head. While there is no pane to draw, its place says why (`SparkPaneView`).

export interface SparkPaneProps {
  spark: SparkId;
  /** the spark's name, as the pane's words say it */
  name: string;
  /** the floor session its own run's terminal is, or null while fieldd has not named it (just after a hatch or a
   * wake) */
  sessionId: string | null;
  /** Chat is the view showing */
  active: boolean;
  /** the pane took the keyboard — a press or a focus in it, or Send's paste: the thread's hello leaves for the window's
   * life (DESIGN.md §8 "Chat's thread", when they show) */
  onKeyboard?: (() => void) | undefined;
}

const NO_TERMINALS_REPORT: SparkPaneReport = Object.freeze({ state: "no-terminals", door: null });

/** The pane says how it stands while Chat shows it, for Send (`thread-pane-door.ts`). */
function usePaneReport(spark: SparkId, active: boolean, report: SparkPaneReport): void {
  useEffect(() => {
    if (!active) return;
    publishSparkPane(spark, report);
    return () => publishSparkPane(spark, null);
  }, [spark, active, report]);
}

/** What the floor answered for the spark's session: the session, no such session, or no answer — in its own words
 * ("the floor did not answer in 10 s"), which is never said to be an empty floor. */
type FloorRead =
  | { readonly kind: "found"; readonly session: SessionSummary }
  | { readonly kind: "absent" }
  | { readonly kind: "unanswered"; readonly reason: string };

const ABSENT: FloorRead = Object.freeze({ kind: "absent" });

/** The floor's answer for `sessionId` on the pool's runtime, by the pool's own join (`terminalSessionSummary`, which
 * waits out an inventory that lags a birth): undefined while it is first asked, or while there is nothing to ask yet.
 * Until the session is found it is asked again whenever the floor may have moved — the runtime replaced, the pool's
 * phase moved, or its roster read again (the deck reads it) with the floor observed or the session listed — and the
 * last answer stands while it is. Once found, nothing asks again. */
function useFloorSession(
  pool: TerminalPoolSnapshot,
  sessionId: string | null,
): FloorRead | undefined {
  const runtime = pool.runtime;
  const [read, setRead] = useState<{
    readonly runtime: GhostteaTerminalRuntime;
    readonly sessionId: string;
    readonly answer: FloorRead;
  } | null>(null);
  const answer =
    read !== null && read.runtime === runtime && read.sessionId === sessionId
      ? read.answer
      : undefined;
  const listed = sessionId !== null && pool.roster.some((item) => item.sessionId === sessionId);
  const moved = answer?.kind === "found" ? null : `${pool.phase} ${pool.rosterState} ${listed}`;
  useEffect(() => {
    if (runtime === null || sessionId === null || moved === null) return;
    let live = true;
    terminalSessionSummary(sessionId).then(
      (session) => {
        const answer: FloorRead = session === null ? ABSENT : { kind: "found", session };
        if (live) setRead({ runtime, sessionId, answer });
      },
      (cause: unknown) => {
        const reason = cause instanceof Error ? cause.message : String(cause);
        if (live) setRead({ runtime, sessionId, answer: { kind: "unanswered", reason } });
      },
    );
    return () => {
      live = false;
    };
  }, [runtime, sessionId, moved]);
  return answer;
}

/** Why this window has no runtime to draw with, and builds none until something claims the pool, in the pool's own
 * words: its warm-up spent (no device), or its open failed. Null while it has one, or is building one. */
function poolFaultOf(pool: TerminalPoolSnapshot): string | null {
  if (pool.runtime !== null) return null;
  if (pool.phase === "spent") return pool.spentReason;
  if (pool.phase === "failed") return pool.fault?.message ?? null;
  return null;
}

/** True once one finding — of this session (or of none named yet) on this runtime — has lasted SPARK_WAKE_WAIT_MS. */
function useFindingLapsed(episode: string | null): boolean {
  const [lapsed, setLapsed] = useState<string | null>(null);
  useEffect(() => {
    if (episode === null) return;
    const timer = setTimeout(() => setLapsed(episode), SPARK_WAKE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [episode]);
  return episode !== null && lapsed === episode;
}

/** The pane, on the window's floor. */
function FloorSparkPane({
  spark,
  name,
  sessionId,
  active,
  onKeyboard,
}: SparkPaneProps): ReactElement {
  const client = useFielddClient();
  // warmed, never claimed (the sign-in terminal's rule): a no-op once the runtime is warm or the deck has the pool
  useEffect(() => prewarmTerminalPool(client), [client]);
  const pool = useTerminalPool();
  const runtime = pool.runtime;
  const read = useFloorSession(pool, sessionId);
  const found = read?.kind === "found" ? read.session : null;
  // a floor that did not answer, or a window whose terminals could not start, is a fault in its own words: never "not
  // on the floor", and never a wait that lapses into saying so
  const fault =
    read?.kind === "unanswered" ? read.reason : read === undefined ? poolFaultOf(pool) : null;
  const lapsed = useFindingLapsed(
    read === undefined && fault === null ? `${sessionId ?? ""} ${pool.generation}` : null,
  );
  const gone = read?.kind === "absent" || (read === undefined && fault === null && lapsed);
  useTerminalSessionViews(found === null ? [] : [found.id], active ? "live" : "none");
  const look = useDeckPaneLook(useGodviewTheme());

  // the pane holds the keyboard: a press or a focus in it, or Send's paste — only while Chat is the view. It is let go
  // at the render that finds Chat gone, as `claims` is taken at the one that finds it shown, so a focus or a paste
  // that lands under another view's cover leaves nothing held for Chat's next show (LEANS Q4)
  const [holds, setHolds] = useState(false);
  if (!active && holds) setHolds(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const onKeyboardRef = useRef(onKeyboard);
  onKeyboardRef.current = onKeyboard;
  useEffect(() => {
    if (holds) onKeyboardRef.current?.();
  }, [holds]);
  // it claims the session's size only once Chat has shown it (DESIGN.md §8 "Chat's thread"), and keeps whatever seat
  // it holds after: mounted under another view's cover — a wake, a terminal named late — it claims no seat at the
  // hidden column's grid
  const [claims, setClaims] = useState(active);
  if (active && !claims) setClaims(true);

  const box = useRef<HTMLDivElement>(null);
  const door = useMemo<SparkPaneDoor | null>(() => {
    if (found === null || runtime === null) return null;
    const id = found.id;
    return {
      whenInputOpen: (timeoutMs) => whenPaneInputOpen(runtime, () => id, timeoutMs),
      // A routed input that is closed drops a paste its surface still claims, so the runtime is asked first, and a
      // paste it would drop is never handed over (the deck's door, `GodviewDeck.tsx` pasteInto).
      paste: (text) => {
        const input = box.current?.querySelector("textarea") ?? null;
        if (input === null || runtime.routedActivation(id)?.inputAllowed !== true) return false;
        // Shown, the pane takes the keyboard, and with it the session's size, BEFORE the text lands (DESIGN.md §8
        // "Chat's composer"): the surface takes the seat in its own focus report once its `active` and its input's
        // focus have committed, so both are flushed before the paste is dispatched. A paste that lands after Chat
        // stopped being the view (Send's wait outlived it) takes neither (§8 "Chat's thread").
        if (activeRef.current) {
          flushSync(() => {
            setHolds(true);
            input.focus();
          });
        }
        return pasteIntoInput(input, text);
      },
    };
  }, [found, runtime]);
  const report = useMemo<SparkPaneReport>(() => {
    if (door !== null) return { state: "live", door };
    if (fault !== null) return { state: "fault", reason: fault, door: null };
    return { state: gone ? "gone" : "finding", door: null };
  }, [door, fault, gone]);
  usePaneReport(spark, active, report);

  if (found === null || runtime === null) {
    return report.state === "fault" ? (
      <SparkPaneView name={name} state="fault" reason={report.reason} />
    ) : (
      <SparkPaneView name={name} state={gone ? "gone" : "finding"} />
    );
  }
  return (
    <SparkPaneView
      name={name}
      state="live"
      ground={look.ground}
      boxRef={box}
      onPointerDown={() => setHolds(true)}
      onFocus={() => setHolds(true)}
      onBlur={(event) => {
        // focus left for a place outside the pane; the window's own blur (another app in front) leaves the keyboard
        // where it was, since the input stays the document's active element
        const inside = (node: EventTarget | null) =>
          node instanceof Node && event.currentTarget.contains(node);
        if (!inside(event.relatedTarget) && !inside(document.activeElement)) setHolds(false);
      }}
    >
      <GhostteaProvider key={pool.generation} runtime={runtime}>
        <TerminalSurface
          session={found}
          theme={look.theme}
          {...(look.effects === undefined ? {} : { effects: look.effects })}
          platform={getHost().platform ?? "other"}
          readClipboard={readClipboardText}
          active={active && holds}
          visible={active}
          controlsResize={claims}
          takeGeometryOnFocus
        />
      </GhostteaProvider>
    </SparkPaneView>
  );
}

/** A window with no terminals (a browser, the catalog): the Peek's words, and Send told so. */
function NoTerminalsPane({ spark, name, active }: SparkPaneProps): ReactElement {
  usePaneReport(spark, active, NO_TERMINALS_REPORT);
  return <SparkPaneView name={name} state="no-terminals" />;
}

/** The spark's own pane in its thread; honest words where there is none to draw. */
export function SparkPane(props: SparkPaneProps): ReactElement {
  return terminalPoolConfigured() ? <FloorSparkPane {...props} /> : <NoTerminalsPane {...props} />;
}
