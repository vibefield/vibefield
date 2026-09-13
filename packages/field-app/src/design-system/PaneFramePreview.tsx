import {
  PaneFrame,
  PaneFrameChrome,
  type PaneFrameSession,
  type PaneFrameVerbs,
  paneFrameModel,
} from "@vibecook/puppeteer-views";
import { type CSSProperties, type ReactElement, useState } from "react";
import { DEFAULT_DECK_APPEARANCE } from "../godview/deck-appearance";
import { godviewTerminalTheme, terminalGround } from "../godview/deck-theme";
import type { AgentSessionSummary } from "../godview/monitor/facet-types";
import { paneFrameAgentFacts } from "../godview/monitor/pane-frame-facts";

/**
 * THE PANE FRAME, as the deck ships it (GT-6, record §07).
 *
 * The frame is the views package's since PU-14 and it is mounted here whole:
 * this file owns no markup of its own and no stylesheet — `PaneFrameChrome` is
 * the shipping component, `paneFrameModel` the shipping model, and
 * `paneFrameAgentFacts` the shipping projection VibeField feeds it with. What
 * the catalog supplies is exactly what a HOST supplies (docs/UI_SYSTEM.md's
 * fixture-adapter rule): a pane element to draw in, a pane colour, the terminal
 * ground the frame mixes its ink from, and fold rows that never existed.
 *
 * The pane wrapper carries ghosttea's own class and the deck's
 * `vf-deck-framed` scope because the package's stylesheet keys the safe areas,
 * the radius and the hover on them — standing in for the pane, not redrawing
 * the frame. The verbs are no-ops: the catalog has no daemon to interrupt, and
 * a fixture that dialled one would be a second host.
 */

/** A fixed clock, so the stop verb's elapsed reads the same in every capture. */
const NOW = Date.parse("2026-09-13T21:00:00.000Z");

const VERBS: PaneFrameVerbs = {
  stop: () => ({ accepted: true }),
  resume: () => undefined,
  zoom: () => undefined,
  zoomShortcut: "⌘⇧↵",
};

interface FoldRowOptions {
  kind: string;
  label: string;
  status: AgentSessionSummary["status"];
  cwd: string;
  alive?: boolean;
  statusSinceMs?: number;
  model?: { id: string; displayName?: string };
  effort?: { value: string; intent: string };
  contextPercent?: number;
  percentageSource?: string;
  /** A run before its first monitor state: no facts, and the bare badge. */
  monitor?: false;
}

/** One fold row, shaped as fieldd's `agent.subscribe` reports it. */
function foldRow(options: FoldRowOptions): AgentSessionSummary {
  const statusSince = new Date(options.statusSinceMs ?? NOW).toISOString();
  return {
    sessionId: "native-1",
    kind: options.kind,
    label: options.label,
    device: "this-device",
    tier: "managed",
    runtimeRunId: "run-1",
    runtimeEpoch: 1,
    terminal: { hosted: "local", runtimeSessionId: "pty-1" },
    workspace: { mode: "direct", root: options.cwd },
    ...(options.monitor === false
      ? {}
      : {
          monitor: {
            schemaVersion: 3,
            runtimeEpoch: 1,
            revision: 4,
            runtimeRunId: "run-1",
            status: options.status === "unknown" ? "idle" : options.status,
            statusSince,
            blockers: [],
            alive: options.alive ?? true,
            environment: { cwd: options.cwd },
            ...(options.model !== undefined ? { model: options.model } : {}),
            ...(options.effort !== undefined ? { effort: options.effort } : {}),
            ...(options.contextPercent !== undefined
              ? {
                  context: {
                    usedTokens: options.contextPercent * 2_000,
                    capacityTokens: 200_000,
                    usedPercent: options.contextPercent,
                    ...(options.percentageSource !== undefined
                      ? { percentageSource: options.percentageSource }
                      : {}),
                  },
                }
              : {}),
          },
        }),
    status: options.status,
    observationLevel: "native-hooks",
    createdAt: statusSince,
    stateChangedAt: statusSince,
  };
}

