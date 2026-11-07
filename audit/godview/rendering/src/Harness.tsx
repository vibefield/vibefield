import { useMemo } from "react";
import { MonitorViewHost } from "@vibefield/puppeteer-view-sdk/host";
import { useMonitorPalette } from "@puppeteer-pin/views/monitor/palette";
import { monitorParameterDefaults } from "@puppeteer-pin/views/monitor/parameters";
import { MONITOR_VIEWS } from "@puppeteer-pin/views/monitor/registry";
import { agentViewFixture, FIXTURE_EPOCH } from "@puppeteer-pin/sdk/testing/fixtures";
import { createFixtureReplica } from "@puppeteer-pin/sdk/testing/replica";
import type { AgentView, MonitorHistory, MonitorPastSpanKind } from "@vibefield/puppeteer-view-sdk";
import { useEffect, useRef } from "react";
import { PIN_STAMP } from "virtual:pin-stamp";
import { ENTRIES, NOW, SWARM_RUNTIME_ENTRIES } from "../inputs.mjs";

const STAGE = Object.freeze({
  width: 1200,
  height: 680,
  insets: Object.freeze({ top: 12, right: 12, bottom: 12, left: 12 }),
  obstacles: Object.freeze([]),
});

const DEVICE = Object.freeze({ id: "desk", name: "Desk", os: "mac" as const, self: true });

function historyFor(kind: MonitorPastSpanKind | "bounds" | "ended", agentId: string): MonitorHistory {
  if (kind === "ended") {
    const endedAt = NOW - 30 * 60_000;
    const startedAt = NOW - 50 * 60_000;
    return {
      sinceMs: NOW - 86_400_000,
      untilMs: NOW,
      readAt: NOW,
      fidelity: "turns",
      state: "complete",
      live: [],
      ended: [
        {
          id: "past:fixture:ended",
          title: "Ended session",
          project: { name: "billing-api", seq: 0 },
          device: DEVICE,
          startedAt,
          endedAt,
          spans: [{ kind: "worked", from: startedAt, to: endedAt }],
          colour: "#4c8dff",
          receded: false,
        },
      ],
    };
  }
  const seam = NOW - 60_000;
  const span = { kind: kind === "bounds" ? "bounds" : kind, from: NOW - 3_600_000, to: seam };
  const ended =
    kind === "bounds"
      ? [
          {
            id: "past:fixture:ended",
            title: "Ended session",
            project: { name: "billing-api", seq: 0 },
            device: DEVICE,
            startedAt: NOW - 7_200_000,
            endedAt: NOW - 3_600_000,
            spans: [{ kind: "bounds" as const, from: NOW - 7_200_000, to: NOW - 3_600_000 }],
            colour: "#4c8dff",
            receded: false,
          },
        ]
      : [];
  return {
    sinceMs: NOW - 86_400_000,
    untilMs: NOW,
    readAt: NOW,
    fidelity: kind === "bounds" ? "bounds" : "turns",
    state: "complete",
    live: kind === "bounds" ? [] : [{ id: agentId, seamAt: seam, spans: [span] }],
    ended,
  };
}

function selectedId(): string | null {
  return new URLSearchParams(location.search).get("fixture");
}

export function Harness() {
  const entries = [...ENTRIES, ...SWARM_RUNTIME_ENTRIES] as Array<{
    fixtureId: string;
    viewId: string;
    stateId: string;
    row: Record<string, unknown>;
    spawn: unknown;
    history: string | null;
    interact: string | null;
    envelope: { notes: string; syntheticLabel: string };
  }>;
  const fixtureId = selectedId();
  const entry = entries.find((item) => item.fixtureId === fixtureId) ?? null;
  return (
    <>
      <header className="fe-banner">
        <b>Puppeteer source {PIN_STAMP.sourceSha.slice(0, 12)}</b>
        <span>post-0.3.3. Not shipped package 0.3.3.</span>
        <span data-fe-fidelity={PIN_STAMP.fidelity} data-source-sha={PIN_STAMP.sourceSha} hidden />
        <select
          aria-label="Fixture"
          value={fixtureId ?? ""}
          onChange={(event) => {
            const url = new URL(location.href);
            url.searchParams.set("fixture", event.target.value);
            location.assign(url);
          }}
        >
          <option value="">Choose a fixture</option>
          {entries.map((item) => (
            <option key={item.fixtureId} value={item.fixtureId}>
              {item.fixtureId}
            </option>
          ))}
        </select>
      </header>
      {entry ? <FixtureView entry={entry} /> : <p>Choose a fixture. The integration page uses ?fixture=fix.…</p>}
    </>
  );
}

function FixtureView({
  entry,
}: {
  entry: {
    fixtureId: string;
    viewId: string;
    stateId: string;
    row: Record<string, unknown>;
    spawn: { devices: ReadonlyArray<Record<string, unknown>> } | null;
    history: string | null;
    interact: string | null;
    envelope: { syntheticLabel: string };
  };
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const palette = useMonitorPalette(rootRef);
  const viewKey = entry.viewId.slice("view.".length);
  const registered = MONITOR_VIEWS.find((view) => view.id === viewKey);
  if (!registered) throw new Error(`missing view ${entry.viewId}`);
  const rows = useMemo(() => {
    const partials = (entry.rows as Array<Record<string, unknown>> | null) ?? [entry.row];
    return partials.map((partial, index) =>
      agentViewFixture({
        id: `row-${index + 1}`,
        createdAt: FIXTURE_EPOCH + index,
        ...partial,
      } as Parameters<typeof agentViewFixture>[0]),
    );
  }, [entry]);
  const history = entry.history
    ? historyFor(entry.history as MonitorPastSpanKind | "bounds", rows[0]?.id ?? "row-1")
    : undefined;
  const replica = useMemo(() => createFixtureReplica(rows as AgentView[]), [rows]);
  const parameters = useMemo(
    () => monitorParameterDefaults(registered.parameterGroups),
    [registered],
  );
  const commands = useMemo(
    () => ({
      select: () => undefined,
      create: () => undefined,
    }),
    [],
  );
  const theme = useMemo(
    () => ({
      scheme: "dark" as const,
      tokens: palette,
      reducedMotion: true,
      animations: false,
    }),
    [palette],
  );
  const capabilities = useMemo(
    () => ({
      ...(history ? { history } : {}),
      ...(entry.spawn ? { spawn: entry.spawn } : {}),
    }),
    [history, entry.spawn],
  );
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    let frames = 0;
    let handle = 0;
    const tick = () => {
      frames += 1;
      const paint = node.querySelector(".vf-monitor-swarm-empty")?.textContent ?? "";
      if (paint.includes("WEBGPU UNAVAILABLE")) node.dataset.fePaint = "webgpu-unavailable";
      else if (node.querySelector("canvas")) node.dataset.fePaint = "canvas";
      else node.dataset.fePaint = "dom";
      if (frames < 3) handle = requestAnimationFrame(tick);
      else node.dataset.feReady = "1";
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [entry.fixtureId]);
  return (
    <div
      ref={rootRef}
      className="vf-godview theme-dark fe-stage"
      data-godview-open="true"
      data-godview-animations="off"
      data-fixture={entry.fixtureId}
      data-view={entry.viewId}
      data-state={entry.stateId}
      data-interact={entry.interact ?? ""}
      data-synthetic={entry.envelope.syntheticLabel}
    >
      <MonitorViewHost
        replica={replica}
        view={registered.view}
        stage={STAGE}
        theme={theme}
        parameters={parameters}
        capabilities={capabilities}
        commands={commands}
        className="fe-slot"
      />
    </div>
  );
}
