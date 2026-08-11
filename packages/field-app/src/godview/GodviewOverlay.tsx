import type { TerminalBridgeStatus } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type CSSProperties, type ReactElement, useCallback, useEffect, useState } from "react";
import { getHost } from "../host";
import { godviewColdOpen } from "./cold-open";
import { useDeckAppearance } from "./deck-appearance";
import { GodviewDeck } from "./GodviewDeck";
import { GodviewMonitor } from "./GodviewMonitor";
import { GodviewStage, GodviewUnavailableDeck } from "./GodviewStage";
import {
  defaultGodviewTuning,
  type GodviewTheme,
  type GodviewTuning,
  GodviewTuningPanel,
  godviewTuningStyle,
} from "./GodviewTuningPanel";
import { useLabSwitches } from "./lab-switches";
import { monitorTuningSections, useMonitorTuning } from "./monitor/monitor-tuning";
import type { RemoteSessionDoor } from "./monitor/remote-door";
import {
  SCANLINE_DENSITY_KEY,
  SCANLINE_OPACITY_KEY,
  VIGNETTE_OPACITY_KEY,
} from "./monitor/stage-parameters";
import type { MonitorPaneFacts } from "./monitor/useMonitorAgents";
import { useGodviewOpen } from "./overlay-state";
import {
  discardWarmTransport,
  prewarmGodviewTransport,
  rewarmGodviewTransport,
} from "./warm-transport";

const THEME_STORAGE_KEY = "vf-godview-color-theme-v1";
/** The prewarm's off switch (GT-3p). A DIAGNOSTIC, not a product setting: the
 * smoke sets it to measure a genuinely cold open, and the only supported value
 * is the one that disables. Nothing in the UI writes it. */
const PREWARM_STORAGE_KEY = "vf-godview-prewarm-v1";

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

function initialGodviewTheme(): GodviewTheme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** A healthy bridge is a standing fact and gets no badge. */
function bridgeNotice(status: TerminalBridgeStatus | null): string | null {
  if (status === null || status.state === "bridge-up") return null;
  if (status.state === "bridge-down") return "TERMINAL BRIDGE DOWN · REBUILDING";
  return "TERMINAL BRIDGE UNAVAILABLE · RECONNECTING";
}

