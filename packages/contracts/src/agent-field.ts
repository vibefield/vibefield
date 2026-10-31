import { z } from "zod";
import { AgentProfileId, AgentProviderId } from "./agent-index";
import {
  AgentSessionOrigin,
  AgentSessionTerminal,
  AgentStatus,
  AgentTier,
  SparkId,
} from "./agent-session";
import type { Principal } from "./envelope";
import { INDEX_ACTIVITY } from "./registries";
import {
  MeshScope,
  meshRowsFrame,
  meshRowsOpen,
  type RowsDelta,
  type RowsDeviceState,
  RowsEpoch,
  type RowsSnapshot,
} from "./rows";

// MF-1 (thinking-godview-mobile-first.md §5/§10.1) — the FIELD projection: the
// fold's row with its content removed, small enough for a phone's radio and
// its battery.
//
// The problem this shape exists to solve: `agent.subscribe` answers the whole
// `AgentListResult` on every publish — every row with its entire monitor
// mirror (usage samples, context, environment, freshness, the latest reply) —
// coalesced to one frame per 16 ms per subscriber. A working agent's mirror
// revises many times a second, so a phone on the tailnet would receive whole
// boards at tens of Hz: 2-5 KB per row × five rows × up to 60 frames/s. The
// projection below is ≈300-500 B per row and carries no content at all.
//
// DELIBERATELY ABSENT (§10.1's own list): `lastAssistantMessage`, a blocker's
// `input`/`questions`/`detail`, `title`, and the mirror itself. A field row
// says WHAT a run is doing, never WHAT it said — content reaches a phone on
// tap, through `agent.list` and the verbs, where the person asked for it.
//
// Two carriers, one shape (D4's hybrid, adopted 2026-09-13): the product API
// serves it as `agent.subscribe {projection: "field"}` (snapshot + deltas),
// and fieldd publishes the same rows into the `field.agents.v1` SyncedStore as
// an `AgentFieldSlice` — replication, catch-up on join, removal on leave, with
// no fieldd in the read path. A reader that can parse one can parse the other.
// *Corrected 2026-10-01 (DS-D14, DS wave 3): ONE carrier now. The store
// carrier retired — no daemon publishes `field.agents.v1` and no phone reads
// it; the mesh board below (`scope: "mesh"`, DS-3) carries every self
// desktop's rows through one door, and the phone homes to a desktop to read it
// (DS-8). `AgentFieldSlice` stays as the record of an older desktop's slice.*

/** One blocker, content-free: what KIND of thing the run is waiting on and,
 * for a permission, which tool asked — never the request itself.
 *
 * `tool` is read from puppeteer's `monitor.blockers[].permission.tool` (its
 * `MonitorBlocker` union puts the tool inside the `permission` member of the
 * `kind: "permission"` arm, beside a `requestId` this projection drops). It is
 * OPTIONAL because upstream's own field is: a permission blocker observed
 * before the tool name is known carries none, and a `question` or `failure`
 * blocker has no tool by construction. */
export const AgentFieldBlocker = z
  .object({
    id: z.string().min(1),
    kind: z.string(),
    since: z.string(),
    tool: z.string().optional(),
  })
  .passthrough();
export type AgentFieldBlocker = z.infer<typeof AgentFieldBlocker>;

/** The phone's row. Every field is a fact a swarm body can be drawn from:
 * identity, the status and its clocks, liveness, the blockers' shape, the
 * bars (usage, context), the model and effort labels, the folder it works in,
 * and the terminal join. `revision` is fieldd's OWN per-row counter — it bumps
 * only when the PROJECTED row changes, never with the mirror's revision, so an
 * idle board sends nothing (§10.2). */
export const AgentFieldRow = z
  .object({
    runtimeRunId: z.string().min(1),
    /** fieldd's per-row change stamp, NOT an ordering (MF-1h). It bumps when
     * the projected row changes, and it RESTARTS at 1 when a run leaves the
     * board and returns — a reader applies every upsert it is given and never
     * compares one row's revision with another's, or with an older one of its
     * own. The board's own `revision` on the snapshot and delta is what orders
     * frames. */
    revision: z.number().int(),
    kind: AgentProviderId,
    label: z.string().min(1),
    tier: AgentTier,
    device: z.string().min(1),
    profileId: AgentProfileId.optional(),
    status: AgentStatus,
    statusSince: z.string(),
    stateChangedAt: z.string(),
    createdAt: z.string(),
    lastActivityAt: z.string().optional(),
    /** Liveness as fieldd knows it: the monitor's own word when a monitor
     * exists, and otherwise whether the floor still hosts the run's PTY.
     * Never "is it observed" — see `pending`. */
    alive: z.boolean(),
    /** AR-4 — a live PTY fieldd could not re-attach to: it resumes at the
     * session's next idle. The row is honest that nothing OBSERVES it, which
     * is a different claim from `alive` (ruled 2026-09-13): a pending run is
     * alive — its PTY is on the floor — and merely undriven. A reader draws
     * `alive` as "is this agent still there", and `pending` as "and is anyone
     * at the wheel". */
    pending: z.enum(["resume-when-idle"]).optional(),
    blockers: z.array(AgentFieldBlocker),
    usage: z
      .object({
        cumulativeTokens: z.number().optional(),
        burnRatePerMin: z.number().optional(),
      })
      .passthrough()
      .optional(),
    context: z.object({ usedPercent: z.number() }).passthrough().optional(),
    model: z
      .object({ id: z.string(), displayName: z.string().optional() })
      .passthrough()
      .optional(),
    effort: z.object({ value: z.string(), intent: z.string().optional() }).passthrough().optional(),
    /** Where the run is working, as a NAME and never a path (EL7 B1, narrowed
     * 2026-09-13). `name` is the folder's basename; the absolute path it came
     * from carried the OS username and the shape of a person's disk, and this
     * slice's audience is every tailnet node the app admits (see
     * `devices.ts` — the store is the APP's peers, not one user's devices), so
     * the path was a leak the row had no use for. A card draws the folder.
     * `branch` is unchanged: absent = nothing looked, null = looked and there
     * is no branch. */
    project: z
      .object({ name: z.string().optional(), branch: z.string().nullable().optional() })
      .passthrough()
      .optional(),
    /** PJ-7 (Q3 (a)) — the provider-native id of the conversation the run
     * continues (the fold's `sessionId`: puppeteer's configured claim until an
     * adapter observes the id, then the observed one), so a History row by that
     * id finds the card to jump to. The id only, never the folder: the path
     * stays on this desktop's own windows (`AgentModelLocalFacts.cwd`, EL7 B1).
     * fieldd fills it on the phone's `field` cut only — a desk row leaves it
     * off (a window reads its own runs' ids from `local`). Absent on a row from
     * a daemon before PJ-7. */
    nativeSessionId: z.string().min(1).max(256).optional(),
    terminal: AgentSessionTerminal.optional(),
    /** SP-1b (track CO; VF-PM 2026-10-31) — the run is this spark's own
     * session, the one it thinks in: the fold's `spark`. Chat reads a spark's
     * status by it. An id, never a name, which can change while the spark
     * stays. Static for the run's life, so a snapshot-delta pays it once.
     * Absent on every other run, and on a row from a daemon before SP-1b. */
    spark: SparkId.optional(),
    /** SP-1b — who started the run (CP-D15): the fold's `origin`, rebuilt from
     * its named fields and never spread. Chat reads a spark's agents by it
     * (CH-D3: "its face is working because its agents are"). Absent reads
     * `you`, as on the fold's row. */
    origin: AgentSessionOrigin.optional(),
  })
  .passthrough();
