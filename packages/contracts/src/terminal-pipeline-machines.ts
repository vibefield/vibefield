import {
  AttachRefusalCode,
  ConnectionRefusalCode,
  GeometryRefusalCode,
  PreAuthFailureCode,
  SeedRequiredReason,
} from "./terminal-pipeline";

// The terminal pipeline's STATE-TRANSITION TABLES and FAILURE MATRIX as data —
// spec terminal-pipeline-v3.md §20 items 2 and 3. The prose in §5–§8 is the
// owner of the semantics; these tables are its machine-checkable form: every
// (state, event) pair of every machine is either a transition row, an explicit
// "ignored" (a no-op in that state) or an explicit "refused" (a protocol error
// in that state) — `terminal-pipeline-machines.test.ts` proves totality and
// determinism, and `fixtures/tp-machines.vector.json` is the published form
// the cell-side implementer (upstream Rust) reads. Guards are prose by
// design: they name the predicate the implementer must evaluate, in the
// spec's own words; the structural facts (which states exist, which events,
// what is absorbing, what is refused) are the part a test can hold.
//
// Conventions: `from: "*"` = every non-absorbing state; an `outputs` note on a
// state records what a consumer derives from it (never a second state). The
// two cell dimensions (`presentation`, `input`) are INPUTS to the activation
// machine, as the eighth review asked.

export interface MachineTransition {
  readonly from: string;
  readonly event: string;
  /** the predicate, in the spec's words; absent = "otherwise" (the default row) */
  readonly guard?: string;
  readonly to: string;
  readonly actions?: readonly string[];
  readonly note?: string;
}

export interface MachineTable {
  readonly name: string;
  readonly owner: string;
  readonly spec: string;
  readonly states: readonly string[];
  readonly initial: string;
  /** absorbing states: every event is ignored there */
  readonly absorbing: readonly string[];
  readonly events: readonly string[];
  readonly transitions: readonly MachineTransition[];
  /** (state, event) pairs that are a deliberate no-op */
  readonly ignored: readonly (readonly [string, string])[];
  /** (state, event) pairs that are a PROTOCOL error (the leg closes 4003 / the unit is dropped) */
  readonly refused: readonly (readonly [string, string])[];
  /** per-state derived outputs, for the reader — never a state of its own */
  readonly outputs?: Readonly<Record<string, string>>;
}

const ANY = "*";

// ---------------------------------------------------------------------------
// 1. Connection leg — the CELL's view of one socket (§5.1, §8 door hygiene)

export const CONNECTION_LEG_MACHINE: MachineTable = {
  name: "connection-leg",
  owner: "cell (server side of one control or frames socket)",
  spec: "§5.1 handshake · §8 door hygiene · §5.1 verification classes",
  states: ["open", "accepted", "closed"],
  initial: "open",
  absorbing: ["closed"],
  events: [
    "hello",
    "pre-auth-message", // any non-HELLO message before acceptance
    "hello-deadline",
    "pre-auth-limit", // preAuthMaxBytes / preAuthConnectionCap / origin
    "heartbeat",
    "heartbeat-timeout",
    "superseded", // a higher-generation leg took this channel
    "fenced", // the cell is no longer this route (STALE_ROUTE) or the lease fence failed
    "protocol-error",
    "peer-close",
    "server-shutdown",
  ],
  transitions: [
    {
      from: "open",
      event: "hello",
      guard:
        "grant verifies (typ, MAC, kid current, audience, validity, lifetime) ∧ channel ∈ allowedChannels ∧ version supported ∧ generation ≥ high-water ∧ (nonce,channel) unconsumed ∧ (channel free ∨ replacing a lower-generation leg ∨ equal generation newer than the current leg) ∧ capacity",
      to: "accepted",
      actions: [
        "send ConnectionAccepted (frames: creditEpoch + initialWindows = min(advertised, cell caps))",
        "raise high-water; consume (nonce, channel)",
        "supersede the previous leg of this channel if any (it gets `superseded`)",
        "start heartbeat receipt deadline",
      ],
    },
    {
      from: "open",
      event: "hello",
      guard:
        "the grant does NOT verify (the silent class: GRANT_BAD_MAC | GRANT_KEY_UNKNOWN | GRANT_TYPE_MISMATCH | GRANT_AUDIENCE_MISMATCH | GRANT_EXPIRED | GRANT_NOT_YET_VALID | GRANT_LIFETIME_EXCEEDED) ∨ HELLO_MALFORMED",
      to: "closed",
      actions: ["close 1008 with NO body", "audit the PreAuthFailureCode"],
    },
    {
      from: "open",
      event: "hello",
      guard:
        "the grant verifies but the request cannot be honoured (GRANT_GENERATION_ROLLBACK | GRANT_NONCE_REPLAYED | CHANNEL_NOT_ALLOWED | VERSION_UNSUPPORTED | SET_CHANNEL_BUSY | CAPACITY)",
      to: "closed",
      actions: ["send ConnectionRefused {code, retryable}", "close"],
    },
    {
      from: "open",
      event: "pre-auth-message",
      to: "closed",
      actions: ["close 1008 (HELLO_MALFORMED)"],
    },
    {
      from: "open",
      event: "hello-deadline",
      to: "closed",
      actions: ["close 1008 (PRE_AUTH_LIMIT)"],
    },
    {
      from: "open",
      event: "pre-auth-limit",
      to: "closed",
      actions: ["close 1008 (PRE_AUTH_LIMIT | ORIGIN_REJECTED)"],
    },
    { from: "open", event: "peer-close", to: "closed" },
    { from: "open", event: "server-shutdown", to: "closed", actions: ["close 1001"] },
    {
      from: "accepted",
      event: "heartbeat",
      to: "accepted",
      actions: ["send LegHeartbeatAck", "re-arm receipt deadline"],
    },
    {
      from: "accepted",
      event: "heartbeat-timeout",
      to: "closed",
      actions: [
        "close 4004 LEG_TIMEOUT",
        "invalidate every activation on this leg (accounts → draining; cursors → dormant)",
      ],
    },
    {
      from: "accepted",
      event: "superseded",
      to: "closed",
      actions: ["close 4002 SUPERSEDED", "invalidate every activation on this leg"],
    },
    {
      from: "accepted",
      event: "fenced",
      to: "closed",
      actions: [
        "close 4000 STALE_ROUTE (cell superseded) or 4001 FENCED (lease fence)",
        "invalidate every activation on this leg",
      ],
    },
    {
      from: "accepted",
      event: "protocol-error",
      to: "closed",
      actions: ["close 4003 PROTOCOL", "invalidate every activation on this leg"],
    },
    {
      from: "accepted",
      event: "peer-close",
      to: "closed",
      actions: ["invalidate every activation on this leg (recoverable: cursors → dormant)"],
    },
    { from: "accepted", event: "server-shutdown", to: "closed", actions: ["close 1001"] },
  ],
  ignored: [
    ["open", "heartbeat"], // a heartbeat before acceptance is a pre-auth-message — covered there
    ["open", "heartbeat-timeout"],
    ["open", "superseded"],
    ["open", "fenced"],
    ["open", "protocol-error"],
    ["accepted", "pre-auth-message"],
    ["accepted", "hello-deadline"],
    ["accepted", "pre-auth-limit"],
  ],
  refused: [["accepted", "hello"]],
};

