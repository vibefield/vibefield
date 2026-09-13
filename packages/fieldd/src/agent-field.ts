import {
  AGENT_FIELD,
  type AgentFieldBlocker,
  type AgentFieldDelta,
  AgentFieldRow,
  type AgentFieldSnapshot,
  type AgentListResult,
  type AgentSessionSummary,
} from "@vibefield/contracts";

// MF-1 (thinking-godview-mobile-first.md §5/§10.2) — the FIELD projection: the
// fold's rows with their content removed, and the revision machinery that lets
// an idle board cost nothing.
//
// Why this exists: `agent.subscribe` answers the whole `AgentListResult` on
// every publish, and a working agent's monitor mirror revises many times a
// second (usage samples, activity, freshness). The desktop reads that over a
// loopback socket and does not care. A phone on the tailnet would receive whole
// boards at tens of Hz — past its radio budget and its battery.
//
// Two halves, both pure enough to test without a daemon:
//   - `projectFieldRow` drops content and keeps facts. It is the ONLY place
//     that reads the mirror's shape, so a wire change upstream has one site to
//     fix, not a view's worth.
//   - `FieldProjection` holds the per-row revision counters. A row's revision
//     bumps IFF its projected JSON changed — never with the mirror's own
//     revision, which is why a board that is only ticking usage samples emits
//     nothing at all.

/** What a fold row projects to before the counter stamps it.
 *
 * Derived from the CONTRACT rather than retyped, and deliberately not
 * `Omit<AgentFieldRow, "revision">`: the row is a `.passthrough()` inference,
 * so its string index signature makes `Omit` swallow every named key with the
 * one it was asked to drop. Zod's own `.omit()` keeps them. */
const ProjectedRowSchema = AgentFieldRow.omit({ revision: true });
export type ProjectedFieldRow = (typeof ProjectedRowSchema)["_output"];

/** Read one unknown object field tolerantly (the mirror is `.passthrough()`,
 * so everything this projection wants beyond the contract's named fields
 * arrives as `unknown`). */
