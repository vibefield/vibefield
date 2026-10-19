import { z } from "zod";
import { AgentProfileSetId } from "./agent-index";
import { TerminalWorkloadClass } from "./envelope";
import { UnavailableDetails } from "./errors";
import { ObservedStaleCell, ObservedTerminal } from "./mgmt";

// The terminal floor's PRODUCT surface (native-floor spec §6, NF-D5). TS-only
// DELIBERATELY: these shapes ride fieldd's product API (renderers, peers via
// D35 device? routing) and never the mgmt channel — field-native has no
// consumer, so they stay out of the Rust gen bundle (the LOG-42
// deliberate-subset precedent; gen-jsonschema.ts documents exclusions).

/** terminal.list/get rows. v1 = the native inventory verbatim
 * (ObservedTerminal re-exported, reference-don't-remodel); the agent-session
 * join (tier, claims) arrives with the AR track and extends here. */
export const TerminalInfo = ObservedTerminal;
export type TerminalInfo = z.infer<typeof TerminalInfo>;

/** Which floor observation an inventory came from (GT-5b). fieldd learns the
 * inventory by subscribing to field-native's observed state, and that payload
 * carries the native `bootId` and the last applied desired `generation` —
 * which fieldd used to discard, keeping only the rows.
 *
 * They are here because a bare row list cannot answer "is this still true":
 * a consumer holding an inventory across a floor replacement sees the same
 * shape from a boot that no longer exists. The bootId names the boot the rows
 * belong to; a `list` whose bootId moved is a different floor's inventory, not
 * a changed one. Absent only alongside the `unobserved` refusal, which is the
 * other half of the same honesty: fieldd never answers rows it has not seen.
 *
 * IL-D4 (`draft/thinking-inventory-latency.md` §4.3) — and how old the rows
 * may be. A read answers with every row it holds and says which cells' rows
 * are older than the bound; one stale cell never hides another cell's rows
 * (IL-D5 (a)). `terminal.list` and `terminal.roster` both carry this shape. */
export const TerminalObservation = z
  .object({
    /** the native boot these rows were observed from */
    bootId: z.string(),
    /** last applied desired generation (0 = none since that boot) */
    generation: z.number().int(),
    /** the floor's inventory bound in ms (`ObservedState.inventoryBoundMs`).
     * ABSENT: the age is unknown — a floor that predates the bound, or a
     * fieldd that predates this field — and a reader says so. */
    boundMs: z.number().int().nonnegative().optional(),
    /** fieldd's composed view of the cells whose rows are older than
     * `boundMs`, present only while one is. It is the floor's own
     * `staleCells`, or, once the observed stream has not reached fieldd for
     * `TERMINAL_INVENTORY.STALE_MS` (the native link not `up`, or no floor
     * tick for `NATIVE_SUPERVISION.TICK_STALE_MS`), every cell fieldd knows,
     * each with `since` = the last observation delivered — except a cell the
     * floor had already named, which keeps the floor's own, older `since`, so
     * its age never moves back when the stream stops. */
    staleCells: z.array(ObservedStaleCell).optional(),
  })
  .passthrough();
export type TerminalObservation = z.infer<typeof TerminalObservation>;

/** IL-D2 (a) (`draft/thinking-inventory-latency.md` §4.4, ruled 2026-10-19) —
 * the terminal inventory's honest states, as `UnavailableDetails` spells them:
 * `service` on both, `unobserved` before fieldd's first observation of the
 * floor (GT-5b), and `inventory_stale` while the cells a door would act in
 * are older than the bound. The terminal vocabulary's snake_case
 * (`cell_gone`, `session_cap`). TS-only: fieldd writes both, the floor
 * neither. */
export const TERMINAL_INVENTORY_REFUSALS = {
  SERVICE: "terminal",
  STATE_UNOBSERVED: "unobserved",
  STATE_INVENTORY_STALE: "inventory_stale",
} as const;