// ---------------------------------------------------------------------------
// 2. Activation — the RUNTIME's (main thread) machine; the cell's two
//    dimensions are inputs (§5.4, §5.5)

export const ACTIVATION_MACHINE: MachineTable = {
  name: "activation",
  owner:
    "the main-thread routed runtime (the single activation authority); the worker reports FramesLegState and owns no activation state",
  spec: "§5.4 two wire levels · the two predicates · §5.5 migration · §8 transfers",
  states: [
    "unresolved", // no route/ticket yet
    "connecting", // the cell's connection set is being established for this route
    "attaching", // AttachControlLeg + AttachFramesLeg sent; awaiting both acks under activationAttachDeadlineMs
    "seeding", // frames attached with SeedRequired: seed + ONE catch-up in flight
    "resuming", // [cap: resume] frames attached with ResumeAccepted: deltas from `from`
    "presenting", // cell presentation = presenting; PresentationReady when local leases hold
    "stalled", // attached but not presenting: cell presentation = stopped, or a local lease (cell/worker) lapsed
    "recovering", // re-resolve/re-dial/re-attach under maxConcurrentActivations/maxConcurrentSeeds
    "unavailable", // the honest face: recovery budget/caps exhausted or no route; a retry re-enters recovering
    "ended", // detached, replaced, right revoked, runtime destroyed
  ],
  initial: "unresolved",
  absorbing: ["ended"],
  events: [
    "ticket-minted", // openTicket/create answered: route + grants (+ endpoints when T1 doors exist)
    "no-route", // fieldd cannot route the session (NOT_FOUND / UNAVAILABLE)
    "transport-ready", // both legs accepted for the route's cell
    "transport-failed", // a leg could not be established (refused / pre-auth close / dial error)
    "control-attached",
    "frames-attached", // with outcome resume-accepted | seed-required (and trfIdentity)
    "attach-refused", // AttachRefused {code, retryable}
    "attach-deadline", // activationAttachDeadlineMs elapsed before both legs attached
    "sync-complete", // seed + one catch-up applied (SceneApplied sent) / resume stream caught up
    "sync-failed", // transfer validation/abort, trfIdentity mismatch, PROTOCOL on the unit
    "cell-status", // CellActivationStatus {presentation, input} — the lease
    "cell-lease-expired", // no CellActivationStatus within leaseTtlMs (local deadline)
    "worker-lease-expired", // no PresentationStatus within leaseTtlMs (local deadline)
    "leg-lost", // control or frames leg closed/superseded/timed out
    "route-stale", // STALE_ROUTE / FENCED from the cell door or a route-change hint
    "grant-expiring", // attach grant within the renewal safety margin
    "renew-failed", // renewAttach refused (CONFLICT/UNAVAILABLE) — read until expiry, input closes
    "detach", // the last view released demand (the runtime ends the activation)
    "replaced", // a newer activation for {client, session} took over (replacesActivationId)
    "retry", // user/hint-driven re-entry from unavailable
    "runtime-destroyed",
  ],
  transitions: [
    {
      from: "unresolved",
      event: "ticket-minted",
      guard: "endpoints present (T1 doors exist)",
      to: "connecting",
      actions: ["hold grants", "dial/reuse the cell's connection set"],
    },
    {
      from: "unresolved",
      event: "ticket-minted",
      guard: "endpoints ABSENT (pre-S3a floor)",
      to: "unavailable",
      actions: ["face: UNAVAILABLE {reason: transport-not-landed}"],
    },
    {
      from: "unresolved",
      event: "no-route",
      to: "unavailable",
      actions: ["face: UNAVAILABLE {reason from fieldd}"],
    },
    {
      from: "connecting",
      event: "transport-ready",
      to: "attaching",
      actions: [
        "mint activationId",
        "send AttachControlLeg{initialDemand} + AttachFramesLeg{resume? if token held}",
        "start activationAttachDeadlineMs",
      ],
    },
    {
      from: "connecting",
      event: "transport-failed",
      guard: "pre-auth close (silent 1008) — first time",
      to: "recovering",
      actions: ["re-mint ONCE (openTicket)"],
    },
    {
      from: "connecting",
      event: "transport-failed",
      guard: "pre-auth close again, or refusal not retryable",
      to: "unavailable",
      actions: ["face: UNAVAILABLE {reason: transport-refused}"],
    },
    {
      from: "connecting",
      event: "transport-failed",
      guard: "refusal retryable (CAPACITY, SET_CHANNEL_BUSY)",
      to: "recovering",
      actions: ["backoff then re-dial under caps"],
    },
    {
      from: "attaching",
      event: "control-attached",
      guard: "frames not yet attached",
      to: "attaching",
      actions: ["record grantGenerationAccepted, rights"],
    },
    {
      from: "attaching",
      event: "control-attached",
      guard: "frames already attached with seed-required",
      to: "seeding",
    },
    {
      from: "attaching",
      event: "control-attached",
      guard: "frames already attached with resume-accepted",
      to: "resuming",
    },
    {
      from: "attaching",
      event: "frames-attached",
      guard: "control not yet attached",
      to: "attaching",
      actions: ["bind trfIdentity → scene key", "keep resumeToken"],
    },
    {
      from: "attaching",
      event: "frames-attached",
      guard: "control attached ∧ outcome seed-required",
      to: "seeding",
      actions: ["bind trfIdentity → scene key", "keep resumeToken"],
    },
    {
      from: "attaching",
      event: "frames-attached",
      guard: "control attached ∧ outcome resume-accepted",
      to: "resuming",
      actions: ["bind trfIdentity → scene key"],
    },
    {
      from: "attaching",
      event: "attach-refused",
      guard: "ACTIVATION_CONFLICT (a pending activation of ours exists)",
      to: "recovering",
      actions: ["new activationId with replacesActivationId"],
    },
    {
      from: "attaching",
      event: "attach-refused",
      guard: "STALE_ROUTE | FENCED",
      to: "recovering",
      actions: ["re-mint via openTicket (new route)"],
    },
    {
      from: "attaching",
      event: "attach-refused",
      guard: "GRANT_GENERATION_ROLLBACK | GRANT_NONCE_REPLAYED",
      to: "recovering",
      actions: ["re-mint via openTicket (fresh generation)"],
    },
    {
      from: "attaching",
      event: "attach-refused",
      guard: "SESSION_UNKNOWN | CAPACITY not retryable",
      to: "unavailable",
      actions: ["face: UNAVAILABLE {reason: attach-refused}"],
    },
    {
      from: "attaching",
      event: "attach-deadline",
      to: "recovering",
      actions: ["abandon activationId", "new activationId with replacesActivationId"],
    },
    {
      from: "seeding",
      event: "sync-complete",
      guard: "cell status not yet received",
      to: "seeding",
      actions: ["SceneApplied sent; await the lease"],
    },
    {
      from: "seeding",
      event: "cell-status",
      guard: "presentation = presenting",
      to: "presenting",
      actions: ["PresentationReady; open input iff input = allowed ∧ right valid"],
    },
    {
      from: "resuming",
      event: "cell-status",
      guard: "presentation = presenting",
      to: "presenting",
      actions: ["PresentationReady; open input iff input = allowed ∧ right valid"],
    },
    {
      from: "seeding",
      event: "sync-failed",
      to: "recovering",
      actions: ["activation failed; new activationId (replacesActivationId)"],
    },
    {
      from: "resuming",
      event: "sync-failed",
      to: "recovering",
      actions: ["activation failed; new activationId; next attach without resume"],
    },
    {
      from: "presenting",
      event: "cell-status",
      guard: "presentation = presenting",
      to: "presenting",
      actions: ["refresh lease deadline", "input open ⇔ input = allowed ∧ right valid"],
    },
    {
      from: "presenting",
      event: "cell-status",
      guard: "presentation = stopped",
      to: "stalled",
      actions: ["close input", "face: behind/overload per reason"],
    },
    {
      from: "stalled",
      event: "cell-status",
      guard: "presentation = presenting",
      to: "presenting",
      actions: ["PresentationReady again"],
    },
    {
      from: "stalled",
      event: "cell-status",
      guard: "presentation = stopped",
      to: "stalled",
      actions: ["refresh lease deadline"],
    },
    {
      from: ANY,
      event: "cell-status",
      guard: "presentation = revoked ∧ reason ∈ {leg-dead, stale-route}",
      to: "recovering",
      actions: ["close input", "new activation (re-mint on stale-route)"],
    },
    {
      from: ANY,
      event: "cell-status",
      guard: "presentation = revoked ∧ reason ∈ {replaced, right-revoked, detached}",
      to: "ended",
      actions: ["close input", "release demand/staging/cursor; account → draining"],
    },
    {
      from: "presenting",
      event: "cell-lease-expired",
      to: "stalled",
      actions: ["close input (PresentationReady false)"],
    },
    {
      from: "presenting",
      event: "worker-lease-expired",
      to: "stalled",
      actions: ["close input (PresentationReady false)"],
    },
    { from: "stalled", event: "cell-lease-expired", to: "stalled" },
    { from: "stalled", event: "worker-lease-expired", to: "stalled" },
    {
      from: ANY,
      event: "leg-lost",
      guard: "frames leg ∧ resume capability ∧ resumeToken held",
      to: "recovering",
      actions: [
        "re-attach frames with resume{resumeToken, from = local applied stamp}; control attachment kept",
      ],
    },
    {
      from: ANY,
      event: "leg-lost",
      guard: "otherwise",
      to: "recovering",
      actions: [
        "new activation (replacesActivationId); geometry holder keeps holderGraceMs on a control-leg loss",
      ],
    },
    {
      from: ANY,
      event: "route-stale",
      to: "recovering",
      actions: ["close input", "re-mint via openTicket", "worker fences stale-activation frames"],
    },
    {
      from: "presenting",
      event: "grant-expiring",
      to: "presenting",
      actions: ["renewAttach(expectGeneration = held, requestId)"],
    },
    {
      from: "presenting",
      event: "renew-failed",
      to: "presenting",
      actions: ["input closes at the safety margin; read until expiry; geometry revokes at expiry"],
    },
    { from: "stalled", event: "grant-expiring", to: "stalled", actions: ["renewAttach"] },
    { from: "stalled", event: "renew-failed", to: "stalled" },
    { from: "recovering", event: "ticket-minted", guard: "endpoints present", to: "connecting" },
    {
      from: "recovering",
      event: "ticket-minted",
      guard: "endpoints ABSENT",
      to: "unavailable",
      actions: ["face: UNAVAILABLE {reason: transport-not-landed}"],
    },
    {
      from: "recovering",
      event: "transport-ready",
      to: "attaching",
      actions: ["as from connecting"],
    },
    { from: "recovering", event: "no-route", to: "unavailable" },
    {
      from: "recovering",
      event: "transport-failed",
      guard: "recovery budget/caps exhausted",
      to: "unavailable",
      actions: ["face: UNAVAILABLE {reason: recovery-exhausted}"],
    },
    {
      from: "recovering",
      event: "transport-failed",
      guard: "otherwise",
      to: "recovering",
      actions: ["backoff; fair scheduling under maxConcurrentActivations"],
    },
    { from: "unavailable", event: "retry", to: "recovering", actions: ["re-mint via openTicket"] },
    { from: "unavailable", event: "ticket-minted", guard: "endpoints present", to: "connecting" },
    {
      from: ANY,
      event: "detach",
      to: "ended",
      actions: [
        "DeclareDemand{none}; close activation",
        "release demand/urgency/staging; cursor dormant (recoverable) or deleted; account → draining",
      ],
    },
    {
      from: ANY,
      event: "replaced",
      to: "ended",
      actions: ["the newer activation owns the session; this one releases everything"],
    },
    {
      from: ANY,
      event: "runtime-destroyed",
      to: "ended",
      actions: ["cursors deleted; accounts → draining at the cell on leg close"],
    },
  ],
  ignored: [
    ["unresolved", "transport-ready"],
    ["unresolved", "transport-failed"],
    ["unresolved", "control-attached"],
    ["unresolved", "frames-attached"],
    ["unresolved", "attach-refused"],
    ["unresolved", "attach-deadline"],
    ["unresolved", "sync-complete"],
    ["unresolved", "sync-failed"],
    ["unresolved", "cell-status"],
    ["unresolved", "cell-lease-expired"],
    ["unresolved", "worker-lease-expired"],
    ["unresolved", "leg-lost"],
    ["unresolved", "route-stale"],
    ["unresolved", "grant-expiring"],
    ["unresolved", "renew-failed"],
    ["unresolved", "retry"],
    ["connecting", "ticket-minted"],
    ["connecting", "no-route"],
    ["connecting", "control-attached"],
    ["connecting", "frames-attached"],
    ["connecting", "attach-refused"],
    ["connecting", "attach-deadline"],
    ["connecting", "sync-complete"],
    ["connecting", "sync-failed"],
    ["connecting", "cell-status"],
    ["connecting", "cell-lease-expired"],
    ["connecting", "worker-lease-expired"],
    ["connecting", "grant-expiring"],
    ["connecting", "renew-failed"],
    ["connecting", "retry"],
    ["attaching", "ticket-minted"],
    ["attaching", "no-route"],
    ["attaching", "transport-ready"],
    ["attaching", "transport-failed"],
    ["attaching", "sync-complete"],
    ["attaching", "sync-failed"],
    ["attaching", "cell-lease-expired"],
    ["attaching", "worker-lease-expired"],
    ["attaching", "grant-expiring"],
    ["attaching", "renew-failed"],
    ["attaching", "retry"],
    ["seeding", "ticket-minted"],
    ["seeding", "no-route"],
    ["seeding", "transport-ready"],
    ["seeding", "transport-failed"],
    ["seeding", "control-attached"],
    ["seeding", "frames-attached"],
    ["seeding", "attach-refused"],
    ["seeding", "attach-deadline"],
    ["seeding", "cell-lease-expired"],
    ["seeding", "worker-lease-expired"],
    ["seeding", "grant-expiring"],
    ["seeding", "renew-failed"],
    ["seeding", "retry"],
    ["resuming", "ticket-minted"],
    ["resuming", "no-route"],
    ["resuming", "transport-ready"],
    ["resuming", "transport-failed"],
    ["resuming", "control-attached"],
    ["resuming", "frames-attached"],
    ["resuming", "attach-refused"],
    ["resuming", "attach-deadline"],
    ["resuming", "sync-complete"],
    ["resuming", "cell-lease-expired"],
    ["resuming", "worker-lease-expired"],
    ["resuming", "grant-expiring"],
    ["resuming", "renew-failed"],
    ["resuming", "retry"],
    ["presenting", "ticket-minted"],
    ["presenting", "no-route"],
    ["presenting", "transport-ready"],
    ["presenting", "transport-failed"],
    ["presenting", "control-attached"],
    ["presenting", "frames-attached"],
    ["presenting", "attach-refused"],
    ["presenting", "attach-deadline"],
    ["presenting", "sync-complete"],
    ["presenting", "sync-failed"],
    ["presenting", "retry"],
    ["stalled", "ticket-minted"],
    ["stalled", "no-route"],
    ["stalled", "transport-ready"],
    ["stalled", "transport-failed"],
    ["stalled", "control-attached"],
    ["stalled", "frames-attached"],
    ["stalled", "attach-refused"],
    ["stalled", "attach-deadline"],
    ["stalled", "sync-complete"],
    ["stalled", "sync-failed"],
    ["stalled", "retry"],
    ["recovering", "control-attached"],
    ["recovering", "frames-attached"],
    ["recovering", "attach-refused"],
    ["recovering", "attach-deadline"],
    ["recovering", "sync-complete"],
    ["recovering", "sync-failed"],
    ["recovering", "cell-lease-expired"],
    ["recovering", "worker-lease-expired"],
    ["recovering", "grant-expiring"],
    ["recovering", "renew-failed"],
    ["recovering", "retry"],
    ["unavailable", "no-route"],
    ["unavailable", "transport-ready"],
    ["unavailable", "transport-failed"],
    ["unavailable", "control-attached"],
    ["unavailable", "frames-attached"],
    ["unavailable", "attach-refused"],
    ["unavailable", "attach-deadline"],
    ["unavailable", "sync-complete"],
    ["unavailable", "sync-failed"],
    ["unavailable", "cell-lease-expired"],
    ["unavailable", "worker-lease-expired"],
    ["unavailable", "grant-expiring"],
    ["unavailable", "renew-failed"],
  ],
  refused: [],
  outputs: {
    presenting:
      "PresentationReady = controlLegLeaseLive ∧ framesLegLeaseLive ∧ localPresentationLeaseLive ∧ cell presentation=presenting ∧ localSceneContent ≥ cellAcceptedContent; InputAllowed = PresentationReady ∧ cell input=allowed ∧ inputRightStillValid",
    stalled: "PresentationReady = false (the last scene stays on screen); InputAllowed = false",
    seeding:
      "PresentationReady = false; the worker shows the previous scene or the recovering face",
    resuming: "PresentationReady = false until the cell's first presenting status",
    recovering: "TC-D11's recovering face; input closed; views and canvases untouched",
    unavailable: "the honest UNAVAILABLE face with its reason; a retry affordance",
  },
};

