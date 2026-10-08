import type { AgentMonitorState } from "@vibecook/puppeteer-core";
import type { MonitorAgentRow } from "@vibecook/puppeteer-view-sdk/model";
import {
  AGENT_FIELD,
  AgentDeskRow,
  type AgentListResult,
  type AgentSessionSummary,
  MonitorAgentRow as MonitorAgentRowSchema,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { projectDeskRow, projectFieldRow, windowMonitorRow } from "../src/agent-field";
import { createModelSubscription } from "../src/agent-model-board";
import { managedSummary as summary } from "./agent-field-summary";
import { NOW0, stateOf, testMonitor } from "./agent-monitor-fixture";

// MV-3a, step 7 — THE DIFFERENTIAL, fieldd-level: for every field the desk
// projection (today's, read off the fold's row) and the model's row (the
// backend's, read off the runtime's state and the host's facts) both carry, the
// same value from the same inputs. The inputs are the fold's fixtures
// (puppeteer's real shapes), each state being the summary's own mirror. Where
// the two differ by DESIGN the difference is named here, with its cause, and
// the test pins it so a silent drift is caught either way.
//
// Also the wire: what a board of n = 20 costs on today's full stream against
// the model board's snapshot, one changed row's delta, and a peer's desk row.
// Recorded in the lane's report; the bounds here are loose sanity ceilings.

const CASES: Record<string, AgentSessionSummary> = {
  working: summary({
    runtimeRunId: "run-working",
    status: "working",
    cumulativeTokens: 900,
    contextPercent: 41,
    effort: { value: "high", intent: "observed" },
    lastAssistantText: "Keeping it greyed; wiring the filter now.",
    git: { branch: "ds/c" },
  }),
  idle: summary({ runtimeRunId: "run-idle", status: "idle", cumulativeTokens: 10 }),
  permission: summary({ runtimeRunId: "run-perm", status: "blocked", permissionTool: "Bash" }),
  permissionNoTool: summary({
    runtimeRunId: "run-perm-bare",
    status: "blocked",
    permissionTool: null,
  }),
  noRepo: summary({ runtimeRunId: "run-norepo", git: null }),
  detached: summary({ runtimeRunId: "run-detached", git: { branch: null } }),
  unlooked: summary({ runtimeRunId: "run-unlooked" }),
  pending: summary({ runtimeRunId: "run-pending", monitor: false, pending: "re-attach refused" }),
  exited: summary({ runtimeRunId: "run-exited", status: "idle", exited: true }),
  unknown: summary({ runtimeRunId: "run-unknown", status: "unknown", monitor: false }),
};

function costing(base: AgentSessionSummary, costUsd: number, costCoverage: string) {
  const monitor = base.monitor;
  if (monitor === undefined) throw new Error("a cost needs a mirror");
  return {
    ...base,
    monitor: { ...monitor, usage: { ...(monitor.usage ?? {}), costUsd, costCoverage } },
  } as AgentSessionSummary;
}

const ms = (iso: string | undefined): number | undefined =>
  iso === undefined ? undefined : Date.parse(iso);

/** The three-word status the model draws from the fold's four: `unknown` (no
 * evidence yet) reads as working, as the stage always drew it ("starting"). */
const modelStatus = (status: AgentSessionSummary["status"], pending: boolean) =>
  pending ? "idle" : status === "unknown" ? "working" : status;

describe("the differential — the desk projection and the model's row say the same thing", () => {
  it("field by field, for every fixture; the designed differences are named", async () => {
    const rows = Object.values(CASES);
    const monitor = await testMonitor({ summaries: rows });
    const findings: string[] = [];
    for (const [name, row] of Object.entries(CASES)) {
      // the desk row as the contract types it (and proves it parses)
      const desk = AgentDeskRow.parse({ ...projectDeskRow(row), revision: 0 });
      const field = projectFieldRow(row);
      const model = monitor.row(row.runtimeRunId);
      const pending = row.continuation?.pending !== undefined;
      // identity and clocks
      expect(model.id, name).toBe(desk.runtimeRunId);
      expect(model.createdAt, name).toBe(ms(desk.createdAt));
      expect(model.tier, name).toBe(desk.tier);
      expect(model.device.id, name).toBe(desk.device);
      expect(model.provider, name).toEqual({ id: desk.kind, label: desk.label });
      // status: the fold's four words onto the model's three; a pending row is idle in both readings
      expect(model.status, name).toBe(modelStatus(desk.status, pending));
      expect(model.pending ?? false, name).toBe(desk.pending !== undefined);
      // statusSince: the mirror's clock when there is one. DIFFERENCE for a row
      // with no mirror: the desk says the fold's `stateChangedAt` (the moment
      // this boot learned what it was looking at), the model the host's
      // `createdAt` (the backend's rule for a run with no state). Both are
      // honest clocks for "since when"; a view draws an age from either.
      if (row.monitor !== undefined) expect(model.statusSince, name).toBe(ms(desk.statusSince));
      else {
        expect(model.statusSince, name).toBe(ms(desk.createdAt));
        findings.push(`${name}: statusSince — desk stateChangedAt, model createdAt (no mirror)`);
      }
      // liveness: fieldd's own rule in both (the host record carries it)
      expect(model.alive, name).toBe(desk.alive);
      // the project. DIFFERENCE for a row with no mirror: the field/desk row
      // names the project only from the OBSERVED directory (it carries no path,
      // EL7 B1, and no workspace), so a pending or unobserved row has none; the
      // model follows the WINDOW's own rule (`agent-status.ts` `projectLabel`):
      // the observed directory, else the workspace's, else the provider's label.
      // The window drew "repo" for that row before, and still does.
      if (desk.project?.name !== undefined)
        expect(model.project.name, name).toBe(desk.project.name);
      else {
        expect(model.project.name, name).toBe("repo");
        findings.push(
          `${name}: project.name — desk none (no observed cwd), model "repo" from the workspace (the window's rule)`,
        );
      }
      if (desk.project?.branch !== undefined)
        expect(model.project.branch, name).toBe(desk.project.branch);
      else expect(model.project.branch, name).toBeUndefined();
      // the bars and the labels
      expect(model.tokens?.total, name).toBe(desk.usage?.cumulativeTokens);
      expect(model.tokens?.perMinute, name).toBe(desk.usage?.burnRatePerMin);
      expect(model.context?.usedPercent, name).toBe(desk.context?.usedPercent);
      expect(model.model, name).toBe(desk.model?.displayName ?? desk.model?.id);
      expect(model.effort, name).toEqual(desk.effort);
      // the wait: the desk's first blocker (kind, the tool inside `permission`)
      const blocker = desk.blockers[0];
      if (blocker === undefined) expect(model.wait, name).toBeUndefined();
      else {
        expect(model.wait?.kind, name).toBe(blocker.kind);
        expect(model.wait?.tool, name).toBe(blocker.tool);
        expect(model.wait?.since, name).toBe(ms(blocker.since));
      }
      // the reply
      expect(model.reply?.text, name).toBe(desk.lastAssistantMessage?.text);
      expect(model.reply?.final, name).toBe(desk.lastAssistantMessage?.final);
      // the field row never carries content; the model's row on the phone's
      // wire never exists (the field projection is untouched)
      expect("lastAssistantMessage" in field, name).toBe(false);
      // the profile set: the summary's word, else the persona's set, else native
      expect(model.profileSet, name).toBe(row.profileSet ?? "native");
      // observed: a mirror exists and nothing pends
      expect(model.observed, name).toBe(row.monitor !== undefined && !pending);
    }
    // every model row parses as the contract's shape: the model row on the wire
    for (const row of rows)
      MonitorAgentRowSchema.parse(windowMonitorRow(monitor.row(row.runtimeRunId)));
    // a cost, as the desk carries it and the backend's ledger prices it (the
    // fold now lists this one run)
    const priced = costing(CASES.working as AgentSessionSummary, 4.04, "complete");
    monitor.fold.publish([priced]);
    monitor.runtime.push({ ...stateOf(priced), revision: 9 } as AgentMonitorState);
    const deskCost = AgentDeskRow.parse({ ...projectDeskRow(priced), revision: 0 }).usage;
    const modelCost = monitor.row("run-working").cost;
    // DIFFERENCE, designed (L11, M15): the desk row says the mirror's running
    // total (`costUsd`, the run so far); the model's cost is the backend's
    // usage LEDGER — totals from core's priced buckets, coverage, burn and the
    // ten-minute series. The fixture's mirror carries no priced buckets, so the
    // ledger has nothing to total and the model row carries no cost at all,
    // while the desk repeats the mirror's 4.04. The two agree once core's
    // `costHistory` rides the state (it does for a live run), and differ by
    // design across a daemon restart (the window refills; the desk never had it).
    expect(deskCost?.costUsd).toBe(4.04);
    expect(deskCost?.costCoverage).toBe("complete");
    findings.push(
      `cost — desk carries the mirror's running costUsd/costCoverage; the model's cost is the ledger's (absent here: ${JSON.stringify(modelCost)}; the fixture mirror has no priced buckets)`,
    );
    console.log(`MV-3a differential — designed differences:\n  ${findings.join("\n  ")}`);
    monitor.service.dispose();
  });
});

// MV-7 — the spend view draws a local row's line from its `cost.series`, and a
// row without one draws no line. The series is the backend's usage ledger over
// core's own priced buckets (`costHistory`, which a live run's state carries):
// here the state carries three of them, and this desktop's model row — and its
// window's wire cut — carry the ledger's total, coverage, burn and its twenty
// 30 s steps (the ten-minute window). (A peer's line is never drawn: the view
// reads a series only on its own desktop's rows.)
describe("MV-7 — a local row carries the ledger's ten-minute series", () => {
  it("prices a run from core's buckets: usd, coverage, burn and the series, on the model row and the wire", async () => {
    const base = CASES.working as AgentSessionSummary;
    const monitor = await testMonitor({ summaries: [base] });
    const priced = costing(base, 4.04, "complete");
    const state = stateOf(priced);
    // core's buckets sit on the 30 s grid: the current one and the two before it
    const boundary = Math.floor(NOW0 / 30_000) * 30_000;
    const bucket = (stepsAgo: number, costUsd: number) => ({
      at: new Date(boundary - stepsAgo * 30_000).toISOString(),
      costUsd,
    });
    monitor.fold.publish([priced]);
    monitor.runtime.push({
      ...state,
      revision: 9,
      usage: {
        ...state.usage,
        costUsd: 4.04,
        costCoverage: "complete",
        costRatePerMin: 0.05,
        costHistory: [bucket(2, 0.4), bucket(1, 0.6), bucket(0, 0.2)],
      },
    } as AgentMonitorState);
    const cost = monitor.row("run-working").cost;
    expect(cost?.usd).toBe(4.04);
    expect(cost?.coverage).toBe("complete");
    expect(cost?.burnPerHour).toBeCloseTo(3);
    expect(cost?.series?.stepMs).toBe(30_000);
    expect(cost?.series?.lastStepAt).toBe(boundary);
    expect(cost?.series?.steps).toHaveLength(20);
    expect(cost?.series?.steps.slice(-3)).toEqual([0.4, 0.6, 0.2]);
    // the window's own cut keeps it whole, and it parses as the contract's row
    const wire = MonitorAgentRowSchema.parse(windowMonitorRow(monitor.row("run-working")));
    expect(wire.cost?.series).toEqual(cost?.series);
    monitor.service.dispose();
  });
});

describe("the wire — what n = 20 costs", () => {
  it("today's full board against the model board: the snapshot, one changed row, a peer's desk row", async () => {
    const rows: AgentSessionSummary[] = [];
    for (let index = 0; index < 20; index += 1) {
      rows.push(
        costing(
          summary({
            runtimeRunId: `run-${index}`,
            status: index % 5 === 0 ? "blocked" : index % 3 === 0 ? "idle" : "working",
            ...(index % 5 === 0 ? { permissionTool: "Bash" } : {}),
            cumulativeTokens: 1_000 * (index + 1),
            contextPercent: (index * 7) % 100,
            effort: { value: "high", intent: "observed" },
            lastAssistantText: `Reply ${index}: ${"the lane lands ".repeat(6)}`,
            cwd: `/repo-${index % 4}`,
            git: { branch: `lane/${index}` },
          }),
          index * 0.37,
          "complete",
        ),
      );
    }
    const monitor = await testMonitor({ summaries: rows });
    monitor.rows();
    // today's full stream: the whole AgentListResult, mirrors included, every tick
    const full: AgentListResult = monitor.fold.list();
    const fullBytes = JSON.stringify(full).length;
    // the model board's snapshot (the window's open) and the desk board's
    const frames: unknown[] = [];
    const board = createModelSubscription({
      fold: monitor.fold,
      monitor: monitor.service,
      emit: (delta) => frames.push(delta),
      epoch: "boot.size",
      minIntervalMs: 0,
    });
    const snapshotBytes = JSON.stringify(board.snapshot).length;
    const perRow = snapshotBytes / 20;
    const modelRowBytes = JSON.stringify(windowMonitorRow(monitor.row("run-7"))).length;
    const deskRowBytes = JSON.stringify({ ...projectDeskRow(rows[7]!), revision: 1 }).length;
    const peerRowBytes = JSON.stringify({
      ...projectDeskRow(rows[7]!, AGENT_FIELD.DESK_TEXT_CHARS, monitor.row("run-7")),
      revision: 1,
    }).length;
    // one row's usage ticks: today the whole board goes out; the model board
    // sends that row's desk row with its model row
    const base = stateOf(rows[7]!);
    monitor.runtime.push({
      ...base,
      revision: base.revision + 1,
      usage: { ...base.usage, cumulativeTokens: 999_999 },
    } as AgentMonitorState);
    monitor.scheduler.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const delta = frames.at(-1);
    expect(delta).toBeDefined();
    const deltaBytes = JSON.stringify(delta).length;
    const changed = (delta as { upserts: unknown[] }).upserts;
    expect(changed).toHaveLength(1);
    AgentDeskRow.parse(changed[0]);
    console.log(
      [
        "MV-3a wire sizes at n = 20 (JSON bytes):",
        `  today's full board frame (every tick while anything changes): ${fullBytes} (${(fullBytes / 20).toFixed(0)}/row)`,
        `  model board snapshot (the open): ${snapshotBytes} (${perRow.toFixed(0)}/row)`,
        `  one changed row's delta (the tick): ${deltaBytes}`,
        `  a model row alone: ${modelRowBytes}; a desk row without it: ${deskRowBytes}; a PEER's desk row with it: ${peerRowBytes}`,
      ].join("\n"),
    );
    expect(deltaBytes).toBeLessThan(fullBytes / 4);
    board.dispose();
    monitor.service.dispose();
  });
});
