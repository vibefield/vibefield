import type { MonitorAgentRow } from "@vibecook/puppeteer-view-sdk/model";
import {
  AGENT_FIELD,
  type AgentDeskBlocker,
  type AgentDeskMessage,
  AgentDeskRow,
  AgentDeskTerminalRow,
  type AgentFieldBlocker,
  type AgentFieldDelta,
  AgentFieldRow,
  type AgentFieldSnapshot,
  type AgentListResult,
  type AgentSessionSummary,
  type AgentSessionTerminal,
  type AgentSubscribeParams,
  type MonitorAgentRow as WireMonitorRow,
} from "@vibefield/contracts";
import { RpcCallError } from "./native-link";
import {
  diffRows,
  projectRows,
  RevisionedSubscription,
  type RowsProjection,
  snapshotDeltaView,
} from "./projection";

/** `agent.subscribe`'s answer to params that do not parse — the handler's, and
 * the subscription forwarder's for a routed ask (`refuseBoardAsk`). */
export function malformedBoardAsk(): RpcCallError {
  return new RpcCallError(
    "PRECONDITION_FAILED",
    'expected { projection?: "full" | "field" | "desk" | "model", scope?: "local" | "mesh", minIntervalMs?: number, heartbeatMs?: number }',
    false,
  );
}

/**
 * WHO may ask WHICH board, in one place (the landing review, S2, 2026-10-01).
 *
 * `agent.subscribe`'s refusals used to live in its handler, and a routed ask
 * (`{device}`) never reaches the handler on THIS daemon: ProductApi forwards it
 * whole to the owner, which sees this daemon's `peer-fieldd` principal and not
 * the caller behind it. So a phone could ask `desk` of another desktop through
 * its home and be served the content SP-L4 withholds from it. The handler asks
 * this of its own caller, and the subscription forwarder asks it of the CALLER
 * before carrying the ask — the one place that caller's kind is known.
 *
 *  · `full` stays on its device: a peer is refused it, the mesh is never asked
 *    for it, and the cadence options it cannot honour are refused (MF-1h);
 *  · `desk` carries content for this person's DESKTOPS — a window, or a self
 *    peer daemon relaying to one; a phone (`tailnet`) reads `field` (SP-L4);
 *  · `scope: "mesh"` is this desktop's clients' aggregate: a peer reads a
 *    desktop's OWN board (DS-L4), and the mesh states each desktop's liveness
 *    itself, so `heartbeatMs` is refused there.
 *
 * Pure: the caller's principal kind and the parsed ask in, the refusal (or
 * null) out. Availability (the mesh board not built yet) is not a refusal and
 * stays with the handler.
 */
