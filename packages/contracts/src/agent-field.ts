import { z } from "zod";
import { AgentProfileId, AgentProviderId } from "./agent-index";
import { AgentSessionTerminal, AgentStatus, AgentTier } from "./agent-session";
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
    terminal: AgentSessionTerminal.optional(),
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
 * reader of `AgentFieldRow` reads it and keeps the rest as passthrough. */
export const AgentDeskRow = AgentFieldRow.extend({
  lastAssistantMessage: AgentDeskMessage.optional(),
  blockers: z.array(AgentDeskBlocker),
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
 * `AGENT_FIELD.DESK_MIN_INTERVAL_MS`). */
export const AgentProjection = z.enum(["full", "field", "desk"]);
export type AgentProjection = z.infer<typeof AgentProjection>;

/** `agent.subscribe`'s options. Absent or `full` is TODAY's subscription,
 * unchanged byte for byte — the desktop's renderer reads whole `rows` arrays
 * and must not learn a new frame shape to keep working. */
export const AgentSubscribeParams = z
  .object({
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

/** DS-3 — the OPEN answer of `agent.subscribe {scope: "mesh"}` (DS-D4): every
 * self desktop the roster lists, each with its state, when that was
 * established, and — once it has answered — its own board at its own
 * `{epoch, revision}`. Rows are keyed `{device, runtimeRunId}`. The daemon
 * MULTIPLEXES and never re-folds: a peer's revisions arrive as the peer
 * numbered them. A `desk` board's rows are `AgentDeskRow`s, which parse here
 * as field rows with the rest passed through. The ANSWERING desktop is listed
 * first — always present, always `live` — so a reader without a roster still
 * knows which board is its own. */
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

/** One device's slice of `field.agents.v1` (D4's hybrid). `expiresAt` is the
 * honesty clause: a desktop that dies without clearing its slice leaves rows a
 * reader must drop on the clock rather than believe forever. A live publisher
 * refreshes it every `AGENT_FIELD.STORE_HEARTBEAT_MS`; a graceful dispose
 * publishes empty rows with `expiresAt` already past. */
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

/** AR-6-0 — the stop verb. A run id, never a terminal id: fieldd resolves the
 * PTY through the record it minted for that run. */
export const AgentInterruptParams = z.object({ runtimeRunId: z.string().min(1) }).passthrough();
export type AgentInterruptParams = z.infer<typeof AgentInterruptParams>;

/** Accepted = the floor took the interrupt, not that the agent obeyed it —
 * what happens next is the vendor's. A refusal carries the floor's own word
 * (`no-terminal-host`, `human-input-conflict`, …), never a sentence composed
 * here. */
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