function objectAt(source: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringAt(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** One blocker, content-free. The tool comes from puppeteer's real shape —
 * `blockers[].permission.tool` (its `MonitorBlocker` union nests it in the
 * `kind: "permission"` arm beside a `requestId` we drop) — NOT from a `tool`
 * at the blocker's root, which nothing upstream writes. `input`, `questions`
 * and `detail` are dropped on purpose: what a run is waiting ON is the field's
 * business, what it is waiting to be TOLD is not. */
function projectBlocker(blocker: { id: string; kind: string; since: string }): AgentFieldBlocker {
  const tool = stringAt(objectAt(blocker, "permission"), "tool");
  return {
    id: blocker.id,
    kind: blocker.kind,
    since: blocker.since,
    ...(tool !== undefined ? { tool } : {}),
  };
}

/** The folder a path ends in, as the field names it (EL7 B1): the last
 * segment, with either platform's separators and any trailing ones trimmed.
 * A root or an empty path has no folder to name, and neither does a bare
 * Windows drive — the row then carries no `name` at all rather than a
 * misleading one.
 *
 * The PATH never travels. It carried the OS username and the shape of a
 * person's disk to every tailnet node the app admits, and a card only ever
 * drew the basename. */
export function folderNameOf(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const trimmed = path.replace(/[/\\]+$/, "");
  if (trimmed === "") return undefined;
  const last = trimmed.split(/[/\\]+/).pop();
  if (last === undefined || last === "" || /^[A-Za-z]:$/.test(last)) return undefined;
  return last;
}

/** The fold's row, projected. Pure: same summary in, same row out, so the
 * revision counter above it can trust JSON equality. */
export function projectFieldRow(summary: AgentSessionSummary): ProjectedFieldRow {
  const monitor = summary.monitor;
  // `effort` is not in the mirror's named fields (it rides `.passthrough()`),
  // so it is read tolerantly: a `value` string is the whole requirement, and
  // `intent` says whether that value is evidence or only launch intent.
  const effortRaw = objectAt(monitor, "effort");
  const effortValue = stringAt(effortRaw, "value");
  const effortIntent = stringAt(effortRaw, "intent");
  const environment = monitor?.environment;
  // EL7 B1 — the FOLDER, never the path
  const name = folderNameOf(environment?.cwd);
  // Three states, and the difference between two of them is the point. `git`
  // ABSENT = nothing looked, so the row carries no `branch` key at all; `git`
  // NULL = looked and this is not a repo; `git.branch` null = a repo with no
  // branch (a detached head). The last two are facts a card can draw; the
  // first is silence, and collapsing them would turn "unknown" into "none".
  const git = environment?.git;
  const branch = git === undefined ? undefined : git === null ? null : git.branch;
  const usage = monitor?.usage;
  const context = monitor?.context;
  const model = monitor?.model;
  const project =
    name !== undefined || branch !== undefined
      ? {
          ...(name !== undefined ? { name } : {}),
          ...(branch !== undefined ? { branch } : {}),
        }
      : undefined;

  return {
    runtimeRunId: summary.runtimeRunId,
    kind: summary.kind,
    label: summary.label,
    tier: summary.tier,
    device: summary.device,
    ...(summary.profileId !== undefined ? { profileId: summary.profileId } : {}),
    status: summary.status,
    // the mirror's own clock when there is one; for an UNOBSERVED row (AR-4's
    // pending) the fold's `stateChangedAt` is the honest since — the moment
    // this boot learned what it was looking at
    statusSince: monitor?.statusSince ?? summary.stateChangedAt,
    stateChangedAt: summary.stateChangedAt,
    createdAt: summary.createdAt,
    ...(summary.lastActivityAt !== undefined ? { lastActivityAt: summary.lastActivityAt } : {}),
    // Liveness AS FIELDD KNOWS IT (ruled 2026-09-13), which is not the same as
    // "observed", and not the same as "has a pane". Three readings, in order:
    //
    //  1. MF-1f — the record is stamped with an exit. fieldd WITNESSED the
    //     process end, so the run is not alive however recently its mirror was
    //     read; the row survives only because the floor still lists the PTY
    //     (the deck's dead pane, with the resume verb on it).
    //  2. a mirror exists — its own word.
    //  3. no mirror — AR-4's pending row: its PTY is on this device and fieldd
    //     will re-adopt or resume it, so the run is ALIVE and merely
    //     unobserved, and `pending` is what says nothing is driving it. The
    //     first draft answered `false` here and that was a defect: a reader
    //     draws `alive: false` as GONE, which would drop a live agent off a
    //     phone. `hosted: "none"` (or no terminal at all) is the honest false.
    alive:
      summary.continuation?.exited === true
        ? false
        : (monitor?.alive ??
          (summary.terminal !== undefined && summary.terminal.hosted !== "none")),
    ...(summary.continuation?.pending !== undefined
      ? { pending: summary.continuation.pending }
      : {}),
    blockers: monitor?.blockers.map(projectBlocker) ?? [],
    // Each of these is REBUILT, never spread: the mirror's own objects carry
    // sample histories, capacities and `asOf` stamps the phone keeps its own
    // ledgers for (IOS-6a), and a spread would smuggle every one of them onto
    // the wire.
    ...(usage !== undefined
      ? {
          usage: {
            ...(usage.cumulativeTokens !== undefined
              ? { cumulativeTokens: usage.cumulativeTokens }
              : {}),
            ...(usage.burnRatePerMin !== undefined ? { burnRatePerMin: usage.burnRatePerMin } : {}),
          },
        }
      : {}),
    ...(context !== undefined ? { context: { usedPercent: context.usedPercent } } : {}),
    ...(model !== undefined
      ? {
          model: {
            id: model.id,
            ...(model.displayName !== undefined ? { displayName: model.displayName } : {}),
          },
        }
      : {}),
    ...(effortValue !== undefined
      ? {
          effort: {
            value: effortValue,
            ...(effortIntent !== undefined ? { intent: effortIntent } : {}),
          },
        }
      : {}),
    ...(project !== undefined ? { project } : {}),
    // The join, verbatim: `{hosted, runtimeSessionId, cellBootId?,
    // workloadClass?, replaced?}` is what a body's card attaches THROUGH (G3),
    // and every field of it is already content-free.
    ...(summary.terminal !== undefined ? { terminal: summary.terminal } : {}),
  };
}

/** Upserts and removals between two projected boards, by (runtimeRunId,
 * revision). A row whose revision is unchanged is not sent again. */
export function diffFieldRows(
  prev: readonly AgentFieldRow[],
  next: readonly AgentFieldRow[],
): { upserts: AgentFieldRow[]; removed: string[] } {
  const before = new Map(prev.map((row) => [row.runtimeRunId, row.revision]));
  const upserts: AgentFieldRow[] = [];
  for (const row of next) {
    if (before.get(row.runtimeRunId) !== row.revision) upserts.push(row);
    before.delete(row.runtimeRunId);
  }
  return { upserts, removed: [...before.keys()] };
}

/** The fold's rows as a field board, with the revisions that make deltas
 * possible.
 *
 * One instance per consumer (a subscriber, the store publisher): the revision
 * chain is per-reader, so nothing has to reason about what a second reader has
 * already seen. Rows keep their own counters across `apply` calls; the board's
 * counter bumps once per frame that actually carries a change. */
export class FieldProjection {
  private rows: AgentFieldRow[] = [];
  /** the projected JSON each row's revision was last stamped for */
  private readonly stamps = new Map<string, string>();
  private boardRevision = 0;

  /** The board as it stands. */
  snapshot(): AgentFieldSnapshot {
    return { revision: this.boardRevision, rows: this.rows.map((row) => ({ ...row })) };
  }

  get revision(): number {
    return this.boardRevision;
  }

  /** Fold in a fresh `agent.list`/publish. Answers the delta when the
   * PROJECTION moved and `null` when it did not — the whole reason an idle
   * board (or one whose only news is a usage sample) sends nothing. */
  apply(result: AgentListResult): AgentFieldDelta | null {
    const since = this.boardRevision;
    const next: AgentFieldRow[] = [];
    const seen = new Set<string>();
    const previous = new Map(this.rows.map((row) => [row.runtimeRunId, row]));

    for (const summary of result.sessions) {
      const projected = projectFieldRow(summary);
      const id = projected.runtimeRunId;
      seen.add(id);
      const stamp = JSON.stringify(projected);
      const prior = previous.get(id);
      if (prior !== undefined && this.stamps.get(id) === stamp) {
        next.push(prior);
        continue;
      }
      this.stamps.set(id, stamp);
      next.push({ ...projected, revision: (prior?.revision ?? 0) + 1 });
    }
    for (const id of this.stamps.keys()) if (!seen.has(id)) this.stamps.delete(id);

    const diff = diffFieldRows(this.rows, next);
    this.rows = next;
    if (diff.upserts.length === 0 && diff.removed.length === 0) return null;
    this.boardRevision = since + 1;
    return {
      since,
      revision: this.boardRevision,
      upserts: diff.upserts.map((row) => ({ ...row })),
      removed: diff.removed,
    };
  }
}

export interface FieldSubscriptionOptions {
  /** the fold's current rows */
  list: () => AgentListResult;
  /** the fold's publish stream (`AgentRuntimeService.subscribe`) */
  subscribe: (emit: (rows: AgentListResult) => void) => () => void;
  /** push one delta frame to this subscriber */
  emit: (delta: AgentFieldDelta) => void;
  /** per-subscriber trailing-edge floor */
  minIntervalMs?: number;
  onError?: (error: unknown) => void;
}

export interface FieldSubscription {
  snapshot: AgentFieldSnapshot;
  dispose: () => void;
}

/** One `agent.subscribe {projection: "field"}` subscriber: a snapshot now, then
 * deltas at this subscriber's own floor.
 *
 * The floor is TRAILING-EDGE, exactly like the fold's own 16 ms tick — a change
 * is never dropped, only held to the end of its window, and several changes in
 * one window collapse into the one frame that carries them all. A subscriber
 * asking for 250 ms therefore costs at most four frames a second no matter how
 * loudly the mirrors revise, and nothing at all while the projection is still. */
export function createFieldSubscription(opts: FieldSubscriptionOptions): FieldSubscription {
  const projection = new FieldProjection();
  const floor = opts.minIntervalMs ?? AGENT_FIELD.MIN_INTERVAL_MS;
  projection.apply(opts.list());
  let timer: NodeJS.Timeout | null = null;
  let disposed = false;

  const flush = (): void => {
    timer = null;
    if (disposed) return;
    let delta: AgentFieldDelta | null;
    try {
      delta = projection.apply(opts.list());
    } catch (error) {
      opts.onError?.(error);
      return;
    }
    if (delta === null) return;
    try {
      opts.emit(delta);
    } catch (error) {
      opts.onError?.(error);
    }
  };

  const unsubscribe = opts.subscribe(() => {
    if (disposed || timer !== null) return;
    timer = setTimeout(flush, floor);
    timer.unref?.();
  });

  return {
    snapshot: projection.snapshot(),
    dispose: () => {
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      unsubscribe();
    },
  };
}