export type AgentFieldRow = z.infer<typeof AgentFieldRow>;

// DS-3 (`thinking-desktop-sync-plane.md` §6.2, DS-D4 RULED 2026-09-30) — the
// DESK projection: the field row plus the three things a person at another of
// their own desktops reads a run by — the reply line, what a blocker is asking,
// and the cost. Content is allowed here because its audience is one person's
// own DESKTOPS (the mesh board's upstreams are self peers only); the phone
// reads `field`, content-free (SP-L4). Every text is bounded by
// `AGENT_FIELD.DESK_TEXT_CHARS`: the row says what a run said, never the whole
// of it — the transcript is History's, by ticket (DS-7).

// MV-3a (MV-D22, MV-D18; `thinking-monitor-view-sdk`) — THE MODEL'S ROW ON THE
// WIRE. The monitor backend beside the runtime (`@vibefield/puppeteer-monitor`,
// hosted by fieldd) computes every business fact about this desktop's agents
// once and emits `MonitorAgentRow`s (`@vibefield/puppeteer-view-sdk/model`); the
// window's replica applies them with no logic of its own. The desk row carries
// one as `monitorRow`, so a window — this desktop's, or another of this
// person's reading it through the mesh board — maps a row to the model by
// renaming nothing. The schemas below MIRROR the SDK's types field for field
// (fieldd pins the two against each other, `agent-monitor.ts`); every clock is
// epoch milliseconds, as the model's are. What is NOT here: `device.self` (a
// reader-relative fact the adapter sets) and, on a PEER's row, `project.seq`
// (desktop-local identity, M16 — omitted by the owner's desk cut).

/** A fixed-bucket series, oldest first; the last bucket is still filling. */
export const MonitorSeries = z
  .object({
    stepMs: z.number().int().positive(),
    steps: z.array(z.number()),
    /** when the last bucket began, so series of different rows align */
    lastStepAt: z.number().int(),
  })
  .passthrough();
export type MonitorSeries = z.infer<typeof MonitorSeries>;

/** What a blocked run waits on: the first blocker, its parts kept apart (M2 —
 * the views word them in their own order). Texts are bounded by the OWNER's cut
 * for a peer (`AGENT_FIELD.DESK_TEXT_CHARS`, M21) and core's own bound for this
 * desktop's window. */
export const MonitorWait = z
  .object({
    /** the runtime's own word, open: `permission`, `question`, `failure`, … */
    kind: z.string(),
    since: z.number().int(),
    /** how many blockers wait; absent: one (M10) */
    count: z.number().int().positive().optional(),
    tool: z.string().optional(),
    code: z.string().optional(),
    header: z.string().optional(),
    question: z.string().optional(),
    detail: z.string().optional(),
  })
  .passthrough();
export type MonitorWait = z.infer<typeof MonitorWait>;

export const MonitorActivity = z
  .object({
    kind: z.string(),
    line: z.string().optional(),
    since: z.number().int().optional(),
  })
  .passthrough();
export type MonitorActivity = z.infer<typeof MonitorActivity>;

export const MonitorReply = z
  .object({
    text: z.string(),
    at: z.number().int().optional(),
    /** false while the reply is still streaming */
    final: z.boolean().optional(),
  })
  .passthrough();
export type MonitorReply = z.infer<typeof MonitorReply>;

/** The cost in puppeteer's own words — an estimate of API-equivalent USD for
 * observed work, never an invoice — with the burn and the ten-minute series
 * the backend keeps in memory (runtime only; it refills after a restart from
 * core's own buckets, L11). `coverage` is open: core's word today is
 * `complete` · `partial` · `unavailable`. */
export const MonitorCost = z
  .object({
    usd: z.number(),
    coverage: z.string(),
    burnPerHour: z.number().optional(),
    series: MonitorSeries.optional(),
  })
  .passthrough();
export type MonitorCost = z.infer<typeof MonitorCost>;

/** The desktop a row lives on, as its owner names it. `self` is NOT carried:
 * whether a row is the reader's own desktop is the reader's to say. */
export const MonitorDeviceRef = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** the SDK's OS mark (`mac` · `windows` · `linux` · `ios` · `android`), open */
    os: z.string().optional(),
  })
  .passthrough();
export type MonitorDeviceRef = z.infer<typeof MonitorDeviceRef>;

/** One row of the model (`MonitorAgentRow`), presentation-free: everything a
 * screen may draw about one agent or bare terminal, computed by the backend.
 * `status` and `kind` are the contract's own closed words — a reader building
 * the SDK's type could do nothing with a fourth. */