interface FrameSpecimen {
  id: string;
  caption: string;
  session: PaneFrameSession;
  row?: AgentSessionSummary;
  remote?: string;
  color?: string;
  zoomed?: boolean;
  stopping?: boolean;
  narrow?: boolean;
}

const SHELL: PaneFrameSession = { id: "pty-1", exited: false, cwd: "/Users/j/src/vibe-field" };

const SPECIMENS: readonly FrameSpecimen[] = [
  {
    id: "shell",
    caption: "a bare shell — the folder, and nothing it cannot say",
    session: SHELL,
  },
  {
    id: "starting",
    caption: "a run before its first state — still the bare badge, never an invented readout",
    session: SHELL,
    row: foldRow({
      kind: "claude",
      label: "Claude",
      status: "unknown",
      cwd: "/Users/j/src/vibe-field",
      monitor: false,
    }),
    color: "oklch(0.62 0.15 250)",
  },
  {
    id: "working",
    caption: "working — the turn's time on the stop verb, the context meter past 80%",
    session: SHELL,
    color: "oklch(0.62 0.15 250)",
    row: foldRow({
      kind: "claude",
      label: "Claude",
      status: "working",
      cwd: "/Users/j/src/vibe-field",
      statusSinceMs: NOW - 102_000,
      model: { id: "claude-opus-5", displayName: "Opus 5" },
      effort: { value: "high", intent: "configured" },
      contextPercent: 86,
    }),
  },
  {
    id: "stopping",
    caption: "stop pressed, nothing confirmed yet — the square hollow until the run leaves working",
    session: SHELL,
    color: "oklch(0.62 0.15 250)",
    stopping: true,
    row: foldRow({
      kind: "claude",
      label: "Claude",
      status: "working",
      cwd: "/Users/j/src/vibe-field",
      statusSinceMs: NOW - 9_000,
      model: { id: "claude-opus-5", displayName: "Opus 5" },
      contextPercent: 41,
    }),
  },
  {
    id: "exited",
    caption: "the process has ended — one verb, resume",
    session: { id: "pty-2", exited: true, cwd: "/Users/j/src/rosetta" },
    color: "oklch(0.7 0.14 150)",
    row: foldRow({
      kind: "codex",
      label: "Codex",
      status: "idle",
      cwd: "/Users/j/src/rosetta",
      alive: false,
      model: { id: "gpt-5-codex" },
      contextPercent: 12,
    }),
  },
  {
    id: "remote",
    caption: "a peer's session — the tether says elsewhere, and names the device",
    session: { id: "replica-1", exited: false, cwd: "/Users/j/src/truffle" },
    remote: "mini",
    color: "oklch(0.66 0.13 60)",
    row: foldRow({
      kind: "claude",
      label: "Claude",
      status: "idle",
      cwd: "/Users/j/src/truffle",
      model: { id: "claude-sonnet-5", displayName: "Sonnet 5" },
      effort: { value: "medium", intent: "observed" },
      contextPercent: 34,
      percentageSource: "derived",
    }),
  },
  {
    id: "narrow",
    caption: "narrow — the readout goes, the stop verb keeps its square",
    session: SHELL,
    narrow: true,
    color: "oklch(0.62 0.15 250)",
    row: foldRow({
      kind: "claude",
      label: "Claude",
      status: "working",
      cwd: "/Users/j/src/vibe-field",
      statusSinceMs: NOW - 384_000,
      model: { id: "claude-opus-5", displayName: "Opus 5" },
      contextPercent: 62,
    }),
  },
  {
    id: "unavailable-share",
    caption: "a provider that cannot say how full its window is — no meter, no invented figure",
    session: SHELL,
    color: "oklch(0.62 0.15 250)",
    row: foldRow({
      kind: "gemini",
      label: "Gemini",
      status: "idle",
      cwd: "/Users/j/src/vibe-field",
      model: { id: "gemini-3-pro" },
      contextPercent: 44,
      percentageSource: "unavailable",
    }),
  },
];