/** IL-D2 (a), IL-D5 (a) — what a door that ACTS on the inventory answers
 * while it is stale: UNAVAILABLE {service: "terminal", state:
 * "inventory_stale", cells}, retryable. `cells` carries
 * `TerminalObservation.staleCells`' entries: for a session listed in a stale
 * cell, that cell; for an unlisted session, which no row ties to a cell (an
 * agent record names none), every stale cell. The doors, each refusing rather
 * than answering "does not exist" or guessing:
 *  - `terminal.get`, `openTicket` and `renewAttach`, for an unlisted session
 *    while any cell is stale;
 *  - terminate, automate and the mints (`openTicket`, `renewAttach`), for an
 *    untagged session no birth placed while any cell is stale (they would
 *    guess the interactive cell);
 *  - the agent runtime's resume and replace, for a session listed in a stale
 *    cell or unlisted while any cell is stale, before anything is terminated;
 *  - the update's point-of-effect census while any cell is stale, which
 *    reopens births.
 * Reads answer with the rows and their age instead. Where fieldd holds the
 * floor `unresponsive`, WG-D4's {service: "native", state: "unresponsive"}
 * answers instead (`NativeUnavailableDetails`), as {service: "terminal",
 * state: "unresponsive"} does for a cell that did not answer fieldd: the
 * worse and truer story wins. fieldd writes it; the floor never does
 * (`error-data.terminal-inventory-stale.json`). */
export const TerminalInventoryStaleDetails = UnavailableDetails.extend({
  service: z.literal(TERMINAL_INVENTORY_REFUSALS.SERVICE),
  state: z.literal(TERMINAL_INVENTORY_REFUSALS.STATE_INVENTORY_STALE),
  cells: z.array(ObservedStaleCell).min(1),
}).passthrough();
export type TerminalInventoryStaleDetails = z.infer<typeof TerminalInventoryStaleDetails>;

/** terminal.list result (the DeviceListResult precedent — result envelopes are
 * contracts shapes, never ad-hoc literals; EL6).
 *
 * An EMPTY `terminals` means "this floor holds no sessions", and it is a claim
 * fieldd may only make about a floor it has actually observed — before the
 * first snapshot applies, `terminal.list` REFUSES with
 * `UNAVAILABLE {service:"terminal", state:"unobserved"}` rather than answering
 * `[]` (GT-5b). The empty answer used to be indistinguishable from an unarmed
 * inventory, and a restore flow reading it concluded every saved pane was dead
 * — for sessions that were alive on a field-native the restarted fieldd had
 * simply not re-subscribed to yet. */
export const TerminalListResult = z
  .object({
    terminals: z.array(TerminalInfo),
    /** the observation these rows came from; absent on a pre-GT-5b daemon */
    observation: TerminalObservation.optional(),
  })
  .passthrough();
export type TerminalListResult = z.infer<typeof TerminalListResult>;

/** Shared params for terminal.get / terminal.openTicket / terminal.terminate. */
export const TerminalSessionParams = z.object({ sessionId: z.string().min(1) }).passthrough();
export type TerminalSessionParams = z.infer<typeof TerminalSessionParams>;

/** DS-4 (design-06 §6; design-04 §6's `device?` convention) — the params of a
 * terminal door the caller may ROUTE to the device that owns the session:
 * `terminal.openTicket` and `terminal.terminate` here, `terminal.renewAttach`
 * beside its grant (terminal-pipeline.ts). `device` absent, or naming this
 * device, serves here; naming another forwards the call whole to the owner
 * (locality `federate`), which mints and acts from ITS OWN rule. The caller's
 * daemon then carries a forwarded ticket's doors onto an egress route of its
 * own (fieldd `remote-cell-rewriter.ts`). */
export const TerminalRoutableSessionParams = TerminalSessionParams.extend({
  device: z.string().min(1).optional(),
}).passthrough();
export type TerminalRoutableSessionParams = z.infer<typeof TerminalRoutableSessionParams>;

/** terminal.openTicket params — routable (DS-4). */
export const TerminalOpenTicketParams = TerminalRoutableSessionParams;
export type TerminalOpenTicketParams = z.infer<typeof TerminalOpenTicketParams>;

/** DS-4e (2026-10-01) — `terminal.sessions {device?}`: the exact engine
 * summaries (`TerminalRuntimeSessionsResult`), routable to the device that
 * owns them like the ticket. A window mounts another desktop's session by the
 * OWNER's decimal `handle` (see `TerminalRuntimeSession` below), which no
 * other answer carries; `device` absent, or naming this device, reads here. */
export const TerminalSessionsParams = z
  .object({ device: z.string().min(1).optional() })
  .passthrough();
export type TerminalSessionsParams = z.infer<typeof TerminalSessionsParams>;

/** DS-4 — `terminal.takeGeometry {sessionId}`: the TAKE (TPv3 §6 amended
 * 2026-09-30, DS-D5's note — the last focused pane holds the geometry) as a
 * PRODUCT door, for a host that cannot speak a cell's control leg: the phone's
 * kit, whose `FieldRoutedTerminal` has no lease verbs yet (DS-4b). A routed
 * runtime takes over its own control leg — one `TransferGeometry` to itself —
 * and never calls this. DECLARED, NOT SERVED: fieldd answers `UNAVAILABLE
 * {service: "terminal", state: "not_implemented"}` until DS-4b designs its
 * half (which activation the door takes for, and what it answers). */
