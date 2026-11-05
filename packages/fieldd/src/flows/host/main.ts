import { getHeapStatistics } from "node:v8";
import { Worker } from "node:worker_threads";
import type { FromFlowHost, ToFlowHost } from "../protocol";
import type { FlowWorkerData, FromFlowWorker, ToFlowWorker } from "./worker";

// CP-4a2a (CP-D8, CP-D9; 4A2-Q1 (a), 4A2-Q5 (a), 4A2-Q6 (b), 4A2-Q7 (b) as re-ruled by VF-PM 2026-11-05 11:46Z) — a
// run's flow host, the child's ENTRY (`flows-host` role) and its own thread. fieldd starts one per run, as its OWN
// executable re-run in this role: the development bundle `flows-host.cjs` under the runtime fieldd runs under, or the
// packaged single executable with `--vibefield-role=flows-host` (bin.ts). Its environment is PATH alone and its one door
// is its IPC pipe (protocol.ts).
//
// This thread runs no script. It holds the pipe, and starts the run's script in a worker_threads Worker from this same
// bundle (worker.ts), under V8's cap on the worker's old generation (`heapMb`), so:
// - a script that spins holds its worker alone: this thread still hears `disconnect` (fieldd died) and SIGTERM, and
//   leaves, which ends the worker with it; `shutdown` too. fieldd pings THROUGH this thread to the worker, so a
//   spinning script still misses its pings and is ended `unanswered`;
// - a script past its heap is ended by V8 (ERR_WORKER_OUT_OF_MEMORY), and this thread says `memory`.
// This thread does not lock itself down: it is another isolate than the script's, it evaluates no script text, and
// nothing but structured-clone data crosses from the worker to it (4A2-Q7 (b): "decide, and say so").
//
// The life of a host:
//   1. say `ready {pid}`;
//   2. take ONE `run`: start the worker with it (a second `run` is `fatal`), and carry the worker's `call`, `log`,
//      `pong` and its end (`done`, `threw`, `fatal`) to fieldd, and fieldd's `answer` and `ping` to the worker;
//   3. leave when told (`shutdown`) or when the pipe closes (fieldd died): it never outlives the daemon.

/** The worker's role in the bundle: entry.ts runs the worker when the bundle is loaded with this. */
export const FLOW_WORKER_ROLE = "vibefield-flow-worker";

let worker: Worker | undefined;
/** the run's end was said: `done`, `threw`, `fatal` or `memory` */
let said = false;

function send(message: FromFlowHost): void {
  if (typeof process.send === "function" && process.connected) process.send(message);
}

const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Say the run's end, once. */
function end(message: Extract<FromFlowHost, { t: "done" | "threw" | "fatal" | "memory" }>): void {
  if (said) return;
  said = true;
  send(message);
}

function fromWorker(message: FromFlowWorker): void {
  switch (message.t) {
    case "call":
    case "log":
    case "pong":
      send(message);
      return;
    case "done":
    case "threw":
    case "fatal":
      end(message);
      return;
  }
}

function start(bundle: string, message: Extract<ToFlowHost, { t: "run" }>): void {
  const heapMb = message.limits.heapMb;
  if (typeof heapMb !== "number" || !Number.isFinite(heapMb) || heapMb <= 0) {
    end({ t: "fatal", reason: "a run's limits name no heap for its worker" });
    return;
  }
  const data: FlowWorkerData & { readonly role: string } = {
    role: FLOW_WORKER_ROLE,
    script: message.script,
    input: message.input,
    limits: message.limits,
  };
  worker = new Worker(bundle, {
    workerData: data,
    resourceLimits: { maxOldGenerationSizeMb: heapMb },
  });
  worker.on("message", (raw: FromFlowWorker) => fromWorker(raw));
  worker.on("error", (error: Error & { code?: string }) => {
    if (error.code === "ERR_WORKER_OUT_OF_MEMORY") end({ t: "memory" });
    else end({ t: "fatal", reason: `the flow's worker failed: ${textOf(error)}` });
  });
  worker.on("exit", (code) => end({ t: "fatal", reason: `the flow's worker left (code ${code})` }));
}

function hear(bundle: string, raw: unknown): void {
  const message = raw as ToFlowHost | null;
  if (message === null || typeof message !== "object") return;
  switch (message.t) {
    case "run":
      if (worker !== undefined) {
        send({ t: "fatal", reason: "a host runs one script; it was handed a second" });
        process.exit(1);
      }
      start(bundle, message);
      return;
    case "answer":
      worker?.postMessage(message satisfies ToFlowWorker);
      return;
    case "ping":
      // the worker answers its own pings, so a script that spins misses them; before it starts, this thread does
      if (worker !== undefined) worker.postMessage(message satisfies ToFlowWorker);
      else send({ t: "pong", n: message.n, heap: getHeapStatistics().used_heap_size });
      return;
    case "shutdown":
      process.exit(0);
  }
}

/** Run the host: called by the bundle's own top level (entry.ts), in the development runtime and in the packaged
 * executable's `flows-host` role (bin.ts loads the bundle). `bundle` is the bundle's own file, the worker's too. */
export function runFlowsHost(bundle: string): void {
  if (typeof process.send !== "function") {
    process.stderr.write("flows-host: started without an IPC pipe — fieldd starts this role\n");
    process.exit(2);
  }
  process.on("message", (raw) => hear(bundle, raw));
  // fieldd died (or closed the pipe): the host leaves with it, and its worker with it
  process.on("disconnect", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
  send({ t: "ready", pid: process.pid });
}
