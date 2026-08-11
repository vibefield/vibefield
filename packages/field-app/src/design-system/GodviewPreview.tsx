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
import { monitorParameterDefaults } from "../godview/monitor/parameters";
import { monitorViewFor } from "../godview/monitor/registry";

/** Runtime-free composition of the production Godview shell and monitor. The
 * terminal bridge is deliberately absent and therefore renders the same honest
 * unavailable deck the live overlay uses on a browser-only host. */
export function GodviewPreview(): ReactElement {
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
  );
}