export const TerminalTakeGeometryParams = z.object({ sessionId: z.string().min(1) }).passthrough();
export type TerminalTakeGeometryParams = z.infer<typeof TerminalTakeGeometryParams>;

/** RETIRED at TP-S3e (2026-08-23). The legacy bridge trio
 * (`{controlSocket, frameSocket, token}` — `TerminalTicket`) and the
 * sessionless `terminal.connectTicket` method died with the
 * `ghosttea-terminal-bridge` utility process: the renderer's only transport is
 * the routed T1 door pair, addressed by `TerminalOpenTicket.endpoints` and
 * authenticated by its grants (terminal-pipeline.ts). The UDS coordinates the
 * trio carried remain FIELDD's own transport (`TerminalEndpoints`,
 * envelope.ts — NF-D8); they simply never reach a renderer again. A keyless
 * floor (no grant key on the route row) now yields NO ticket, and the reader
 * shows `UNAVAILABLE {reason: transport-not-landed}` — the honest §5.1 answer
 * a half ticket used to paper over. */

/**
 * The renderer-runtime inventory carried by `terminal.sessions`.
 *
 * This is deliberately the Ghosttea `SessionSummary` wire shape, named at our
 * product boundary rather than cast in the renderer.  The routed runtime needs
 * the engine's decimal `handle` before it can mount a surface: a product roster
 * row cannot stand in for it, and synthesising one would make the worker reject
 * the first `FramesLegAttached` identity.  Keeping this schema here also makes
 * an upstream summary-shape change fail our type/build gates at the adapter.
 */
/** ghosttea's exit-fact enums (kebab-case wire forms), named ONCE — the roster
 * summary below and the TP `SessionEvent` verb (terminal-pipeline.ts, TP-S3f)
 * carry the same facts in the same spelling. */
export const TerminalTerminationSource = z.enum(["user", "application", "service-shutdown"]);
export type TerminalTerminationSource = z.infer<typeof TerminalTerminationSource>;

export const TerminalExitOutcome = z.enum([
  "completed",
  "crashed",
  "signaled",
  "user-terminated",
  "application-terminated",
  "service-terminated",
  "unknown",
]);
export type TerminalExitOutcome = z.infer<typeof TerminalExitOutcome>;

export const TerminalSessionActivity = z
  .object({
    kind: z.enum(["shell-idle", "foreground-job", "unknown"]),
    source: z.enum(["shell-integration", "process-group", "unsupported"]),
    confidence: z.enum(["authoritative", "heuristic"]),
    rootProcessGroupId: z.number().int().nullable(),
    foregroundProcessGroupId: z.number().int().nullable(),
    observedAtMs: z.number().int().nonnegative(),
  })
  .passthrough();
export type TerminalSessionActivity = z.infer<typeof TerminalSessionActivity>;

export const TerminalRuntimeSession = z
  .object({
    id: z.string().min(1),
    /** ghosttea/TRF1 u64, represented as decimal text on JSON wires */
    handle: z.string().regex(/^(0|[1-9][0-9]*)$/),
    executable: z.string(),
    cols: z.number().int().nonnegative(),
    rows: z.number().int().nonnegative(),
    exited: z.boolean(),
    readWrite: z.boolean(),
    title: z.string().nullable(),
    cwd: z.string().nullable(),
    bellCount: z.number().int().nonnegative(),
    pid: z.number().int().nullable(),
    createdAtMs: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    exitSignal: z.string().nullable(),
    requestedTermination: TerminalTerminationSource.nullable(),
    exitOutcome: TerminalExitOutcome.nullable(),
    ownerId: z.string().nullable(),
    persistence: z
      .enum(["terminate-with-app", "keep-until-exit", "keep-until-explicit-close"])
      .nullable(),
    scrollbackBytes: z.number().int().nonnegative().nullable().optional(),
    activity: TerminalSessionActivity,
  })
  .passthrough();
export type TerminalRuntimeSession = z.infer<typeof TerminalRuntimeSession>;

export const TerminalRuntimeSessionsResult = z
  .object({ sessions: z.array(TerminalRuntimeSession) })
  .passthrough();
export type TerminalRuntimeSessionsResult = z.infer<typeof TerminalRuntimeSessionsResult>;

