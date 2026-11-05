import "ses";
import type { FlowHostLimits, FromFlowHost, ToFlowHost } from "../protocol";
import { evaluateFlow, type FlowApi } from "./compartment";

// CP-4a2a (CP-D8, CP-D9; 4A2-Q1 (a), 4A2-Q5 (a), 4A2-Q6 (b)) — a run's flow host, the child's ENTRY (`flows-host`
// role). fieldd starts one per run, as its OWN executable re-run in this role: the development bundle `flows-host.cjs`
// under the runtime fieldd runs under, or the packaged single executable with `--vibefield-role=flows-host` (bin.ts).
// Its environment is PATH alone and its one door is its IPC pipe (protocol.ts).
//
// The life of a host:
//   1. `lockdown()` FIRST, before the pipe is read: the realm's intrinsics frozen and tamed, with every option named
//      here so no environment variable chooses one (and the environment is PATH alone);
//   2. say `ready {pid}`;
//   3. take ONE `run`: evaluate the script in its compartment (compartment.ts), call its default export with the
//      run's input, and say how it ended (`done`, `threw`); a second `run` is `fatal`;
//   4. each `agent(…)` and `ask(…)` is a `call` on the pipe, bounded here before it is sent, and its `answer` resolves
//      or throws the script's `await`; `log(…)` is a `log` line, cut; every `ping` is answered at once;
//   5. leave when told (`shutdown`) or when the pipe closes (fieldd died): it never outlives the daemon.

const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let nextCall = 1;
let ran = false;

function send(message: FromFlowHost): void {
  if (typeof process.send === "function" && process.connected) process.send(message);
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
      // the host reports how the script ended itself; SES traps nothing and exits nothing
      errorTrapping: "none",
      unhandledRejectionTrapping: "none",
    });
    return undefined;
  } catch (error) {
    return textOf(error);
  }
}

/** The flow API over the pipe, holding each call to the run's bounds before it is sent. */
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
      send({ t: "call", id, what, args: JSON.parse(json) as unknown[] });
    });
  };
  return {
    agent: (prompt, options) => call("agent", options === undefined ? [prompt] : [prompt, options]),
    ask: (question, choices) =>
      call("ask", choices === undefined ? [question] : [question, choices]),
    log: (text) => {
      send({ t: "log", text: cut(String(text), limits.logMaxChars) });
    },
    phase: (_name, fn) => {
      if (typeof fn !== "function")
        throw new TypeError("phase(name, fn): its fn is not a function");
      return (fn as () => unknown)();
    },
  };
}

async function run(message: Extract<ToFlowHost, { t: "run" }>): Promise<void> {
  try {
    const main = await evaluateFlow(message.script, flowApi(message.limits));
    if (typeof main !== "function") throw new TypeError("its default export is not a function");
    const value: unknown = await (main as (input: unknown) => unknown)(
      harden({ ...message.input }),
    );
    const json = value === undefined ? undefined : JSON.stringify(value);
    if (json === undefined) send({ t: "done" });
    else if (Buffer.byteLength(json, "utf8") > message.limits.callMaxBytes)
      send({ t: "done", cut: true });
    else send({ t: "done", value: JSON.parse(json) });
  } catch (error) {
    send({ t: "threw", message: textOf(error) });
  }
}

function hear(raw: unknown): void {
  const message = raw as ToFlowHost | null;
  if (message === null || typeof message !== "object") return;
  switch (message.t) {
    case "run":
      if (ran) {
        send({ t: "fatal", reason: "a host runs one script; it was handed a second" });
        process.exit(1);
      }
      ran = true;
      void run(message);
      return;
    case "answer": {
      const waiting = pending.get(message.id);
      if (waiting === undefined) return;
      pending.delete(message.id);
      if (message.ok) waiting.resolve(message.value);
      else waiting.reject(new Error(String(message.refused)));
      return;
    }
    case "ping":
      send({ t: "pong", n: message.n });
      return;
    case "shutdown":
      process.exit(0);
  }
}

/** Run the host: called by the bundle's own top level, and by bin.ts in the packaged executable's `flows-host`
 * role. */
export function runFlowsHost(): void {
  if (typeof process.send !== "function") {
    process.stderr.write("flows-host: started without an IPC pipe — fieldd starts this role\n");
    process.exit(2);
  }
  const refused = lockdownFirst();
  if (refused !== undefined) {
    send({ t: "fatal", reason: `lockdown failed: ${refused}` });
    process.exit(1);
  }
  // a promise the script left behind is the script's own: the run's end is what its default export does
  process.on("unhandledRejection", () => {});
  process.on("message", hear);
  // fieldd died (or closed the pipe): the host leaves with it
  process.on("disconnect", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
  send({ t: "ready", pid: process.pid });
}
