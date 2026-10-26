import { useFielddClient } from "@vibefield/fieldd-client/react";
import { frameScheduler } from "@vibefield/puppeteer-view-sdk/host";
import { ChromeBoundary } from "@vibefield/puppeteer-views";
import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { answerGodviewDeckUp, type GodviewDeckState } from "../frame/deck-door";
import { publishSystemControlDoor } from "../frame/system-control-door";
import { useActiveView } from "../frame/view-state";
import { prewarmTerminalPool, terminalPoolConfigured } from "../terminal/pool";
import { godviewColdOpen } from "./cold-open";
import { useDeckAppearance } from "./deck-appearance";
import { deckAfter, installGodviewDeckLab, storeDeckState, storedDeckState } from "./deck-state";
import { godviewTerminalGroundStyle } from "./deck-theme";
import { GodviewDeck } from "./GodviewDeck";
import { GodviewMonitor } from "./GodviewMonitor";
import { GodviewStage, GodviewUnavailableDeck } from "./GodviewStage";
import {
  defaultGodviewTuning,
  type GodviewTuning,
  GodviewTuningPanel,
  godviewTuningStyle,
} from "./GodviewTuningPanel";
import { useGodviewTheme } from "./godview-theme";
import { LastRunCurtain } from "./LastRunCurtain";
import { useLabSwitches } from "./lab-switches";
import {
  askLastRun,
  curtainQuestion,
  dismissLastRun,
  restoreLastRun,
  startCleanLastRun,
  stillBoardPort,
  useLastRun,
} from "./last-run";
import { GodviewAgentsProvider, MonitorFeedOverride } from "./monitor/GodviewAgentsProvider";
import { useMonitorReplica } from "./monitor/model-replica";
import { monitorTuningSections, useMonitorTuning } from "./monitor/monitor-tuning";
import { useGodviewReplayPanes } from "./monitor/perf/replay-panes";
import type { RemoteSessionDoor } from "./monitor/remote-door";
import {
  SCANLINE_DENSITY_KEY,
  SCANLINE_OPACITY_KEY,
  VIGNETTE_OPACITY_KEY,
} from "./monitor/stage-parameters";
import type { MonitorPaneFacts } from "./monitor/useMonitorAgents";

/** The prewarm's off switch (GT-3p). A DIAGNOSTIC, not a product setting: the
 * smoke sets it to measure a genuinely cold open, and the only supported value
 * is the one that disables. Nothing in the UI writes it. */
const PREWARM_STORAGE_KEY = "vf-godview-prewarm-v1";

/** Stable, so the stage's props do not change identity per render. */
const DECK_EDGE_PERSISTED = { persist: true } as const;