/** terminal.create — the free-shell door (NF-D6: the user's $SHELL as a login
 * shell, inherit-minus-strip env). Agent PTYs are NOT born here — they come
 * from agent.spawn with clean+allowlist env; this method exists so plain PTYs
 * (iOS, agents, tests) have a product-plane birth. Since GT-D10 the pane deck
 * is NOT among its callers: the workspace creates its own panes. */
export const TerminalCreateParams = z
  .object({
    cwd: z.string().optional(),
    /** absolute shell path; default = the user's login shell */
    shell: z.string().optional(),
    title: z.string().optional(),
    /** ghosttea persistence-policy name, opaque passthrough. Default =
     * keep-until-exit (NF-D3: daemon-lifetime is the product promise). */
    persistence: z.string().optional(),
    /** TC-D6(c) — workload class selects the scrollback byte cap (agents <
     * interactive; scrollback is ~92% of a loaded session's memory, measured)
     * — and, since TC-S3, WHICH CELL hosts the session (the placement hint).
     * Absent = "interactive", the generous cap — the tolerant-reader default. */
    workloadClass: TerminalWorkloadClass.optional(),
    /** SB-2 (AR-7g) — the Agent Profile the shell is born under: fieldd
     * expands the set to its sign-ins and the shell inherits their binding
     * environment (opaque to VibeField, AR-L1), so an agent typed there runs
     * on that profile's accounts. The native set binds nothing and is still
     * a bound birth. A caller must ALSO hold `agent.spawn` (EL7). Absent = an
     * unbound shell, exactly as before — which is also what a fieldd older
     * than this field does with it (the object passes it through unread). */
    profileSet: AgentProfileSetId.optional(),
  })
  .passthrough();
export type TerminalCreateParams = z.infer<typeof TerminalCreateParams>;

/** SB-2 — one shell fieldd birthed under an Agent Profile: the session and the
 * set. Never the variables (they are the set's to hold and a shell's to
 * inherit; nothing of them is recorded). */
export const TerminalBinding = z
  .object({
    sessionId: z.string().min(1),
    profileSet: AgentProfileSetId,
    /** when fieldd recorded the birth (ISO 8601) */
    boundAt: z.string(),
  })
  .passthrough();
export type TerminalBinding = z.infer<typeof TerminalBinding>;

/** SB-2 — `users/<fuid>/fieldd/terminal-bindings.json` (LAYOUT
 * `TERMINAL_BINDINGS_FILE`), fieldd-owned and private (0600): which shells
 * were born bound. Nothing below fieldd can hold it — the floor's session
 * options carry an owner label and nothing else — and the floor outlives
 * fieldd, so the record is on disk: a restarted fieldd still reports a
 * surviving shell's profile, and prunes the rows whose sessions are gone. A
 * reader keeps each row that parses and sets aside each that does not. */
export const TerminalBindingsFile = z
  .object({
    version: z.literal(1),
    bindings: z.array(TerminalBinding),
  })
  .passthrough();
export type TerminalBindingsFile = z.infer<typeof TerminalBindingsFile>;

/** TC-D6(c) — the per-class scrollback caps live in the genned registry (one
 * authority both planes read); re-exported here beside the param they govern. */
export { TERMINAL_SCROLLBACK_CLASS_BYTES } from "./registries";

/** TC-D6(d) — the per-pair session cap at the product create seam. The
 * machine-wide admission ledger (TC-L1f, native side) is the custody authority
 * beneath it, and kernel refusal remains the final one; this is the policy
 * gate in front of both. 100 matches TC-G6's measured envelope. */
export const TERMINAL_SESSION_CAP = 100;

/** terminal.create result. GT-1's structural point survives the bridge it was
 * born for: `openTicket` gates on fieldd's OBSERVED inventory (a mgmt round
 * trip behind the spawn, 62-117ms measured), while create KNOWS the session it
 * just made — so the birth answers atomically with the authoritative runtime
 * summary, and the routed ticket for the first activation is primed from it
 * (TP-S3-production). The legacy nested bridge `ticket` retired at TP-S3e;
 * the spread `TerminalOpenTicket` fields ride `TerminalCreateOpenResult`
 * (terminal-pipeline.ts). */
export const TerminalCreateResult = z
  .object({
    sessionId: z.string(),
    session: TerminalRuntimeSession,
  })
  .passthrough();
export type TerminalCreateResult = z.infer<typeof TerminalCreateResult>;

