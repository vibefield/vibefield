import { z } from "zod";
import { TerminalWorkloadClass } from "./envelope";
import { ObservedTerminal } from "./mgmt";

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
 * other half of the same honesty: fieldd never answers rows it has not seen. */
export const TerminalObservation = z
  .object({
    /** the native boot these rows were observed from */
    bootId: z.string(),
    /** last applied desired generation (0 = none since that boot) */
    generation: z.number().int(),
  })
  .passthrough();
export type TerminalObservation = z.infer<typeof TerminalObservation>;

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
    requestedTermination: z.enum(["user", "application", "service-shutdown"]).nullable(),
    exitOutcome: z
      .enum([
        "completed",
        "crashed",
        "signaled",
        "user-terminated",
        "application-terminated",
        "service-terminated",
        "unknown",
      ])
      .nullable(),
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
  })
  .passthrough();
export type TerminalCreateParams = z.infer<typeof TerminalCreateParams>;

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
export const TerminalTerminateParams = TerminalSessionParams;
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
// AFTER the user's own Ghostty files. These two methods are the product-plane
// door onto that one file, scoped `settings.manage` — the trusted desktop
// surface, never plugins, agents, or the tailnet.
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
  })
  .passthrough();
export type TerminalConfigWriteResult = z.infer<typeof TerminalConfigWriteResult>;
