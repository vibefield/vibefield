import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import { type CSSProperties, type ReactElement, useMemo, useRef, useState } from "react";
import type { GodviewTheme } from "../godview/GodviewTuningPanel";
import type { AgentVisualStatus } from "../godview/monitor/agent-status";
import { providerLabel } from "../godview/monitor/agent-status";
import type { AgentKind } from "../godview/monitor/facet-types";
import { useMonitorPalette } from "../godview/monitor/monitor-palette";
import type { MonitorAgent, PaneAttachment } from "../godview/monitor/types";
import {
  AgentBubbleView,
  agentBubblePresentation,
  animateAgentBubbleSpawn,
} from "../godview/views/swarm/AgentBubble";
import {
  DEFAULT_SWARM_PARAMETERS,
  radiusForStatus,
  type SwarmParameters,
} from "../godview/views/swarm/swarm-parameters";

interface AgentFixtureOptions {
  id: string;
  project: string;
  status: AgentVisualStatus;
  color: string;
  kind?: AgentKind;
  model?: string;
  branch?: string;
  contextPercent?: number;
  active?: boolean;
  attachment?: PaneAttachment;
  detail?: string;
}

function agentFixture(options: AgentFixtureOptions): MonitorAgent {
  const kind = options.kind ?? "claude";
  const session = {
    id: options.id,
    exited: false,
    createdAtMs: 0,
  } as SessionSummary;
  const contextWindow =
    options.contextPercent === undefined
      ? undefined
      : {
          usedTokens: options.contextPercent * 2_000,
          capacityTokens: 200_000,
          usedPercent: options.contextPercent,
          modelId: options.model ?? providerLabel(kind),
          updatedAt: "2026-08-05T00:00:00.000Z",
        };

  return {
    id: options.id,
    session,
    createdAtMs: 0,
    status: options.status,
    project: options.project,
    detail: options.detail ?? options.status,
    color: options.color,
    active: options.active ?? false,
    ...(options.attachment ? { attachment: options.attachment } : {}),
    agent: {
      kind,
      provider: providerLabel(kind),
      ...(options.model ? { model: options.model } : {}),
      ...(options.branch ? { branch: options.branch } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      info: {
        agent: kind,
        sessionId: options.id,
        runtimeSessionId: `runtime-${options.id}`,
        workspace: { mode: "direct", root: `/Projects/${options.project}` },
        session,
      },
    },
  };
}

function terminalFixture(
  id: string,
  status: Exclude<AgentVisualStatus, "waiting">,
  color: string,
): MonitorAgent {
  return {
    id,
    createdAtMs: 0,
    status,
    project: status === "idle" ? "scratch" : "release",
    detail: status === "idle" ? "/Projects/scratch" : "/Projects/release",
    color,
    active: false,
  };
}

interface RemoteFixtureOptions {
  id: string;
  status: Exclude<AgentVisualStatus, "waiting">;
  color: string;
  hostWritable?: boolean;
  attachable?: boolean;
  active?: boolean;
  attachment?: PaneAttachment;
}

function remoteFixture(options: RemoteFixtureOptions): MonitorAgent {
  return {
    id: options.id,
    createdAtMs: 0,
    status: options.status,
    project: "mesh-console",
    detail: "studio-mini · /Projects/mesh-console",
    color: options.color,
    active: options.active ?? false,
    ...(options.attachment ? { attachment: options.attachment } : {}),
    remote: {
      deviceId: "studio-mini",
      deviceName: "studio-mini",
      remoteSessionId: options.id,
      attachable: options.attachable ?? true,
      hostWritable: options.hostWritable ?? true,
      cwdLabel: "/Projects/mesh-console",
      ...(options.active ? { localSessionId: `replica-${options.id}` } : {}),
    },
  };
}

interface BubbleSpecimen {
  id: string;
  title: string;
  note: string;
  agent: MonitorAgent;
}

interface BubbleGroup {
  eyebrow: string;
  title: string;
  description: string;
  specimens: readonly BubbleSpecimen[];
}

function bubbleGroups(accents: readonly string[]): readonly BubbleGroup[] {
  const accent = (index: number): string => accents[index % accents.length] ?? "currentColor";
  const primaryLink = accent(4);
  const linked = { primary: primaryLink, mirrors: [] } satisfies PaneAttachment;
  const mirrored = {
    primary: primaryLink,
    mirrors: [accent(1), accent(2)],
  } satisfies PaneAttachment;

  return [
    {
      eyebrow: "01 / lifecycle",
      title: "Every valid source × runtime-status mapping",
      description:
        "The seven persistent lifecycle combinations the projection can emit. Runtime status and drawn state are listed separately because a ready agent intentionally borrows the working-size body without ignition.",
      specimens: [
        {
          id: "terminal-idle",
          title: "Unassigned terminal · idle",
          note: "Smallest body. No provider glyph, branch, or context meter.",
          agent: terminalFixture("terminal-idle", "idle", accent(0)),
        },
        {
          id: "terminal-working",
          title: "Unassigned terminal · job running",
          note: "Working body, but never ignition: terminal activity is not agent activity.",
          agent: terminalFixture("terminal-working", "working", accent(1)),
        },
        {
          id: "agent-ready",
          title: "Agent · ready",
          note: "Runtime idle → working-size body. This reserves idle size for unclaimed terminals.",
          agent: agentFixture({
            id: "agent-ready",
            project: "vibe-field",
            status: "idle",
            color: accent(2),
            kind: "claude",
            model: "Opus 4.1",
            branch: "main",
            contextPercent: 18,
          }),
        },
        {
          id: "agent-working",
          title: "Agent · working / ignited",
          note: "Working-size body plus core glow, particles, and glyph pulse.",
          agent: agentFixture({
            id: "agent-working",
            project: "renderer",
            status: "working",
            color: accent(3),
            kind: "codex",
            model: "GPT-5.6 Codex",
            branch: "swarm-audit",
            contextPercent: 42,
            detail: "using tool",
          }),
        },
        {
          id: "agent-waiting",
          title: "Agent · waiting",
          note: "Largest body and faster attention shadow; no ignition particles.",
          agent: agentFixture({
            id: "agent-waiting",
            project: "fieldd",
            status: "waiting",
            color: accent(4),
            kind: "grok",
            model: "Grok 4",
            branch: "permissions",
            contextPercent: 67,
            detail: "permission · Bash",
          }),
        },
        {
          id: "remote-idle",
          title: "Remote terminal · idle",
          note: "Idle body with the peer-only accent hairline and host eyebrow.",
          agent: remoteFixture({ id: "remote-idle", status: "idle", color: accent(5) }),
        },
        {
          id: "remote-working",
          title: "Remote terminal · job running",
          note: "Remote sessions can be idle or working, never waiting without agent semantics.",
          agent: remoteFixture({ id: "remote-working", status: "working", color: accent(6) }),
        },
      ],
    },
    {
      eyebrow: "02 / access and panes",
      title: "Access policy, current selection, and deck relationships",
      description:
        "These are independent facets layered over lifecycle. Some are deliberately semantic-only today; showing that absence is part of an honest state inventory.",
      specimens: [
        {
          id: "remote-view-only",
          title: "Remote · read-only host",
          note: "Every remote bubble states its HOST's write policy — the advertisement is one boolean per peer, and whether this viewer gets writes is decided at attach.",
          agent: remoteFixture({
            id: "remote-view-only",
            status: "working",
            color: accent(7),
            hostWritable: false,
          }),
        },
        {
          id: "remote-not-shared",
          title: "Remote · not attachable",
          note: "No persistent visual modifier today; refusal is announced only after selection.",
          agent: remoteFixture({
            id: "remote-not-shared",
            status: "idle",
            color: accent(0),
            attachable: false,
          }),
        },
        {
          id: "active-only",
          title: "Current · no pane link",
          note: "ARIA current and .is-active are present; there is intentionally no standalone paint yet.",
          agent: agentFixture({
            id: "active-only",
            project: "preview-choice",
            status: "idle",
            color: accent(1),
            kind: "claude",
            model: "Sonnet 4",
            active: true,
            contextPercent: 25,
          }),
        },
        {
          id: "linked-primary",
          title: "Mounted in another pane",
          note: "Primary pane accent becomes a four-pixel link ring and glow.",
          agent: agentFixture({
            id: "linked-primary",
            project: "pane-linked",
            status: "working",
            color: accent(2),
            kind: "codex",
            model: "GPT-5.6 Codex",
            branch: "main",
            contextPercent: 54,
            attachment: linked,
          }),
        },
        {
          id: "linked-mirrored-active",
          title: "Current · primary + mirrors",
          note: "Primary link ring plus one inset hairline per mirrored pane.",
          agent: agentFixture({
            id: "linked-mirrored-active",
            project: "multi-pane",
            status: "waiting",
            color: accent(3),
            kind: "grok",
            model: "Grok 4",
            branch: "review",
            contextPercent: 81,
            active: true,
            attachment: mirrored,
          }),
        },
        {
          id: "remote-linked-active",
          title: "Remote · mounted and current",
          note: "The pane-link ring replaces the quieter peer hairline; host identity remains in copy.",
          agent: remoteFixture({
            id: "remote-linked-active",
            status: "working",
            color: accent(5),
            active: true,
            attachment: linked,
          }),
        },
        {
          id: "terminal-linked-active",
          title: "Unassigned terminal · current pane",
          note: "A local terminal can be pane-linked before any agent claims its stable session id.",
          agent: {
            ...terminalFixture("terminal-linked-active", "idle", accent(6)),
            active: true,
            attachment: linked,
          },
        },
      ],
    },
    {
      eyebrow: "03 / identity and information",
      title: "Every glyph plus information boundaries",
      description:
        "The provider glyph is organizational identity. Context fill is continuous, so the catalog pins its meaningful boundaries and a midpoint instead of pretending every percentage is a separate state.",
      specimens: [
        {
          id: "identity-claude-empty-context",
          title: "Claude · context unavailable",
          note: "Provider fallback label with CTX:--% and no fill layer.",
          agent: agentFixture({
            id: "identity-claude-empty-context",
            project: "anthropic",
            status: "idle",
            color: accent(0),
            kind: "claude",
          }),
        },
        {
          id: "identity-codex-zero-context",
          title: "Codex · context 0%",
          note: "Observed empty window; distinct from unavailable even though the fill has zero height.",
          agent: agentFixture({
            id: "identity-codex-zero-context",
            project: "openai",
            status: "idle",
            color: accent(1),
            kind: "codex",
            model: "GPT-5.6 Codex",
            branch: "main",
            contextPercent: 0,
          }),
        },
        {
          id: "identity-grok-mid-context",
          title: "Grok · context 50%",
          note: "Midpoint makes the translucent capacity fill easy to evaluate.",
          agent: agentFixture({
            id: "identity-grok-mid-context",
            project: "xai",
            status: "working",
            color: accent(2),
            kind: "grok",
            model: "Grok 4",
            branch: "main",
            contextPercent: 50,
          }),
        },
        {
          id: "identity-acp-full-context",
          title: "ACP · context 100%",
          note: "Full-window boundary and the text fallback glyph used by ACP agents.",
          agent: agentFixture({
            id: "identity-acp-full-context",
            project: "adapter",
            status: "waiting",
            color: accent(3),
            kind: "acp",
            model: "ACP adapter",
            branch: "full-context",
            contextPercent: 100,
          }),
        },
        {
          id: "copy-overflow",
          title: "Copy · overflow boundary",
          note: "Long project, branch, and model strings exercise the shipping ellipsis behavior.",
          agent: agentFixture({
            id: "copy-overflow",
            project: "extraordinarily-long-monorepo-workspace-name",
            status: "waiting",
            color: accent(4),
            kind: "codex",
            model: "A deliberately verbose provider model identity",
            branch: "feature/a-very-long-branch-name-for-layout-auditing",
            contextPercent: 96,
          }),
        },
      ],
    },
  ];
}

function RangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <label className="vf-ds-agent-bubble-range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
      <output>{`${value}${suffix}`}</output>
    </label>
  );
}