// ---------------------------------------------------------------------------
// 3. Credit account — cell side, per activation (§8 flow control)

export const CREDIT_ACCOUNT_MACHINE: MachineTable = {
  name: "credit-account",
  owner:
    "cell (per activation, within one creditEpoch); the worker keeps only a bare returned-bytes counter per activationId until creditAccountDrainTtlMs",
  spec: "§8 'Credit is bytes, never sequence' laws (1)–(7)",
  states: ["open", "draining", "closed"],
  initial: "open",
  absorbing: ["closed"],
  events: [
    "unit-admitted", // a presentation unit written to the socket; admitted += its whole message length
    "return-received", // TransportCredit carrying this account's cumulative bytesReturned (max() applies)
    "return-stale-epoch", // a TransportCredit whose creditEpoch is not this leg's
    "activation-invalidated", // detach / replaced / revoked / leg invalidation
    "epoch-reset", // the physical frames leg was replaced (new creditEpoch)
  ],
  transitions: [
    {
      from: "open",
      event: "unit-admitted",
      guard: "admitted − returned + length ≤ per-activation window ∧ connection window allows",
      to: "open",
      actions: ["admitted += length"],
    },
    {
      from: "open",
      event: "return-received",
      to: "open",
      actions: ["returned = max(returned, reported)"],
    },
    { from: "open", event: "activation-invalidated", guard: "admitted == returned", to: "closed" },
    {
      from: "open",
      event: "activation-invalidated",
      guard: "otherwise",
      to: "draining",
      actions: ["no further admission; already-admitted bytes are never pretended away"],
    },
    {
      from: "draining",
      event: "return-received",
      guard: "max(returned, reported) == admitted",
      to: "closed",
    },
    {
      from: "draining",
      event: "return-received",
      guard: "otherwise",
      to: "draining",
      actions: ["returned = max(returned, reported)"],
    },
    {
      from: "open",
      event: "epoch-reset",
      to: "closed",
      actions: ["every total of the old epoch is discarded with the leg"],
    },
    { from: "draining", event: "epoch-reset", to: "closed" },
  ],
  ignored: [
    ["open", "return-stale-epoch"],
    ["draining", "return-stale-epoch"],
    ["draining", "activation-invalidated"],
  ],
  refused: [
    ["open", "unit-admitted"], // when the guard fails: the writer must not admit — a bug, not a wire error
    ["draining", "unit-admitted"],
  ],
  outputs: {
    open: "window = min(perActivationCreditBytes − (admitted − returned), connectionCreditBytes − (connAdmitted − connReturned))",
    draining:
      "window = 0; the worker still returns every in-flight unit's charge exactly once (law 1)",
  },
};