export function GodviewOverlay(): ReactElement | null {
  const open = useGodviewOpen();
  const [everOpened, setEverOpened] = useState(false);
  const [bridge, setBridge] = useState<TerminalBridgeStatus | null>(null);
  const [theme, setTheme] = useState<GodviewTheme>(initialGodviewTheme);
  const [tuning, setTuning] = useState<GodviewTuning>(() => defaultGodviewTuning(theme));
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

  const changeTuning = useCallback((patch: Partial<GodviewTuning>) => {
    setTuning((current) => ({ ...current, ...patch }));
  }, []);
  const resetTuning = useCallback(() => setTuning(defaultGodviewTuning(theme)), [theme]);
  const changeTheme = useCallback((next: GodviewTheme) => {
    setTheme(next);
    setTuning(defaultGodviewTuning(next));
  }, []);

  useEffect(() => {
    if (open) {
      // Time zero for the cold-open trace, taken before any React work the open
      // causes — this effect runs on the commit that first saw `open`.
      godviewColdOpen.mark("open");
      setEverOpened(true);
    } else setTuningOpen(false);
  }, [open]);

  // THE PREWARM (GT-D14). At idle after this overlay has mounted — which is
  // after the canvas has committed, since the overlay is mounted beneath it —
  // and never on the startup path. What warms is transport only: a ticket, a
  // bridge, a socket, a worker, a GPU device. No session, no shell, no PTY.
  //
  // Cancelled the moment the overlay has ever been open: from then on the deck
  // owns the transport, and a prewarm waking up behind it would build a second
  // runtime waiting for the same one-shot ports (see the one-runtime law).
  // `takeTransportForDeck` closes that race authoritatively; this only keeps the
  // pointless work from being scheduled in the first place.
  useEffect(() => {
    if (!prewarmEnabled() || everOpened) return;
    // The trace goes with it: the prewarm's stations are stamped BEFORE the
    // open, which is what lets the cold-open report name them as `warm` rather
    // than merely omitting them. An absent phase and a phase that was already
    // done look the same in a breakdown otherwise.
    return whenIdle(() => prewarmGodviewTransport(fieldd, godviewColdOpen), 2_000);
  }, [fieldd, everOpened]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // A disabled storage partition should not disable the switch itself.
    }
  }, [theme]);

  useEffect(() => {
    const terminal = getHost().terminal;
    if (terminal === undefined) return;
    return terminal.onStatus((status) => {
      setBridge(status);
      // GT-D14's custody clause: a warm transport whose bridge died before
      // anyone used it is dead weight holding a disposed worker. Discarding it
      // spends the attempt — `rewarmGodviewTransport` allows exactly one more,
      // and nothing here loops. A CLAIMED transport is untouched: it belongs to
      // the deck, whose own recovery ladder (GT-1) owns it from then on.
      if (status.state === "bridge-down") discardWarmTransport("the bridge died before first use");
      // The one lazy re-warm. `rewarmGodviewTransport` is a no-op unless the
      // singleton is SPENT and has never re-warmed, so a bridge that flaps — or
      // a deck's own recovery republishing bridge-up — cannot turn this into a
      // ladder. Nothing schedules a retry; the next bridge-up is the trigger, or
      // there is no second attempt at all.
      if (status.state === "bridge-up") rewarmGodviewTransport(fieldd);
    });
  }, [fieldd]);

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
  // belongs entirely to whatever has focus.
  // The panel keeps its own × (`Close system controls`) and its toolbar toggle,
  // so the affordance is lost only from the keyboard, and only for the panel.
  // KillActivePane's Esc-disarms stays: it is bubble-phase, armed-only, and
  // withdrawing a destructive confirm is DESIGN.md §7's law, not this ladder's.

  if (!everOpened) return null;

  const notice = bridgeNotice(bridge);
  const terminalAvailable = getHost().terminal !== undefined;
  const stage = monitor.stageParameters;
  const screenStyle = {
    ...godviewTuningStyle(tuning),
    "--vf-monitor-stage-height": `${monitor.stageHeight}%`,
    "--vf-scanline-density": `${stage[SCANLINE_DENSITY_KEY] ?? 2}px`,
    "--vf-scanline-opacity": stage[SCANLINE_OPACITY_KEY] ?? 0.4,
    "--vf-vignette-opacity": stage[VIGNETTE_OPACITY_KEY] ?? 1,
  } as CSSProperties;

  return (
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
          <GodviewMonitor
            view={monitor.view}
            parameters={monitor.parameters}
            theme={theme}
            notice={notice}
            tuningOpen={tuningOpen}
            door={remoteDoor}
            panes={panes}
            onSelectView={monitor.selectView}
            onToggleTuning={() => setTuningOpen((current) => !current)}
            onThemeChange={changeTheme}
          />
        ) : undefined
      }
      tuningPanel={
        <GodviewTuningPanel
          open={open && tuningOpen}
          theme={theme}
          value={tuning}
          appearance={appearance}
          monitorSections={monitorTuningSections(monitor)}
          rendererBackend={rendererBackend}
          onClose={() => setTuningOpen(false)}
          onThemeChange={changeTheme}
          onChange={changeTuning}
          onReset={resetTuning}
          onResetMonitor={monitor.resetParameters}
        />
      }
      deck={
        terminalAvailable ? (
          <GodviewDeck
            active={open}
            theme={theme}
            onRendererBackend={setRendererBackend}
            onRemoteDoor={setRemoteDoor}
            onPanes={setPanes}
          />
        ) : (
          <GodviewUnavailableDeck />
        )
      }
    />
  );
}
