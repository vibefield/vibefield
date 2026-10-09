import {
  type IndexContribution,
  type IndexHeatmapDay,
  type IndexHourTotal,
  type IndexModelDay,
  type IndexModelHour,
  IndexProjectDayResult,
  IndexProjectResult,
  type IndexSearchSource,
  type ProjectContribution,
  type ProjectFiguresDayResult,
  type ProjectFiguresResult,
  type ProjectFiguresSource,
} from "@vibefield/contracts";
import { RpcCallError } from "../native-link";

// PJ-4 — A PROJECT'S MERGED FIGURES (H2 (a), James 2026-10-09; A-D3 (a) +
// (ii); contracts `project-doors.ts` §project.figures). rosetta aggregates per
// rosetta project only; a PJ project's sessions are filed under several, on
// several desktops. `ProjectDoors.figuresPlan` says which (desktop, rosetta
// project) pairs hold the project's sessions and whether the project holds
// each WHOLE; this file asks each of them (`index.project` /
// `index.projectDay` — this desktop's index directly, a peer's door through
// IndexMesh's ask, which says when it is asleep or silent) and folds the
// answers: what is additive is summed, a part held in PART gives its sessions'
// contribution rows and none of its days (the days cannot be cut), and every
// desktop says how it took part. Nothing is cached here: the window shares one
// answer between the room's two asks (`history/doors.ts`).

/** One (desktop, rosetta project) pair the project's sessions are filed under
 * — keyed by both, never the bare rosetta id (A4.1). */
export interface FiguresPart {
  readonly device: string;
  readonly projectId: string;
  /** every session this rosetta project files on `device` is the project's */
  readonly whole: boolean;
  /** the project's sessions it files there (rosetta's canonical ids) */
  readonly sessions: ReadonlySet<string>;
}

/** What one project's figures are asked of (`ProjectDoors.figuresPlan`). */
export interface FiguresPlan {
  /** the project answered — the asked key, or the one it moved into */
  readonly key: string;
  readonly movedTo?: string;
  /** every desktop the project has a place on, in the project's order */
  readonly devices: readonly string[];
  readonly parts: readonly FiguresPart[];
  /** `${device}\0${sessionId}` → `${kind}\0${nativeSessionId}`: one
   * conversation two desktops both recorded is counted once (DS-D10) */
  readonly conversations: ReadonlyMap<string, string>;
}

/** A peer's answer through IndexMesh's ask, or how it took part instead. */
export type PeerAsk =
  | { answered: true; value: unknown; tookMs: number }
  | { answered: false; source: IndexSearchSource };

/** Where the parts are asked: this desktop's index, and a peer's door. */
export interface FiguresAsk {
  /** this desktop's id — its parts are asked of its own index */
  readonly self: string;
  readonly local: {
    project(params: {
      projectId: string;
      sinceMs?: number | undefined;
      offsetMinutes?: number | undefined;
    }): Promise<IndexProjectResult>;
    projectDay(params: {
      projectId: string;
      day: string;
      offsetMinutes?: number | undefined;
    }): Promise<IndexProjectDayResult>;
  };
  readonly peer: (device: string, method: string, params: unknown) => Promise<PeerAsk>;
  readonly now?: () => number;
}

/** How many of one desktop's parts are asked at once. */
export const FIGURES_PART_CONCURRENCY = 4;

type Answer<T> = { ok: true; value: T } | { ok: false; source: IndexSearchSource };

/** What a failed local ask says of this desktop (`#askLocal`'s reading):
 * an index that is not up is `building`, in fieldd's own words. */
function localRefusal(device: string, error: unknown, tookMs: number): IndexSearchSource {
  const detail = error instanceof Error && error.message ? error.message : undefined;
  if (error instanceof RpcCallError && error.kind === "TIMEOUT")
    return { device, state: "timeout", tookMs, ...(detail ? { detail } : {}) };
  return {
    device,
    state: "building",
    tookMs,
    detail: detail ?? "this desktop's index did not answer",
  };
}