// -- The shell's Backend seam (GT-D3) RETIRED at TP-S3e (2026-08-23): the
// `ghosttea-terminal-bridge` utility process, its `TerminalBridgeStatus` IPC
// and the `terminal.connect` attach (`TerminalBackendAttachResult`) are gone —
// the renderer dials the cells' T1 doors itself, and the login-shell/home
// policy those shapes carried rides the authenticated window bootstrap
// (`WindowTerminalBootstrap`, shell.ts) instead.

/** terminal.terminate — the full ladder (interrupt → 2s → SIGTERM pgrp → 2s →
 * SIGKILL pgrp) runs native-side. */
export const TerminalTerminateParams = TerminalRoutableSessionParams;
export type TerminalTerminateParams = z.infer<typeof TerminalTerminateParams>;

/** terminal.terminate result. `terminated: true` = the ladder was fired for a
 * session the floor knew; `false` = the session was ALREADY GONE (the normal
 * race when a ladder and a user click converge — the desired end state holds,
 * so the call still succeeds). A floor that cannot be asked (dead socket,
 * absent endpoints) is an UNAVAILABLE error, never a false — the review's
 * transport-death-reads-as-benign class (NF-6). */
export const TerminalTerminateResult = z.object({ terminated: z.boolean() }).passthrough();
export type TerminalTerminateResult = z.infer<typeof TerminalTerminateResult>;

// -- The `config.ghostty` surface (GT-3 rider). Config belongs to whoever owns
// the daemon, and that is us: field-native points its embedded service at
// `<its data dir>/config.ghostty` (registries FILES), loaded as an overlay
// AFTER the user's own Ghostty files. These methods are the product-plane
// door onto that one file, scoped `settings.manage` — the trusted desktop
// surface, never plugins, agents, or the tailnet. GT-7 added the third, the
// DRY RUN (`terminal.config.validate`): the loader reads a candidate text in
// the overlay's place and says what it would make of it, writing nothing —
// ghosttea's own `validate-config-document`, forwarded.
//
// The floor's OWN document API is what runs underneath: it reads and replaces
// the overlay atomically (same-directory temp + fsync + revision recheck) and
// reloads in the same operation. fieldd therefore does no file IO and derives
// no path — it asks the service, which is the one authority for where the file
// is and the only process that may write it while sessions are live.

/** terminal.config.read params — empty, like connectTicket: there is one
 * app-owned overlay per device and the caller is asking for it. Parsed by the
 * handler (GT-5b), on connectTicket's reasoning and with the same `?? {}`. */
export const TerminalConfigReadParams = z.object({}).passthrough();
export type TerminalConfigReadParams = z.infer<typeof TerminalConfigReadParams>;

/** One thing the config loader has to say about the text it just read. Ghostty
 * syntax is permissive — an unknown key is a diagnostic, not a refusal — so a
 * write can succeed and reload while the loader still has complaints, and
 * hiding them would make the panel claim more than it knows (EL5). */
export const TerminalConfigDiagnostic = z
  .object({
    severity: z.string(),
    code: z.string(),
    message: z.string(),
    source: z.string().optional(),
    line: z.number().optional(),
    key: z.string().optional(),
  })
  .passthrough();
export type TerminalConfigDiagnostic = z.infer<typeof TerminalConfigDiagnostic>;

/** Where the loader read settings from, in load order: the user's own Ghostty
 * files first, anything they include, and our overlay LAST, which is why it
 * wins (ghosttea `ConfigSourceKind`: `ghostty-default` · `included` ·
 * `ghosttea-overlay`). `kind` stays a string so a kind the next ghosttea adds
 * is shown, not refused. */
export const TerminalConfigSource = z
  .object({
    path: z.string(),
    kind: z.string(),
  })
  .passthrough();
export type TerminalConfigSource = z.infer<typeof TerminalConfigSource>;

/** A key the loaded text sets, and what this terminal does with it — ghosttea's
 * own classification, the only public view of it: `applied` (it changes what a
 * terminal draws or keeps), `parsed` (read and kept, not honoured on the
 * desktop yet — the fonts), `unsupported` (a Ghostty key this terminal
 * recognizes and ignores). `occurrences` counts every layer, overlay included. */
export const TerminalConfiguredKey = z
  .object({
    key: z.string(),
    support: z.string(),
    occurrences: z.number(),
  })
  .passthrough();
export type TerminalConfiguredKey = z.infer<typeof TerminalConfiguredKey>;

/** One effective keybinding, in Ghostty's own spelling (`super+k` · `clear_screen`). */
export const TerminalConfigKeybinding = z
  .object({
    trigger: z.string(),
    action: z.string(),
  })
  .passthrough();
