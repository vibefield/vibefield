// @vitest-environment happy-dom
/**
 * THE SEAM-COST BENCH (MV-0, step 5): what one fold frame costs today, stage by
 * stage, at n = 10 / 20 / 60 — the wire's `JSON.parse`, the zod read
 * (`AgentListResult.safeParse`), the damage gate (`rowsKey`), and the `agents`
 * memo's body (the usage ledger, the projection `assembleMonitorAgents`, the
 * unread ledger, the status ledger) with the same inputs the hook hands them;
 * and what a mesh frame costs (parse, zod, `meshFieldAfterFrame`, `meshRecords`).
 *
 * Medians, p95 and max over the corpus's frames, the median taken across
 * rounds (the first round is the warm-up and is dropped); the load average is
 * recorded beside the numbers (memory `loaded-host-measurement-discipline`:
 * medians survive load, tails are weather). happy-dom is only here so
 * `readMonitorPalette` has a document, as the stage has one.
 *
 * The usage-persistence write RATE is the oracle's measurement
 * (`godview-oracle.perf.tsx`, both arms); this bench reports the GATE's pass
 * rate — the share of fold frames on which `rowsKey` changed — which is what
 * bounds the save effect's firing, and the cost of `exportUsage` per frame.
 *
 *   VF_GODVIEW_SEAM_ROUNDS=4   VF_GODVIEW_SEAM_OUT=<dir>
 *   pnpm --filter @vibefield/field-app perf:godview:seam
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import {
  EMPTY_STATUS_LEDGER,
  EMPTY_UNREAD_LEDGER,
  EMPTY_USAGE_LEDGER,
  exportUsage,
  observeStatuses,
  readMonitorPalette,
  reconcileUnread,
  reconcileUsage,
  type StatusLedger,
  type UnreadLedger,
  type UsageLedger,
  type UsageLedgerKey,
} from "@vibecook/puppeteer-views";
import { AgentListResult, AgentMeshFrame, AgentMeshOpen } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { projectKey } from "../src/godview/monitor/agent-status";
import {
  assembleMonitorAgents,
  type MonitorTerminalRecord,
  managedRowId,
} from "../src/godview/monitor/agents";
import { deviceFacet, rosterView } from "../src/godview/monitor/devices";
import type { AgentSessionSummary } from "../src/godview/monitor/facet-types";
import {
  EMPTY_MESH_FIELD,
  type MeshFieldSnapshot,
  meshFieldAfterFrame,
  meshFieldFromOpen,
} from "../src/godview/monitor/mesh-field";
import { meshHere, meshRecords } from "../src/godview/monitor/mesh-rows";
import { type Corpus, generateCorpus, recipeName } from "../src/godview/monitor/perf/corpus";
import type { RecordedFrame } from "../src/godview/monitor/perf/frame-recorder";
import {
  dealProjectSeqs,
  EMPTY_PROJECT_LEDGER,
  type ProjectLedger,
} from "../src/godview/monitor/project-ledger";
import { coreUsage, rowsKey } from "../src/godview/monitor/useMonitorAgents";
import { LANE_RECIPES } from "./lib/recipes";

const STAGES = [
  "parse",
  "zod",
  "gate",
  "usageLedger",
  "assemble",
  "unreadLedger",
  "statusLedger",
  "exportUsage",
  "frame",
] as const;
type Stage = (typeof STAGES)[number];
const MESH_STAGES = ["meshParse", "meshZod", "meshApply", "meshRecords", "meshFrame"] as const;
type MeshStage = (typeof MESH_STAGES)[number];

interface Quantiles {
  n: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

function quantiles(values: number[]): Quantiles {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))] ?? 0;
  return {
    n: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted.at(-1) ?? 0,
    mean: sorted.reduce((total, value) => total + value, 0) / Math.max(1, sorted.length),
  };
}

const round3 = (value: number): number => Math.round(value * 1_000) / 1_000;

interface RoundResult {
  stages: Record<Stage, Quantiles>;
  mesh: Record<MeshStage, Quantiles>;
  gatePasses: number;
  foldFrames: number;
  meshFrames: number;
  agentsOut: number;
  usageRecords: number;
}

/** One pass over the corpus: the seam's own stages, timed. */
function runRound(corpus: Corpus, wire: { fold: string[]; mesh: string[] }): RoundResult {
  const palette = readMonitorPalette(document.documentElement);
  const colours = { tint: palette.tint, neutral: palette.neutral };
  const roster = rosterView(corpus.roster);
  const samples: Record<Stage, number[]> = {
    parse: [],
    zod: [],
    gate: [],
    usageLedger: [],
    assemble: [],
    unreadLedger: [],
    statusLedger: [],
    exportUsage: [],
    frame: [],
  };
  const meshSamples: Record<MeshStage, number[]> = {
    meshParse: [],
    meshZod: [],
    meshApply: [],
    meshRecords: [],
    meshFrame: [],
  };

  // the hook's own held state, as its refs hold it
  let usage: UsageLedger = EMPTY_USAGE_LEDGER;
  let unread: UnreadLedger = EMPTY_UNREAD_LEDGER;
  let status: StatusLedger = EMPTY_STATUS_LEDGER;
  let projectLedger: ProjectLedger = EMPTY_PROJECT_LEDGER;
  let meshField: MeshFieldSnapshot = EMPTY_MESH_FIELD;
  let previousVisualIds: ReadonlyMap<string, string> = new Map();
  let stableKey = "";
  let gatePasses = 0;
  let agentsOut = 0;
  let usageRecords = 0;
  // the deck's panes, as the hook derives them: every non-exited pane session
  const sessions = new Map(corpus.panes.sessions.map((session) => [session.id, session]));
  const terminals: MonitorTerminalRecord[] = [...sessions.values()]
    .filter((session) => !session.exited)
    .map((session) => ({ session }));

  let foldIndex = 0;
  let meshIndex = 0;
  for (const frame of corpus.frames) {
    const nowMs = frame.wall;
    if (frame.kind === "fold") {
      const text = wire.fold[foldIndex] as string;
      foldIndex += 1;
      const t0 = performance.now();
      const payload = JSON.parse(text) as unknown;
      const t1 = performance.now();
      const parsed = AgentListResult.safeParse(payload);
      const t2 = performance.now();
      if (!parsed.success) throw new Error("a corpus frame did not parse");
      const rows = parsed.data.sessions as AgentSessionSummary[];
      const key = rowsKey(rows);
      const t3 = performance.now();
      const passed = key !== stableKey;
      if (passed) {
        stableKey = key;
        gatePasses += 1;
      }
      // the projection runs only when the gate passes (localRows changed)
      if (passed) {
        const projectKeys = rows
          .map(projectKey)
          .filter((value): value is string => value !== undefined);
        projectLedger = dealProjectSeqs(projectLedger, projectKeys);
        const here = meshHere(meshField, roster);
        const remotes = meshRecords(meshField, roster);
        const t4 = performance.now();
        usage = reconcileUsage(
          usage,
          rows.map((row) => ({
            id: managedRowId(row),
            ...(row.monitor?.usage ? { usage: coreUsage(row.monitor.usage) } : {}),
          })),
          nowMs,
        );
        const t5 = performance.now();
        const assembled = assembleMonitorAgents({
          managed: rows.map((summary) => ({ summary })),
          terminals,
          floor: [],
          mesh: remotes,
          ...(here !== undefined ? { here: deviceFacet(here, roster.byId, here) } : {}),
          colours,
          projectSeqs: projectLedger.seqByKey,
          usage: usage.histories,
          sessions,
          attachments: new Map(),
          visualIds: new Map(),
          previousVisualIds,
          nowMs,
        });
        previousVisualIds = new Map(
          assembled.map((agent) => [agent.id, agent.visualId ?? agent.id]),
        );
        const t6 = performance.now();
        unread = reconcileUnread(
          unread,
          assembled.map((agent) => {
            const statusSince = agent.agent?.monitor?.statusSince;
            const statusSinceMs = statusSince === undefined ? Number.NaN : Date.parse(statusSince);
            return {
              id: agent.id,
              status: agent.status,
              active: agent.active,
              hasAgent: agent.agent !== undefined,
              ...(Number.isFinite(statusSinceMs) ? { statusSinceMs } : {}),
            };
          }),
          nowMs,
        );
        const projected = assembled.map((agent) =>
          unread.unreadIds.has(agent.id) ? { ...agent, unread: true } : agent,
        );
        const t7 = performance.now();
        status = observeStatuses(status, projected, nowMs);
        const t8 = performance.now();
        // the save effect's work: the keys, then the export (the store write is
        // the oracle's measurement)
        const keys: UsageLedgerKey[] = rows.flatMap((row) =>
          row.monitor === undefined
            ? []
            : [{ id: managedRowId(row), providerId: row.kind, nativeSessionId: row.sessionId }],
        );
        usageRecords += exportUsage(usage, keys, nowMs).length;
        const t9 = performance.now();
        agentsOut = projected.length;
        samples.usageLedger.push(t5 - t4);
        samples.assemble.push(t6 - t5);
        samples.unreadLedger.push(t7 - t6);
        samples.statusLedger.push(t8 - t7);
        samples.exportUsage.push(t9 - t8);
        samples.frame.push(t9 - t0);
      } else {
        samples.frame.push(t3 - t0);
      }
      samples.parse.push(t1 - t0);
      samples.zod.push(t2 - t1);
      samples.gate.push(t3 - t2);
      continue;
    }
    if (frame.kind === "mesh-open" || frame.kind === "mesh-frame") {
      const text = wire.mesh[meshIndex] as string;
      meshIndex += 1;
      const t0 = performance.now();
      const payload = JSON.parse(text) as unknown;
      const t1 = performance.now();
      const parsed =
        frame.kind === "mesh-open"
          ? AgentMeshOpen.safeParse(payload)
          : AgentMeshFrame.safeParse(payload);
      const t2 = performance.now();
      if (!parsed.success) throw new Error("a corpus mesh frame did not parse");
      if (frame.kind === "mesh-open") {
        meshField = meshFieldFromOpen(parsed.data as AgentMeshOpen);
      } else {
        const next = meshFieldAfterFrame(meshField, parsed.data as AgentMeshFrame);
        if (next === "gap") throw new Error("a corpus mesh frame opened a gap");
        meshField = next;
      }
      const t3 = performance.now();
      meshRecords(meshField, roster);
      const t4 = performance.now();
      meshSamples.meshParse.push(t1 - t0);
      meshSamples.meshZod.push(t2 - t1);
      meshSamples.meshApply.push(t3 - t2);
      meshSamples.meshRecords.push(t4 - t3);
      meshSamples.meshFrame.push(t4 - t0);
    }
  }
  const stages = Object.fromEntries(
    STAGES.map((stage) => [stage, quantiles(samples[stage])]),
  ) as Record<Stage, Quantiles>;
  const mesh = Object.fromEntries(
    MESH_STAGES.map((stage) => [stage, quantiles(meshSamples[stage])]),
  ) as Record<MeshStage, Quantiles>;
  return {
    stages,
    mesh,
    gatePasses,
    foldFrames: foldIndex,
    meshFrames: meshIndex,
    agentsOut,
    usageRecords,
  };
}