function PaneSpecimen({
  specimen,
  ground,
}: {
  specimen: FrameSpecimen;
  ground: { background: string; ink: string };
}): ReactElement {
  const agent = specimen.row === undefined ? undefined : paneFrameAgentFacts(specimen.row);
  /** The pane element the frame is PORTALLED into, exactly as the deck hands
   * ghosttea's over. Held in state rather than a ref so the portal mounts on
   * the render after the element exists. */
  const [pane, setPane] = useState<HTMLElement | null>(null);
  return (
    <figure className="vf-ds-pane-frame-figure">
      {/* The host's pane, standing in for ghosttea's: the class the frame's
          stylesheet scopes to, the colour the workspace sets, the ground the
          terminal draws on, and a real WIDTH — the narrow specimen is 200px and
          the package's own observer decides what that means, rather than this
          fixture writing `data-vf-narrow` by hand and calling it a state. */}
      <div
        ref={setPane}
        className="ghostty-pane is-active"
        data-pane-id={specimen.id}
        // Ghosttea's accent layer exists only for a pane the host dealt a
        // colour, and since PU-14b that is what decides whether the frame's
        // line and glow are the project's or the terminal's ink — so the bare
        // shell carries no accent here either.
        {...(specimen.color !== undefined ? { "data-pane-accent": "" } : {})}
        style={
          {
            position: "relative",
            width: specimen.narrow ? 200 : 320,
            height: 132,
            background: ground.background,
            "--ghostty-pane-color": specimen.color ?? "",
          } as CSSProperties
        }
      >
        {specimen.stopping ? (
          // The ONE specimen the portal cannot hold still: `stopping` is state
          // inside `PaneFrame`, set by a press and cleared when the run leaves
          // `working`, so the markup half is mounted with it forced. Same
          // shipping component underneath — `PaneFrame` renders this.
          <PaneFrameChrome
            sessionId={specimen.session.id}
            model={paneFrameModel({
              session: specimen.session,
              ...(agent ? { agent } : {}),
              nowMs: NOW,
            })}
            {...(specimen.color !== undefined ? { color: specimen.color } : {})}
            zoomed={specimen.zoomed === true}
            stopping
            verbs={VERBS}
            onStop={() => undefined}
            onResume={() => undefined}
            onZoom={() => undefined}
          />
        ) : pane === null ? null : (
          <PaneFrame
            pane={pane}
            session={specimen.session}
            {...(agent ? { agent } : {})}
            {...(specimen.remote !== undefined ? { remote: specimen.remote } : {})}
            {...(specimen.color !== undefined ? { color: specimen.color } : {})}
            zoomed={specimen.zoomed === true}
            nowMs={NOW}
            verbs={VERBS}
          />
        )}
      </div>
      <figcaption>{specimen.caption}</figcaption>
    </figure>
  );
}

export function PaneFramePreview(): ReactElement {
  const light = terminalGround(godviewTerminalTheme(DEFAULT_DECK_APPEARANCE, "light"));
  const dark = terminalGround(godviewTerminalTheme(DEFAULT_DECK_APPEARANCE, "dark"));
  return (
    <div className="vf-ds-pane-frames">
      {[
        { id: "light", ground: light },
        { id: "dark", ground: dark },
      ].map((theme) => (
        <div
          key={theme.id}
          className="vf-deck-framed vf-ds-pane-frame-deck"
          style={{ "--vf-godview-terminal-ink": theme.ground.ink } as CSSProperties}
        >
          {SPECIMENS.map((specimen) => (
            <PaneSpecimen key={specimen.id} specimen={specimen} ground={theme.ground} />
          ))}
        </div>
      ))}
    </div>
  );
}