/** Ask every part of one desktop, a few at a time. */
async function askDevice<T>(
  device: string,
  parts: readonly FiguresPart[],
  ask: FiguresAsk,
  local: (part: FiguresPart) => Promise<T>,
  method: string,
  params: (part: FiguresPart) => Record<string, unknown>,
  parse: (value: unknown) => T,
): Promise<Array<{ part: FiguresPart; answer: Answer<T>; tookMs: number }>> {
  const now = ask.now ?? Date.now;
  const out: Array<{ part: FiguresPart; answer: Answer<T>; tookMs: number }> = [];
  let next = 0;
  // an asleep or incompatible desktop answers the same for every part: once
  // it has said so, the rest of its parts are not asked
  let standing: IndexSearchSource | null = null;
  const worker = async (): Promise<void> => {
    while (next < parts.length) {
      const part = parts[next++]!;
      if (standing !== null) {
        out.push({ part, answer: { ok: false, source: standing }, tookMs: 0 });
        continue;
      }
      const started = now();
      if (device === ask.self) {
        try {
          out.push({
            part,
            answer: { ok: true, value: await local(part) },
            tookMs: now() - started,
          });
        } catch (error) {
          const tookMs = Math.max(0, now() - started);
          out.push({
            part,
            answer: { ok: false, source: localRefusal(device, error, tookMs) },
            tookMs,
          });
        }
        continue;
      }
      const reply = await ask.peer(device, method, params(part));
      if (!reply.answered) {
        if (reply.source.state === "asleep" || reply.source.state === "incompatible")
          standing = reply.source;
        out.push({
          part,
          answer: { ok: false, source: reply.source },
          tookMs: reply.source.tookMs,
        });
        continue;
      }
      try {
        out.push({ part, answer: { ok: true, value: parse(reply.value) }, tookMs: reply.tookMs });
      } catch {
        // a body this build cannot read is the peer's other build (DS-L9)
        out.push({
          part,
          answer: {
            ok: false,
            source: { device, state: "incompatible", tookMs: reply.tookMs },
          },
          tookMs: reply.tookMs,
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FIGURES_PART_CONCURRENCY, parts.length) }, () => worker()),
  );
  return out;
}

/** Ask every part of the plan, desktop by desktop (all desktops at once). */
async function askAll<T>(
  plan: FiguresPlan,
  ask: FiguresAsk,
  parts: readonly FiguresPart[],
  local: (part: FiguresPart) => Promise<T>,
  method: string,
  params: (part: FiguresPart) => Record<string, unknown>,
  parse: (value: unknown) => T,
): Promise<{
  answered: Array<{ part: FiguresPart; value: T }>;
  sources: ProjectFiguresSource[];
  missing: boolean;
}> {
  const byDevice = new Map<string, FiguresPart[]>();
  for (const part of parts) {
    const held = byDevice.get(part.device) ?? [];
    held.push(part);
    byDevice.set(part.device, held);
  }
  const answers = await Promise.all(
    plan.devices.map(async (device) => {
      const mine = byDevice.get(device) ?? [];
      // every part of the plan on this desktop (whatever this ask needs of it)
      const planned = plan.parts.filter((part) => part.device === device);
      const results =
        mine.length === 0 ? [] : await askDevice(device, mine, ask, local, method, params, parse);
      return { device, planned, results };
    }),
  );
  const answered: Array<{ part: FiguresPart; value: T }> = [];
  const sources: ProjectFiguresSource[] = [];
  let missing = false;
  for (const { device, planned, results } of answers) {
    const failed = results.find((result) => !result.answer.ok);
    for (const result of results)
      if (result.answer.ok) answered.push({ part: result.part, value: result.answer.value });
    if (failed !== undefined) missing = true;
    const tookMs = results.reduce((most, result) => Math.max(most, Math.round(result.tookMs)), 0);
    const base: IndexSearchSource =
      failed !== undefined && !failed.answer.ok
        ? failed.answer.source
        : { device, state: "answered", tookMs };
    sources.push({
      ...base,
      device,
      tookMs: Math.max(0, Math.round(base.tookMs)),
      projects: planned.length,
      split: planned.filter((part) => !part.whole).length,
    });
  }
  return { answered, sources, missing };
}

/* ── the folds: what is additive is summed ─────────────────────────────── */

type Figures = Pick<
  IndexHeatmapDay,
  | "tokens"
  | "costMicroUsd"
  | "billedMicroUsd"
  | "unpricedTokens"
  | "unrecordedOutput"
  | "reportedCostAdjustmentMicroUsd"
>;

const ZERO: Figures = {
  tokens: 0,
  costMicroUsd: null,
  billedMicroUsd: null,
  unpricedTokens: 0,
  unrecordedOutput: 0,
  reportedCostAdjustmentMicroUsd: 0,
};

/** A nullable money figure summed as SQL sums it: null only while every part
 * is null (an unpriced part is counted in `unpricedTokens`, never as zero). */
const plus = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : a + b;

export function addFigures(a: Figures, b: Figures): Figures {
  return {
    tokens: a.tokens + b.tokens,
    costMicroUsd: plus(a.costMicroUsd, b.costMicroUsd),
    billedMicroUsd: plus(a.billedMicroUsd, b.billedMicroUsd),
    unpricedTokens: a.unpricedTokens + b.unpricedTokens,
    unrecordedOutput: a.unrecordedOutput + b.unrecordedOutput,
    reportedCostAdjustmentMicroUsd:
      a.reportedCostAdjustmentMicroUsd + b.reportedCostAdjustmentMicroUsd,
  };
}

const figuresOf = (row: Figures): Figures => ({
  tokens: row.tokens,
  costMicroUsd: row.costMicroUsd,
  billedMicroUsd: row.billedMicroUsd,
  unpricedTokens: row.unpricedTokens,
  unrecordedOutput: row.unrecordedOutput,
  reportedCostAdjustmentMicroUsd: row.reportedCostAdjustmentMicroUsd,
});

/** Sum rows by a key, in the key's order. */
function sumBy<Row extends Figures, Key extends string | number>(
  rows: readonly Row[],
  keyOf: (row: Row) => Key,
  rebuild: (key: Key, row: Row, figures: Figures) => Row,
): Row[] {
  const held = new Map<Key, { row: Row; figures: Figures }>();
  for (const row of rows) {
    const key = keyOf(row);
    const at = held.get(key);
    held.set(key, {
      row: at?.row ?? row,
      figures: addFigures(at?.figures ?? ZERO, figuresOf(row)),
    });
  }
  return [...held.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, { row, figures }]) => rebuild(key, row, figures));
}