// ---------------------------------------------------------------------------
// 4. Transfer — worker side, per transferId (§8 transfers)

export const TRANSFER_MACHINE: MachineTable = {
  name: "transfer",
  owner: "worker (the frames leg's receiver), per transferId within one activation",
  spec: "§8 'Transfers — one generalized, self-fenced, convergent wire' · convergence",
  states: ["staging", "validated", "swapped", "aborted"],
  initial: "staging",
  absorbing: ["swapped", "aborted"],
  events: [
    "begin", // transfer-begin {kind, totalBytes, chunkCount, targetLayout, checksum, base/result stamps}
    "chunk", // transfer-chunk {chunkIndex, byteOffset} + payload
    "end", // transfer-end
    "apply", // internal: the validated staging replica is swapped in (atomic)
    "activation-invalidated",
    "leg-lost",
    "budget-exceeded", // stagingBytesPerSession / stagingBytesTotal / maxConcurrentSeeds
  ],
  transitions: [
    {
      from: "staging",
      event: "begin",
      guard:
        "activation known ∧ totalBytes ≤ staging budget ∧ layout fits computed allocations ∧ (seed: baseContent = null | catch-up: baseContent == current scene stamp) ∧ one sceneEpoch across stamps ∧ no transfer with this id",
      to: "staging",
      actions: ["preallocate fixed-size staging under the budget", "return the unit's charge"],
    },
    {
      from: "staging",
      event: "begin",
      guard: "otherwise",
      to: "aborted",
      actions: ["drop; return the charge; PROTOCOL on malformed"],
    },
    {
      from: "staging",
      event: "chunk",
      guard:
        "index < chunkCount ∧ [offset, offset+len) within totalBytes ∧ not overlapping a received range",
      to: "staging",
      actions: ["copy into staging", "return the charge at once"],
    },
    {
      from: "staging",
      event: "chunk",
      guard: "otherwise",
      to: "aborted",
      actions: ["release staging; return the charge; PROTOCOL"],
    },
    {
      from: "staging",
      event: "end",
      guard: "every chunk received ∧ crc32c over the concatenated bytes == checksum",
      to: "validated",
      actions: ["return the charge"],
    },
    {
      from: "staging",
      event: "end",
      guard: "otherwise (missing chunks | checksum mismatch | duplicate end)",
      to: "aborted",
      actions: ["release staging; the activation fails (sync-failed)"],
    },
    {
      from: "validated",
      event: "apply",
      guard: "catch-up: base still == current | seed: always",
      to: "swapped",
      actions: ["atomic swap staging → SceneReplica", "send SceneApplied(resultContent)"],
    },
    {
      from: "validated",
      event: "apply",
      guard: "catch-up and the base moved",
      to: "aborted",
      actions: ["the activation fails (sync-failed)"],
    },
    {
      from: "staging",
      event: "activation-invalidated",
      to: "aborted",
      actions: ["release staging at once"],
    },
    {
      from: "validated",
      event: "activation-invalidated",
      to: "aborted",
      actions: ["release staging at once"],
    },
    { from: "staging", event: "leg-lost", to: "aborted", actions: ["release staging"] },
    { from: "validated", event: "leg-lost", to: "aborted", actions: ["release staging"] },
    {
      from: "staging",
      event: "budget-exceeded",
      to: "aborted",
      actions: ["release staging; the cell's next attempt is a fresh transfer"],
    },
  ],
  ignored: [
    ["validated", "begin"], // a new transfer id starts its own machine
    ["validated", "chunk"],
    ["validated", "end"],
    ["validated", "budget-exceeded"],
    ["staging", "apply"],
  ],
  refused: [],
};