export function refuseBoardAsk(principal: string, ask: AgentSubscribeParams): RpcCallError | null {
  const projection = ask.projection ?? "full";
  const scope = ask.scope ?? "local";
  const { minIntervalMs, heartbeatMs } = ask;
  if (projection === "full") {
    // DS-D4 — the whole fold row stays on its device. The door became `stream`
    // for the board's sake (a peer daemon asks it), so the wall that used to
    // refuse a peer outright is this line for `full`. SP-L4 (DS wave 2 landing,
    // 2026-10-01): the PHONE is refused it too — a `tailnet` principal's bare
    // ask used to be the whole fold at the desktop's 16 ms tick; the phone
    // reads `field` (and does: FieldLink asks `{projection: "field"}`).
    if (principal === "peer-fieldd" || principal === "tailnet")
      return new RpcCallError(
        "FORBIDDEN_SCOPE",
        principal === "tailnet"
          ? "the full projection is local to its device; a phone reads field (SP-L4)"
          : "the full projection is local to its device; a peer reads field or desk (DS-D4)",
        false,
        { projection },
      );
    if (scope === "mesh")
      return new RpcCallError(
        "PRECONDITION_FAILED",
        "the mesh board is the field or desk projection; full is local to its device",
        false,
      );
    // MF-1h — an option that cannot be honoured is refused, not ignored: a
    // caller that asked for a cadence and silently got the desktop's 16 ms tick
    // would have no way to learn it asked the wrong question.
    if (minIntervalMs !== undefined || heartbeatMs !== undefined)
      return new RpcCallError(
        "PRECONDITION_FAILED",
        `${minIntervalMs !== undefined ? "minIntervalMs" : "heartbeatMs"} applies to the field projection and the desk projection`,
        false,
      );
    return null;
  }
  // MV-3a (MV-D18, L8, M16) — the model board is THIS desktop's own windows':
  // it carries the colour sequences this desktop dealt and its bare terminals,
  // neither of which crosses the sync plane. A peer reads `desk`, a phone
  // `field`; both are refused here as they are refused `full`.
  if (projection === "model" && (principal === "peer-fieldd" || principal === "tailnet"))
    return new RpcCallError(
      "FORBIDDEN_SCOPE",
      principal === "tailnet"
        ? "the model projection is this desktop's windows'; a phone reads field (SP-L4)"
        : "the model projection is this desktop's windows'; a peer reads desk (M16)",
      false,
      { projection },
    );
  // SP-L4 — every subscription a phone opens is content-free. Decided by the
  // principal's kind, never by its transport.
  if (projection === "desk" && principal === "tailnet")
    return new RpcCallError(
      "FORBIDDEN_SCOPE",
      "the desk projection carries content for this person's desktops; a phone reads field (SP-L4)",
      false,
      { projection },
    );
  if (scope === "mesh") {
    // DS-L4 — a peer asking for the mesh would be one daemon aggregating
    // another's aggregate, and two desktops asking each other would loop.
    if (principal === "peer-fieldd")
      return new RpcCallError(
        "FORBIDDEN_SCOPE",
        "a peer reads a desktop's own board; the mesh board is this desktop's clients' (DS-L4)",
        false,
        { scope },
      );
    if (heartbeatMs !== undefined)
      return new RpcCallError(
        "PRECONDITION_FAILED",
        "heartbeatMs is asked of one desktop's board; the mesh board states each desktop's liveness itself",
        false,
      );
  }
  return null;
}

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
/** MV-3a — the model board's two row shapes before the counter stamps them,
 * derived the same way and for the same reason (`Omit` would swallow them). */
const ProjectedDeskRowSchema = AgentDeskRow.omit({ revision: true });
export type ProjectedDeskRow = (typeof ProjectedDeskRowSchema)["_output"];
const ProjectedTerminalRowSchema = AgentDeskTerminalRow.omit({ revision: true });
export type ProjectedTerminalRow = (typeof ProjectedTerminalRowSchema)["_output"];

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

/** A text cut to a bound a person can read in one line, by CODE POINT (never
 * through a surrogate pair), with an ellipsis where it was cut. The desk row's
 * bound is `AGENT_FIELD.DESK_TEXT_CHARS`; the whole text is History's (DS-7). */
export function boundText(text: string, chars: number): string {
  if (text.length <= chars) return text;
  // at most two UTF-16 units per code point: this head holds every point the
  // bound can keep, without walking a reply that may run to megabytes
  const long = text.length > chars * 2;
  const points = Array.from(long ? text.slice(0, chars * 2) : text);
  if (!long && points.length <= chars) return text;
  return `${points.slice(0, chars - 1).join("")}…`;
}

/** What a row is projected by: the field's (content-free) or the desk's. */
export type RowProjector = (summary: AgentSessionSummary) => ProjectedFieldRow;

/** The run's latest reply as the desk carries it: puppeteer's
 * `MonitorAssistantMessageState` read tolerantly off the open mirror object,
 * its text bounded. No text, no line — never an empty one. */