/** A deterministic, physics-free mount of every production AgentBubbleView
 * branch. Only placement and fixtures belong to this catalog adapter. */
export function AgentBubblePreview(): ReactElement {
  const palette = useMonitorPalette();
  const groups = useMemo(() => bubbleGroups(palette.accents), [palette.accents]);
  const galleryRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<GodviewTheme>("light");
  const [animations, setAnimations] = useState(true);
  const [selectedId, setSelectedId] = useState<string>();
  const [swarm, setSwarm] = useState<SwarmParameters>({ ...DEFAULT_SWARM_PARAMETERS });

  const update = (patch: Partial<SwarmParameters>): void => {
    setSwarm((current) => ({ ...current, ...patch }));
  };
  const reset = (): void => setSwarm({ ...DEFAULT_SWARM_PARAMETERS });
  const replayArrivals = (): void => {
    if (!animations) return;
    for (const bubble of galleryRef.current?.querySelectorAll<HTMLButtonElement>(
      ".vf-monitor-bubble",
    ) ?? []) {
      animateAgentBubbleSpawn(bubble);
    }
  };

  const stageStyle = {
    "--vf-monitor-bubble-fill-opacity": `${swarm.bubbleFillOpacity * 100}%`,
  } as CSSProperties;

  return (
    <div
      ref={galleryRef}
      className={`vf-ds-agent-bubble-catalog vf-godview theme-${theme}`}
      data-agent-bubble-catalog="true"
      data-agent-bubble-theme={theme}
      data-godview-open="true"
      data-godview-animations={animations ? "on" : "off"}
      style={stageStyle}
    >
      <header className="vf-ds-agent-bubble-toolbar">
        <div>
          <span className="vf-ds-agent-bubble-toolbar-eyebrow">Live production variables</span>
          <strong>One control surface, every circle</strong>
          <small>
            Click a circle to mark it current. Use Tab to inspect the real focus ring; press and
            hold to inspect the real grabbed cursor.
          </small>
        </div>
        <div className="vf-ds-agent-bubble-actions">
          <button
            type="button"
            aria-pressed={theme === "dark"}
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? "DARK THEME" : "LIGHT THEME"}
          </button>
          <button
            type="button"
            aria-pressed={!animations}
            onClick={() => setAnimations((current) => !current)}
          >
            {animations ? "PAUSE MOTION" : "RESUME MOTION"}
          </button>
          <button type="button" disabled={!animations} onClick={replayArrivals}>
            REPLAY ARRIVALS
          </button>
          <button type="button" onClick={reset}>
            RESET VALUES
          </button>
        </div>
        <div className="vf-ds-agent-bubble-ranges">
          <RangeControl
            label="Idle radius"
            value={swarm.radiusIdle}
            min={20}
            max={80}
            suffix="px"
            onChange={(radiusIdle) => update({ radiusIdle })}
          />
          <RangeControl
            label="Working radius"
            value={swarm.radiusWorking}
            min={40}
            max={120}
            suffix="px"
            onChange={(radiusWorking) => update({ radiusWorking })}
          />
          <RangeControl
            label="Waiting radius"
            value={swarm.radiusWaiting}
            min={60}
            max={160}
            suffix="px"
            onChange={(radiusWaiting) => update({ radiusWaiting })}
          />
          <RangeControl
            label="Fill opacity"
            value={Math.round(swarm.bubbleFillOpacity * 100)}
            min={0}
            max={100}
            suffix="%"
            onChange={(percent) => update({ bubbleFillOpacity: percent / 100 })}
          />
        </div>
      </header>

      {groups.map((group) => (
        <section className="vf-ds-agent-bubble-group" key={group.eyebrow}>
          <header>
            <span>{group.eyebrow}</span>
            <h3>{group.title}</h3>
            <p>{group.description}</p>
          </header>
          <div className="vf-ds-agent-bubble-grid">
            {group.specimens.map((specimen) => {
              const agent =
                selectedId === specimen.id && !specimen.agent.active
                  ? { ...specimen.agent, active: true }
                  : specimen.agent;
              const presentation = agentBubblePresentation(agent);
              const radius = radiusForStatus(swarm, presentation.appearance);
              return (
                <article
                  key={specimen.id}
                  className="vf-ds-agent-bubble-card"
                  data-agent-bubble-preview={specimen.id}
                >
                  <div className="vf-ds-agent-bubble-stage">
                    <AgentBubbleView
                      agent={agent}
                      positionerStyle={{
                        width: `${radius * 2}px`,
                        height: `${radius * 2}px`,
                        top: "50%",
                        left: "50%",
                        transform: "translate3d(-50%, -50%, 0)",
                      }}
                      onClick={() => setSelectedId(specimen.id)}
                    />
                  </div>
                  <div className="vf-ds-agent-bubble-card-copy">
                    <strong>{specimen.title}</strong>
                    <dl>
                      <div>
                        <dt>source</dt>
                        <dd>{presentation.source}</dd>
                      </div>
                      <div>
                        <dt>runtime</dt>
                        <dd>{agent.status}</dd>
                      </div>
                      <div>
                        <dt>drawn</dt>
                        <dd>{presentation.visualState}</dd>
                      </div>
                    </dl>
                    <p>{specimen.note}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