/** PJ-4 — fold the answered parts into one project's figures (pure). Daily
 * figures come from WHOLE parts only; contribution rows from every part (a
 * split part's for the project's own sessions), one per conversation. */
export function mergeFigures(
  plan: FiguresPlan,
  answered: ReadonlyArray<{ part: FiguresPart; value: IndexProjectResult }>,
  sources: ProjectFiguresSource[],
  missing: boolean,
  maxContributionRows?: number,
): ProjectFiguresResult {
  const whole = answered.filter(({ part }) => part.whole);
  const heatmap = sumBy(
    whole.flatMap(({ value }) => value.heatmap),
    (row) => row.day,
    (day, _row, figures): IndexHeatmapDay => ({ day, ...figures }),
  );
  const models = sumBy(
    whole.flatMap(({ value }) => value.usage.models),
    (row) => `${row.day}\u0000${row.model}`,
    (_key, row, figures): IndexModelDay => ({ day: row.day, model: row.model, ...figures }),
  );
  const hours = sumBy(
    whole.flatMap(({ value }) => value.usage.hours),
    (row) => row.hour,
    (hour, _row, figures): IndexHourTotal => ({ hour, ...figures }),
  );
  // the contribution: every part's rows for the project's own sessions — a
  // whole part's are all of them, even one the catalog has not listed yet —
  // and one row per conversation however many desktops recorded it
  const seen = new Set<string>();
  let recordedTwice = false;
  const contribution: ProjectContribution[] = [];
  // the plan's order (its desktops, then the rosetta ids), never the order
  // the answers happened to land in
  const ordered = [...answered].sort(
    (a, b) => plan.parts.indexOf(a.part) - plan.parts.indexOf(b.part),
  );
  for (const { part, value } of ordered) {
    for (const row of value.contribution) {
      if (!part.whole && !part.sessions.has(row.sessionId)) continue;
      const conversation =
        plan.conversations.get(`${part.device}\u0000${row.sessionId}`) ??
        `\u0001${part.device}\u0000${row.sessionId}`;
      if (seen.has(conversation)) {
        recordedTwice = true;
        continue;
      }
      seen.add(conversation);
      contribution.push({ ...(row as IndexContribution), device: part.device });
    }
  }
  const limit = maxContributionRows;
  const clipped =
    answered.some(({ value }) => value.clipped) ||
    (limit !== undefined && contribution.length > limit);
  const split = plan.parts.some((part) => !part.whole);
  return {
    key: plan.key,
    ...(plan.movedTo !== undefined ? { movedTo: plan.movedTo } : {}),
    heatmap,
    usage: { models, hours },
    contribution: limit !== undefined ? contribution.slice(0, limit) : contribution,
    sources,
    partial: missing || split || recordedTwice,
    lifetimePartial: missing || clipped,
    clipped,
  };
}

