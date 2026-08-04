import { type ReactElement, useEffect, useRef } from "react";
import { emitGodviewMonitorMarker } from "../development-console";
import { MONITOR_CHROME_ATTRIBUTE, MONITOR_STAGE_CLASS } from "./monitor/chrome";
import { useMonitorPalette } from "./monitor/monitor-palette";
import type { MonitorParameters } from "./monitor/parameters";
import type { AgentMonitorView } from "./monitor/types";
import { useMonitorAgents } from "./monitor/useMonitorAgents";

// The monitor stage (GT-3m) — the reference app's monitor⇄workspace composition,
// inside our overlay.
//
// The reference lays its window out as header · monitor stage · terminal deck,
// with the stage's share of the height a tunable and the deck taking the rest.
// That shape is mirrored here rather than reinvented: `GodviewOverlay` is the
// column, this is the top of it, `GodviewDeck` is the bottom.
//
// LIFETIME, and it is the PF6 answer: this component is mounted ONLY while the
// overlay is open. The deck below it stays mounted while closed — that is what
// makes reopening instant and the pane layout survive — but a monitor has no
// layout to preserve and a deterministic timeline to restart from, so it takes
// the stricter treatment: closing the Godview unmounts the stage, which clears
// the mock's interval, tears down matter's engine and its rAF loop, and
// disconnects every observer. A closed overlay runs no monitor work at all,
// which is a stronger claim than "no monitor work is scheduled".
//
// THE LABEL IS LAW (GT-D13). Every row on this stage is invented, and a monitor
// showing invented agents without saying so violates the honest-states rule as
// squarely as a blank card that means "loading". The label is chrome in the
// `monitor/chrome.ts` sense — physical furniture the swarm's bodies collide
// with — so it cannot be quietly drawn over either.

/** The words themselves, exported so the smoke asserts on the STRING the stage
 * renders rather than on a copy of it that could drift. */
export const MOCK_LABEL = "preview — mock agents";

/** How long an acknowledgement stays on the eyebrow. Long enough to read one
 * short sentence, short enough that it is gone before the next gesture. */
const ACKNOWLEDGEMENT_MS = 2_600;

export interface GodviewMonitorProps {
  view: AgentMonitorView;
  parameters: MonitorParameters;
}

export function GodviewMonitor({ view, parameters }: GodviewMonitorProps): ReactElement {
  const palette = useMonitorPalette();
  const { agents, actions, acknowledgement, clearAcknowledgement } = useMonitorAgents({ palette });
  const stageRef = useRef<HTMLElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);

  // Views that lay out in flow clear the chrome with this; the swarm instead
  // reads the chrome's rect directly (through `monitorChromeElements`) and
  // steers bodies around it. The measure is a WIDTH because our chrome is
  // anchored top-right and occupies no full band — the reference publishes a
  // height for the same reason in reverse, its chrome being a full-width panel.
  useEffect(() => {
    const stage = stageRef.current;
    const chrome = chromeRef.current;
    if (!stage || !chrome || typeof ResizeObserver === "undefined") return;
    const publish = (): void =>
      stage.style.setProperty(
        "--vf-monitor-chrome-width",
        `${Math.round(chrome.getBoundingClientRect().width)}px`,
      );
    const observer = new ResizeObserver(publish);
    observer.observe(chrome);
    publish();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (acknowledgement === null) return;
    const timer = window.setTimeout(clearAcknowledgement, ACKNOWLEDGEMENT_MS);
    return () => window.clearTimeout(timer);
  }, [acknowledgement, clearAcknowledgement]);

  // What the monitor currently IS, said out loud once per change — the deck's
  // own marker idiom (`GODVIEW_DECK`), for the same reason: a headless harness
  // has no other way to ask a page what it drew, and "the label is present" is
  // exactly the kind of claim a smoke should be able to hold.
  useEffect(() => {
    emitGodviewMonitorMarker({
      viewId: view.id,
      agents: agents.length,
      agentBacked: agents.filter((agent) => agent.agent !== undefined).length,
      mockLabel: MOCK_LABEL,
    });
  }, [agents, view.id]);

  const MonitorView = view.Component;

  return (
    <section
      ref={stageRef}
      className={MONITOR_STAGE_CLASS}
      aria-label="Agent monitor — mock preview"
    >
      <MonitorView agents={agents} parameters={parameters} actions={actions} palette={palette} />
      {/* The eyebrow (§3): 10px, uppercase, tracked, at the ramp's eyebrow
          opacity. It is `data-monitor-chrome` so the swarm treats it as solid,
          and it is `aria-live` because when it carries an acknowledgement it is
          the ONLY confirmation a click gets. */}
      <div ref={chromeRef} className="vf-monitor-chrome" {...{ [MONITOR_CHROME_ATTRIBUTE]: "" }}>
        <span className="vf-monitor-mock-chip">{MOCK_LABEL}</span>
        <span className="vf-monitor-ack" aria-live="polite">
          {acknowledgement?.message ?? ""}
        </span>
      </div>
    </section>
  );
}