export type TerminalConfigKeybinding = z.infer<typeof TerminalConfigKeybinding>;

/** One palette entry the layers set (sparse: an index nobody set is absent and
 * the terminal draws Ghostty's default for it). */
export const TerminalConfigPaletteEntry = z
  .object({
    index: z.number().int().min(0).max(255),
    /** `#rrggbb` */
    color: z.string(),
  })
  .passthrough();
export type TerminalConfigPaletteEntry = z.infer<typeof TerminalConfigPaletteEntry>;

/** The loader's snapshot of every layer together (GT-7), reduced to what the
 * product draws: which files were read and in what order, what the loader said
 * about each line, which keys the text sets and whether this terminal honours
 * them, and the effective values Settings shows as facts. It is ghosttea's
 * `ConfigSnapshot` projected — a VibeField shape, so an upstream field that
 * nobody here reads never becomes a wire promise. */
export const TerminalConfigSnapshot = z
  .object({
    /** the effective configuration's revision (moves when anything effective does) */
    revision: z.string(),
    /** the Ghostty release whose key schema the loader speaks (`1.3.1`) */
    ghosttyVersion: z.string(),
    /** how many Ghostty keys that schema knows */
    knownKeyCount: z.number(),
    sources: z.array(TerminalConfigSource),
    diagnostics: z.array(TerminalConfigDiagnostic),
    configuredKeys: z.array(TerminalConfiguredKey),
    keybindings: z.array(TerminalConfigKeybinding),
    /** a `keybind = clear` removed Ghostty's defaults before these */
    clearKeybindings: z.boolean(),
    /** bytes of scrollback a NEW terminal keeps (the floor reads it at spawn) */
    scrollbackBytes: z.number(),
    palette: z.array(TerminalConfigPaletteEntry),
    /** what the layers ask for — parsed, not honoured on the desktop (see support) */
    fontSize: z.number(),
    fontFamilies: z.array(z.string()),
    /** GT-8a — whether terminals find links in their output (Ghostty's
     * `link-url`; an OSC 8 link is a link either way). Optional: a floor whose
     * ghosttea predates the key (0.11.1) does not send it, and absent means the
     * loader said nothing — a reader shows Ghostty's default, which is on. */
    linkUrl: z.boolean().optional(),
  })
  .passthrough();
export type TerminalConfigSnapshot = z.infer<typeof TerminalConfigSnapshot>;

/** The overlay as it stands. `exists: false` with empty `text` is a NORMAL
 * state, not an error — ghosttea treats a not-yet-created overlay as a valid
 * empty config (verified in the pinned loader: the explicit path joins the
 * source list marked optional), so nothing has to create the file to read it.
 * `revision` is the loader's own hash of the exact bytes; a write must hand it
 * back, which is what makes a lost update impossible rather than unlikely. */
export const TerminalConfigDocument = z
  .object({
    path: z.string(),
    text: z.string(),
    revision: z.string(),
    exists: z.boolean(),
    /** GT-7: the loader's snapshot of the document as saved, every layer with
     * it — so a reader sees the diagnostics and the load order before any
     * edit. Optional on the wire: an older fieldd does not send it. */
    config: TerminalConfigSnapshot.optional(),
  })
  .passthrough();
export type TerminalConfigDocument = z.infer<typeof TerminalConfigDocument>;

/** terminal.config.write params. `revision` is the one the reader was handed;
 * a stale one is CONFLICT with the current document, never a silent clobber. */
export const TerminalConfigWriteParams = z
  .object({
    text: z.string(),
    revision: z.string(),
  })
  .passthrough();
export type TerminalConfigWriteParams = z.infer<typeof TerminalConfigWriteParams>;

/** terminal.config.write result — the service's own verdict, not our summary.
 *
 * `ok` is the loader's acceptance of the reloaded config (no error-severity
 * diagnostic), NOT "the bytes reached the disk": a written file that the loader
 * rejects is a real state a user must see, and it is not a failed call.
 * `effectiveChanged` answers "did anything actually move" — a comment-only edit
 * reloads honestly and changes nothing, and saying so beats implying a restyle
 * that never happened. It is DERIVED, because the service computes the same bit
 * internally (to decide whether to push `config-changed`) and then does not put
 * it on the wire: fieldd compares the effective-config revision it held before
 * the write with the one the write answered — the service's own comparison,
 * made one level up. */
