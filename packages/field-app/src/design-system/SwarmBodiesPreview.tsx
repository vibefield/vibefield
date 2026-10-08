import { presentAgentMonitorHeadline } from "@vibecook/puppeteer-core";
import type { MonitorTheme, StageGeometry } from "@vibecook/puppeteer-view-sdk";
import {
  frameScheduler,
  type MonitorReplicaLike,
  MonitorViewHost,
  type ViewSlotCommands,
} from "@vibecook/puppeteer-view-sdk/host";
import type { AgentView, MonitorDeviceRef, MonitorModel } from "@vibecook/puppeteer-view-sdk/model";
import {
  type LabAgent,
  monitorParameterDefaults,
  stateStages,
  swarmMonitorView,
  useMonitorPalette,
} from "@vibecook/puppeteer-views";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";

// The swarm's bodies, every drawn state at once: the views package's own lab
// fixtures (the design record's stages — the empty and running terminal, the
// idle, working and blocked agent, the pane light, the unread dot, the hot
// burn) mounted through the SHIPPING view, never a replica of its drawing.
// What the catalog shows is what Godview paints, on this browser's WebGPU; a
// browser without it shows the same honest line the product does.
//
// The chrome above the stage is the catalog's fixture adapter and nothing more
// (docs/UI_SYSTEM.md): the theme and the motion switch are what a HOST hands
// the view (`MonitorTheme`), and selection is the host's verb answered the way
// a deck answers it — by making the row current. Since MV-5 the swarm is an SDK
// view: it mounts through the view host on a replica of the stages, each said
// as the `AgentView` a backend and a window would hand it (`bodyOf`), and runs
// its own physics wherever it can load them.

/** The desktop the catalog's bodies run on: this one. */
const CATALOG_DESKTOP: MonitorDeviceRef = Object.freeze({
  id: "catalog",
  name: "catalog",
  os: "mac",
  self: true,
});

const parsed = (iso: string | undefined): number | undefined => {
  if (iso === undefined) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
};

/**
 * One stage's row as the view reads it: each fact the row says, in the model's words. The held
 * total is the fixture's (`LabAgent`): no window keeps a usage ledger (L11), the backend does.
 */
function bodyOf(agent: LabAgent, active: boolean): AgentView {
  const facet = agent.agent;
  const monitor = facet?.monitor;
  const blocker = monitor?.blockers[0];
  const question = blocker?.kind === "question" ? blocker.questions?.[0] : undefined;
  const reply = monitor?.lastAssistantMessage;
  const activity = facet ? monitor?.activity : agent.session?.activity;
  const rate = monitor?.usage.costRatePerMin;
  const total = facet?.usage?.total ?? monitor?.usage.costUsd;
  const priced = monitor !== undefined && (total !== undefined || rate !== undefined);
  const tokens = monitor?.usage.cumulativeTokens;
  return {
    id: agent.id,
    kind: facet ? "agent" : "terminal",
    createdAt: agent.createdAtMs,
    status: agent.status,
    statusSince: parsed(monitor?.statusSince) ?? agent.createdAtMs,
    stale: agent.stale === true,
    alive: true,
    observed: true,
    detail: monitor ? presentAgentMonitorHeadline(monitor).detail : agent.detail,
    ...(activity
      ? {
          activity: {
            kind: activity.kind,
            ...(facet && monitor?.activity?.line !== undefined
              ? { line: monitor.activity.line }
              : {}),
          },
        }
      : {}),
    project: { name: agent.project, ...(facet?.branch ? { branch: facet.branch } : {}) },
    ...(facet ? { provider: { id: facet.provider.id, label: facet.provider.label } } : {}),
    ...(facet?.model ? { model: facet.model } : {}),
    ...(monitor?.effort
      ? {
          effort: {
            value: monitor.effort.value,
            ...(monitor.effort.intent === undefined ? {} : { intent: monitor.effort.intent }),
          },
        }
      : {}),
    ...(facet?.contextWindow?.usedPercent === undefined
      ? {}
      : { context: { usedPercent: facet.contextWindow.usedPercent } }),
    ...(blocker
      ? {
          wait: {
            kind: blocker.kind,
            since: parsed(blocker.since) ?? agent.createdAtMs,
            ...(blocker.kind === "permission" && blocker.permission?.tool
              ? { tool: blocker.permission.tool }
              : {}),
            ...(blocker.kind === "failure" && blocker.failure?.code
              ? { code: blocker.failure.code }
              : {}),
            ...(question?.header === undefined ? {} : { header: question.header }),
            ...(question?.prompt === undefined ? {} : { question: question.prompt }),
            ...(blocker.detail === undefined ? {} : { detail: blocker.detail }),
          },
        }
      : {}),
    ...(reply
      ? {
          reply: {
            text: reply.text,
            ...(parsed(reply.at) === undefined ? {} : { at: parsed(reply.at) }),
            ...(reply.final === undefined ? {} : { final: reply.final }),
          },
        }
      : {}),
    ...(priced
      ? {
          cost: {
            usd: total ?? 0,
            coverage:
              total === undefined ? "unavailable" : (monitor.usage.costCoverage ?? "complete"),
            ...(rate === undefined ? {} : { burnPerHour: rate * 60 }),
          },
        }
      : {}),
    ...(tokens === undefined ? {} : { tokens: { total: tokens } }),
    unread: agent.unread === true,
    device: CATALOG_DESKTOP,
    attachable: true,
    writable: true,
    colour: agent.color,
    active,
    receded: false,
    ...(agent.attachment
      ? {
          attachment: {
            panes: agent.attachment.paneIds.length,
            ...(agent.attachment.color === undefined ? {} : { colour: agent.attachment.color }),
          },
        }
      : {}),
  };
}