function deskMessage(summary: AgentSessionSummary, chars: number): AgentDeskMessage | undefined {
  const message = objectAt(summary.monitor, "lastAssistantMessage");
  const text = stringAt(message, "text");
  if (text === undefined) return undefined;
  const at = stringAt(message, "at");
  const final = message?.["final"];
  return {
    text: boundText(text, chars),
    ...(at !== undefined ? { at } : {}),
    ...(typeof final === "boolean" ? { final } : {}),
  };
}

/** A question blocker's first prompt (puppeteer's `questions[0].prompt`),
 * bounded — what the run is asking, in its own words. */
function blockerQuestion(blocker: unknown, chars: number): string | undefined {
  if (typeof blocker !== "object" || blocker === null) return undefined;
  const questions = (blocker as Record<string, unknown>)["questions"];
  if (!Array.isArray(questions)) return undefined;
  const prompt = stringAt(
    typeof questions[0] === "object" && questions[0] !== null
      ? (questions[0] as Record<string, unknown>)
      : undefined,
    "prompt",
  );
  return prompt === undefined ? undefined : boundText(prompt, chars);
}

// MV-3a (MV-D22, MV-D18) — THE MODEL'S ROW, CUT PER AUDIENCE. The backend
// beside the runtime (`agent-monitor.ts`) emits the SDK's `MonitorAgentRow`;
// the board carries it on the wire as the contract's mirror (`MonitorAgentRow`
// in `agent-field.ts` of the contracts), and WHO reads it decides what of it
// travels (design-mv §1: "which fields leave the device stays VibeField's
// custody rule"):
//   · this desktop's own window (the `model` projection) reads it whole — the
//     colour sequence it dealt, the texts as core bounded them (M21);
//   · a PEER (the `desk` projection) reads it without `project.seq` (M16: a
//     sequence is desktop-local and would collide with the reader's own) and
//     with every text bounded at `DESK_TEXT_CHARS`, exactly as the desk row's
//     own reply line and question are (M21);
//   · the phone (`field`) never sees it.
// `device.self` is the reader's fact and never travels.

/** The SDK's row as the wire carries it: the same facts, `device.self` dropped. */
function wireMonitorRow(row: MonitorAgentRow): WireMonitorRow {
  const { self: _self, ...device } = row.device;
  // the contract mirrors the SDK field for field (the fixtures and the service's
  // tests parse real backend rows through it); the arrays are readonly there
  // and plain here, which is the one difference the type cannot state
  return { ...row, device } as unknown as WireMonitorRow;
}

/** The model's row for THIS desktop's own window: whole. */
export function windowMonitorRow(row: MonitorAgentRow): WireMonitorRow {
  return wireMonitorRow(row);
}

/** The model's row for a PEER: no colour sequence (M16), every text bounded
 * at the desk's bound (M21). */
export function peerMonitorRow(
  row: MonitorAgentRow,
  chars: number = AGENT_FIELD.DESK_TEXT_CHARS,
): WireMonitorRow {
  const wire = wireMonitorRow(row);
  const { seq: _seq, ...project } = wire.project;
  const bound = (text: string | undefined): string | undefined =>
    text === undefined ? undefined : boundText(text, chars);
  const activity = wire.activity;
  const wait = wire.wait;
  const reply = wire.reply;
  return {
    ...wire,
    project,
    detail: boundText(wire.detail, chars),
    ...(activity !== undefined
      ? {
          activity: {
            ...activity,
            ...(activity.line !== undefined ? { line: boundText(activity.line, chars) } : {}),
          },
        }
      : {}),
    ...(wait !== undefined
      ? {
          wait: {
            ...wait,
            ...(wait.header !== undefined ? { header: bound(wait.header) } : {}),
            ...(wait.question !== undefined ? { question: bound(wait.question) } : {}),
            ...(wait.detail !== undefined ? { detail: bound(wait.detail) } : {}),
          },
        }
      : {}),
    ...(reply !== undefined ? { reply: { ...reply, text: boundText(reply.text, chars) } } : {}),
  };
}

/** A bare terminal as the `model` board's row (L8): keyed by the model's id
 * (its floor session), joined to the pane it is, this desktop's windows only. */