export const TerminalConfigWriteResult = z
  .object({
    ok: z.boolean(),
    document: TerminalConfigDocument,
    effectiveChanged: z.boolean(),
    diagnostics: z.array(TerminalConfigDiagnostic),
    /** GT-7: the snapshot the write's own reload produced */
    config: TerminalConfigSnapshot.optional(),
  })
  .passthrough();
export type TerminalConfigWriteResult = z.infer<typeof TerminalConfigWriteResult>;

/** terminal.config.validate params (GT-7) — the candidate text, nothing else:
 * it is loaded in the overlay's place and never written. */
export const TerminalConfigValidateParams = z
  .object({
    text: z.string(),
  })
  .passthrough();
export type TerminalConfigValidateParams = z.infer<typeof TerminalConfigValidateParams>;

/** terminal.config.validate result (GT-7): what the loader would make of the
 * candidate, and whether Settings may save it.
 *
 * TWO RULES decide a save, and the write re-checks both (a stale page cannot
 * talk its way past them):
 * - **includes**: the text may keep the document's `config-file` queue exactly
 *   or clear it, never restructure it. Otherwise the loader would read any file
 *   the text names — validation would become a file-read door. A refused text
 *   is NOT loaded: `includesAllowed` is false and `config` is absent. Includes
 *   are edited in the file itself (ghosttea's desktop rule, adopted whole).
 * - **blocking**: every error in this document blocks; an error from an
 *   inherited layer (the user's Ghostty file) blocks only when this text adds
 *   another occurrence of it — a Ghostty mistake the user made elsewhere must
 *   not make VibeField's own file read-only.
 *
 * `documentRevision` is the saved document the validation read against; a save
 * still hands its own read revision, so this is information, not a lease. */
export const TerminalConfigValidation = z
  .object({
    documentRevision: z.string(),
    includesAllowed: z.boolean(),
    blocking: z.array(TerminalConfigDiagnostic),
    config: TerminalConfigSnapshot.optional(),
  })
  .passthrough();
export type TerminalConfigValidation = z.infer<typeof TerminalConfigValidation>;

/** Why a write was refused before it touched the disk (GT-7) — the details of a
 * PRECONDITION_FAILED from `terminal.config.write`. */
export const TerminalConfigWriteRefusal = z
  .object({
    reason: z.enum(["includes-changed", "blocking-errors"]),
    blocking: z.array(TerminalConfigDiagnostic),
  })
  .passthrough();
export type TerminalConfigWriteRefusal = z.infer<typeof TerminalConfigWriteRefusal>;

/** The details of a CONFLICT from `terminal.config.write` (GT-7): the document
 * as it stands now, so a page can show what moved instead of only "reload". */
export const TerminalConfigConflict = z
  .object({
    current: TerminalConfigDocument,
  })
  .passthrough();
export type TerminalConfigConflict = z.infer<typeof TerminalConfigConflict>;

// -- The include queue (GT-7). The loader's small `config-file` grammar, and
// only that: each line whose key is `config-file` either QUEUES a path
// (`path`, `"path"`, `?path`, `?"path"` — `?` marks it optional) or, bare,
// RESETS the queue. One implementation, two callers: fieldd enforces the rule
// on validate and on write; Settings predicts it so the editor can say so
// before a round trip. Mirrors ghosttea's desktop `configDocumentIncludes`.

export type TerminalConfigIncludeOp =
  | { kind: "include"; path: string; optional: boolean }
  | { kind: "reset" };

export function terminalConfigIncludeOps(text: string): TerminalConfigIncludeOp[] {
  const ops: TerminalConfigIncludeOp[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const separator = raw.indexOf("=");
    if (separator < 0 || raw.slice(0, separator).trim() !== "config-file") continue;
    const rawValue = raw.slice(separator + 1).trim();
    const quoted = rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"');
    let value = quoted ? rawValue.slice(1, -1) : rawValue;
    if (!quoted && value === "") {
      ops.push({ kind: "reset" });
      continue;
    }
    let optional = false;
    if (!quoted && value.startsWith("?")) {
      optional = true;
      value = value.slice(1);
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
        value = value.slice(1, -1);
    }
    if (value) ops.push({ kind: "include", path: value, optional });
  }
  return ops;
}

/** The paths the queue ends up holding (a reset empties it). */
export function terminalConfigIncludes(text: string): Set<string> {
  const includes = new Set<string>();
  for (const op of terminalConfigIncludeOps(text)) {
    if (op.kind === "reset") includes.clear();
    else includes.add(op.path);
  }
  return includes;
}