export const MonitorAgentRow = z
  .object({
    /** stable identity: survives a terminal's promotion and a run's resume */
    id: z.string().min(1),
    kind: z.enum(["agent", "terminal"]),
    createdAt: z.number().int(),
    status: z.enum(["idle", "working", "blocked"]),
    statusSince: z.number().int(),
    /** not heard from lately — presentation metadata, never a status */
    stale: z.boolean(),
    alive: z.boolean(),
    /** the runtime has reported a state for this run (M10) */
    observed: z.boolean(),
    /** alive, but nothing drives it yet (AR-4) */
    pending: z.boolean().optional(),
    /** the line under the name, in the backend's words (M4: core's headline) */
    detail: z.string(),
    activity: MonitorActivity.optional(),
    project: z
      .object({
        /** a folder NAME, never a path (EL7 B1); empty for a terminal in no project */
        name: z.string(),
        /** absent: nothing looked; null: looked, and there is no branch */
        branch: z.string().nullable().optional(),
        /** the project's colour sequence — this desktop's own windows only (M16) */
        seq: z.number().int().nonnegative().optional(),
      })
      .passthrough(),
    provider: z.object({ id: z.string(), label: z.string() }).passthrough().optional(),
    model: z.string().optional(),
    effort: z
      .object({ value: z.string(), intent: z.enum(["configured", "observed"]).optional() })
      .passthrough()
      .optional(),
    account: z.string().optional(),
    context: z.object({ usedPercent: z.number() }).passthrough().optional(),
    wait: MonitorWait.optional(),
    reply: MonitorReply.optional(),
    cost: MonitorCost.optional(),
    tokens: z
      .object({ total: z.number().optional(), perMinute: z.number().optional() })
      .passthrough()
      .optional(),
    /** a finished turn nobody has looked at yet (L5) */
    unread: z.boolean(),
    device: MonitorDeviceRef,
    tier: AgentTier.optional(),
    /** the Agent Profile SET it runs under (`native` for the machine's own) */
    profileSet: z.string().optional(),
    /** a pane on the owning desktop can show it now */
    attachable: z.boolean(),
    /** M41 — whether a pane on ANOTHER desktop may type into this run, by its
     * home desktop's policy: computed once by the row's home backend (today it
     * equals `attachable`), read by a view only for a row from another desktop
     * (the list's host chip, the swarm's host line). Optional on the wire, the
     * tolerant reader's rule: a peer on an older daemon sends none, and the
     * window adapter fills it from `attachable` — the rule that daemon applied —
     * so the SDK's row always carries it. */
    writable: z.boolean().optional(),
  })
  .passthrough();
export type MonitorAgentRow = z.infer<typeof MonitorAgentRow>;

/** Item 100 (2026-10-29) — whose cut a caller reads of the model's rows and
 * of the recorded lanes: by its principal's KIND, never its transport (SP-L4's
 * rule; this table is its instrument). `window` is the whole row, `project.seq`
 * included. The sequence is this desktop's own deal (M16), so only callers on
 * this desktop read it: its windows and local clients (`local-token`) and its
 * shell (`shell-main`). Every other kind is cut as a peer is: a phone, a guest,
 * a peer daemon, an agent's MCP session, a plugin. Each kind is named, so a
 * kind added to `Principal` fails the typecheck here until it is given its
 * cut, and a doubtful kind's cut is `peer`. A TypeScript constant, server-side
 * as `Principal` is: no wire shape, nothing generated. */
export type MonitorAudience = "window" | "peer";
export const MONITOR_AUDIENCE = {
  "local-token": "window",
  "shell-main": "window",
  tailnet: "peer",
  "tailnet-guest": "peer",
  "mcp-agent": "peer",
  "peer-fieldd": "peer",
  plugin: "peer",
} as const satisfies Record<Principal["kind"], MonitorAudience>;

/** The run's latest reply, bounded: puppeteer's `MonitorAssistantMessageState`
 * with its text cut to the registry's bound. `at` and `final` are optional
 * because the mirror carries the message as an open object (`agent-session.ts`)
 * and a projection never invents a clock or a verdict it was not given. */
export const AgentDeskMessage = z
  .object({
    text: z.string(),
    at: z.string().optional(),
    /** false while the reply is still streaming */
    final: z.boolean().optional(),
  })
  .passthrough();
export type AgentDeskMessage = z.infer<typeof AgentDeskMessage>;

/** A blocker as the desk sees it: the field's content-free blocker plus the
 * first question a `question` blocker asks (`questions[0].prompt`), bounded. */
export const AgentDeskBlocker = AgentFieldBlocker.extend({
  question: z.string().optional(),
}).passthrough();
export type AgentDeskBlocker = z.infer<typeof AgentDeskBlocker>;

/** The desk row. A desk row IS a field row (every field fact, same keys), so a
 * reader of `AgentFieldRow` reads it and keeps the rest as passthrough.
 *
 * MV-3a — it also carries the MODEL's row for the run (`monitorRow`): the
 * backend's facts, computed once at the run's home desktop, so a window's
 * replica applies them with no derivation. Optional on the wire: a desktop on
 * an older daemon sends none, and a reader draws what it was sent. On a PEER's
 * row the owner's cut bounds its texts at `AGENT_FIELD.DESK_TEXT_CHARS` and
 * omits `project.seq` (M16, M21); this desktop's own window reads it whole.
 * The chrome's facts (MV-3d) are not here: they ride only the `model` board's
 * own rows (`AgentModelDeskRow.local`), which no peer receives. */