export function projectModelTerminalRow(
  row: MonitorAgentRow,
  join: Pick<AgentSessionTerminal, "cellBootId" | "workloadClass"> = {},
): ProjectedTerminalRow {
  return {
    runtimeRunId: row.id,
    kind: "terminal",
    device: row.device.id,
    terminal: {
      hosted: "local",
      runtimeSessionId: row.id,
      ...(join.cellBootId !== undefined ? { cellBootId: join.cellBootId } : {}),
      ...(join.workloadClass !== undefined ? { workloadClass: join.workloadClass } : {}),
    },
    monitorRow: windowMonitorRow(row),
  };
}

/**
 * DS-3 — the DESK row: the field row plus the reply line, the blocker's
 * question and the cost (DS-D4; `AgentDeskRow` in the contract). Content is
 * allowed here because the desk's audience is this person's own desktops —
 * the mesh board's upstreams are self peers, and the door refuses `desk` to a
 * phone (which reads `field`, SP-L4). Everything the field row says is said
 * the same way, from `projectFieldRow`, so the two cannot drift.
 *
 * MV-3a — with the model's row for the run (`monitorRow`), the desk row also
 * carries the backend's facts, cut for its audience: a PEER's cut by default
 * (`peerMonitorRow`), this desktop's own window's when `audience` says so.
 * Absent (the backend has not assembled the run yet, or a caller without the
 * backend), the row carries none and a reader draws what it was sent.
 */
export function projectDeskRow(
  summary: AgentSessionSummary,
  chars: number = AGENT_FIELD.DESK_TEXT_CHARS,
  monitorRow?: MonitorAgentRow | undefined,
  audience: "peer" | "window" = "peer",
): ProjectedFieldRow {
  const field = projectFieldRow(summary);
  const message = deskMessage(summary, chars);
  const mirrorBlockers = summary.monitor?.blockers ?? [];
  const blockers: AgentDeskBlocker[] = field.blockers.map((blocker, index) => {
    const question = blockerQuestion(mirrorBlockers[index], chars);
    return question === undefined ? blocker : { ...blocker, question };
  });
  // the cost, in puppeteer's own words: an estimate of API-equivalent USD for
  // observed work, never an invoice, and how much of the work was priced
  const usage = summary.monitor?.usage as Record<string, unknown> | undefined;
  const costUsd = typeof usage?.["costUsd"] === "number" ? usage["costUsd"] : undefined;
  const costCoverage = stringAt(usage, "costCoverage");
  const cost =
    costUsd !== undefined || costCoverage !== undefined
      ? {
          ...(costUsd !== undefined ? { costUsd } : {}),
          ...(costCoverage !== undefined ? { costCoverage } : {}),
        }
      : undefined;
  return {
    ...field,
    blockers,
    ...(cost !== undefined ? { usage: { ...field.usage, ...cost } } : {}),
    ...(message !== undefined ? { lastAssistantMessage: message } : {}),
    ...(monitorRow !== undefined
      ? {
          monitorRow:
            audience === "window"
              ? windowMonitorRow(monitorRow)
              : peerMonitorRow(monitorRow, chars),
        }
      : {}),
  };
}

/** The desk projector with the backend joined in: each run's model row, as a
 * peer reads it. The join is by run id (`AgentMonitorService.rowForRun`). */
export function deskProjector(
  rowForRun: (runtimeRunId: string) => MonitorAgentRow | undefined,
  chars: number = AGENT_FIELD.DESK_TEXT_CHARS,
): RowProjector {
  return (summary) => projectDeskRow(summary, chars, rowForRun(summary.runtimeRunId));
}

/** Upserts and removals between two projected boards, by (runtimeRunId,
 * revision). A row whose revision is unchanged is not sent again. SP-1: the
 * keyed diff is `projection.ts`'s; this is the board's key and its notion of
 * "unchanged". */