function prewarmEnabled(): boolean {
  try {
    return localStorage.getItem(PREWARM_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Run `task` when the browser is next idle, or after `timeoutMs` if it never
 * is. Idle rather than a timer because GT-D14's whole condition is "do not delay
 * app startup" — this work is worth doing early and worth doing LAST. */
function whenIdle(task: () => void, timeoutMs: number): () => void {
  const idle = (
    globalThis as {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    }
  ).requestIdleCallback;
  if (typeof idle === "function") {
    const handle = idle(task, { timeout: timeoutMs });
    return () =>
      (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle);
  }
  const timer = window.setTimeout(task, timeoutMs);
  return () => window.clearTimeout(timer);
}

/* RETIRED, kept for the docs trail: the bridge badge died with the bridge at
   TP-S3e (per-activation health is the routed runtime's, surfaced by the deck's
   own faces), and `bridgeNotice()` answered null from then on. Its slot was the
   instrument bar's and left with the bar (GV-D1): when a plane-down notice
   returns it is one held notice on the frame's status line.
   the old ladder, for reference:
  if (status.state === "bridge-down") return "TERMINAL BRIDGE DOWN · REBUILDING";
  return "TERMINAL BRIDGE UNAVAILABLE · RECONNECTING";
*/

/** Godview as the cover's content (One Frame FR-1): a VIEW now, drawn below
 * the frame inside the one cover, open exactly while it is the window's view —
 * there is no bit of its own any more. */
export function GodviewOverlay(): ReactElement | null {
  const open = useActiveView() === "godview";
  const [everOpened, setEverOpened] = useState(false);
  // FC-D7: the app's theme, unless Settings → Terminal overrides it — never a
  // mode of Godview's own (its ☼◐ switch retired at FR-4).
  const theme = useGodviewTheme();
  const [tuning, setTuning] = useState<GodviewTuning>(() => defaultGodviewTuning(theme));
  // A change of mode resets the stage's tuning to that mode's defaults, as the
  // switch used to (React's state-from-the-previous-render pattern).
  const [tunedFor, setTunedFor] = useState(theme);
  if (tunedFor !== theme) {
    setTunedFor(theme);
    setTuning(defaultGodviewTuning(theme));
  }
  const [tuningOpen, setTuningOpen] = useState(false);
  const appearance = useDeckAppearance();
  const monitor = useMonitorTuning();
  const fieldd = useFielddClient();
  const labSwitches = useLabSwitches();
  /** GT-3f's residual, closed: the lab can say which renderer is actually
   * drawing, because the deck tells it. Null until a deck has existed — the
   * backend is not a fact before a render worker is. */
  const [rendererBackend, setRendererBackend] = useState<string | null>(null);
  /** GT-D17's wiring, and the whole of it: the deck builds a two-verb door and
   * publishes its pane facts; this holds both and hands them to the monitor.
   * The overlay is where the two surfaces are siblings, so it is where they
   * meet — nothing about a runtime or a workspace passes through here. */
  const [remoteDoor, setRemoteDoor] = useState<RemoteSessionDoor | null>(null);
  const [panes, setPanes] = useState<MonitorPaneFacts>({ sessionIds: [] });
  const monitorPanes = useGodviewReplayPanes(panes);
  /** THE TERMINALS' STATE (round 3, L2 — GV-D5, GV-D6): away, up or
   * maximized, owned here and only here. The stage draws it and asks for a
   * change (the Lip's minimize); a call — any session brought to the
   * terminals, through the deck's doors or the frame's deck door — brings them
   * up as they were left. Kept for the run (L3): a reload finds what was left,
   * a launch opens on the monitor alone, the terminals away (W7). */
  const [deckState, setDeckState] = useState<GodviewDeckState>(storedDeckState);
  useEffect(() => storeDeckState(deckState), [deckState]);
  const callTerminalsUp = useCallback(() => setDeckState((state) => deckAfter(state, "call")), []);
  // N16 (a): ⌘W on the last pane minimizes them, and Godview stays the view
  const minimizeTerminals = useCallback(
    () => setDeckState((state) => deckAfter(state, "minimize")),
    [],
  );
  useEffect(() => answerGodviewDeckUp(callTerminalsUp), [callTerminalsUp]);
  /** THE FIRST CALL (W7 — GV-D5, N14 (a)). A launch opens Godview on the
   * monitor alone: the deck is mounted — its door is the monitor's — but not
   * CALLED, so it asks no restore question, mounts no workspace and births no
   * shell. The first call brings last run's panes up with the session it
   * called; from then on the deck stays called (minimized, its panes stay
   * mounted, as before W7). A reload into up or maximized was called before. */
  const [called, setCalled] = useState(() => deckState !== "away");
  if (!called && deckState !== "away") setCalled(true);
  /** W7 — the lab's call, under the Godview markers only (`deck-state.ts`):
   * the witness says when it raised the terminals from away, until they next
   * go away. */
  const [raisedBy, setRaisedBy] = useState<"lab" | null>(null);
  if (raisedBy !== null && deckState === "away") setRaisedBy(null);
  const deckStateNow = useRef(deckState);
  deckStateNow.current = deckState;
  useEffect(
    () =>
      installGodviewDeckLab(() => {
        if (deckStateNow.current === "away") setRaisedBy("lab");
        callTerminalsUp();
      }),
    [callTerminalsUp],
  );

  /** LR (James, 2026-10-15) — WHAT THE LAST RUN LEFT, asked once as Godview
   * first opens (`last-run.ts`): every view draws last run's picture, still,
   * through a feed of its own (the window's subscription stays open beside it
   * for the deck), and the curtain stands over the stage until it is
   * answered. The deck waits on the same answer. */
  const lastRun = useLastRun();
  useEffect(() => {
    if (everOpened) void askLastRun(fieldd);
  }, [everOpened, fieldd]);
  const question = curtainQuestion(lastRun);
  const picture = question?.board;
  const stillPort = useMemo(
    () => (picture !== undefined ? stillBoardPort(picture) : null),
    [picture],
  );
  const { feed: stillFeed } = useMonitorReplica(stillPort, { scheduler: frameScheduler });
  const restore = useCallback(() => void restoreLastRun(fieldd), [fieldd]);
  const startClean = useCallback(() => void startCleanLastRun(fieldd), [fieldd]);

  const changeTuning = useCallback((patch: Partial<GodviewTuning>) => {
    setTuning((current) => ({ ...current, ...patch }));
  }, []);
  const resetTuning = useCallback(() => setTuning(defaultGodviewTuning(theme)), [theme]);

  useEffect(() => {
    if (open) setEverOpened(true);
    else setTuningOpen(false);
  }, [open]);

  // Time zero for the cold-open trace, taken before any React work the open
  // causes — this effect runs on the commit that first saw the terminals
  // called while Godview shows. Since W7 that is their first call, not the
  // view's open (the report says so, `zero: "first-call"`).
  useEffect(() => {
    if (open && called) godviewColdOpen.mark("open");
  }, [open, called]);

  // GV-D1 — System control is the palette's act now (the instrument bar that
  // held its control left VibeField): while Godview is the window's view it
  // lends the frame the one verb that toggles the panel, and takes it back.
  useEffect(() => {
    if (!open) return;
    publishSystemControlDoor({ toggle: () => setTuningOpen((current) => !current) });
    return () => publishSystemControlDoor(null);
  }, [open]);

  // THE PREWARM (GT-D14). At idle after this overlay has mounted — which is
  // after the canvas has committed, since the overlay is mounted beneath it —
  // and never on the startup path. What warms is transport only: a ticket, a
  // bridge, a socket, a worker, a GPU device. No session, no shell, no PTY.
  //
  // Cancelled the moment the overlay has ever been open: from then on the deck
  // has claimed the pool, and a prewarm waking up behind it would build a second
  // runtime waiting for the same one-shot ports (see the one-runtime law).
  // `openTerminalPool` closes that race authoritatively — its claim is
  // synchronous — and this only keeps the pointless work from being scheduled in
  // the first place.
  //
  // TP-S0b: what is scheduled here is a POOL warm, not a Godview one. The
  // overlay is where the idle moment is observable, so it stays the scheduler;
  // the transport it warms belongs to the window.
  useEffect(() => {
    if (!prewarmEnabled() || everOpened) return;
    // The trace goes with it: the prewarm's stations are stamped BEFORE the
    // open, which is what lets the cold-open report name them as `warm` rather
    // than merely omitting them. An absent phase and a phase that was already
    // done look the same in a breakdown otherwise.
    return whenIdle(() => prewarmTerminalPool(fieldd, godviewColdOpen), 2_000);
  }, [fieldd, everOpened]);

  // The bridge NOTICE, and only the notice (TP-S0b). This used to be half of the
  // recovery ladder as well: GT-D14's custody clause (discard a warm whose
  // bridge died before anyone used it) and the one lazy re-warm lived here,
  // while the deck held the other half — a replacement — behind its own
  // transition guard. Two subscribers, two ideas of what counted as news. The
  // pool subscribes once and owns the whole ladder; what is left here is a badge.

  // BARE Escape IS DELIBERATELY UNBOUND HERE (James, 2026-08-04).
  //
  // Until now this page held a capture-phase Escape ladder: first press closed
  // the system-control panel, second closed Godview. Capture was the point — it
  // beat the deck to the key. That is also what was wrong with it: a terminal
  // pane holding focus NEVER received a literal Escape, so vim could not leave
  // insert mode inside the deck, and the ladder outranked every TUI a user came
  // here to run. The known cost was documented; it was still a cost.
  //
  // One door instead: ⇧⇧, a double tap of Shift detected in main from
  // `before-input-event`, which reaches it whatever holds focus (GT-D2) — so
  // nothing on this page needs to race the terminal for a key, and Escape now
  // belongs entirely to whatever has focus. (Since One Frame, FR-1: ⌘1 leaves
  // Godview and ⌘2 comes back, as product chords the frame takes first; ⇧⇧
  // retired. Escape is still never Godview's.)
  // The panel keeps its own × (`Close system controls`) and its toolbar toggle,
  // so the affordance is lost only from the keyboard, and only for the panel.
  // (Until GT-6a the deck's kill chip kept a bubble-phase Esc of its own to
  // withdraw its confirm — DESIGN.md §7's law rather than this ladder's. The
  // chip is retired with the rest of the deck's overlay chrome, so no listener
  // on this page competes for Escape at all now.)

  // M49 — the deck and System control are chrome beside the monitor, each
  // behind its own boundary: a throw in either says so where it stood, and the
  // monitor and its view stay mounted. Each tries again only for a fact it is
  // handed (M176). For the deck that is Godview opening or closing, or a new
  // theme — never the render its own failure causes here (a failed deck takes
  // its door with it, GT-D17, and this overlay re-renders with the null). The
  // panel tries again for its own values.
  const deckRetryKey = useMemo(() => ({ open, theme }), [open, theme]);
  const tuningRetryKey = useMemo(
    () => ({
      open: open && tuningOpen,
      theme,
      tuning,
      appearance,
      view: monitor.view,
      parameters: monitor.parameters,
      stage: monitor.stageParameters,
      rendererBackend,
    }),
    [
      open,
      tuningOpen,
      theme,
      tuning,
      appearance,
      monitor.view,
      monitor.parameters,
      monitor.stageParameters,
      rendererBackend,
    ],
  );

  if (!everOpened) return null;

  const terminalAvailable = terminalPoolConfigured();
  const stage = monitor.stageParameters;
  const screenStyle = {
    ...godviewTuningStyle(tuning),
    // The backdrop is the cover's 72% tint over the desk's still (DK-15) —
    // godview.css's own, no longer the viewer's (GT-7's setting retired).
    // The deck sheet is the frame: the terminal's own ground mixed toward the
    // terminal's own ink, so the root is handed both (DESIGN.md §8, GV-D7).
    ...godviewTerminalGroundStyle(appearance, theme),
    "--vf-scanline-density": `${stage[SCANLINE_DENSITY_KEY] ?? 2}px`,
    "--vf-scanline-opacity": stage[SCANLINE_OPACITY_KEY] ?? 0.4,
    "--vf-vignette-opacity": stage[VIGNETTE_OPACITY_KEY] ?? 1,
  } as CSSProperties;

  return (
    // THE FOLD, one per window (AR-6 §4.1, GT-6). The monitor and the deck are
    // siblings under the stage and both read fieldd's agent rows — the monitor
    // to draw the field, the deck to name and drive the agent in each pane — so
    // the subscription is opened once, here, over the door the deck publishes
    // upward. It asks nothing while Godview is closed (PF6).
    <GodviewAgentsProvider door={remoteDoor} subscribed={open}>
      <GodviewStage
        open={open}
        theme={theme}
        tuningOpen={tuningOpen}
        // GT-3p, lab only: one attribute silences every ambient loop on the
        // stage, so the frame readout can be watched with and without them. It
        // changes no layout and no color — what leaves is the motion alone.
        animations={labSwitches.animations}
        style={screenStyle}
        monitor={
          open && labSwitches.monitor ? (
            // LR — under the curtain the views draw last run's picture
            <MonitorFeedOverride feed={question !== null ? stillFeed : null}>
              <GodviewMonitor
                view={monitor.view}
                parameters={monitor.parameters}
                theme={theme}
                door={remoteDoor}
                panes={monitorPanes}
                // MV-W4: the same switch, for a ported view's own loop — and
                // under a maximized deck the view's bodies rest (GV-D11)
                animations={labSwitches.animations && deckState !== "maximized"}
                // P2: the window's Godview lends the frame's Peek its Live now
                publishesFind
                onSelectView={monitor.selectView}
                still={question !== null}
              />
            </MonitorFeedOverride>
          ) : undefined
        }
        curtain={
          open && question !== null ? (
            <LastRunCurtain
              state={lastRun}
              onRestore={restore}
              onStartClean={startClean}
              onContinue={dismissLastRun}
            />
          ) : undefined
        }
        tuningPanel={
          <ChromeBoundary name="System control" retryKey={tuningRetryKey}>
            <GodviewTuningPanel
              open={open && tuningOpen}
              theme={theme}
              value={tuning}
              appearance={appearance}
              monitorSections={monitorTuningSections(monitor)}
              rendererBackend={rendererBackend}
              onClose={() => setTuningOpen(false)}
              onChange={changeTuning}
              onReset={resetTuning}
              onResetMonitor={monitor.resetParameters}
            />
          </ChromeBoundary>
        }
        // The sheet's edge is this viewer's, remembered (DESIGN.md §8).
        deckEdge={DECK_EDGE_PERSISTED}
        // Round 3 (L2): the window's Godview says what its terminals are, and
        // only it: the frame reads this through the deck's door (nothing while
        // another view shows) and the shell hears it by name.
        deckState={deckState}
        onDeckState={setDeckState}
        publishesDeck
        deckRaisedBy={raisedBy}
        deck={
          terminalAvailable ? (
            <ChromeBoundary name="Deck" retryKey={deckRetryKey}>
              <GodviewDeck
                // Away, the terminals take no demand, as a closed Godview's
                // do: every session runs on the floor, nothing is drawn (PF6)
                active={open && deckState !== "away"}
                // W7: until the first call the deck is a door and nothing else
                called={called}
                onLastPaneClose={minimizeTerminals}
                theme={theme}
                onRendererBackend={setRendererBackend}
                onRemoteDoor={setRemoteDoor}
                onPanes={setPanes}
              />
            </ChromeBoundary>
          ) : (
            <GodviewUnavailableDeck />
          )
        }
      />
    </GodviewAgentsProvider>
  );
}
