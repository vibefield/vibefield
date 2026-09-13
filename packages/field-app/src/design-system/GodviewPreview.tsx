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

/** Runtime-free composition of the production Godview shell and monitor. The
 * terminal bridge is deliberately absent and therefore renders the same honest
 * unavailable deck the live overlay uses on a browser-only host. The views and
 * their registry are the puppeteer views package's since AR-5; the list view
 * opens because it draws without WebGPU, which a catalog host may lack (the
 * swarm's bodies have their own page, on the shipping view). */
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
