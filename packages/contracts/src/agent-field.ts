import { z } from "zod";
import { AgentProfileId, AgentProviderId } from "./agent-index";
import { AgentSessionTerminal, AgentStatus, AgentTier } from "./agent-session";

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
 * bars (usage, context), the model and effort labels, the project it sits in,
 * and the terminal join. `revision` is fieldd's OWN per-row counter — it bumps
 * only when the PROJECTED row changes, never with the mirror's revision, so an
 * idle board sends nothing (§10.2). */
export const AgentFieldRow = z
  .object({
    runtimeRunId: z.string().min(1),
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
    project: z
      .object({ cwd: z.string().optional(), branch: z.string().nullable().optional() })
      .passthrough()
      .optional(),
    terminal: AgentSessionTerminal.optional(),
  })
  .passthrough();
export type AgentFieldRow = z.infer<typeof AgentFieldRow>;

/** `agent.subscribe`'s options. Absent or `full` is TODAY's subscription,
 * unchanged byte for byte — the desktop's renderer reads whole `rows` arrays
 * and must not learn a new frame shape to keep working. */
export const AgentSubscribeParams = z
  .object({
    projection: z.enum(["full", "field"]).optional(),
    /** field only; default `AGENT_FIELD.MIN_INTERVAL_MS`. A per-subscriber
     * trailing-edge floor, like the fold's own tick. */
    minIntervalMs: z.number().int().min(16).max(60_000).optional(),
  })
  .passthrough();
export type AgentSubscribeParams = z.infer<typeof AgentSubscribeParams>;

/** The first frame of a field subscription, and what a re-subscribe answers. */
export const AgentFieldSnapshot = z
  .object({ revision: z.number().int(), rows: z.array(AgentFieldRow) })
  .passthrough();
export type AgentFieldSnapshot = z.infer<typeof AgentFieldSnapshot>;

/** Every later frame. It applies ON TOP OF `since`: a client whose own
 * revision is not `since` has lost a frame and re-subscribes for a fresh
 * snapshot — the tolerant reader's own rule, never an ack protocol. */
export const AgentFieldDelta = z
  .object({
    since: z.number().int(),
    revision: z.number().int(),
    upserts: z.array(AgentFieldRow),
    removed: z.array(z.string()),
  })
  .passthrough();
export type AgentFieldDelta = z.infer<typeof AgentFieldDelta>;

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

/** G4 — the phone asks the desktop for the floor's mirror-write capability
 * instead of a person pasting an env var into a phone. No params: the grant is
 * for the CALLER, whose identity the door already knows. */
export const TerminalMirrorWriteGrantParams = z.object({}).passthrough();
export type TerminalMirrorWriteGrantParams = z.infer<typeof TerminalMirrorWriteGrantParams>;

/** The capability the floor compares (D5 v1: ONE secret per floor, so a
 * rotation revokes every device — per-device tokens are the named upgrade,
 * GT-D6). `deviceId` is the floor's device, so a phone holding grants from two
 * desktops knows which is which. The capability NEVER enters an audit record;
 * the ledger gets `{deviceId, principal}` (§10.1). */
export const TerminalMirrorWriteGrantResult = z
  .object({
    capability: z.string().min(1),
    deviceId: z.string().min(1),
    issuedAt: z.number().int(),
  })
  .passthrough();
export type TerminalMirrorWriteGrantResult = z.infer<typeof TerminalMirrorWriteGrantResult>;
