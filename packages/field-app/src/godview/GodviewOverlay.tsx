import type { TerminalBridgeStatus } from "@vibefield/contracts";
import { type CSSProperties, type ReactElement, useCallback, useEffect, useState } from "react";
import { getHost } from "../host";
import { useDeckAppearance } from "./deck-appearance";
import { GodviewDeck } from "./GodviewDeck";
import { GodviewMonitor } from "./GodviewMonitor";
import {
  defaultGodviewTuning,
  type GodviewTheme,
  type GodviewTuning,
  GodviewTuningPanel,
  godviewTuningStyle,
} from "./GodviewTuningPanel";
import { monitorTuningSections, useMonitorTuning } from "./monitor/monitor-tuning";
import {
  SCANLINE_DENSITY_KEY,
  SCANLINE_OPACITY_KEY,
  VIGNETTE_OPACITY_KEY,
} from "./monitor/stage-parameters";
import { useGodviewOpen } from "./overlay-state";

const THEME_STORAGE_KEY = "vf-godview-color-theme-v1";

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

  const changeTuning = useCallback((patch: Partial<GodviewTuning>) => {
    setTuning((current) => ({ ...current, ...patch }));
  }, []);
  const resetTuning = useCallback(() => setTuning(defaultGodviewTuning(theme)), [theme]);
  const changeTheme = useCallback((next: GodviewTheme) => {
    setTheme(next);
    setTuning(defaultGodviewTuning(next));
  }, []);

  useEffect(() => {
    if (open) setEverOpened(true);
    else setTuningOpen(false);
  }, [open]);

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
    return terminal.onStatus(setBridge);
  }, []);

  // BARE Escape IS DELIBERATELY UNBOUND HERE (James, 2026-08-04).
  //
  // Until now this page held a capture-phase Escape ladder: first press closed
  // the system-control panel, second closed Godview. Capture was the point — it
  // beat the deck to the key. That is also what was wrong with it: a terminal
  // pane holding focus NEVER received a literal Escape, so vim could not leave
  // insert mode inside the deck, and the ladder outranked every TUI a user came
  // here to run. The known cost was documented; it was still a cost.
  //
  // One door instead: ⌘⎋, which is an application accelerator and reaches main
  // whatever holds focus (GT-D2), so nothing on this page needs to race the
  // terminal for a key. Escape now belongs entirely to whatever has focus.
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
    <div
      aria-hidden={!open}
      data-godview-open={open ? "true" : "false"}
      data-godview-tuning-open={tuningOpen ? "true" : "false"}
      className={`vf-godview theme-${theme}`}
      style={screenStyle}
    >
      <div className="vf-godview-scanlines" aria-hidden="true" />
      <div className="vf-godview-vignette" aria-hidden="true" />

      {open && (
        <GodviewMonitor
          view={monitor.view}
          parameters={monitor.parameters}
          theme={theme}
          notice={notice}
          tuningOpen={tuningOpen}
          onSelectView={monitor.selectView}
          onToggleTuning={() => setTuningOpen((current) => !current)}
          onThemeChange={changeTheme}
        />
      )}

      <GodviewTuningPanel
        open={open && tuningOpen}
        theme={theme}
        value={tuning}
        appearance={appearance}
        monitorSections={monitorTuningSections(monitor)}
        onClose={() => setTuningOpen(false)}
        onThemeChange={changeTheme}
        onChange={changeTuning}
        onReset={resetTuning}
        onResetMonitor={monitor.resetParameters}
      />

      <section
        className="vf-godview-terminal-deck relative min-h-0 flex-1"
        aria-label="Terminal panes"
      >
        {terminalAvailable ? (
          <GodviewDeck active={open} theme={theme} />
        ) : (
          <p className="vf-godview-unavailable">
            THIS HOST HAS NO TERMINAL BRIDGE — THE DECK IS UNAVAILABLE HERE.
          </p>
        )}
      </section>
    </div>
  );
}