// ---------------------------------------------------------------------------
// 5. Geometry seat — cell side, per session (§6)

export const GEOMETRY_SEAT_MACHINE: MachineTable = {
  name: "geometry-seat",
  owner: "cell, per session: at most one GeometryHolder at any revision",
  spec: "§6 the geometry lease, complete",
  states: ["empty", "held", "held-grace"],
  initial: "empty",
  absorbing: [],
  events: [
    "claim", // claim_geometry {claimant, cols, rows, expectRevision}
    "release", // release_geometry {holder}
    "transfer", // transfer_geometry {from, to, expectRevision, cols, rows}
    "holder-control-lost", // the holder's control leg died (grace)
    "holder-frames-lost", // the holder's frames leg died (survives)
    "holder-reconnected", // the holder's control attachment is back within the grace
    "grace-expired", // holderGraceMs elapsed
    "holder-grant-expired", // the holder's attach grant reached expiry without renewal
    "holder-grant-renewed", // renewal retaining `geometry` (rebind) or dropping it (revoke)
    "holder-view-detached", // the holder's view/mount ended
    "session-ended",
  ],
  transitions: [
    {
      from: "empty",
      event: "claim",
      guard: "expectRevision == current revision ∧ the claimant's attach grant carries `geometry`",
      to: "held",
      actions: [
        "mint holderGeneration",
        "commit ONE PTY resize",
        "revision += 1",
        "announce the holder (control-changed{revision})",
      ],
    },
    {
      from: "empty",
      event: "claim",
      guard: "otherwise",
      to: "empty",
      actions: ["GeometryRefused {STALE_REVISION | RIGHT_MISSING}"],
    },
    {
      from: "held",
      event: "claim",
      guard:
        "the claimant is the current holder (same clientId, viewId) ∧ expectRevision == current",
      to: "held",
      actions: ["commit ONE PTY resize", "revision += 1"],
    },
    {
      from: "held",
      event: "claim",
      guard: "otherwise",
      to: "held",
      actions: ["GeometryRefused {SEAT_HELD | STALE_REVISION}"],
    },
    {
      from: "held",
      event: "release",
      guard: "holder matches incl. holderGeneration",
      to: "empty",
      actions: ["announce empty seat"],
    },
    {
      from: "held",
      event: "release",
      guard: "otherwise",
      to: "held",
      actions: ["GeometryRefused {NOT_HOLDER}"],
    },
    {
      from: "held",
      event: "transfer",
      guard:
        "(caller is the holder ∨ caller's grant carries geometryAdmin [S4]) ∧ `to` holds a valid geometry-capable grant ∧ expectRevision == current",
      to: "held",
      actions: [
        "ONE transition: revoke `from`, grant `to` (new holderGeneration), commit ONE PTY resize, revision += 1",
      ],
    },
    {
      from: "held",
      event: "transfer",
      guard: "otherwise",
      to: "held",
      actions: [
        "GeometryRefused {NOT_HOLDER | RIGHT_MISSING | DESTINATION_INELIGIBLE | STALE_REVISION}",
      ],
    },
    {
      from: "held",
      event: "holder-control-lost",
      to: "held-grace",
      actions: ["start holderGraceMs"],
    },
    {
      from: "held",
      event: "holder-frames-lost",
      to: "held",
      actions: ["the lease survives a frames-leg replacement (attach/client/view scope)"],
    },
    {
      from: "held-grace",
      event: "holder-reconnected",
      to: "held",
      actions: [
        "cancel the grace; the new activation is the only one allowed to issue geometry commands",
      ],
    },
    {
      from: "held-grace",
      event: "grace-expired",
      to: "empty",
      actions: ["auto-release; announce empty seat"],
    },
    {
      from: "held-grace",
      event: "claim",
      guard: "another claimant",
      to: "held-grace",
      actions: ["GeometryRefused {SEAT_HELD}"],
    },
    {
      from: "held-grace",
      event: "claim",
      guard: "the holder itself reclaims",
      to: "held",
      actions: ["cancel the grace; commit ONE PTY resize; revision += 1"],
    },
    { from: "held-grace", event: "release", guard: "holder matches", to: "empty" },
    {
      from: "held-grace",
      event: "release",
      guard: "otherwise",
      to: "held-grace",
      actions: ["GeometryRefused {NOT_HOLDER}"],
    },
    {
      from: "held-grace",
      event: "transfer",
      guard: "caller's grant carries geometryAdmin [S4] ∧ `to` eligible",
      to: "held",
      actions: ["the seat moves; the grace is cancelled"],
    },
    {
      from: "held-grace",
      event: "transfer",
      guard: "otherwise",
      to: "held-grace",
      actions: ["GeometryRefused {NOT_HOLDER}"],
    },
    { from: "held", event: "holder-grant-expired", to: "empty", actions: ["auto-release"] },
    { from: "held-grace", event: "holder-grant-expired", to: "empty", actions: ["auto-release"] },
    {
      from: "held",
      event: "holder-grant-renewed",
      guard: "the renewal retains `geometry`",
      to: "held",
      actions: ["rebind the holder to the newer grant generation"],
    },
    {
      from: "held",
      event: "holder-grant-renewed",
      guard: "the renewal drops `geometry`",
      to: "empty",
      actions: ["revoke at once"],
    },
    { from: "held-grace", event: "holder-grant-renewed", guard: "retains", to: "held-grace" },
    { from: "held-grace", event: "holder-grant-renewed", guard: "drops", to: "empty" },
    { from: "held", event: "holder-view-detached", to: "empty", actions: ["auto-release"] },
    { from: "held-grace", event: "holder-view-detached", to: "empty" },
    { from: "empty", event: "session-ended", to: "empty" },
    {
      from: "held",
      event: "session-ended",
      to: "empty",
      actions: ["the seat ends with the session"],
    },
    { from: "held-grace", event: "session-ended", to: "empty" },
  ],
  ignored: [
    ["empty", "release"], // GeometryRefused {NOT_HOLDER} — a refusal answer, not a state change
    ["empty", "transfer"], // GeometryRefused {NOT_HOLDER}
    ["empty", "holder-control-lost"],
    ["empty", "holder-frames-lost"],
    ["empty", "holder-reconnected"],
    ["empty", "grace-expired"],
    ["empty", "holder-grant-expired"],
    ["empty", "holder-grant-renewed"],
    ["empty", "holder-view-detached"],
    ["held", "holder-reconnected"],
    ["held", "grace-expired"],
    ["held-grace", "holder-control-lost"],
    ["held-grace", "holder-frames-lost"],
  ],
  refused: [],
  outputs: {
    held: "exactly one GeometryHolder {clientId, viewId, holderGeneration} at `geometryRevision`; a handover is ONE committed resize",
    "held-grace":
      "the holder is the same; no other claimant may take the seat until holderGraceMs elapses",
  },
};

