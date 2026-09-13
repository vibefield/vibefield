import {
  type MonitorActions,
  type MonitorAgent,
  monitorParameterDefaults,
  stateStages,
  swarmMonitorView,
  useMonitorPalette,
} from "@vibecook/puppeteer-views";
import { type ReactElement, useMemo, useRef, useState } from "react";

// The swarm's bodies, every drawn state at once: the views package's own lab
// fixtures (the design record's stages — the empty and running terminal, the
// idle, working and blocked agent, the pane light, the unread dot, the hot
// burn) mounted through the SHIPPING view, never a replica of its drawing.
// What the catalog shows is what Godview paints, on this browser's WebGPU; a
// browser without it shows the same honest line the product does.
//
// The chrome above the stage is the catalog's fixture adapter and nothing more
// (docs/UI_SYSTEM.md): the theme and the motion switch are what a HOST sets on
// the Godview root, and selection is the host's verb answered the way a deck
// answers it — by making the row current. The physics runs in this thread,
// which is the package's default; the product's worker is the overlay's
// business, not a page's.

type BodiesTheme = "light" | "dark";

export function SwarmBodiesPreview(): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nowMs = useMemo(() => Date.now(), []);
  const [theme, setTheme] = useState<BodiesTheme>("light");
  const [motion, setMotion] = useState(true);
  const [arrival, setArrival] = useState(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const stages = useMemo(() => stateStages(nowMs), [nowMs]);
  const agents = useMemo<readonly MonitorAgent[]>(
    () =>
      stages.map((stage) =>
        stage.agent.id === selectedId ? { ...stage.agent, active: true } : stage.agent,
      ),
    [stages, selectedId],
  );
  const parameters = useMemo(() => monitorParameterDefaults(swarmMonitorView.parameterGroups), []);
  const actions = useMemo<MonitorActions>(
    () => ({
      select: (agent) => setSelectedId((current) => (current === agent.id ? undefined : agent.id)),
      createAt: () => undefined,
    }),
    [],
  );
  // The palette is read from THIS root: the page has another Godview root (the
  // stage specimen) in its own theme, and the bodies must wear theirs.
  const palette = useMonitorPalette(rootRef);
  const Swarm = swarmMonitorView.Component;

  return (
    <div
      ref={rootRef}
      className={`vf-godview vf-ds-swarm-bodies-catalog theme-${theme}`}
      data-swarm-bodies-catalog=""
      data-swarm-bodies-theme={theme}
      data-godview-open="true"
      data-godview-animations={motion ? "on" : "off"}
    >
      <div className="vf-ds-swarm-bodies-toolbar">
        <div>
          <span className="vf-ds-swarm-bodies-toolbar-eyebrow">
            the package's fixtures · the shipping renderer
          </span>
          <strong>Every drawn state of a body</strong>
          <small>
            One body per stage of the design record, drawn by the same WebGPU pipeline the overlay
            uses. Each body is also a button: select one to see it current, as a deck would show it.
          </small>
        </div>
        <div className="vf-ds-swarm-bodies-actions">
          <button
            type="button"
            aria-pressed={theme === "dark"}
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "LIGHT THEME" : "DARK THEME"}
          </button>
          <button
            type="button"
            aria-pressed={!motion}
            onClick={() => setMotion((current) => !current)}
          >
            {motion ? "PAUSE MOTION" : "RESUME MOTION"}
          </button>
          <button
            type="button"
            disabled={!motion}
            onClick={() => setArrival((current) => current + 1)}
          >
            REPLAY ARRIVALS
          </button>
        </div>
      </div>
      <section className="vf-godview-monitor-stage" aria-label="Swarm bodies">
        <Swarm
          key={arrival}
          agents={agents}
          parameters={parameters}
          actions={actions}
          palette={palette}
        />
      </section>
    </div>
  );
}