/** The includes rule: `candidate` keeps `current`'s queue operation for
 * operation, or includes nothing at all. Reordering or swapping paths counts as
 * a change — an included file can reset entries after it, so a reorder could
 * read a file the saved document never did. */
export function terminalConfigIncludesAllowed(current: string, candidate: string): boolean {
  const before = terminalConfigIncludeOps(current);
  const after = terminalConfigIncludeOps(candidate);
  const unchanged =
    before.length === after.length &&
    before.every((op, index) => {
      const next = after[index];
      if (next === undefined || op.kind !== next.kind) return false;
      return (
        op.kind === "reset" ||
        (next.kind === "include" && op.path === next.path && op.optional === next.optional)
      );
    });
  return unchanged || terminalConfigIncludes(candidate).size === 0;
}

/** The largest document Settings may save or import — the loader's own limit
 * (ghosttea `MAX_CONFIG_DOCUMENT_BYTES`), so a refusal happens before a round
 * trip rather than inside the floor. */
export const TERMINAL_CONFIG_MAX_BYTES = 64 * 1024;

// -- The file actions (GT-7): three product methods, each reaching the native
// dialog or the file manager through the scoped `shell.*` provider (ESR §6.2:
// shell-native capabilities enter there, never as new preload channels).
// fieldd owns the file IO on both sides of a dialog, bounded to the loader's
// own limit, and nothing here writes the overlay: an import lands in the
// editor as a draft and goes through `terminal.config.write` like any edit.

/** terminal.config.import result: the user picks a file (a native open
 * dialog); its text (a regular file, UTF-8, at most TERMINAL_CONFIG_MAX_BYTES)
 * comes back for the editor. */
export const TerminalConfigImportResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("cancelled") }).passthrough(),
  z.object({ status: z.literal("imported"), path: z.string(), text: z.string() }).passthrough(),
]);
export type TerminalConfigImportResult = z.infer<typeof TerminalConfigImportResult>;

/** terminal.config.export params: the text to save (the editor's, saved or
 * not) — written where the user's native save dialog says, audited by size. */
export const TerminalConfigExportRequest = z
  .object({
    text: z.string(),
  })
  .passthrough();
export type TerminalConfigExportRequest = z.infer<typeof TerminalConfigExportRequest>;

export const TerminalConfigExportResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("cancelled") }).passthrough(),
  z.object({ status: z.literal("exported"), path: z.string(), bytes: z.number() }).passthrough(),
]);
export type TerminalConfigExportResult = z.infer<typeof TerminalConfigExportResult>;

/** Reveal: the overlay (or, before it exists, its folder) shown in the file
 * manager. fieldd takes the path from the floor's own document — the caller
 * names nothing. */
export const TerminalConfigRevealResult = z
  .object({
    revealed: z.boolean(),
    path: z.string(),
  })
  .passthrough();
export type TerminalConfigRevealResult = z.infer<typeof TerminalConfigRevealResult>;

// -- Terminal links (GT-8a, GT-D22). ghosttea's runtime finds links in a pane's
// output and, on ⌘-click, hands the host the URL; `terminal.link.open` is where
// VibeField decides what that click may do. The policy is VibeField's own and
// stricter than ghosttea desktop's, because a same-uid agent can print any link
// and one click must never run anything (EL7): an `http:` or `https:` link
// opens in the default browser, a `file:` link naming an absolute path on this
// device is SHOWN in the file manager and never opened (opening a `.command` or
// an app would run it), and every other link is refused. fieldd holds the rule
// (its `terminal-links.ts`); these are the door's wire shapes.

/** The longest link the door reads — ghosttea's own bound for a link it will
 * show (`terminalLinkUrl`), so every link the terminal can offer reaches the
 * policy instead of a length check. */
export const TERMINAL_LINK_MAX_CHARS = 8192;

/** terminal.link.open params: the link as the terminal found it. */
export const TerminalLinkOpenParams = z
  .object({ url: z.string().min(1).max(TERMINAL_LINK_MAX_CHARS) })
  .passthrough();
export type TerminalLinkOpenParams = z.infer<typeof TerminalLinkOpenParams>;

/** What the click did: a web link `opened` in the browser, a file link
 * `revealed` in the file manager. A refused link is a PRECONDITION_FAILED,
 * never an outcome — nothing happened. */
export const TerminalLinkOpenResult = z
  .object({ outcome: z.enum(["opened", "revealed"]) })
  .passthrough();
export type TerminalLinkOpenResult = z.infer<typeof TerminalLinkOpenResult>;