export const TERMINAL_PIPELINE_MACHINES: readonly MachineTable[] = [
  CONNECTION_LEG_MACHINE,
  ACTIVATION_MACHINE,
  CREDIT_ACCOUNT_MACHINE,
  TRANSFER_MACHINE,
  GEOMETRY_SEAT_MACHINE,
];

// ---------------------------------------------------------------------------
// Coverage — the structural facts a test can hold (and a reader can compute)

export interface MachineCoverage {
  readonly name: string;
  /** (state, event) pairs with neither a transition nor an ignored/refused entry */
  readonly uncovered: readonly (readonly [string, string])[];
  /** pairs with two guard-less rows, or a guard-less row that is not last */
  readonly ambiguous: readonly (readonly [string, string])[];
  /** transitions whose `to` or `from` is not a state, or whose event is not an event */
  readonly dangling: readonly string[];
  /** absorbing states with an outgoing transition to another state */
  readonly leakyAbsorbing: readonly string[];
}

export function machineCoverage(table: MachineTable): MachineCoverage {
  const states = new Set(table.states);
  const events = new Set(table.events);
  const dangling: string[] = [];
  const pairs = new Map<string, MachineTransition[]>();
  for (const t of table.transitions) {
    if (t.from !== ANY && !states.has(t.from)) dangling.push(`from:${t.from}`);
    if (!states.has(t.to)) dangling.push(`to:${t.to}`);
    if (!events.has(t.event)) dangling.push(`event:${t.event}`);
    const froms =
      t.from === ANY ? table.states.filter((s) => !table.absorbing.includes(s)) : [t.from];
    for (const from of froms) {
      const key = `${from} ${t.event}`;
      const list = pairs.get(key) ?? [];
      list.push(t);
      pairs.set(key, list);
    }
  }
  const covered = new Set<string>([
    ...pairs.keys(),
    ...table.ignored.map(([s, e]) => `${s} ${e}`),
    ...table.refused.map(([s, e]) => `${s} ${e}`),
  ]);
  const uncovered: (readonly [string, string])[] = [];
  for (const s of table.states) {
    if (table.absorbing.includes(s)) continue;
    for (const e of table.events) if (!covered.has(`${s} ${e}`)) uncovered.push([s, e]);
  }
  const ambiguous: (readonly [string, string])[] = [];
  for (const [key, list] of pairs) {
    const guardless = list.filter((t) => t.guard === undefined);
    const lastIsGuardless = list[list.length - 1]?.guard === undefined;
    if (guardless.length > 1 || (guardless.length === 1 && !lastIsGuardless)) {
      const [s, e] = key.split(" ") as [string, string];
      ambiguous.push([s, e]);
    }
  }
  const leakyAbsorbing = table.absorbing.filter((s) =>
    table.transitions.some((t) => t.from === s && t.to !== s),
  );
  return { name: table.name, uncovered, ambiguous, dangling, leakyAbsorbing };
}

