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

/** terminal.create — the free-shell door (NF-D6: the user's $SHELL as a login
 * shell, inherit-minus-strip env). Agent PTYs are NOT born here — they come
 * from agent.spawn with clean+allowlist env; this method exists so plain PTYs
 * (pane deck, canvas terminals without an agent) have a product-plane birth. */
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

export const TerminalCreateResult = z.object({ sessionId: z.string() }).passthrough();
export type TerminalCreateResult = z.infer<typeof TerminalCreateResult>;

/** terminal.terminate — the full ladder (interrupt → 2s → SIGTERM pgrp → 2s →
 * SIGKILL pgrp) runs native-side; terminating an already-exited session is the
 * normal race and reads as success, never an error. */
export const TerminalTerminateParams = z.object({ sessionId: z.string() }).passthrough();
export type TerminalTerminateParams = z.infer<typeof TerminalTerminateParams>;