/** The wire's text for every frame, serialized once so the rounds time the
 * reading and never the writing. */
function serialize(corpus: Corpus): { fold: string[]; mesh: string[]; foldBytes: Quantiles } {
  const fold: string[] = [];
  const mesh: string[] = [];
  for (const frame of corpus.frames as RecordedFrame[]) {
    if (frame.kind === "fold") fold.push(JSON.stringify({ sessions: frame.rows }));
    else if (frame.kind === "mesh-open") mesh.push(JSON.stringify(frame.open));
    else if (frame.kind === "mesh-frame") mesh.push(JSON.stringify(frame.frame));
  }
  return { fold, mesh, foldBytes: quantiles(fold.map((text) => text.length)) };
}

const medianOf = (values: number[]): number => quantiles(values).p50;

describe("the seam's cost per frame", () => {
  it("measures parse, zod, the gate, the ledgers and the projection at n = 10 / 20 / 60", () => {
    const rounds = Math.max(2, Number(process.env["VF_GODVIEW_SEAM_ROUNDS"] ?? 4));
    const outDir =
      process.env["VF_GODVIEW_SEAM_OUT"] ??
      join(import.meta.dirname, "..", "..", "..", ".vibefield", "perf", "godview", "seam");
    mkdirSync(outDir, { recursive: true });
    const report: Record<string, unknown>[] = [];
    for (const recipe of LANE_RECIPES) {
      const corpus = generateCorpus(recipe);
      const name = recipeName(recipe);
      const wire = serialize(corpus);
      const loadBefore = loadavg();
      const results: RoundResult[] = [];
      for (let round = 0; round < rounds; round += 1) results.push(runRound(corpus, wire));
      const loadAfter = loadavg();
      const kept = results.slice(1); // the first round warms the JIT and the caches
      const perStage = Object.fromEntries(
        STAGES.map((stage) => [
          stage,
          {
            p50: round3(medianOf(kept.map((r) => r.stages[stage].p50))),
            p95: round3(medianOf(kept.map((r) => r.stages[stage].p95))),
            max: round3(Math.max(...kept.map((r) => r.stages[stage].max))),
            mean: round3(medianOf(kept.map((r) => r.stages[stage].mean))),
          },
        ]),
      );
      const perMesh = Object.fromEntries(
        MESH_STAGES.map((stage) => [
          stage,
          {
            p50: round3(medianOf(kept.map((r) => r.mesh[stage].p50))),
            p95: round3(medianOf(kept.map((r) => r.mesh[stage].p95))),
            max: round3(Math.max(...kept.map((r) => r.mesh[stage].max))),
          },
        ]),
      );
      const last = kept.at(-1) as RoundResult;
      const entry = {
        corpus: name,
        n: recipe.n,
        rounds: kept.length,
        foldFrames: last.foldFrames,
        meshFrames: last.meshFrames,
        agentsOut: last.agentsOut,
        wireBytesPerFoldFrame: {
          p50: Math.round(wire.foldBytes.p50),
          max: Math.round(wire.foldBytes.max),
        },
        perFoldFrameMs: perStage,
        perMeshFrameMs: perMesh,
        gate: {
          passes: last.gatePasses,
          passRate: round3(last.gatePasses / last.foldFrames),
        },
        usageExportRecordsPerRound: last.usageRecords,
        frameBudgetMs: 16,
        loadavg: { before: loadBefore, after: loadAfter },
      };
      report.push(entry);
      process.stdout.write(`${JSON.stringify(entry)}\n`);
      expect(last.foldFrames).toBe(corpus.meta.counts.fold);
      expect(last.agentsOut).toBeGreaterThanOrEqual(recipe.n);
    }
    writeFileSync(
      join(outDir, `seam-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  });
});
