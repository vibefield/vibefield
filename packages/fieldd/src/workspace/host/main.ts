import type { FromWorker, ToWorker, WorkerError, WorkerOp } from "../protocol";
import { setMilleNativePath } from "./native-path";

// FS-1a — the files worker's ENTRY (`files-host` role; L1). fieldd starts it
// with fieldd (FS-D11 (b)) as its OWN executable re-run in this role — the
// development bundle `files-host.cjs` under the runtime fieldd runs under, or
// the packaged single executable with `--vibefield-role=files-host` (bin.ts) —
// and talks to it over the child IPC pipe (protocol.ts). The native addon is
// loaded HERE and nowhere else in the product: never in the daemon, never in
// Electron main, never in a renderer (wall R24).
//
// The life of a generation:
//   1. wait for `init` — the addon's explicit path — and set it before the
//      engine module is first imported (its native shim reads it on load);
//   2. load the engine; a failure is `fatal` and exit 1 (the supervisor reads
//      a worker that cannot load its addon as terminal, never a spin);
//   3. say `ready` (the READY line), then answer `req`s in their own time;
//   4. exit when told (`shutdown`) or when the pipe closes (fieldd died): the
//      worker never outlives the daemon that owns it.

type EngineModule = typeof import("./engine");
type GitModule = typeof import("./git");

let engines: InstanceType<EngineModule["Engines"]> | null = null;
let gitModule: GitModule | null = null;
let failureClass: EngineModule["WorkerFailure"] | null = null;
let stopping = false;
let listener: import("./listener").WorkspaceListener | null = null;
let resolveConfined: typeof import("./listener").resolveConfined | null = null;

function send(message: FromWorker): void {
  if (typeof process.send === "function" && process.connected) process.send(message);
}

function errorOf(error: unknown): WorkerError {
  if (failureClass !== null && error instanceof failureClass)
    return { code: error.code, message: error.message };
  const code = (error as { code?: unknown } | null)?.code;
  return {
    code: "internal",
    message:
      `${error instanceof Error ? error.message : String(error)}${typeof code === "string" ? ` (${code})` : ""}`.slice(
        0,
        512,
      ),
  };
}

let assertRoot: EngineModule["assertRoot"] | null = null;

async function assertRootOf(ask: Record<string, unknown>): Promise<void> {
  if (assertRoot === null) throw new Error("the engine is not loaded");
  await assertRoot(String(ask["rootPath"]));
}

async function answer(op: WorkerOp, args: unknown): Promise<unknown> {
  if (engines === null || gitModule === null) throw new Error("the engine is not loaded");
  const ask = (args ?? {}) as Record<string, unknown>;
  switch (op) {
    case "resolve":
      if (resolveConfined === null) throw new Error("files listener is not ready");
      return resolveConfined(
        String(ask["rootPath"]),
        ask["segments"] as string[],
        ask["file"] === true,
      );
    case "registerTicket":
      if (listener === null) throw new Error("files listener is not ready");
      listener.register(args as import("../protocol").AttachRegistration);
      return { port: listener.port };
    case "closeTicket":
      return listener?.closeTicket(String(ask["clientId"]), String(ask["ticket"])) ?? false;
    case "revokeClient":
      listener?.revokeClient(String(ask["clientId"]));
      return null;
    case "retainRoots":
      listener?.retainRoots(ask["rootIds"] as string[]);
      return null;
    case "list":
      return await engines.list(args as Parameters<typeof engines.list>[0]);
    case "search":
      return await engines.search(args as Parameters<typeof engines.search>[0]);
    case "gitFacts":
      await assertRootOf(ask);
      return await gitModule.gitFacts(String(ask["rootPath"]));
    case "stats": {
      const memory = process.memoryUsage();
      const cpu = process.cpuUsage();
      return {
        pid: process.pid,
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        cpuUserMicros: cpu.user,
        cpuSystemMicros: cpu.system,
        engines: engines.count,
      };
    }
    default:
      throw new Error(`unknown op ${String(op)}`);
  }
}

async function shutdown(code: number): Promise<never> {
  if (!stopping) {
    stopping = true;
    try {
      await listener?.close();
      await engines?.disposeAll();
    } catch {
      // the process is leaving either way
    }
  }
  process.exit(code);
}

async function init(milleNative: string): Promise<void> {
  try {
    setMilleNativePath(milleNative);
    const engine: EngineModule = await import("./engine");
    gitModule = await import("./git");
    failureClass = engine.WorkerFailure;
    assertRoot = engine.assertRoot;
    engines = new engine.Engines();
    const serving = await import("./listener");
    resolveConfined = serving.resolveConfined;
    // R6 — an attachment's establish and end ride the control pipe to fieldd's ledger
    listener = await serving.WorkspaceListener.start(engines, (event) =>
      send({ t: "session", ...event }),
    );
    const mille = await import("./mille-identity");
    send({ t: "ready", pid: process.pid, port: listener.port, mille: mille.milleIdentity() });
  } catch (error) {
    send({
      t: "fatal",
      reason:
        `mille's engine did not load from ${milleNative}: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          1_024,
        ),
    });
    await shutdown(1);
  }
}

/** Run the worker: called by the bundle's own top level, and by bin.ts in the
 * packaged executable's `files-host` role. */
export function runFilesHost(): void {
  if (typeof process.send !== "function") {
    process.stderr.write("files-host: started without an IPC pipe — fieldd starts this role\n");
    process.exit(2);
  }
  let initialized = false;
  process.on("message", (raw: unknown) => {
    const message = raw as ToWorker | null;
    if (message === null || typeof message !== "object") return;
    if (message.t === "init") {
      if (initialized || typeof message.milleNative !== "string") return;
      initialized = true;
      void init(message.milleNative);
      return;
    }
    if (message.t === "shutdown") {
      void shutdown(0);
      return;
    }
    if (message.t === "req" && typeof message.id === "number") {
      const { id, op, args } = message;
      void answer(op, args).then(
        (value) => send({ t: "res", id, ok: true, value }),
        (error: unknown) => send({ t: "res", id, ok: false, error: errorOf(error) }),
      );
    }
  });
  // fieldd died (or closed the pipe): the worker leaves with it
  process.on("disconnect", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGINT", () => void shutdown(0));
}