export const AgentDeskRow = AgentFieldRow.extend({
  lastAssistantMessage: AgentDeskMessage.optional(),
  blockers: z.array(AgentDeskBlocker),
  monitorRow: MonitorAgentRow.optional(),
  usage: z
    .object({
      cumulativeTokens: z.number().optional(),
      burnRatePerMin: z.number().optional(),
      /** puppeteer's estimate of API-equivalent USD for observed work — never
       * an invoice (its own words, `MonitorUsageAggregate.costUsd`) */
      costUsd: z.number().optional(),
      /** puppeteer's own word for how much of the work was priced
       * (`complete` · `partial` · `unavailable`), open here */
      costCoverage: z.string().optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();
export type AgentDeskRow = z.infer<typeof AgentDeskRow>;

/** Which board a subscription reads. `full` is the fold's whole row, LOCAL ONLY
 * (it never federates, DS-D4); `field` the content-free row (the phone's,
 * `AGENT_FIELD.MIN_INTERVAL_MS`); `desk` the field row plus the reply line,
 * the blocker's question and the cost (windows,
 * `AGENT_FIELD.DESK_MIN_INTERVAL_MS`).
 *
 * MV-3a — `model` is THIS DESKTOP'S OWN WINDOWS' board (MV-D18, L8, L12,
 * M16): the desk rows with the model's row whole (`project.seq` dealt, texts
 * as core bounded them) plus this desktop's bare TERMINALS as rows of their
 * own (`AgentDeskTerminalRow`), at the fold's own 16 ms floor
 * (`AGENT_FIELD.FULL_TICK_MS`) with urgent changes ahead of it. Refused to a
 * peer daemon and to a phone, like `full`; with `scope: "mesh"` the other
 * desktops' boards beside it are their `desk` cuts, as their owners sent
 * them. The phone's `field` row is untouched by all of this.
 *
 * MV-3d (M35) — this desktop's run rows on it also carry the chrome's facts
 * (`AgentModelDeskRow.local`), so a window reads `model` alone: `full` is no
 * longer asked while Godview is open. */
export const AgentProjection = z.enum(["full", "field", "desk", "model"]);
export type AgentProjection = z.infer<typeof AgentProjection>;

/** `agent.subscribe`'s options. Absent or `full` is TODAY's subscription,
 * unchanged byte for byte — the desktop's renderer reads whole `rows` arrays
 * and must not learn a new frame shape to keep working. */
export const AgentSubscribeParams = z
  .object({
    /** `full` (today's), `field`, `desk`, or `model` (MV-3a, this desktop's
     * windows: `AgentModelMeshOpen`/`AgentModelMeshFrame` under `scope:
     * "mesh"`, `AgentModelSnapshot`/`AgentModelDelta` local) */
    projection: AgentProjection.optional(),
    /** DS-3 — `local` (the default: today's callers never move) is THIS
     * daemon's board; `mesh` is every self desktop the roster lists,
     * multiplexed by this daemon (DS-L4): the open answers `AgentMeshOpen`,
     * later frames are `AgentMeshFrame`. `field` and `desk` only. */
    scope: MeshScope.optional(),
    /** field and desk only; default `AGENT_FIELD.MIN_INTERVAL_MS` (field) or
     * `AGENT_FIELD.DESK_MIN_INTERVAL_MS` (desk), and never below the desk's
     * floor for a desk board. A per-subscriber trailing-edge floor, like the
     * fold's own tick. *Corrected 2026-10-01: a FLOOR for both — a field ask
     * below `AGENT_FIELD.MIN_INTERVAL_MS` is served at the floor (it used to be
     * a default a caller could undercut to the schema's 16 ms).* */
    minIntervalMs: z.number().int().min(16).max(60_000).optional(),
    /** DS-3 — field and desk only, `local` scope. After this long with no frame
     * the source sends a HEARTBEAT: an empty delta whose `since` equals its
     * `revision` (no upserts, no removals — it moves nothing a reader holds).
     * A reader across a link asks for it so a quiet board and a dead stream
     * stop looking alike (DS-L8); the mesh board's upstreams ask for
     * `AGENT_FIELD.MESH_HEARTBEAT_MS`. Absent: no heartbeat, today's stream. */
    heartbeatMs: z.number().int().min(250).max(60_000).optional(),
  })
  .passthrough();
export type AgentSubscribeParams = z.infer<typeof AgentSubscribeParams>;

/** The first frame of a field subscription, and what a re-subscribe answers.
 *
 * DS-3 — `epoch` names the revision CHAIN the frame belongs to (DS-L3's table
 * identity): fieldd ALWAYS sends it, as its boot id plus the chain's ordinal,
 * because two subscriptions in one boot are two chains whose revisions must
 * never be compared. It is OPTIONAL in the schema, deliberately: the kit's
 * mirrored goldens and every phone already shipped parse frames without it,
 * and a required field added to a shared schema has broken adoption before. */
export const AgentFieldSnapshot = z
  .object({ epoch: RowsEpoch.optional(), revision: z.number().int(), rows: z.array(AgentFieldRow) })
  .passthrough();
export type AgentFieldSnapshot = z.infer<typeof AgentFieldSnapshot>;

/** Every later frame. It applies ON TOP OF `since`: a client whose own
 * revision is not `since` has lost a frame and re-subscribes for a fresh
 * snapshot — the tolerant reader's own rule, never an ack protocol. `epoch`
 * as on the snapshot; a delta whose epoch is not the one the reader holds is
 * a gap too. */
export const AgentFieldDelta = z
  .object({
    epoch: RowsEpoch.optional(),
    since: z.number().int(),
    revision: z.number().int(),
    upserts: z.array(AgentFieldRow),
    removed: z.array(z.string()),
  })
  .passthrough();
export type AgentFieldDelta = z.infer<typeof AgentFieldDelta>;

/** PG-1b (PG-L4.1, 2026-10-29) — the RELAY's reading of every board it carries
 * (`field`, `desk`, and PG-2's `remote`): each row's KEY and the owner's stamp,
 * nothing else. Every other fact is the owner's and passes through untouched
 * (DS-L2: one owner per row, the relay copies; DS-D4: multiplexed, never
 * re-folded), so a peer whose rows this build's field schema cannot read is
 * still relayed, and each reader decides what it can read (a window per desktop,
 * `godview/monitor/board-screen.ts`; the phone per row). It is not a business
 * reader, so it logs no unknown fields: every field it does not read is
 * someone else's. The envelopes are `AgentFieldSnapshot`'s and
 * `AgentFieldDelta`'s with the row swapped for its key. */
export const AgentBoardRowKey = z
  .object({ runtimeRunId: z.string().min(1), revision: z.number().int() })
  .passthrough();
export type AgentBoardRowKey = z.infer<typeof AgentBoardRowKey>;
export const AgentBoardKeySnapshot = z
  .object({
    epoch: RowsEpoch.optional(),
    revision: z.number().int(),
    rows: z.array(AgentBoardRowKey),
  })
  .passthrough();
export type AgentBoardKeySnapshot = z.infer<typeof AgentBoardKeySnapshot>;
export const AgentBoardKeyDelta = z
  .object({
    epoch: RowsEpoch.optional(),
    since: z.number().int(),
    revision: z.number().int(),
    upserts: z.array(AgentBoardRowKey),
    removed: z.array(z.string()),
  })
  .passthrough();
export type AgentBoardKeyDelta = z.infer<typeof AgentBoardKeyDelta>;

/** DS-3 — the OPEN answer of `agent.subscribe {scope: "mesh"}` (DS-D4): every
 * self desktop the roster lists, each with its state, when that was
 * established, and — once it has answered — its own board at its own
 * `{epoch, revision}`. Rows are keyed `{device, runtimeRunId}`. The daemon
 * MULTIPLEXES and never re-folds: a peer's revisions arrive as the peer
 * numbered them. A `desk` board's rows are `AgentDeskRow`s, which parse here
 * as field rows with the rest passed through. The ANSWERING desktop is listed
 * first — always present, always `live` — so a reader without a roster still
 * knows which board is its own.
 *
 * The same open also arrives MID-STREAM as the subscription's `.snapshot`: the
 * client's own replay after a reconnect, and the door's resync of a phone that
 * fell behind its cap (PG-1c, `PRODUCT_API_LIMITS.TAILNET_QUEUED_BYTES`). The
 * reader replaces its whole board, each device at its owner's `{epoch,
 * revision}`, and the next delta continues from there. */
export const AgentMeshOpen = meshRowsOpen(AgentFieldRow);
/** One device's entry in the open. Written out rather than inferred: the
 * passthrough inference gives every arm a string index signature, and a
 * reader's `"snapshot" in entry` would then narrow to `unknown`. The schema
 * above is the authority; a parsed value is assignable to these. */
export interface AgentMeshDevice {
  device: string;
  state: RowsDeviceState;
  /** ISO-8601 — when `state` was last established */
  asOf: string;
  snapshot?: RowsSnapshot<AgentFieldRow> | undefined;
}
export interface AgentMeshOpen {
  devices: AgentMeshDevice[];
}

/** DS-3 — a later frame of the mesh board: one device's delta, relayed
 * verbatim · one device's snapshot (that device's reset — the reader REPLACES
 * its copy of that device and nothing else) · one device's state changing. A
 * device that stops answering sends only the state change: its last board
 * stays with the reader, greyed (DS-L8), never an empty board in its place. */
export const AgentMeshFrame = meshRowsFrame(AgentFieldRow);
/** The frame's three arms, written out for the same reason as the open's. */
export type AgentMeshFrame =
  | { device: string; delta: RowsDelta<AgentFieldRow> }
  | { device: string; snapshot: RowsSnapshot<AgentFieldRow> }
  | { device: string; state: RowsDeviceState; asOf: string };

// MV-3a (L8) — A BARE TERMINAL IS A ROW ON ITS OWN DESKTOP. The model draws
// every PTY no agent speaks for as a row (`kind: "terminal"`), and only this
// desktop's windows receive them: the `model` projection carries them, the
// `desk` cut peers read never does (the program adds no cross-desktop
// behaviour), and the phone's `field` row cannot (no run, no mirror). It is a
// row of its own kind rather than a field row in disguise: a terminal has no
// provider, no tier, no run — the field row's required facts would all be
// invented. The board key stays `runtimeRunId` because every reader of the rows
// protocol keys by that field (`diffFieldRows`, the mesh board's maps); for a
// terminal it is the model's id (the floor session, or the identity it
// carries), never a run.

export const AgentDeskTerminalRow = z
  .object({
    /** the board key: the model row's id (a floor session), never a run */
    runtimeRunId: z.string().min(1),
    /** fieldd's per-row change stamp, as on the field row */
    revision: z.number().int(),
    kind: z.literal("terminal"),
    device: z.string().min(1),
    /** the pane join (G3): the floor session a window mounts */
    terminal: AgentSessionTerminal,
    monitorRow: MonitorAgentRow,
  })
  .passthrough();
export type AgentDeskTerminalRow = z.infer<typeof AgentDeskTerminalRow>;

// MV-3d (M35, M42) — THE CHROME'S FACTS, ON THIS DESKTOP'S OWN ROWS. Beside the
// views, this desktop's window draws chrome the model does not serve, by design
// (M19; MV-D17): the deck's pane frames and empty-pane launchers, the find
// sheet, the AR-7 marker. Until MV-3d those read the fold's `full` board, a
// second subscription that sent the whole board every 16 ms while anything
// moved. They read `local` now: the fold's facts no other part of the row
// carries, riding ON the run's desk row of the `model` board, so a fact arrives
// in the frame of the row it annotates (no second stream to order against) and
// a moved fact upserts the row in the board's next delta like any other.
//
// WHO SEES IT is the projection's rule, not this schema's: `model` is refused to
// peers and the phone (M29), and fieldd writes `local` on the window's cut only
// — never on the `desk` cut a peer receives, never in `monitorRow` (the model,
// which syncs), never on the phone's field row. That is what lets it carry the
// working directory as a PATH (EL7 B1 keeps the path off everything that leaves
// this desktop). Every field is optional (the tolerant reader); a reader of a
// row with no `local` reads a run fieldd said nothing more about. A bare
// terminal's row carries none: no reader asks anything of a terminal beyond
// its row.

/** What this desktop's own window reads of one of its runs beside the model:
 * the fold's facts, each named for the chrome that reads it and nothing more. */
export const AgentModelLocalFacts = z
  .object({
    /** the provider-native session id the run's transcript is filed under (the
     * fold's `sessionId`): the find sheet joins rosetta's hits by it */
    nativeSessionId: z.string().min(1).optional(),
    /** the directory the run works in, as a PATH: the mirror's observed cwd,
     * else the workspace's source path, else its root. The pane frame names
     * its badge from it and a pane returned to a shell opens there. Absent
     * when nothing names one */
    cwd: z.string().optional(),
    /** AR-7 — where the run came from (`AGENT_SPAWNED_BY`, open; absent reads `app`) */
    spawnedBy: z.string().optional(),
    /** MF-1f — fieldd witnessed the run's process end while its pane is still
     * on the floor; absent: it did not */
    exited: z.boolean().optional(),
    /** Q08 — the key the stop verb presses in the run's pane (the fold's
     * `stopKey`): the pane frame's stop title names it. Absent: the stop
     * presses no key, and the title names none */
    stopKey: z.string().optional(),
    /** The mirror's own words the chrome reads, present exactly when fieldd
     * holds a monitor mirror for the run — the provider has spoken. Absent is
     * the run before its first state: the pane frame's bare badge, the
     * marker's `observed: false`. */
    mirror: z
      .object({
        /** the mirror's liveness, verbatim (the row's own `alive` is fieldd's
         * reading, which an exit outranks) */
        alive: z.boolean().optional(),
        /** when the provider's session began (`session.startedAt`): the find
         * sheet's scope for rosetta's hits */
        startedAt: z.string().optional(),
        /** the newest evidence the provider gave (`freshness.lastEvidenceAt`):
         * when the find sheet says a run was last active */
        lastEvidenceAt: z.string().optional(),
        /** how the provider knows its context share (`context.percentageSource`,
         * open: `provider` · `derived` · `unavailable`): no meter is drawn from
         * an unavailable one */
        contextSource: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type AgentModelLocalFacts = z.infer<typeof AgentModelLocalFacts>;

/** A run's row on the `model` board: the desk row, and — this desktop's own
 * runs, the window's cut — the chrome's facts (`local`). A peer's desk row on
 * the same board carries none: its owner's desk cut never writes them. */
export const AgentModelDeskRow = AgentDeskRow.extend({
  local: AgentModelLocalFacts.optional(),
}).passthrough();
export type AgentModelDeskRow = z.infer<typeof AgentModelDeskRow>;

/** A row of the `model` board: a desk row (an agent, `monitorRow` whole) or a
 * bare terminal's row. Discriminated by shape — a terminal row has no
 * `status`, `label` or `tier`, and the union tries the desk row first. */
export const AgentModelBoardRow = z.union([AgentModelDeskRow, AgentDeskTerminalRow]);
export type AgentModelBoardRow = z.infer<typeof AgentModelBoardRow>;

/** `agent.subscribe {projection: "model"}` at the local scope: the field's
 * pair over model-board rows. */
export const AgentModelSnapshot = z
  .object({
    epoch: RowsEpoch.optional(),
    revision: z.number().int(),
    rows: z.array(AgentModelBoardRow),
  })
  .passthrough();
export type AgentModelSnapshot = z.infer<typeof AgentModelSnapshot>;
export const AgentModelDelta = z
  .object({
    epoch: RowsEpoch.optional(),
    since: z.number().int(),
    revision: z.number().int(),
    upserts: z.array(AgentModelBoardRow),
    removed: z.array(z.string()),
  })
  .passthrough();
export type AgentModelDelta = z.infer<typeof AgentModelDelta>;

/** `agent.subscribe {projection: "model", scope: "mesh"}` — the window's one
 * door (MV-D18): this desktop's model board first (always `live`), then every
 * other self desktop's DESK board as its owner cut it, each on its own chain
 * (DS-D4: the daemon multiplexes, it never re-folds). The frames are the mesh
 * board's three arms over model-board rows. */
export interface AgentModelMeshDevice {
  device: string;
  state: RowsDeviceState;
  asOf: string;
  snapshot?: RowsSnapshot<AgentModelBoardRow> | undefined;
}
export interface AgentModelMeshOpen {
  devices: AgentModelMeshDevice[];
}
export type AgentModelMeshFrame =
  | { device: string; delta: RowsDelta<AgentModelBoardRow> }
  | { device: string; snapshot: RowsSnapshot<AgentModelBoardRow> }
  | { device: string; state: RowsDeviceState; asOf: string };
// Annotated with the interfaces above: the inferred type of a mesh frame over
// the model-board union is longer than the compiler will serialize into a
// declaration (TS7056), so the schema is typed by its written-out output.
export const AgentModelMeshOpen: z.ZodType<AgentModelMeshOpen, z.ZodTypeDef, unknown> =
  meshRowsOpen(AgentModelBoardRow);
export const AgentModelMeshFrame: z.ZodType<AgentModelMeshFrame, z.ZodTypeDef, unknown> =
  meshRowsFrame(AgentModelBoardRow);

/** MV-3a (L5) — `agent.reportShown`: which rows the calling window shows in its
 * active pane, by MODEL id. The screen is the CONNECTION's own model board
 * (identity is transport-derived, never on the wire — P6): the door refuses a
 * report from a connection with no model board open, and a closed board
 * forgets its screen (M20). An empty list clears the report. */
export const AgentReportShownParams = z
  .object({ ids: z.array(z.string().min(1)).max(4096) })
  .passthrough();
export type AgentReportShownParams = z.infer<typeof AgentReportShownParams>;
export const AgentReportShownResult = z.object({ reported: z.literal(true) }).passthrough();
export type AgentReportShownResult = z.infer<typeof AgentReportShownResult>;

/** LR (James, 2026-10-15 — the focus session's ruling) — one session the last
 * run LEFT: a row of the last board whose run or terminal is not alive on this
 * boot. An agent appears here only when its record can continue it
 * (`agent.resume {runtimeRunId: id}` — the record exists and verifies, was not
 * already continued, and did not end by its own exit), so `gone` is exactly
 * what a restore acts on; a terminal is any bare shell the floor lost. */
export const AgentLastRunGone = z
  .object({
    /** the board row's id — its `runtimeRunId` (a terminal's is its session id) */
    id: z.string().min(1),
    kind: z.enum(["agent", "terminal"]),
    /** the floor session the row held as the run ended: the deck's pane join
     * (a saved pane names this id) */
    sessionId: z.string().min(1).optional(),
  })
  .passthrough();
export type AgentLastRunGone = z.infer<typeof AgentLastRunGone>;

/** LR — `agent.lastRun {}`: what this desktop's last run left. fieldd keeps ONE
 * picture of its own model board (the local cut a window reads), rewritten as
 * the board moves; at a boot whose floor lost sessions, the last run's picture
 * is held until a window answers (`agent.lastRunForget`) — never a history,
 * never federated, refused to a peer and a phone like the `model` board.
 * `none`: nothing was left (or every session survived the restart). `left`:
 * the board as the last run left it, for the views to draw still, and the rows
 * whose sessions did not survive. Before the boot's re-attach has settled the
 * door answers UNAVAILABLE `{service: "agent-last-run", state: "starting"}`,
 * retryable: a session not yet re-attached is not yet gone. */
export type AgentLastRunResult =
  | { state: "none" }
  | {
      state: "left";
      /** when the picture was last written — the last run's last moment */
      asOf: string;
      /** the last board, whole: this desktop's rows as they stood */
      board: AgentModelSnapshot;
      gone: AgentLastRunGone[];
    };
// Annotated with the type above for the reason `AgentModelMeshOpen` is: the
// inferred type over the model-board union is longer than the compiler will
// serialize into a declaration (TS7056).
export const AgentLastRunResult: z.ZodType<AgentLastRunResult, z.ZodTypeDef, unknown> =
  z.discriminatedUnion("state", [
    z.object({ state: z.literal("none") }).passthrough(),
    z
      .object({
        state: z.literal("left"),
        asOf: z.string(),
        board: AgentModelSnapshot,
        gone: z.array(AgentLastRunGone).max(4096),
      })
      .passthrough(),
  ]);

/** LR — `agent.lastRunForget {}`: the window's answer is in (restore, or start
 * clean) and the held picture goes. `forgotten`: one was held. */
export const AgentLastRunForgetResult = z.object({ forgotten: z.boolean() }).passthrough();
export type AgentLastRunForgetResult = z.infer<typeof AgentLastRunForgetResult>;

/** TL (docket v9, RULED 2026-10-09; B-D6 (a)) — `agent.recordedLanes
 * {sinceMs, untilMs, device?}`: the lanes' past as the monitor backend beside
 * the runtime derives it from the record (`MonitorBackend.readPast` over
 * `index.activity`'s reader), for a window whose mounted view asked for it
 * (capability `history`). Read through to rosettad at each ask and held
 * nowhere: this is NOT the removed `agent.history` (TL-D8's ledger in fieldd's
 * fold, retired at MV-D13), and it never rides the model's rows. The window is
 * at most `INDEX_ACTIVITY.MAX_WINDOW_MS`. */
export const AgentRecordedLanesParams = z
  .object({
    sinceMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    untilMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    device: z.string().min(1).optional(),
  })
  .passthrough()
  .refine(
    (params) =>
      params.untilMs > params.sinceMs &&
      params.untilMs - params.sinceMs <= INDEX_ACTIVITY.MAX_WINDOW_MS,
    "a window of at most a day, untilMs after sinceMs",
  );
export type AgentRecordedLanesParams = z.infer<typeof AgentRecordedLanesParams>;

/** One stretch of a lane's past (the SDK's `MonitorPastSpan`, TIMELINE SHAPES
 * v2): `worked` inside a turn, `quiet` between turns, `unrecorded` across a long
 * silence inside one, `bounds` a session's bounds alone (the floor, or one
 * session whose turns were not read — drawn flat and faint, never counted).
 * Never blocked, never unseen: the record says neither. Closed, as the SDK's
 * type is. */
export const MonitorPastSpan = z
  .object({
    kind: z.enum(["worked", "quiet", "unrecorded", "bounds"]),
    from: z.number().int(),
    to: z.number().int(),
  })
  .passthrough();
export type MonitorPastSpan = z.infer<typeof MonitorPastSpan>;

/** A model row's past up to `seamAt` (its `statusSince` when read). */
export const MonitorLivePast = z
  .object({
    id: z.string().min(1),
    seamAt: z.number().int(),
    spans: z.array(MonitorPastSpan),
  })
  .passthrough();
export type MonitorLivePast = z.infer<typeof MonitorLivePast>;

/** A run THIS runtime ran that the model no longer holds (`past:<provider>:<native
 * id>`; a session this runtime never ran is no lane, v2 item 7). `device.self` is
 * not carried, as on every row: the reader says it, and the reader computes
 * `receded` from its own filters with `profileSet`. Never openable in v1: no
 * command takes a `past:` id. */
export const MonitorEndedRow = z
  .object({
    id: z.string().min(1),
    provider: z.object({ id: z.string(), label: z.string() }).passthrough().optional(),
    /** the run's title, else the record's */
    title: z.string().optional(),
    /** the Agent Profile SET the run was born under */
    profileSet: z.string().optional(),
    project: z
      .object({
        name: z.string(),
        branch: z.string().nullable().optional(),
        seq: z.number().int().nonnegative().optional(),
      })
      .passthrough(),
    device: MonitorDeviceRef,
    startedAt: z.number().int(),
    endedAt: z.number().int(),
    spans: z.array(MonitorPastSpan),
  })
  .passthrough();
export type MonitorEndedRow = z.infer<typeof MonitorEndedRow>;

/** `agent.recordedLanes`' answer: the SDK's `MonitorPastSnapshot`, field for
 * field (fieldd pins the two, `agent-monitor.ts`). `state` is the honest word —
 * `unavailable` with `detail` when a record should be here and cannot be read
 * now (rosettad starting, a peer asleep), `partial` when some of it was not.
 * A desktop that keeps no record at all refuses the door NOT_FOUND {state:
 * "no-record"}: its window lends no past and draws today's floor. Dropped
 * sessions are `partial` with a detail. `clipped` is SP-D13's word, as
 * `index.activity`'s is: a `tailnet` caller's `ended` keeps the newest
 * `INDEX_TAILNET_LIMITS.MAX_ROWS` lanes by their end and says so, while its
 * `live` lanes (the model's rows, read whole over the board) stay whole; a window
 * and a peer daemon read the whole day and are never told. A bound is not
 * `partial`, which says the record could not be read. A peer reads each ended
 * title at the desk's bound (M21), as it reads the model's rows.
 * *Corrected 2026-10-29 (item 105): this said "No cap, no `truncated`", and a
 * phone's day of ended lanes and their titles was unbounded.* */
export const AgentRecordedLanesResult = z
  .object({
    sinceMs: z.number().int(),
    untilMs: z.number().int(),
    readAt: z.number().int(),
    fidelity: z.enum(["turns", "bounds"]),
    state: z.enum(["complete", "partial", "unavailable"]),
    detail: z.string().optional(),
    live: z.array(MonitorLivePast),
    ended: z.array(MonitorEndedRow),
    clipped: z.boolean().optional(),
  })
  .passthrough();
export type AgentRecordedLanesResult = z.infer<typeof AgentRecordedLanesResult>;

/** One device's slice of `field.agents.v1` (D4's hybrid). `expiresAt` is the
 * honesty clause: a desktop that dies without clearing its slice leaves rows a
 * reader must drop on the clock rather than believe forever. A live publisher
 * refreshes it every `AGENT_FIELD.STORE_HEARTBEAT_MS`; a graceful dispose
 * publishes empty rows with `expiresAt` already past.
 *
 * RETIRED 2026-10-01 (DS-D14): nothing publishes or reads this slice any more
 * (`STORES.AGENT_FIELD`'s note). The schema stays as the record of what an
 * older desktop's slice says, pinned by its goldens. */
export const AgentFieldSlice = z
  .object({
    v: z.literal(1),
    deviceId: z.string().min(1),
    publishedAt: z.number().int(),
    expiresAt: z.number().int(),
    revision: z.number().int(),
    rows: z.array(AgentFieldRow),
    /** MF-1h — rows the CAP left out (absent when the board is whole).
     *
     * A slice has a transport limit (`MESH_CONTROL_LIMITS.AGENT_FIELD_SLICE_BYTES`)
     * and a populated row measures ≈725 B, so a board of roughly ninety agents
     * reaches it. Past that the publisher drops rows from the END of the board
     * order and says how many rather than letting the floor refuse the whole
     * write — a refusal would read as mesh-down and retry forever, and this
     * desktop would simply vanish from every phone. The DOOR
     * (`agent.subscribe {projection: "field"}`) is never capped: it carries the
     * whole board. */
    omitted: z.number().int().positive().optional(),
  })
  .passthrough();
export type AgentFieldSlice = z.infer<typeof AgentFieldSlice>;

// MV-3a (L4; `thinking-monitor-view-sdk`'s build plan §2) — the project
// colour's identity, on disk. The monitor backend beside the runtime deals each
// project its colour SEQUENCE the first time an agent runs in it, and every
// window reads the colour from that sequence. Without a record of the deal a
// daemon restart would reshuffle every project's colour, so fieldd keeps it in
// `users/<fuid>/fieldd/project-identity.json` (LAYOUT `PROJECT_IDENTITY_FILE`,
// 0600). It is identity and nothing else: no clock, no row of what a project
// did (MV-D22, runtime only), and it never crosses the sync plane (M16 — a
// sequence is desktop-local; a peer's would collide with this desktop's).

/** One dealt project: the key its colour was dealt by (the host's canonical
 * root — a PATH, which is why the file is private) and the sequence. */
export const ProjectIdentityEntry = z
  .object({ key: z.string().min(1), seq: z.number().int().nonnegative() })
  .passthrough();
export type ProjectIdentityEntry = z.infer<typeof ProjectIdentityEntry>;

/** The file. `next` is the next sequence to deal, kept beside the entries so a
 * record trimmed of its oldest keys never deals a retired sequence again
 * (the renderer's `dealProjectSeqs` kept the same counter in localStorage). */
export const ProjectIdentityFile = z
  .object({
    version: z.literal(1),
    next: z.number().int().nonnegative(),
    projects: z.array(ProjectIdentityEntry),
  })
  .passthrough();
export type ProjectIdentityFile = z.infer<typeof ProjectIdentityFile>;

/** AR-6-0 — the stop verb. A run id, never a terminal id: fieldd resolves the
 * PTY through the record it minted for that run. */
export const AgentInterruptParams = z.object({ runtimeRunId: z.string().min(1) }).passthrough();
export type AgentInterruptParams = z.infer<typeof AgentInterruptParams>;

/** Accepted = the floor took the interrupt, not that the agent obeyed it —
 * what happens next is the vendor's. A refusal carries the floor's own word
 * (`no-terminal-host`, `human-input-conflict`, …), never a sentence composed
 * here. Q08 — the interrupt is the run's own turn stop: accepted is the floor
 * taking its key, or the agent's own control answering, and a refusal is that
 * one's word. */
export const AgentInterruptResult = z.discriminatedUnion("accepted", [
  z.object({ accepted: z.literal(true) }),
  z.object({ accepted: z.literal(false), reason: z.string() }),
]);
export type AgentInterruptResult = z.infer<typeof AgentInterruptResult>;

// RETIRED 2026-09-14 (TM-3, `thinking-terminal-mesh-cells.md` §7 / TM-D3):
// `TerminalMirrorWriteGrantParams` and `TerminalMirrorWriteGrantResult
// {capability, deviceId, issuedAt}` — G4's answer, by which the phone was
// handed the floor's durable write secret instead of a person pasting an env
// var into a phone. The secret it carried is deleted on every plane. The right
// to type now rides the attach grant in the ticket (`rights: ["input", "read"]`
// for a WhoIs-verified self peer, TM-2), so the phone asks for nothing extra
// and holds nothing that outlives the session it was minted for. *Corrected
// 2026-09-30 (DS-4, DS-D5's note): every self principal — the phone included —
// is minted `["geometry", "input", "read"]`; the kit's lease verbs are DS-4b.*
