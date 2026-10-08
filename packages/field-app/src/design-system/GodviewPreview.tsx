import { monitorParameterDefaults, monitorViewFor } from "@vibecook/puppeteer-views";
import { type CSSProperties, type ReactElement, useMemo, useState } from "react";
import { useDeckAppearance } from "../godview/deck-appearance";
import { godviewTerminalGroundStyle } from "../godview/deck-theme";
import { GodviewMonitor } from "../godview/GodviewMonitor";
import { GodviewStage, GodviewUnavailableDeck } from "../godview/GodviewStage";
import {
  defaultGodviewTuning,
  type GodviewTheme,
  type GodviewTuning,
  GodviewTuningPanel,
  godviewTuningStyle,
} from "../godview/GodviewTuningPanel";
import { GodviewAgentsProvider } from "../godview/monitor/GodviewAgentsProvider";
import type { MonitorDoor } from "../godview/monitor/remote-door";
import type { MonitorPaneFacts } from "../godview/monitor/useMonitorAgents";

/** Runtime-free composition of the production Godview shell and monitor. The
 * terminal bridge is deliberately absent and therefore renders the same honest
 * unavailable deck the live overlay uses on a browser-only host. The views and
 * their registry are the puppeteer views package's since AR-5; the list view
 * opens because it draws without WebGPU, which a catalog host may lack (the
 * swarm's bodies have their own page, on the shipping view). A `door` — the
 * profile tabs' fixture (AR-S5) — puts a fold and its profiles on the stage;
 * without one nobody is asked, and the stage says so. `panes` are a deck's facts
 * as a fixture keeps them (the spawn bloom's births, SB-3), and `initialView`
 * opens another view — the swarm, where a host has WebGPU to draw it. */
export function GodviewPreview({
  door = null,
  panes,
  initialView = "list",
  theme = "light",
}: {
  door?: MonitorDoor | null;
  panes?: MonitorPaneFacts;
  initialView?: string;
  /** Godview follows the app's theme (FC-D7) — here, the catalog page's. */
  theme?: GodviewTheme;
} = {}): ReactElement {
  const [viewId, setViewId] = useState(initialView);
  const [tuningOpen, setTuningOpen] = useState(false);
  const [tuning, setTuning] = useState<GodviewTuning>(() => defaultGodviewTuning(theme));
  const [tunedFor, setTunedFor] = useState(theme);
  if (tunedFor !== theme) {
    setTunedFor(theme);
    setTuning(defaultGodviewTuning(theme));
  }
  const appearance = useDeckAppearance();
  const view = monitorViewFor(viewId);
  const parameters = useMemo(() => monitorParameterDefaults(view.parameterGroups), [view]);

  const screenStyle = {
    ...godviewTuningStyle(tuning),
    ...godviewTerminalGroundStyle(appearance, theme),
    "--vf-monitor-stage-height": "35%",
    "--vf-scanline-density": "2px",
    "--vf-scanline-opacity": 0.4,
    "--vf-vignette-opacity": 1,
  } as CSSProperties;

  return (
    // The window's fold (GT-6), with no door to open: the catalog has no
    // daemon, so the field is `no-door` — nobody has been asked — and the
    // monitor draws the honest empty stage rather than invented rows.
    <GodviewAgentsProvider door={door}>
      <div className="vf-ds-godview-frame">
        <GodviewStage
          open
          theme={theme}
          tuningOpen={tuningOpen}
          animations={false}
          style={screenStyle}
          monitor={
            <GodviewMonitor
              view={view}
              parameters={parameters}
              // the stage's switch above (MV-W4): a ported view's loop holds still too
              animations={false}
              door={door}
              {...(panes !== undefined ? { panes } : {})}
              theme={theme}
              tuningOpen={tuningOpen}
              onSelectView={setViewId}
              onToggleTuning={() => setTuningOpen((current) => !current)}
            />
          }
          tuningPanel={
            <GodviewTuningPanel
              open={tuningOpen}
              theme={theme}
              value={tuning}
              appearance={appearance}
              monitorSections={[]}
              rendererBackend="design preview"
              onClose={() => setTuningOpen(false)}
              onChange={(patch) => setTuning((current) => ({ ...current, ...patch }))}
              onReset={() => setTuning(defaultGodviewTuning(theme))}
              onResetMonitor={() => undefined}
            />
          }
          // The shipping edge, live on the page and forgotten with it.
          deckEdge={{ persist: false }}
          deck={<GodviewUnavailableDeck />}
        />
      </div>
    </GodviewAgentsProvider>
  );
}