export function diffFieldRows(
  prev: readonly AgentFieldRow[],
  next: readonly AgentFieldRow[],
): { upserts: AgentFieldRow[]; removed: string[] } {
  return diffRows(
    prev,
    next,
    (row) => row.runtimeRunId,
    (before, after) => before.revision === after.revision,
  );
}

/** The fold's rows as a field board, with the revisions that make deltas
 * possible.
 *
 * One instance per consumer (a subscriber, the store publisher): the revision
 * chain is per-reader, so nothing has to reason about what a second reader has
 * already seen. Rows keep their own counters across `apply` calls; the board's
 * counter bumps once per frame that actually carries a change.
 *
 * SP-1 (2026-10-01): the machinery is `projection.ts`'s `projectRows`, keyed by
 * the run id; a row's own counter is written INTO the row (`revision`), which is
 * what the field's wire has always carried. */
export class FieldProjection {
  readonly #rows: RowsProjection<AgentSessionSummary, ProjectedFieldRow, AgentFieldRow>;

  /** DS-3 — the projector decides WHICH board this is (`projectFieldRow`, the
   * default and the store's, or `projectDeskRow`); the revision machinery is
   * the same for both. */
  constructor(project: RowProjector = projectFieldRow) {
    this.#rows = projectRows({
      project,
      keyOf: (row: ProjectedFieldRow) => row.runtimeRunId,
      stamp: (row: ProjectedFieldRow, revision: number): AgentFieldRow => ({ ...row, revision }),
    });
  }

  /** The board as it stands. */
  snapshot(): AgentFieldSnapshot {
    const table = this.#rows.snapshot();
    return { revision: table.revision, rows: table.rows };
  }

  get revision(): number {
    return this.#rows.revision;
  }

  /** Fold in a fresh `agent.list`/publish. Answers the delta when the
   * PROJECTION moved and `null` when it did not — the whole reason an idle
   * board (or one whose only news is a usage sample) sends nothing. */
  apply(result: AgentListResult): AgentFieldDelta | null {
    const change = this.#rows.apply(result.sessions);
    if (change === null) return null;
    return {
      since: change.since,
      revision: change.revision,
      upserts: change.upserts,
      removed: change.removed,
    };
  }
}

/**
 * TM-2 (MF-1l) — the rows as a READER outside this device may have them.
 *
 * The `terminal` join (`{hosted, runtimeSessionId, cellBootId?, …}`) is what a
 * reader attaches THROUGH (G3). While this device is not publishing its doors,
 * an attach cannot succeed — `terminal.openTicket` answers
 * `doors_not_published` — so carrying the join would promise a tap that cannot
 * land. The ROW itself stays: the agent is real and working, and dropping it
 * for a transport reason would lose a live agent off a phone.
 *
 * ONE spelling, because the field has TWO carriers (F-M4, 2026-09-14): the
 * store publisher's slice and the door's `agent.subscribe {projection:
 * "field"}`. The withholding lived in the publisher alone, so the same board
 * promised a tap over the door that it refused over the mesh — and the phone
 * folds the door leg in beside the store leg, which is where the two answers
 * met. A local reader (the desktop's own renderer) never sees this: it dials
 * the loopback door with a window principal, whose ticket never depended on the
 * tailnet at all.
 *
 * `alive` is computed from the SUMMARY before this runs, so a pending row
 * (AR-4: a PTY on this device with nothing driving it) keeps reading alive here
 * rather than flipping to "gone" because the mesh is off.
 */
export function attachableRows(
  rows: readonly AgentFieldRow[],
  terminalPublished: boolean,
): AgentFieldRow[] {
  if (terminalPublished) return [...rows];
  return rows.map((row) => {
    if (row.terminal === undefined) return row;
    const { terminal: _unreachable, ...rest } = row;
    return rest;
  });
}

