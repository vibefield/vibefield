import { keyVerifier } from "../../spark-transcript-lines";
import type { FromHost, HostError, HostOp, TicketRegistration, ToHost } from "../protocol";
import { HostFailure, TranscriptListener } from "./listener";

// TH-1 (TH0-Q5 (b)) — the transcript worker's ENTRY (`transcript-host` role). fieldd starts it with fieldd, as its
// OWN executable re-run in this role: the development bundle `transcript-host.cjs` under the runtime fieldd runs
// under, or the packaged single executable with `--vibefield-role=transcript-host` (bin.ts). It is mille-free: it
// imports no engine, so it serves while the files worker cannot load one.
//
// The life of a generation:
//   1. wait for `init`: the folder, the key (base64, on the pipe and never in the environment, EL7), the Origins and
//      the generation;
//   2. start the listener and say `ready {pid, port}`; a listener that cannot start is `fatal`, exit 1;
//   3. answer `req`s, read on at each `appended`;
//   4. leave when told (`shutdown`) or when the pipe closes (fieldd died): it never outlives the daemon.

let listener: TranscriptListener | null = null;
let stopping = false;

function send(message: FromHost): void {
  if (typeof process.send === "function" && process.connected) process.send(message);
}

function errorOf(error: unknown): HostError {
  if (error instanceof HostFailure) return { code: error.code, message: error.message };
  return {
    code: "internal",
    message: (error instanceof Error ? error.message : String(error)).slice(0, 512),
  };
}

function answer(op: HostOp, args: unknown): unknown {
  if (listener === null) throw new Error("the transcript listener is not ready");
  const ask = (args ?? {}) as Record<string, unknown>;
  switch (op) {
    case "registerTicket":
      listener.register(args as TicketRegistration);
      return { port: listener.port };
    case "closeTicket":
      return listener.closeTicket(String(ask["clientId"]), String(ask["ticket"]));
    case "revokeClient":
      listener.revokeClient(String(ask["clientId"]));
      return null;
    default:
      throw new Error(`unknown op ${String(op)}`);
  }
}

async function shutdown(code: number): Promise<never> {
  if (!stopping) {
    stopping = true;
    try {
      await listener?.close();
    } catch {
      // the process is leaving either way
    }
  }
  process.exit(code);
}

async function init(message: Extract<ToHost, { t: "init" }>): Promise<void> {
  try {
    const key = Buffer.from(message.key, "base64");
    if (key.length === 0) throw new Error("no key was handed on the pipe");
    listener = await TranscriptListener.start({
      dir: message.dir,
      verify: keyVerifier(key),
      allowedOrigins: [...message.allowedOrigins],
      generation: message.generation,
      onLog: (event, text, fields) =>
        send({ t: "log", level: "warn", event, message: text, ...(fields ? { fields } : {}) }),
    });
    send({ t: "ready", pid: process.pid, port: listener.port });
  } catch (error) {
    send({
      t: "fatal",
      reason:
        `the transcript listener did not start: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          1_024,
        ),
    });
    await shutdown(1);
  }
}

/** Run the worker: called by the bundle's own top level, and by bin.ts in the packaged executable's
 * `transcript-host` role. */
export function runTranscriptHost(): void {
  if (typeof process.send !== "function") {
    process.stderr.write(
      "transcript-host: started without an IPC pipe — fieldd starts this role\n",
    );
    process.exit(2);
  }
  let initialized = false;
  process.on("message", (raw: unknown) => {
    const message = raw as ToHost | null;
    if (message === null || typeof message !== "object") return;
    switch (message.t) {
      case "init":
        if (initialized || typeof message.key !== "string" || typeof message.dir !== "string")
          return;
        initialized = true;
        void init(message);
        return;
      case "appended":
        listener?.appended(String(message.spark), String(message.run));
        return;
      case "shutdown":
        void shutdown(0);
        return;
      case "req": {
        if (typeof message.id !== "number") return;
        const { id, op, args } = message;
        try {
          send({ t: "res", id, ok: true, value: answer(op, args) });
        } catch (error) {
          send({ t: "res", id, ok: false, error: errorOf(error) });
        }
        return;
      }
    }
  });
  // fieldd died (or closed the pipe): the worker leaves with it
  process.on("disconnect", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGINT", () => void shutdown(0));
}
