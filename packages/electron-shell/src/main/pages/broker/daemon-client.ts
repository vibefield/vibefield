// EY-1 (2026-11-19) — THE PAGE ENGINE'S DAEMON CLIENT: how main speaks to the engine it runs. The
// engine's own client at v0.41.0 is the shape (connection.rs:1230-1273): one connection per
// command, ONE JSON line written, ONE line read back, then the connection closes. The reply is
// `{ success, data?, error?, code? }` (connection.rs:37-44). Main sends the checked command it was
// given and nothing else, never argv (EY-S2-01B measured this exchange).
//
// It never sends a command twice. A failure says what main can know of it:
// - `not-sent`: the socket refused or failed before the line was written, so the engine never saw
//   the command;
// - `outcome-unknown`: the line went out and no whole reply came back (the socket closed or
//   failed), so the engine may have acted. The engine's own CLI resends only read-only actions
//   (connection.rs:1118-1160); main resends nothing;
// - `timeout`: the call's deadline came first, with `written` saying whether the line went out;
// - `too-large`: the reply ran past its bound and was cut off unread;
// - `bad-reply`: the line was not a reply.

import { createConnection } from "node:net";
import { SURFACE_AUTHORITY_LIMITS } from "@vibefield/contracts";

/** What a reply may carry beyond the engine's output: its envelope (`success`, `error`, `code`). */
export const DAEMON_REPLY_ENVELOPE_BYTES = 4096;
/** A reply line's bound: the contract's output bound plus the envelope (shell.ts). */
export const DAEMON_REPLY_MAX_BYTES =
  SURFACE_AUTHORITY_LIMITS.CONTROL_OUTPUT_MAX_BYTES + DAEMON_REPLY_ENVELOPE_BYTES;

/** A command as the engine reads it: an id, an action, and the action's own fields. */
export interface PagesDaemonCommand {
  readonly id: string;
  readonly action: string;
  readonly [field: string]: unknown;
}

/** The engine's reply (connection.rs:37-44). */
export interface PagesDaemonResponse {
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
  readonly code?: string;
}

export type PagesDaemonFailure =
  | { readonly failure: "not-sent" }
  | { readonly failure: "outcome-unknown" }
  | { readonly failure: "timeout"; readonly written: boolean }
  | { readonly failure: "too-large" }
  | { readonly failure: "bad-reply" };

export type PagesDaemonExchange =
  | { readonly ok: true; readonly reply: PagesDaemonResponse }
  | ({ readonly ok: false } & PagesDaemonFailure);

/** The socket side the client uses: node's net.Socket in the product, a fake in a test. */
export interface DaemonSocket {
  write(data: string, done: (error?: Error | null) => void): boolean;
  on(event: "connect", listener: () => void): this;
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: () => void): this;
  destroy(): void;
}

export interface DaemonExchangeOptions {
  /** The call's deadline, in `now()`'s clock: the exchange ends by it, answered or not. */
  readonly deadlineAt: number;
  readonly now?: () => number;
  readonly connect?: (path: string) => DaemonSocket;
  readonly maxReplyBytes?: number;
}

const defaultConnect = (path: string): DaemonSocket => createConnection(path);

/** The engine CLI's id shape (commands.rs gen_id): "r" and the microseconds mod 1e6. */
export function daemonRequestId(now: () => number = Date.now): string {
  return `r${Math.floor(now() * 1000) % 1_000_000}`;
}

function parseReply(line: string): PagesDaemonResponse | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const reply = value as Record<string, unknown>;
  if (typeof reply.success !== "boolean") return null;
  if (reply.error !== undefined && typeof reply.error !== "string") return null;
  if (reply.code !== undefined && typeof reply.code !== "string") return null;
  return reply as unknown as PagesDaemonResponse;
}

/** One command, one reply: the exchange the engine's own CLI makes, bounded by the call's
 * deadline and by the reply's size. */
export function exchangeDaemon(
  path: string,
  command: PagesDaemonCommand,
  opts: DaemonExchangeOptions,
): Promise<PagesDaemonExchange> {
  const now = opts.now ?? Date.now;
  const max = opts.maxReplyBytes ?? DAEMON_REPLY_MAX_BYTES;
  const line = `${JSON.stringify(command)}\n`;
  return new Promise((resolve) => {
    let settled = false;
    let written = false;
    let socket: DaemonSocket | null = null;
    const chunks: Buffer[] = [];
    let bytes = 0;
    const done = (out: PagesDaemonExchange): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve(out);
    };
    const lost = (): PagesDaemonExchange =>
      written ? { ok: false, failure: "outcome-unknown" } : { ok: false, failure: "not-sent" };
    const timer = setTimeout(
      () => done({ ok: false, failure: "timeout", written }),
      Math.max(0, opts.deadlineAt - now()),
    );
    if (opts.deadlineAt <= now()) {
      done({ ok: false, failure: "timeout", written: false });
      return;
    }
    try {
      socket = (opts.connect ?? defaultConnect)(path);
    } catch {
      done({ ok: false, failure: "not-sent" });
      return;
    }
    socket.on("error", () => done(lost()));
    socket.on("close", () => done(lost()));
    socket.on("data", (chunk: Buffer) => {
      const at = chunk.indexOf(0x0a);
      const take = at < 0 ? chunk : chunk.subarray(0, at);
      bytes += take.length;
      if (bytes > max) {
        done({ ok: false, failure: "too-large" });
        return;
      }
      chunks.push(take);
      if (at < 0) return;
      const reply = parseReply(Buffer.concat(chunks).toString("utf8"));
      done(reply === null ? { ok: false, failure: "bad-reply" } : { ok: true, reply });
    });
    socket.on("connect", () => {
      // Written before the write: from here on, a failure cannot prove the engine never saw it.
      written = true;
      socket?.write(line, (error) => {
        if (error) done(lost());
      });
    });
  });
}

/** Whether the daemon's socket accepts a connection yet, polled until the deadline: the engine's
 * own readiness test (connection.rs:444-449). */
export async function daemonReady(
  path: string,
  opts: DaemonExchangeOptions & {
    readonly intervalMs?: number;
    readonly sleep?: (ms: number) => Promise<void>;
  },
): Promise<boolean> {
  const now = opts.now ?? Date.now;
  const connect = opts.connect ?? defaultConnect;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  while (now() < opts.deadlineAt) {
    const accepted = await new Promise<boolean>((resolve) => {
      let socket: DaemonSocket;
      try {
        socket = connect(path);
      } catch {
        resolve(false);
        return;
      }
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (accepted) return true;
    await sleep(opts.intervalMs ?? 50);
  }
  return false;
}
