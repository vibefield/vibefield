import { fstatSync } from "node:fs";
import { Socket } from "node:net";
import { getHeapStatistics } from "node:v8";
import { Worker } from "node:worker_threads";
import {
  FLOW_HOST_TEXT_MAX,
  FrameReader,
  type FromFlowHost,
  frameOf,
  TO_FLOW_HOST_FRAME_MAX,
  type ToFlowHost,
} from "../protocol";
import type { FlowWorkerData, FromFlowWorker, ToFlowWorker } from "./worker";

// CP-4a2a (CP-D8, CP-D9; 4A2-Q1 (a), 4A2-Q5 (a), 4A2-Q6 (b), 4A2-Q7 (b) as re-ruled by VF-PM 2026-11-05 11:46Z) — a
// run's flow host, the child's ENTRY (`flows-host` role) and its own thread. fieldd starts one per run, as its OWN
// executable re-run in this role: the development bundle `flows-host.cjs` under the runtime fieldd runs under, or the
// packaged single executable with `--vibefield-role=flows-host` (bin.ts). Its environment is PATH alone and its one door
// is its fd 3, a plain pipe of one JSON message a line (protocol.ts).
//
// This thread runs no script. It holds the pipe, and starts the run's script in a worker_threads Worker from this same
// bundle (worker.ts), under V8's cap on the worker's old generation (`heapMb`), so:
// - a script that spins holds its worker alone: this thread still hears `disconnect` (fieldd died) and SIGTERM, and
//   leaves, which ends the worker with it; `shutdown` too. fieldd pings THROUGH this thread to the worker, so a
//   spinning script still misses its pings and is ended `unanswered`;
// - a script past its heap is ended by V8 (ERR_WORKER_OUT_OF_MEMORY), and this thread says `memory`;
// - what V8's cap cannot see, a typed array's backing store (outside the heap, and left in every compartment by
//   SES), this thread holds: it reads the host's resident memory every RSS_POLL_MS, and past the run's `rssMb`
//   (FLOW_LIMITS.HOST_RSS_MB, 512 provisional) it says `memory` and SIGKILLs the host (bth's re-read N1, ruled by
//   VF-PM 13:26Z). The worker's loop may be inside one long builtin then, so the host never waits for it to end;
// - the memory it holds to that cap is the higher of the resident size and the worker's own count, its external
//   memory (every typed array's backing store) and its heap, `worker.getHeapStatistics()` (bth's second re-read
//   R2, VF-PM 13:48Z): under memory pressure macOS's resident size leaves out compressed and swapped pages, and
//   the worker's count does not;
// - that read goes on past the run's end, until the host has left (bth's second re-read R1, VF-PM 13:48Z): at the
//   end the worker is terminated, and every leave terminates it and exits once it has gone, never by a
//   `process.exit()` that would hold this thread until one long builtin ends. Past the cap after the run's end, the
//   host is killed with no word: its end was said.
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

let pipe: Socket | undefined;
let worker: Worker | undefined;
/** the run's end was said (`done`, `threw`, `fatal` or `memory`), or the host is leaving: nothing more is said */
let said = false;
/** the host is leaving: its worker is being terminated, and it exits once that is done */
let leaving = false;
/** the host's own read of its resident memory, while its script runs */
let rssTimer: NodeJS.Timeout | undefined;

/** How often this thread reads the host's resident memory against the run's `rssMb`: the host's own timing, as
 * fieldd's ping is fieldd's, not a run's bound (bth's re-read N1). */
const RSS_POLL_MS = 50;
/** How long `memory` may take to reach the pipe before the host is killed without it. */
const RSS_KILL_GRACE_MS = 250;

function send(message: FromFlowHost): void {
  if (pipe?.writable === true) pipe.write(frameOf(message));
}