/** PJ-4 — fold one day's answered WHOLE parts into hour × model tokens. */
export function mergeDay(
  plan: FiguresPlan,
  day: string,
  answered: ReadonlyArray<{ part: FiguresPart; value: IndexProjectDayResult }>,
  sources: ProjectFiguresSource[],
  missing: boolean,
): ProjectFiguresDayResult {
  const tokens = new Map<string, { hour: number; model: string; tokens: number }>();
  for (const { value } of answered) {
    for (const row of value.models) {
      const key = `${String(row.hour).padStart(2, "0")}\u0000${row.model}`;
      const held = tokens.get(key);
      tokens.set(key, {
        hour: row.hour,
        model: row.model,
        tokens: (held?.tokens ?? 0) + row.tokens,
      });
    }
  }
  const models: IndexModelHour[] = [...tokens.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, row]) => row);
  return {
    key: plan.key,
    ...(plan.movedTo !== undefined ? { movedTo: plan.movedTo } : {}),
    day,
    models,
    sources,
    partial: missing || plan.parts.some((part) => !part.whole),
  };
}

/* ── the fan-out ───────────────────────────────────────────────────────── */

/** `project.figures` — every part asked, the answers folded. */
export async function projectFigures(
  plan: FiguresPlan,
  window: { sinceMs?: number | undefined; offsetMinutes?: number | undefined },
  ask: FiguresAsk,
  maxContributionRows?: number,
): Promise<ProjectFiguresResult> {
  const asked = {
    ...(window.sinceMs !== undefined ? { sinceMs: window.sinceMs } : {}),
    ...(window.offsetMinutes !== undefined ? { offsetMinutes: window.offsetMinutes } : {}),
  };
  const { answered, sources, missing } = await askAll(
    plan,
    ask,
    plan.parts,
    (part) => ask.local.project({ projectId: part.projectId, ...asked }),
    "index.project",
    (part) => ({ projectId: part.projectId, ...asked }),
    (value) => IndexProjectResult.parse(value),
  );
  return mergeFigures(plan, answered, sources, missing, maxContributionRows);
}

/** `project.figuresDay` — the whole parts' hours that day, folded. */
export async function projectFiguresDay(
  plan: FiguresPlan,
  day: string,
  offsetMinutes: number | undefined,
  ask: FiguresAsk,
): Promise<ProjectFiguresDayResult> {
  const asked = offsetMinutes !== undefined ? { offsetMinutes } : {};
  const { answered, sources, missing } = await askAll(
    plan,
    ask,
    plan.parts.filter((part) => part.whole),
    (part) => ask.local.projectDay({ projectId: part.projectId, day, ...asked }),
    "index.projectDay",
    (part) => ({ projectId: part.projectId, day, ...asked }),
    (value) => IndexProjectDayResult.parse(value),
  );
  return mergeDay(plan, day, answered, sources, missing);
}
