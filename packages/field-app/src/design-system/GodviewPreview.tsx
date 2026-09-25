import { monitorParameterDefaults, monitorViewFor } from "@vibecook/puppeteer-views";
import { type CSSProperties, type ReactElement, useMemo, useState } from "react";
import { useDeckAppearance } from "../godview/deck-appearance";
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

/** Runtime-free composition of the production Godview shell and monitor. The
 * terminal bridge is deliberately absent and therefore renders the same honest
 * unavailable deck the live overlay uses on a browser-only host. The views and
 * their registry are the puppeteer views package's since AR-5; the list view
 * opens because it draws without WebGPU, which a catalog host may lack (the
 * swarm's bodies have their own page, on the shipping view). A `door` — the
 * profile tabs' fixture (AR-S5) — puts a fold and its profiles on the stage;
 * without one nobody is asked, and the stage says so. */
export function GodviewPreview({ door = null }: { door?: MonitorDoor | null } = {}): ReactElement {
  const [viewId, setViewId] = useState("list");
  const [theme, setTheme] = useState<GodviewTheme>("light");
  const [tuningOpen, setTuningOpen] = useState(false);
  const [tuning, setTuning] = useState<GodviewTuning>(() => defaultGodviewTuning("light"));
  const appearance = useDeckAppearance();
  const view = monitorViewFor(viewId);
  const parameters = useMemo(() => monitorParameterDefaults(view.parameterGroups), [view]);

  const changeTheme = (next: GodviewTheme): void => {
    setTheme(next);
    setTuning(defaultGodviewTuning(next));
  };
  const screenStyle = {
    ...godviewTuningStyle(tuning),
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
              door={door}
              theme={theme}
              tuningOpen={tuningOpen}
              onSelectView={setViewId}
              onToggleTuning={() => setTuningOpen((current) => !current)}
              onThemeChange={changeTheme}
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
              onThemeChange={changeTheme}
              onChange={(patch) => setTuning((current) => ({ ...current, ...patch }))}
              onReset={() => setTuning(defaultGodviewTuning(theme))}
              onResetMonitor={() => undefined}
            />
          }
          deck={<GodviewUnavailableDeck />}
        />
      </div>
    </GodviewAgentsProvider>
  );
}
