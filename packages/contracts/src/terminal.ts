import { z } from "zod";
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

/** terminal.list result (the DeviceListResult precedent — result envelopes are
 * contracts shapes, never ad-hoc literals; EL6). */
export const TerminalListResult = z.object({ terminals: z.array(TerminalInfo) }).passthrough();
export type TerminalListResult = z.infer<typeof TerminalListResult>;

/** Shared params for terminal.get / terminal.openTicket / terminal.terminate. */
export const TerminalSessionParams = z.object({ sessionId: z.string().min(1) }).passthrough();
export type TerminalSessionParams = z.infer<typeof TerminalSessionParams>;

/** terminal.openTicket result (D6: v1 carries the single native service token —
 * per-client native tokens are the named ghosttea upgrade). Socket PATHS are
 * stable across fieldd restarts (external-mode law); the token rotates per
 * field-native boot and reaches fieldd on the pairing hello (NF-D8). Ticket
 * mints are audited per call. */
export const TerminalTicket = z
  .object({
    controlSocket: z.string(),
    frameSocket: z.string(),
    token: z.string(),
  })
  .passthrough();
export type TerminalTicket = z.infer<typeof TerminalTicket>;

/** terminal.connectTicket params — deliberately empty (GT-D10). A connection
 * is not a session, so there is nothing to name: the caller is asking for the
 * coordinates of THIS device's floor, which are the same for every holder of
 * the scope. Kept as an object rather than `void` so the method can grow a
 * device selector (D35) without a params-shape break. */
export const TerminalConnectTicketParams = z.object({}).passthrough();
export type TerminalConnectTicketParams = z.infer<typeof TerminalConnectTicketParams>;

/** terminal.connectTicket result (GT-D10 — the one-authority correction).
 *
 * `terminal.create` answers with a ticket because GT-1 needed the mint to
 * outrun the observed inventory, and the deck then used create as its DOOR:
 * every connection began by spawning a shell nobody asked for. The workspace
 * owns pane births now, so the deck needs a ticket and no session at all —
 * that is this method. `openTicket` keeps its observed gate for
 * attach-to-a-KNOWN-session (load-bearing in the seam and kill-matrix tests),
 * `create` keeps its nested mint for programmatic births (iOS, agents, tests);
 * this one mints for a connection, with no floor state to consult and none to
 * make. Same ticket shape, same scope, same per-call audited grant. */
export const TerminalConnectTicketResult = z.object({ ticket: TerminalTicket }).passthrough();
export type TerminalConnectTicketResult = z.infer<typeof TerminalConnectTicketResult>;

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
  })
  .passthrough();
export type TerminalCreateParams = z.infer<typeof TerminalCreateParams>;

/** terminal.create result. The `ticket` is GT-1's structural answer to the
 * GT-0 finding: `openTicket` gates on fieldd's OBSERVED inventory, a mgmt round
 * trip behind the spawn (62-117ms measured), so a caller that created and
 * immediately ticketed got NOT_FOUND for a session that certainly existed.
 * create does not have that problem — it KNOWS the session, having just made
 * it — so the mint happens here and the attach has no wait to retry through.
 * `openTicket` keeps its observed gate for attach-to-EXISTING flows, where the
 * inventory is the only honest proof the session is real. */
export const TerminalCreateResult = z
  .object({ sessionId: z.string(), ticket: TerminalTicket })
  .passthrough();
export type TerminalCreateResult = z.infer<typeof TerminalCreateResult>;

// -- The shell's Backend seam (GT-D3, design-03 A1). These two shapes are IPC,
// not product API: the renderer redeems a ticket over fieldd (the one product
// door, D27) and hands main the transport coordinates it cannot reach itself.
// Main holds no product logic behind them — a ticket in, a bridge status out.

/** main → renderer, unsolicited: the honest state of THIS window's bridge.
 * `bridge-down` is the moment of death, `bridge-up` a completed recovery on the
 * stored connection, `ticket-expired` the ladder's terminal state — main could
 * not rebuild and the renderer owes it a freshly redeemed ticket. */
export const TerminalBridgeStatus = z
  .object({
    state: z.enum(["bridge-up", "bridge-down", "ticket-expired"]),
    /** rebuild attempts spent reaching this state (0 on the first death) */
    attempts: z.number().int().nonnegative().optional(),
    /** why the ladder gave up — diagnostic only, never a control signal */
    detail: z.string().optional(),
  })
  .passthrough();
export type TerminalBridgeStatus = z.infer<typeof TerminalBridgeStatus>;

/** renderer → main invoke result. `attached` is true once the ports for THIS
 * document have been posted; a false would be a lie the renderer could not
 * detect, so every failure is an exception instead.
 *
 * `defaultShell` and `home` ride here because GT-D10 makes the WORKSPACE the
 * one authority over pane births, and its create doors take `executable` and
 * `cwd` from props the renderer must already hold. Neither value is knowable
 * in a sandboxed page — `SHELL`, `userInfo()` and `$HOME` are main's to read —
 * and both are needed BEFORE the workspace first mounts, because ghosttea's
 * initialization key is `storageKey ∥ defaultShell ∥ claimExistingSessions ∥
 * initialCwd`: a value that arrives late re-initializes the workspace and
 * creates a second pane. Answering them on the connect the deck already makes
 * is what lets the deck gate its first render on knowing them. */
export const TerminalBackendAttachResult = z
  .object({
    attached: z.boolean(),
    /** the user's real login shell — never `/bin/sh` (the `sh-3.2$` tombstone) */
    defaultShell: z.string().min(1),
    /** `$HOME`, which becomes the workspace's `initialCwd` */
    home: z.string().min(1),
  })
  .passthrough();
export type TerminalBackendAttachResult = z.infer<typeof TerminalBackendAttachResult>;

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