const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Say the run's end, once, and terminate the worker: its script has nothing more to say. The resident read goes on
 * (bth's second re-read R1): a script can go on allocating after its end. */
function end(message: Extract<FromFlowHost, { t: "done" | "threw" | "fatal" | "memory" }>): void {
  if (said) return;
  said = true;
  send(message);
  worker?.terminate().catch(() => {});
}

/** Leave with `code`, never blocking this thread on the worker: `process.exit()` waits for the worker's thread to end,
 * and a worker inside one long builtin does not end mid-call. So the worker is terminated, the host exits once it has
 * gone, and the resident read runs meanwhile (bth's second re-read R1). Nothing more is said. */
function leave(code: number): void {
  if (leaving) return;
  leaving = true;
  said = true;
  const running = worker;
  if (running === undefined) process.exit(code);
  running.terminate().then(
    () => process.exit(code),
    () => process.exit(code),
  );
}

/** Past the resident cap: say `memory`, then SIGKILL this host, never `process.exit()`, which waits for the worker
 * to end, and one long builtin (a `fill` of gigabytes) is not interrupted mid-call. fieldd reads the frame before
 * the child's close, so the run ends `memory`; were the frame not written in the grace, the kill comes anyway. After
 * the run's end, or once the host is leaving, there is nothing to say: the kill alone. */
function pastResidentCap(): void {
  clearInterval(rssTimer);
  const kill = (): void => {
    process.kill(process.pid, "SIGKILL");
  };
  if (said) {
    kill();
    return;
  }
  said = true;
  setTimeout(kill, RSS_KILL_GRACE_MS);
  if (pipe?.writable === true) pipe.write(frameOf({ t: "memory" }), kill);
  else kill();
}

function fromWorker(message: FromFlowWorker): void {
  switch (message.t) {
    case "call":
    case "log":
    case "pong":
      send(message);
      return;
    case "done":
      end(message);
      return;
    // the worker cut its words; this thread holds them to the bound again (bth's review finding 1)
    case "threw":
      end({ t: "threw", message: String(message.message).slice(0, FLOW_HOST_TEXT_MAX) });
      return;
    case "fatal":
      end({ t: "fatal", reason: String(message.reason).slice(0, FLOW_HOST_TEXT_MAX) });
      return;
  }
}

function start(bundle: string, message: Extract<ToFlowHost, { t: "run" }>): void {
  const { heapMb, rssMb } = message.limits;
  if (typeof heapMb !== "number" || !Number.isFinite(heapMb) || heapMb <= 0) {
    end({ t: "fatal", reason: "a run's limits name no heap for its worker" });
    return;
  }
  if (typeof rssMb !== "number" || !Number.isFinite(rssMb) || rssMb <= 0) {
    end({ t: "fatal", reason: "a run's limits name no resident cap for its host" });
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
    else
      end({
        t: "fatal",
        reason: `the flow's worker failed: ${textOf(error)}`.slice(0, FLOW_HOST_TEXT_MAX),
      });
  });
  worker.on("exit", (code) => end({ t: "fatal", reason: `the flow's worker left (code ${code})` }));
  const capBytes = rssMb * 1024 * 1024;
  // the host's memory is the higher of its resident size and its worker's own count (bth's second re-read R2):
  // the resident size is read at once every tick; the worker answers its count at its next interrupt check, so
  // one ask is out at a time, and a worker inside one long builtin, which cannot answer, leaves the resident
  // size to hold. A worker that has gone answers nothing, and the resident size holds alone
  let counting = false;
  rssTimer = setInterval(() => {
    if (process.memoryUsage.rss() > capBytes) {
      pastResidentCap();
      return;
    }
    const running = worker;
    if (counting || running === undefined) return;
    counting = true;
    running.getHeapStatistics().then(
      (count) => {
        counting = false;
        if (count.external_memory + count.used_heap_size > capBytes) pastResidentCap();
      },
      () => {
        counting = false;
      },
    );
  }, RSS_POLL_MS);
}

function hear(bundle: string, raw: unknown): void {
  const message = raw as ToFlowHost | null;
  if (message === null || typeof message !== "object") return;
  switch (message.t) {
    case "run":
      if (worker !== undefined) {
        send({ t: "fatal", reason: "a host runs one script; it was handed a second" });
        leave(1);
        return;
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
      leave(0);
  }
}

/** The pipe fieldd started this host with, on fd 3; undefined when there is none. */
function openPipe(): Socket | undefined {
  try {
    fstatSync(3);
    return new Socket({ fd: 3, readable: true, writable: true });
  } catch {
    return undefined;
  }
}

/** Run the host: called by the bundle's own top level (entry.ts), in the development runtime and in the packaged
 * executable's `flows-host` role (bin.ts loads the bundle). `bundle` is the bundle's own file, the worker's too. */
export function runFlowsHost(bundle: string): void {
  pipe = openPipe();
  if (pipe === undefined) {
    process.stderr.write(
      "flows-host: started without its pipe on fd 3 — fieldd starts this role\n",
    );
    process.exit(2);
  }
  const reader = new FrameReader(
    TO_FLOW_HOST_FRAME_MAX,
    (raw) => hear(bundle, raw),
    () => {
      send({ t: "fatal", reason: "fieldd's pipe carried a frame this host does not read" });
      leave(1);
    },
  );
  pipe.on("data", (chunk: Buffer) => reader.read(chunk));
  // fieldd died (or closed the pipe): the host leaves with it, and its worker with it
  pipe.on("end", () => leave(0));
  pipe.on("close", () => leave(0));
  pipe.on("error", () => leave(0));
  process.on("SIGTERM", () => leave(0));
  process.on("SIGINT", () => leave(0));
  send({ t: "ready", pid: process.pid });
}