// ---------------------------------------------------------------------------
// The failure / error / retry matrix (§20 item 3) — every code the wire can
// name, with who retries, how, what the user sees, and the audit line.

export interface FailureRow {
  readonly code: string;
  readonly family:
    | "pre-auth"
    | "connection-refusal"
    | "attach-refusal"
    | "geometry-refusal"
    | "seed-required"
    | "close-code"
    | "envelope-decode";
  /** how it reaches the wire */
  readonly wire: string;
  readonly retryable: boolean;
  readonly whoRetries: "runtime" | "cell" | "none" | "user";
  readonly how: string;
  readonly userFace: string;
  readonly audit: string;
}

const preAuth = (
  code: string,
  how = "re-mint ONCE via openTicket; a second 1008 ⇒ UNAVAILABLE",
): FailureRow => ({
  code,
  family: "pre-auth",
  wire: "silent close 1008 — no body, no code on the wire",
  retryable:
    code === "GRANT_EXPIRED" || code === "GRANT_NOT_YET_VALID" || code === "GRANT_KEY_UNKNOWN",
  whoRetries: "runtime",
  how,
  userFace: "UNAVAILABLE {service: terminal, reason: transport-refused} after the one re-mint",
  audit: `cell: tp.door.refused {code: ${code}, origin, connectionSetId?}`,
});

