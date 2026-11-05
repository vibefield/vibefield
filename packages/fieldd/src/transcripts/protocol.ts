// TH-1 (TH0-Q5 (b)) — fieldd ⇄ the transcript worker, on the worker's IPC pipe (Node's `process.send`, advanced
// serialization off): the files worker's shape (workspace/protocol.ts), smaller. No transcript byte rides it (EL2):
// fieldd hands the worker the folder's key and each ticket, and nudges it when a run's file grew; the worker reads the
// spark's folder itself and serves the window on its own loopback socket.
//
// fieldd → worker:
// - `init` once, first: the folder the sparks' transcripts stand in, the key their lines are MAC'd under (base64,
//   never in the worker's environment, EL7), the Origins a window may send, and the generation it serves as;
// - `req {id, op, args}`, answered by one `res {id, ok, value | error}`;
// - `appended {spark, run}`: a line was written to that run's file (the tail's nudge, ids only);
// - `shutdown`.
// worker → fieldd: `ready {pid, port}` once its listener is up; `res`; `log`; `fatal {reason}` (it cannot serve, and
// leaves).

/** The listener's one path: a window's endpoint is `ws://127.0.0.1:<port>/transcripts`. */
export const TRANSCRIPT_PATH = "/transcripts";

/** A ticket as fieldd mints it: single use, for one spark's folder, redeemable until `expiresAt` (ms). */
export interface TicketRegistration {
  readonly ticket: string;
  readonly spark: string;
  /** the window token's id, so a revoked window's sockets close */
  readonly clientId: string;
  readonly expiresAt: number;
}

export interface HostOps {
  registerTicket: { args: TicketRegistration; value: { port: number } };
  closeTicket: { args: { clientId: string; ticket: string }; value: boolean };
  revokeClient: { args: { clientId: string }; value: null };
}
export type HostOp = keyof HostOps;

/** A refusal the worker answered: `busy` (no slot), `invalid` (a ticket it will not hold), `internal`. */
export interface HostError {
  readonly code: "busy" | "invalid" | "internal";
  readonly message: string;
}

export type ToHost =
  | {
      t: "init";
      key: string;
      dir: string;
      allowedOrigins: readonly string[];
      generation: number;
    }
  | { t: "req"; id: number; op: HostOp; args: unknown }
  | { t: "appended"; spark: string; run: string }
  | { t: "shutdown" };

export type FromHost =
  | { t: "ready"; pid: number; port: number }
  | { t: "res"; id: number; ok: true; value: unknown }
  | { t: "res"; id: number; ok: false; error: HostError }
  | {
      t: "log";
      level: "info" | "warn";
      event: string;
      message: string;
      fields?: Record<string, unknown>;
    }
  | { t: "fatal"; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A worker message fieldd reads, or null: a worker of fieldd's own is still read as untrusted bytes. */
export function readFromHost(raw: unknown): FromHost | null {
  if (!isRecord(raw)) return null;
  switch (raw["t"]) {
    case "ready":
      return typeof raw["pid"] === "number" && typeof raw["port"] === "number"
        ? { t: "ready", pid: raw["pid"], port: raw["port"] }
        : null;
    case "res": {
      if (typeof raw["id"] !== "number") return null;
      if (raw["ok"] === true) return { t: "res", id: raw["id"], ok: true, value: raw["value"] };
      const error = isRecord(raw["error"]) ? raw["error"] : {};
      const code = error["code"];
      return {
        t: "res",
        id: raw["id"],
        ok: false,
        error: {
          code: code === "busy" || code === "invalid" ? code : "internal",
          message: String(error["message"] ?? "the transcript worker refused").slice(0, 512),
        },
      };
    }
    case "log":
      return {
        t: "log",
        level: raw["level"] === "warn" ? "warn" : "info",
        event: String(raw["event"] ?? "log").slice(0, 64),
        message: String(raw["message"] ?? "").slice(0, 512),
        ...(isRecord(raw["fields"]) ? { fields: raw["fields"] } : {}),
      };
    case "fatal":
      return { t: "fatal", reason: String(raw["reason"] ?? "").slice(0, 1_024) };
    default:
      return null;
  }
}
