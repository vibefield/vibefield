import "ses";
import { getHeapStatistics } from "node:v8";
import { parentPort } from "node:worker_threads";
import type { FlowHostLimits, FromFlowHost, ToFlowHost } from "../protocol";
import { evaluateFlow, type FlowApi } from "./compartment";

// CP-4a2a (CP-D8, CP-D9; 4A2-Q7 (b), re-ruled by VF-PM 2026-11-05 11:46Z) — a run's script's WORKER: a worker_threads
// Worker the host's own thread starts (main.ts) from the same bundle, under V8's cap on its old generation
// (`resourceLimits.maxOldGenerationSizeMb`, the run's `heapMb`). The script runs here and nowhere else, so a script that
// spins or allocates without a pause holds this thread alone: the host's thread still hears its pipe, its `disconnect`
// and SIGTERM, and leaves, and V8 ends a worker past its cap (ERR_WORKER_OUT_OF_MEMORY, the run's `memory`).
//
// The life of a worker:
//   1. `lockdown()` FIRST, before the script is read: this isolate's intrinsics frozen and tamed, with every option
//      named here so no environment variable chooses one (and the environment is PATH alone);
//   2. evaluate the script in its compartment (compartment.ts), call its default export with the run's input, and say
//      how it ended (`done`, `threw`), or `fatal` when lockdown failed;
//   3. each `agent(…)` and `ask(…)` is a `call`, bounded here before it is posted, and its `answer` resolves or throws
//      the script's `await`; `log(…)` is a `log` line, cut; every `ping` is answered at once, with this isolate's heap
//      (telemetry: the cap is V8's). The host's thread carries each to and from fieldd's pipe.

/** What the host's thread hands its worker: the run, as fieldd sent it. */
export interface FlowWorkerData {
  readonly script: string;
  readonly input: Readonly<Record<string, string>>;
  readonly limits: FlowHostLimits;
}

/** What a worker hears from the host's thread: fieldd's answers and pings, passed on. */
export type ToFlowWorker = Extract<ToFlowHost, { t: "answer" } | { t: "ping" }>;

/** What a worker says: every host message but `ready`, which is the host's thread's own. */
export type FromFlowWorker = Exclude<FromFlowHost, { t: "ready" } | { t: "memory" }>;

const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let nextCall = 1;

function post(message: FromFlowWorker): void {
  parentPort?.postMessage(message);
}

const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const kib = (bytes: number): string => `${Math.floor(bytes / 1024)} KiB (${bytes} bytes)`;

/** `text` cut at `max` characters, with "…" in the last place. */
const cut = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;

function lockdownFirst(): string | undefined {
  try {
    lockdown({
      errorTaming: "safe",
      stackFiltering: "concise",
      consoleTaming: "safe",
      overrideTaming: "moderate",
      localeTaming: "safe",
      regExpTaming: "safe",
      domainTaming: "safe",
      evalTaming: "safe-eval",
      // the worker reports how the script ended itself; SES traps nothing and exits nothing
      errorTrapping: "none",
      unhandledRejectionTrapping: "none",
    });
    return undefined;
  } catch (error) {
    return textOf(error);
  }
}

/** The flow API over the host's thread, holding each call to the run's bounds before it is posted. */
function flowApi(limits: FlowHostLimits): FlowApi {
  const call = (what: "agent" | "ask", args: unknown[]): Promise<unknown> => {
    let json: string;
    try {
      json = JSON.stringify(args);
    } catch {
      return Promise.reject(
        new Error(`VibeField can't send this ${what}: its arguments are not plain data`),
      );
    }
    if (Buffer.byteLength(json, "utf8") > limits.callMaxBytes)
      return Promise.reject(
        new Error(
          `VibeField can't send this ${what}: a call is at most ${kib(limits.callMaxBytes)}`,
        ),
      );
    const id = nextCall++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ t: "call", id, what, args: JSON.parse(json) as unknown[] });
    });
  };
  return {
    agent: (prompt, options) => call("agent", options === undefined ? [prompt] : [prompt, options]),
    ask: (question, choices) =>
      call("ask", choices === undefined ? [question] : [question, choices]),
    log: (text) => {
      post({ t: "log", text: cut(String(text), limits.logMaxChars) });
    },
    phase: (_name, fn) => {
      if (typeof fn !== "function")
        throw new TypeError("phase(name, fn): its fn is not a function");
      return (fn as () => unknown)();
    },
  };
}

async function run(data: FlowWorkerData): Promise<void> {
  try {
    const main = await evaluateFlow(data.script, flowApi(data.limits));
    if (typeof main !== "function") throw new TypeError("its default export is not a function");
    const value: unknown = await (main as (input: unknown) => unknown)(harden({ ...data.input }));
    const json = value === undefined ? undefined : JSON.stringify(value);
    if (json === undefined) post({ t: "done" });
    else if (Buffer.byteLength(json, "utf8") > data.limits.callMaxBytes)
      post({ t: "done", cut: true });
    else post({ t: "done", value: JSON.parse(json) });
  } catch (error) {
    post({ t: "threw", message: textOf(error) });
  }
}

function hear(message: ToFlowWorker): void {
  switch (message.t) {
    case "answer": {
      const waiting = pending.get(message.id);
      if (waiting === undefined) return;
      pending.delete(message.id);
      if (message.ok) waiting.resolve(message.value);
      else waiting.reject(new Error(String(message.refused)));
      return;
    }
    case "ping":
      // this isolate's heap, for fieldd's record of the run: the cap itself is V8's (resourceLimits)
      post({ t: "pong", n: message.n, heap: getHeapStatistics().used_heap_size });
      return;
  }
}

/** Run the worker: called by the bundle's own top level when it is loaded as the host's worker (entry.ts). */
export function runFlowWorker(data: FlowWorkerData): void {
  const refused = lockdownFirst();
  if (refused !== undefined) {
    post({ t: "fatal", reason: `lockdown failed: ${refused}` });
    return;
  }
  // a promise the script left behind is the script's own: the run's end is what its default export does
  process.on("unhandledRejection", () => {});
  parentPort?.on("message", hear);
  void run(data);
}