export const FAILURE_MATRIX: readonly FailureRow[] = [
  // pre-auth (silent)
  ...PreAuthFailureCode.options.map((code) => preAuth(code)),
  // connection refusals (structured, post-verification)
  {
    code: "GRANT_GENERATION_ROLLBACK",
    family: "connection-refusal",
    wire: "ConnectionRefused {code, retryable:false}",
    retryable: false,
    whoRetries: "runtime",
    how: "re-mint via openTicket (a fresh, higher generation); never re-present this grant",
    userFace: "transient: recovering face",
    audit: "cell: tp.door.refused; fieldd: terminal.ticket.mint (the re-mint)",
  },
  {
    code: "GRANT_NONCE_REPLAYED",
    family: "connection-refusal",
    wire: "ConnectionRefused {code, retryable:false}",
    retryable: false,
    whoRetries: "runtime",
    how: "re-mint via openTicket; audit as a possible replay",
    userFace: "transient: recovering face",
    audit: "cell: tp.door.refused {replay suspected}",
  },
  {
    code: "CHANNEL_NOT_ALLOWED",
    family: "connection-refusal",
    wire: "ConnectionRefused {code, retryable:false}",
    retryable: false,
    whoRetries: "none",
    how: "a client bug (grant minted for the other channel); UNAVAILABLE",
    userFace: "UNAVAILABLE {reason: transport-refused}",
    audit: "cell: tp.door.refused",
  },
  {
    code: "VERSION_UNSUPPORTED",
    family: "connection-refusal",
    wire: "ConnectionRefused {code, retryable:false}",
    retryable: false,
    whoRetries: "none",
    how: "no retry; the pair is out of lockstep (EL8)",
    userFace: "UNAVAILABLE {reason: version-mismatch}",
    audit: "cell: tp.door.refused {offeredMajor/minor}",
  },
  {
    code: "SET_CHANNEL_BUSY",
    family: "connection-refusal",
    wire: "ConnectionRefused {code, retryable:true}",
    retryable: true,
    whoRetries: "runtime",
    how: "a newer leg of ours already holds the channel: adopt it; else back off and re-dial with a higher-generation grant",
    userFace: "none (transient)",
    audit: "cell: tp.door.refused",
  },
  {
    code: "CAPACITY",
    family: "connection-refusal",
    wire: "ConnectionRefused {code, retryable:true}",
    retryable: true,
    whoRetries: "runtime",
    how: "exponential backoff under maxConcurrentActivations; bounded by the recovery budget",
    userFace: "recovering face; UNAVAILABLE {reason: capacity} when exhausted",
    audit: "cell: tp.door.refused {capacity}",
  },
  // attach refusals
  {
    code: "ACTIVATION_CONFLICT",
    family: "attach-refusal",
    wire: "AttachRefused {code, retryable:true}",
    retryable: true,
    whoRetries: "runtime",
    how: "a pending/active activation of ours exists: attach again naming replacesActivationId",
    userFace: "none",
    audit: "cell: tp.attach.refused",
  },
  {
    code: "GRANT_GENERATION_ROLLBACK",
    family: "attach-refusal",
    wire: "AttachRefused {code, retryable:false}",
    retryable: false,
    whoRetries: "runtime",
    how: "re-mint via openTicket/renewAttach",
    userFace: "transient",
    audit: "cell: tp.attach.refused",
  },
  {
    code: "GRANT_NONCE_REPLAYED",
    family: "attach-refusal",
    wire: "AttachRefused {code, retryable:false}",
    retryable: false,
    whoRetries: "runtime",
    how: "re-mint",
    userFace: "transient",
    audit: "cell: tp.attach.refused {replay suspected}",
  },
  {
    code: "STALE_ROUTE",
    family: "attach-refusal",
    wire: "AttachRefused {code, retryable:true} (and 4000 at the door)",
    retryable: true,
    whoRetries: "runtime",
    how: "re-resolve: openTicket → new RouteBinding → new activation with replacesActivationId",
    userFace: "TC-D11 recovering face",
    audit: "cell: tp.attach.refused {stale-route}; fieldd: terminal.ticket.mint",
  },
  {
    code: "FENCED",
    family: "attach-refusal",
    wire: "AttachRefused {code, retryable:true}",
    retryable: true,
    whoRetries: "runtime",
    how: "the lease epoch moved: re-mint (the new grant carries the new leaseEpoch)",
    userFace: "recovering face",
    audit: "cell: tp.attach.refused {fenced}",
  },
  {
    code: "SESSION_UNKNOWN",
    family: "attach-refusal",
    wire: "AttachRefused {code, retryable:false}",
    retryable: false,
    whoRetries: "none",
    how: "the session is not on this cell (gone or migrated): re-resolve once; then UNAVAILABLE/NOT_FOUND",
    userFace: "UNAVAILABLE {reason: session-gone}",
    audit: "cell: tp.attach.refused",
  },
  {
    code: "CAPACITY",
    family: "attach-refusal",
    wire: "AttachRefused {code, retryable:true}",
    retryable: true,
    whoRetries: "runtime",
    how: "backoff under maxConcurrentActivations",
    userFace: "recovering face",
    audit: "cell: tp.attach.refused {capacity}",
  },
  // geometry refusals (answers, never closes)
  {
    code: "SEAT_HELD",
    family: "geometry-refusal",
    wire: "GeometryRefused {code, currentHolder, geometryRevision}",
    retryable: false,
    whoRetries: "none",
    how: "the host asks the holder to transfer (or S4 admin); never a retry loop",
    userFace: "the pane shows who holds geometry",
    audit: "cell: tp.geometry.refused",
  },
  {
    code: "STALE_REVISION",
    family: "geometry-refusal",
    wire: "GeometryRefused {code, geometryRevision}",
    retryable: true,
    whoRetries: "runtime",
    how: "re-read the revision and retry ONCE",
    userFace: "none",
    audit: "none",
  },
  {
    code: "NOT_HOLDER",
    family: "geometry-refusal",
    wire: "GeometryRefused {code}",
    retryable: false,
    whoRetries: "none",
    how: "a stale release/transfer from a previous mount — ignore",
    userFace: "none",
    audit: "none",
  },
  {
    code: "RIGHT_MISSING",
    family: "geometry-refusal",
    wire: "GeometryRefused {code}",
    retryable: false,
    whoRetries: "none",
    how: "the grant lacks `geometry`/`geometryAdmin`; a read-only view never claims",
    userFace: "none (the mirror is not a claimant by construction)",
    audit: "cell: tp.geometry.refused {right-missing}",
  },
  {
    code: "DESTINATION_INELIGIBLE",
    family: "geometry-refusal",
    wire: "GeometryRefused {code}",
    retryable: false,
    whoRetries: "none",
    how: "the transfer target holds no geometry-capable grant",
    userFace: "none",
    audit: "cell: tp.geometry.refused",
  },
  // seed-required reasons (outcomes, not failures)
  ...SeedRequiredReason.options.map(
    (code): FailureRow => ({
      code,
      family: "seed-required",
      wire: "FramesLegAttached.outcome {kind: seed-required, reason}",
      retryable: false,
      whoRetries: "cell",
      how: "the cell seeds (seed + one catch-up); the runtime shows the recovering face until presenting",
      userFace: "recovering face (TC-D11)",
      audit: "none (a normal outcome)",
    }),
  ),
  // close codes
  {
    code: "1008",
    family: "close-code",
    wire: "WebSocket close, pre-authentication, no body",
    retryable: false,
    whoRetries: "runtime",
    how: "re-mint ONCE; then UNAVAILABLE",
    userFace: "UNAVAILABLE {reason: transport-refused}",
    audit: "cell: tp.door.refused (the code stays cell-side)",
  },
  {
    code: "1001",
    family: "close-code",
    wire: "WebSocket close (going away)",
    retryable: true,
    whoRetries: "runtime",
    how: "the cell is shutting down: every activation → recovering; re-resolve the route",
    userFace: "recovering face",
    audit: "cell: tp.leg.closed {going-away}",
  },
  {
    code: "1011",
    family: "close-code",
    wire: "WebSocket close (server error)",
    retryable: true,
    whoRetries: "runtime",
    how: "re-dial under backoff; activations → recovering",
    userFace: "recovering face",
    audit: "cell: tp.leg.closed {server-error, detail}",
  },
  {
    code: "4000",
    family: "close-code",
    wire: "STALE_ROUTE",
    retryable: true,
    whoRetries: "runtime",
    how: "re-resolve via openTicket",
    userFace: "recovering face",
    audit: "cell: tp.leg.closed {stale-route}",
  },
  {
    code: "4001",
    family: "close-code",
    wire: "FENCED",
    retryable: true,
    whoRetries: "runtime",
    how: "re-mint (new lease epoch)",
    userFace: "recovering face",
    audit: "cell: tp.leg.closed {fenced}",
  },
  {
    code: "4002",
    family: "close-code",
    wire: "SUPERSEDED",
    retryable: false,
    whoRetries: "none",
    how: "a newer leg of ours owns the channel: nothing to retry; activations follow the new leg",
    userFace: "none",
    audit: "cell: tp.leg.closed {superseded, byGeneration}",
  },
  {
    code: "4003",
    family: "close-code",
    wire: "PROTOCOL",
    retryable: true,
    whoRetries: "runtime",
    how: "a malformed message (or trfIdentity/envelope mismatch): re-dial ONCE with a fresh activation; a second PROTOCOL close ⇒ UNAVAILABLE + a bug report line",
    userFace: "recovering, then UNAVAILABLE {reason: protocol}",
    audit: "both: tp.leg.closed {protocol, detail}",
  },
  {
    code: "4004",
    family: "close-code",
    wire: "LEG_TIMEOUT",
    retryable: true,
    whoRetries: "runtime",
    how: "heartbeat receipt deadline passed: re-dial; resume if a token is held",
    userFace: "recovering face",
    audit: "the detecting side: tp.leg.closed {timeout}",
  },
  // envelope decode errors (worker side)
  ...(
    [
      "short",
      "bad-magic",
      "bad-version",
      "header-too-large",
      "header-truncated",
      "header-not-utf8",
      "header-not-json",
      "header-invalid",
    ] as const
  ).map(
    (code): FailureRow => ({
      code,
      family: "envelope-decode",
      wire: "the worker closes the frames leg 4003 PROTOCOL",
      retryable: true,
      whoRetries: "runtime",
      how: "the charge of the undecodable message is still returned (law 1); the leg is re-dialed once",
      userFace: "recovering face",
      audit: "renderer: tp.envelope.rejected {error}",
    }),
  ),
];

/** Every code the wire can name, for the coverage test. */
export const FAILURE_CODES_UNDER_CONTRACT = {
  preAuth: PreAuthFailureCode.options,
  connectionRefusal: ConnectionRefusalCode.options,
  attachRefusal: AttachRefusalCode.options,
  geometryRefusal: GeometryRefusalCode.options,
  seedRequired: SeedRequiredReason.options,
  closeCodes: ["1001", "1008", "1011", "4000", "4001", "4002", "4003", "4004"],
} as const;