/** A replica of a model that changes only when the catalog says so. */
function fixtureReplica(model: MonitorModel): MonitorReplicaLike {
  const snapshot = Object.freeze({
    model,
    changes: Object.freeze({
      added: Object.freeze(model.agents.map((agent) => agent.id)),
      updated: Object.freeze([]),
      removed: Object.freeze([]),
    }),
  });
  return { getSnapshot: () => snapshot, subscribe: () => () => undefined };
}

const UNMEASURED: StageGeometry = Object.freeze({
  width: 0,
  height: 0,
  insets: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
  obstacles: Object.freeze([]),
});

const SWARM_PARAMETERS = monitorParameterDefaults(swarmMonitorView.manifest.parameters);

type BodiesTheme = "light" | "dark";

export function SwarmBodiesPreview(): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const nowMs = useMemo(() => Date.now(), []);
  const [theme, setTheme] = useState<BodiesTheme>("light");
  const [motion, setMotion] = useState(true);
  const [arrival, setArrival] = useState(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [stage, setStage] = useState<StageGeometry>(UNMEASURED);

  const stages = useMemo(() => stateStages(nowMs), [nowMs]);
  const replica = useMemo(() => {
    const agents = stages.map((entry) => bodyOf(entry.agent, entry.agent.id === selectedId));
    return fixtureReplica({
      revision: 1,
      agents,
      byId: new Map(agents.map((agent) => [agent.id, agent] as const)),
    });
  }, [stages, selectedId]);
  const commands = useMemo<ViewSlotCommands>(
    () => ({
      select: (agentId) => setSelectedId((current) => (current === agentId ? undefined : agentId)),
      create: () => undefined,
    }),
    [],
  );
  // The palette is read from THIS root: the page has another Godview root (the
  // stage specimen) in its own theme, and the bodies must wear theirs.
  const palette = useMonitorPalette(rootRef);
  const monitorTheme = useMemo<MonitorTheme>(
    () => ({ scheme: theme, tokens: palette, reducedMotion: false, animations: motion }),
    [theme, palette, motion],
  );
  // The stage a host measures (MV-D19): the section's size, and no chrome over it.
  useEffect(() => {
    const element = stageRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const publish = (): void => {
      const box = element.getBoundingClientRect();
      setStage({ ...UNMEASURED, width: Math.round(box.width), height: Math.round(box.height) });
    };
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    publish();
    return () => observer.disconnect();
  }, []);

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
      <section ref={stageRef} className="vf-godview-monitor-stage" aria-label="Swarm bodies">
        <MonitorViewHost
          key={arrival}
          replica={replica}
          view={swarmMonitorView}
          stage={stage}
          theme={monitorTheme}
          parameters={SWARM_PARAMETERS}
          commands={commands}
          scheduler={frameScheduler}
        />
      </section>
    </div>
  );
}
