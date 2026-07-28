import { z } from "zod";
import { SemverString } from "./envelope";

// Shell-boundary contracts (ESR spec §6.1): the shapes that cross the Electron
// seam — the daemon's on-disk discovery descriptor and the closed contextBridge
// IPC surface. TS-only by design (never in the Rust gen bundle): fieldd writes
// and Electron reads on the same machine. Channel names live in
// registries.IPC_CHANNELS; slice 4's bootstrap semantics evolve WindowConnection
// into the WindowBootstrap envelope (controlUrl instead of a bare port) — until
// that wire exists, only today's shapes ship (contracts describe reality).

/** `<dataRoot>/fieldd/run/product.json` — written by fieldd on boot, read by the
 * shell/supervisor for adopt-or-spawn (design-02 §3.6/D10). Tolerant: future
 * daemons may add fields; readers must survive them. */
export const ProductInfo = z
  .object({
    /** actual bound control port (ephemeral in tests — never inferred, always read) */
    port: z.number().int().positive(),
    pid: z.number().int().positive(),
    bootId: z.string().min(1),
    contractsVersion: SemverString,
    startedAt: z.number(),
    /** pid of the field-native the daemon ensured; null when native is disabled */
    nativePid: z.number().int().positive().nullable(),
    /** Development build identity. Production writes null; optional keeps
     * adoption compatible with product files written by older daemons. */
    buildId: z.string().min(1).max(128).nullable().optional(),
  })
  .passthrough();
export type ProductInfo = z.infer<typeof ProductInfo>;

/** Reply to the window-bootstrap invoke: the loopback control endpoint + the
 * per-window scoped token (D27 — main brokers this once, relays nothing). */
export const WindowConnection = z
  .object({
    port: z.number().int().positive(),
    token: z.string().min(1), // opaque bearer token, same treatment as hello credential
  })
  .passthrough();
export type WindowConnection = z.infer<typeof WindowConnection>;

export const CloseReason = z.enum(["window", "app-quit", "restart", "update"]);
export type CloseReason = z.infer<typeof CloseReason>;

/** main → renderer: drain the document session for a durable close. One attempt
 * active per window; requestId binds the eventual CloseResult to it. */
export const CloseRequest = z
  .object({
    requestId: z.string().min(1),
    reason: CloseReason,
  })
  .passthrough();
export type CloseRequest = z.infer<typeof CloseRequest>;

/** renderer → main: the drain verdict. `ok:false` carries an honest error and
 * keeps the window open for the user's Retry / Quit Without Saving decision. */
export const CloseResult = z
  .object({
    requestId: z.string().min(1),
    ok: z.boolean(),
    error: z.string().optional(),
  })
  .passthrough();
export type CloseResult = z.infer<typeof CloseResult>;