export interface FieldSubscriptionOptions {
  /** the fold's current rows */
  list: () => AgentListResult;
  /** the fold's publish stream (`AgentRuntimeService.subscribe`); the rows it
   * hands over are not read — the projection lists the fold itself — so a
   * second source (MV-3a: the backend's changes behind the desk row) may
   * signal it with none */
  subscribe: (emit: (rows?: AgentListResult) => void) => () => void;
  /** push one delta frame to this subscriber */
  emit: (delta: AgentFieldDelta) => void;
  /** per-subscriber trailing-edge floor */
  minIntervalMs?: number;
  /**
   * DS-3 (DS-L3) — this subscription's revision CHAIN, stamped on its snapshot
   * and on every delta. The daemon mints one per subscription (its boot id and
   * the chain's ordinal, `daemon.ts` `nextBoardEpoch`): two subscriptions in
   * one boot are two chains, and a reader must never compare a revision of one
   * with a revision of the other. Absent (unit rows that only care about the
   * fold): frames carry none, exactly as before DS-3.
   */
  epoch?: string;
  /** DS-3 — which board: `projectFieldRow` (default) or `projectDeskRow`. */
  project?: RowProjector;
  /**
   * DS-3 — after this long with no frame, an EMPTY delta (`since === revision`,
   * nothing upserted or removed): the mesh board's upstreams ask for it so a
   * quiet desktop and a dead stream stop looking alike (DS-L8). Absent: no
   * heartbeat — a local window and the phone's field are exactly as before.
   */
  heartbeatMs?: number;
  /**
   * TM-2 (F-M4) — are this device's terminal doors published on the tailnet?
   * The SAME gate the store publisher applies, so the two carriers of one board
   * cannot promise different things about the same row. Default `true` keeps
   * the local callers that have no tailnet question to ask (and the unit rows
   * that only care about the fold) exactly as they were.
   *
   * RESIDUAL, recorded rather than papered over: this is read at snapshot time
   * and at each emitted frame, so a subscriber learns of a GATE change only
   * with the next board change. Closing that would mean emitting a frame whose
   * rows carry no new revision, and a board revision that moves on a join flip
   * is precisely what the store carrier's design forbids (MF-1h: the rows'
   * own facts have not moved). The safe direction is already safe — a gate
   * that OPENS late only withholds a true join for a while.
   */
  terminalPublished?: () => boolean;
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
 * loudly the mirrors revise, and nothing at all while the projection is still.
 *
 * SP-1 (2026-10-01): the subscriber is `projection.ts`'s
 * `RevisionedSubscription` over the board's `snapshotDeltaView`. The
 * heartbeat is re-armed by every frame, so it only ever speaks into silence,
 * and its `since` and `revision` are the projection's own — a fold change still
 * waiting out the floor has not moved it yet. A lost frame stays the READER's
 * gap (the view has no `reset`): the field's wire has never carried a
 * mid-stream snapshot, and the tolerant reader re-subscribes on a `since` it
 * does not hold. */
export function createFieldSubscription(opts: FieldSubscriptionOptions): FieldSubscription {
  const projection = new FieldProjection(opts.project);
  const published = (): boolean => opts.terminalPublished?.() ?? true;
  projection.apply(opts.list());
  const subscriber = new RevisionedSubscription({
    view: snapshotDeltaView<AgentFieldRow>({
      table: () => projection.snapshot(),
      apply: () => projection.apply(opts.list()),
      revision: () => projection.revision,
      ...(opts.epoch !== undefined ? { epoch: opts.epoch } : {}),
      present: (rows) => attachableRows(rows, published()),
    }),
    subscribe: (onChange) => opts.subscribe(() => onChange()),
    emit: (frame) => opts.emit(frame as AgentFieldDelta),
    minIntervalMs: opts.minIntervalMs ?? AGENT_FIELD.MIN_INTERVAL_MS,
    ...(opts.heartbeatMs !== undefined ? { heartbeatMs: opts.heartbeatMs } : {}),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
  });
  return { snapshot: subscriber.snapshot, dispose: () => subscriber.dispose() };
}
