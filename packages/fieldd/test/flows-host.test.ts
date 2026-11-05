import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FLOW_INPUT_VALUE_MAX,
  FLOW_INPUTS_MAX,
  FLOW_LIMITS,
  flowAnswerBytes,
} from "@vibefield/contracts";
import { afterEach, describe, expect, inject, it } from "vitest";
import { chooseFlowsHostLaunch, type FlowsHostLaunch } from "../src/flows/launch";
import { flowScriptOf } from "../src/flows/module-script";
import { FLOW_CUT_MARK, FLOW_HOST_TEXT_MAX, type ToFlowHost } from "../src/flows/protocol";
import {
  boundedAnswer,
  type FlowCallHandler,
  type FlowHostAnswer,
  type FlowHostCall,
  type FlowHostRun,
  type FlowHostTimings,
  startFlowHost,
} from "../src/flows/supervisor";
import { roleOf } from "../src/roles";
import { directHost, flowsHostLaunch, standInSource } from "./flows-host-bundle";

// CP-4a2a (step0-cp4a2.md §12 commit 5; CP-D8, CP-D9; 4A2-Q1, Q5, Q6, Q7 (a), ruled by VF-PM 2026-11-05 08:51Z) — a
// run's flow host, end to end: the REAL child (fieldd's own build of `flows-host.cjs`, flows-host-bundle.ts) started by
// the supervisor, its calls answered by a scripted handler (the runs are CP-4a2b's). Every wait is bounded and its
// outcome asserted: a host that never answers reads as the row's wrong value, never as the test's timeout.

const ROW_MS = 30_000;
const WAIT_MS = 15_000;
const PATH_ONLY = { PATH: process.env["PATH"] ?? "/usr/bin:/bin" };

const encoder = new TextEncoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);

/** A flow file whose default export runs `body` with `input` in scope. */
const flow = (body: string): Uint8Array =>
  bytes(
    `export const meta = { name: "Host row" };\nexport default async function (input) {\n${body}\n}\n`,
  );

/** `promise`'s value, or "timeout" past `ms`: the row asserts which it got. */
async function within<T>(promise: Promise<T>, ms = WAIT_MS): Promise<T | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A handler that answers each call by `answer` (or never, for "never") and keeps what it heard. */
function scripted(answer: (call: FlowHostCall) => FlowHostAnswer | "never" = () => "never") {
  const calls: FlowHostCall[] = [];
  const logs: string[] = [];
  const handler: FlowCallHandler = {
    call(call) {
      calls.push(call);
      const reply = answer(call);
      return reply === "never" ? new Promise<FlowHostAnswer>(() => {}) : Promise.resolve(reply);
    },
    log(text) {
      logs.push(text);
    },
  };
  return { handler, calls, logs };
}

const runs: FlowHostRun[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((run) => run.stop()));
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
});

async function host(
  script: Uint8Array,
  opts: {
    handler?: FlowCallHandler;
    input?: Record<string, string>;
    timings?: Partial<FlowHostTimings>;
    heapMb?: number;
    rssMb?: number;
    launch?: FlowsHostLaunch;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<FlowHostRun> {
  const run = startFlowHost({
    launch: { kind: "launch", launch: opts.launch ?? (await flowsHostLaunch()) },
    bytes: script,
    input: opts.input ?? {},
    handler: opts.handler ?? scripted().handler,
    environment: opts.environment ?? PATH_ONLY,
    ...(opts.timings !== undefined ? { timings: opts.timings } : {}),
    ...(opts.heapMb !== undefined ? { heapMb: opts.heapMb } : {}),
    ...(opts.rssMb !== undefined ? { rssMb: opts.rssMb } : {}),
  });
  runs.push(run);
  return run;
}

/** A stand-in child that speaks the protocol on fd 3: at `run` it does `onRun` (JavaScript, in the child), and it
 * answers each ping with `heap` bytes in use (a heap fact the row states; the real allocation is the mini's). */
function standIn({
  onRun = "",
  heap = 4 * 1024 * 1024,
}: {
  onRun?: string;
  heap?: number;
} = {}): FlowsHostLaunch {
  const dir = mkdtempSync(join(inject("fielddRunRoot"), "vf-fh-stand-in-"));
  const file = join(dir, "stand-in.cjs");
  writeFileSync(
    file,
    standInSource([
      "say({ t: 'ready', pid: process.pid });",
      "on((m) => {",
      `  if (m && m.t === 'run') { ${onRun} }`,
      `  if (m && m.t === 'ping') say({ t: 'pong', n: m.n, heap: ${heap} });`,
      "  if (m && m.t === 'shutdown') process.exit(0);",
      "});",
    ]),
  );
  return { command: process.execPath, args: [file] };
}

/** The first message of kind `t` the child sent, or "timeout" past `ms`. */
async function heardOf(heard: readonly unknown[], t: string, ms = WAIT_MS): Promise<unknown> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = heard.find(
      (message) =>
        typeof message === "object" && message !== null && (message as { t?: unknown }).t === t,
    );
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return "timeout";
}

/** A child's resident memory at its highest, MB: `ps` every 20 ms until `until` settles. */
async function peakRssMb(pid: number, until: Promise<unknown>): Promise<number> {
  let peak = 0;
  let over = false;
  void until.finally(() => {
    over = true;
  });
  while (!over) {
    try {
      const kib = Number(
        execFileSync("ps", ["-o", "rss=", "-p", String(pid)])
          .toString()
          .trim(),
      );
      if (Number.isFinite(kib) && kib > peak) peak = kib;
    } catch {
      // gone
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return peak / 1024;
}

/** Answer every `call` a direct host sends with "yes" until it says its run's end: that end's frame, or "timeout".
 * A call whose first argument is `holds` is never answered: the script waits on it for good. */
async function answeredToEnd(
  direct: { readonly heard: readonly unknown[]; tell: (message: ToFlowHost) => void },
  { ms = WAIT_MS, holds }: { ms?: number; holds?: string } = {},
): Promise<unknown> {
  const deadline = Date.now() + ms;
  let answered = 0;
  while (Date.now() < deadline) {
    const frames = direct.heard as readonly { t?: string; id?: number; args?: unknown[] }[];
    const calls = frames.filter((frame) => frame.t === "call");
    for (const call of calls.slice(answered))
      if (holds === undefined || call.args?.[0] !== holds)
        direct.tell({ t: "answer", id: call.id as number, ok: true, value: "yes" });
    answered = calls.length;
    const end = frames.find((frame) =>
      ["done", "threw", "fatal", "memory"].includes(frame.t ?? ""),
    );
    if (end !== undefined) return end;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return "timeout";
}

/** How a child left, once it has. */
const exitOf = (child: ChildProcess): Promise<{ code: number | null; signal: string | null }> =>
  new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

/** The `run` fieldd would send for a flow file, at FLOW_LIMITS' bounds. */
function runOf(file: Uint8Array): ToFlowHost {
  const read = flowScriptOf(file);
  expect(read.kind, "the rewrite reads the row's flow").toBe("script");
  return {
    t: "run",
    script: (read as { script: string }).script,
    input: {},
    limits: {
      callMaxBytes: FLOW_LIMITS.RESULT_MAX_BYTES,
      logMaxChars: 200,
      heapMb: FLOW_LIMITS.HOST_HEAP_MB,
      rssMb: FLOW_LIMITS.HOST_RSS_MB,
      argsDepthMax: FLOW_LIMITS.ARGS_DEPTH_MAX,
    },
  };
}

async function logged(logs: readonly string[], ms = WAIT_MS): Promise<string | "timeout"> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (logs.length > 0) return logs[0] as string;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return "timeout";
}

describe("CP-4a2a — the flow host: lockdown, the compartment, the environment", () => {
  it(
    "H1: lockdown ran before any script: the realm's intrinsics are frozen where the script runs",
    async () => {
      const run = await host(
        flow(
          "return [Object.isFrozen(Array.prototype), Object.isFrozen(Object), Object.isFrozen(Promise)];",
        ),
      );
      expect(await within(run.ended)).toEqual({ kind: "done", value: [true, true, true] });
    },
    ROW_MS,
  );

  it(
    "H2: the compartment's globals are the flow API alone: no require, process, fetch, timer or import()",
    async () => {
      const run = await host(
        flow(
          [
            "const kinds = {};",
            "for (const name of ['require', 'process', 'fetch', 'setTimeout', 'setImmediate', 'queueMicrotask',",
            "  'Buffer', 'console', 'module', 'agent', 'ask', 'log', 'phase'])",
            "  kinds[name] = typeof globalThis[name];",
            "return kinds;",
          ].join("\n"),
        ),
      );
      expect(await within(run.ended)).toEqual({
        kind: "done",
        value: {
          require: "undefined",
          process: "undefined",
          fetch: "undefined",
          setTimeout: "undefined",
          setImmediate: "undefined",
          queueMicrotask: "undefined",
          Buffer: "undefined",
          console: "undefined",
          module: "undefined",
          agent: "function",
          ask: "function",
          log: "function",
          phase: "function",
        },
      });
      // a dynamic import never reaches a loader: SES refuses the source before it runs
      const imports = await host(flow('return await import("node:fs");'));
      const ended = await within(imports.ended);
      expect(ended).toMatchObject({ kind: "threw" });
      expect((ended as { message?: string }).message).toMatch(/SES_IMPORT_REJECTED/);
    },
    ROW_MS,
  );

  it(
    "H3: the clock and randomness are tamed in the compartment (measured on this Mac, ses 2.3.0, 2026-11-05)",
    async () => {
      const run = await host(
        flow(
          [
            "const tried = (f) => { try { return 'ran: ' + String(f()); } catch (error) { return error.message; } };",
            "return [tried(() => Date.now()), tried(() => new Date()), tried(() => Math.random())];",
          ].join("\n"),
        ),
      );
      const ended = await within(run.ended);
      expect(ended).toMatchObject({ kind: "done" });
      const value = (ended as { value?: unknown }).value as string[];
      expect(value).toHaveLength(3);
      for (const said of value) expect(said).toMatch(/^secure mode/);
    },
    ROW_MS,
  );

  it(
    "H4: the child's environment is PATH alone (4A2-Q6 (b)): no FIELD_*, no FIELDD_*, nothing else of fieldd's",
    async () => {
      const { handler, logs } = scripted();
      await host(flow("return 1;"), {
        handler,
        launch: standIn({
          onRun: "say({ t: 'log', text: JSON.stringify(Object.keys(process.env).sort()) });",
        }),
        environment: {
          PATH: PATH_ONLY.PATH,
          FIELDD_TOKEN: "a daemon secret",
          FIELD_NATIVE_SOCKET: "/tmp/x.sock",
          HOME: "/Users/someone",
        },
      });
      const said = await logged(logs);
      expect(said).not.toBe("timeout");
      // __CF_USER_TEXT_ENCODING is the macOS loader's own key: CoreFoundation's loader sets it in every process the
      // system starts, whatever environment it was handed (measured on this Mac, 2026-11-05), so it is the system's,
      // never fieldd's, and the one key past PATH this row lets through
      const keys = (JSON.parse(said) as string[]).filter(
        (key) => key !== "__CF_USER_TEXT_ENCODING",
      );
      expect(keys).toEqual(["PATH"]);
    },
    ROW_MS,
  );
});

describe("CP-4a2a — the flow host: its pipe (4A2-Q5 (a)) and its life", () => {
  it(
    "H5: READY arrives on the pipe, with the child's pid",
    async () => {
      const run = await host(flow('await agent("wait");'));
      const pid = await within(run.ready);
      expect(typeof pid).toBe("number");
      expect(alive(pid as number)).toBe(true);
    },
    ROW_MS,
  );

  it(
    "H6: a call and its answer round-trip: agent, ask and log reach the handler; a refusal is the await's throw",
    async () => {
      const { handler, calls, logs } = scripted((call) =>
        call.what === "agent"
          ? { ok: true, value: { verdict: "clean" } }
          : { ok: true, value: "Ship" },
      );
      const run = await host(
        flow(
          [
            'const a = await agent("Review the branch", { agent: "codex", label: "review" });',
            'const b = await ask("Ship it?", ["Ship", "Hold"]);',
            'log("asked");',
            "return { a, b, input };",
          ].join("\n"),
        ),
        { handler, input: { target: "s-7f3a2c" } },
      );
      expect(await within(run.ended)).toEqual({
        kind: "done",
        value: { a: { verdict: "clean" }, b: "Ship", input: { target: "s-7f3a2c" } },
      });
      expect(calls).toEqual([
        { what: "agent", args: ["Review the branch", { agent: "codex", label: "review" }] },
        { what: "ask", args: ["Ship it?", ["Ship", "Hold"]] },
      ]);
      expect(logs).toEqual(["asked"]);

      const refusing = scripted(() => ({ ok: false, refused: "VibeField ended this step." }));
      const refused = await host(
        flow(
          'try { await agent("Review"); return "answered"; } catch (error) { return error.message; }',
        ),
        { handler: refusing.handler },
      );
      expect(await within(refused.ended)).toEqual({
        kind: "done",
        value: "VibeField ended this step.",
      });
    },
    ROW_MS,
  );

  it(
    "H7: a pipe that closes ends the child: it never outlives fieldd (fd 3, a plain pipe)",
    async () => {
      const direct = await directHost(PATH_ONLY);
      children.push(direct.child);
      const exited = exitOf(direct.child);
      expect(await heardOf(direct.heard, "ready")).toEqual({ t: "ready", pid: direct.child.pid });
      direct.close();
      expect(await within(exited)).toEqual({ code: 0, signal: null });
    },
    ROW_MS,
  );

  it(
    "H7b: a spinning script's host still leaves when its pipe closes, and on SIGTERM: the script never holds the host's own thread (4A2-Q7 (b))",
    async () => {
      const run = runOf(flow('log("spinning");\nwhile (true) {}'));
      for (const leave of ["close", "SIGTERM"] as const) {
        const direct = await directHost(PATH_ONLY);
        children.push(direct.child);
        const exited = exitOf(direct.child);
        expect(await heardOf(direct.heard, "ready")).toEqual({
          t: "ready",
          pid: direct.child.pid,
        });
        direct.tell(run);
        // the script said it is about to spin: from here it never yields
        expect(await heardOf(direct.heard, "log")).toEqual({ t: "log", text: "spinning" });
        if (leave === "close") direct.close();
        else direct.child.kill("SIGTERM");
        expect(await within(exited), `a spinning host leaves on ${leave}`).toEqual({
          code: 0,
          signal: null,
        });
      }
    },
    ROW_MS,
  );

  it(
    "H16: a script's throw is cut in the child (finding 1), and a throw no text reads still ends its run (finding 4)",
    async () => {
      // the child says at most FLOW_HOST_TEXT_MAX characters of a thrown message: fieldd never reads the rest
      const direct = await directHost(PATH_ONLY);
      children.push(direct.child);
      expect(await heardOf(direct.heard, "ready")).toMatchObject({ t: "ready" });
      direct.tell(runOf(flow('throw new Error("x".repeat(2 ** 22));')));
      const threw = await heardOf(direct.heard, "threw");
      expect(threw).toMatchObject({ t: "threw" });
      expect((threw as { message?: string }).message?.length).toBeLessThanOrEqual(
        FLOW_HOST_TEXT_MAX,
      );
      // a thrown value with no text, a message that throws when read, a message that is no string: each ends `threw`
      for (const body of [
        "throw Object.create(null);",
        'const e = new Error("x"); Object.defineProperty(e, "message", { get() { throw new Error("no"); } }); throw e;',
        'const e = new Error("x"); e.message = 1n; throw e;',
      ]) {
        const run = await host(flow(body));
        const ended = await within(run.ended);
        expect(ended, body).toMatchObject({ kind: "threw", message: expect.any(String) });
      }
    },
    ROW_MS,
  );

  it(
    "H17: fieldd reads its pipe itself (bth's review P2): a frame past 64 KiB and its envelope, or one that is not JSON, ends the run `protocol`",
    async () => {
      // the frame never ends: fieldd refuses it before it holds 64 KiB and its envelope, never at its newline
      const endless = await host(flow("return 1;"), {
        launch: standIn({
          onRun: `pipe.write("x".repeat(${FLOW_LIMITS.RESULT_MAX_BYTES + 8 * 1024}));`,
        }),
      });
      expect(await within(endless.ended)).toEqual({ kind: "ended", why: "protocol" });
      const garbled = await host(flow("return 1;"), {
        launch: standIn({ onRun: "pipe.write('{not json}\\n');" }),
      });
      expect(await within(garbled.ended)).toEqual({ kind: "ended", why: "protocol" });
      // a `done` whose value is past RESULT_MAX_BYTES, inside the frame's envelope, is read as cut: fieldd bounds it too
      const over = await host(flow("return 1;"), {
        launch: standIn({
          onRun: `say({ t: "done", value: "x".repeat(${FLOW_LIMITS.RESULT_MAX_BYTES - 2 + 256}) });`,
        }),
      });
      expect(await within(over.ended)).toEqual({ kind: "done", cut: true });
    },
    ROW_MS,
  );

  it(
    "H8: a script past HOST_HEAP_MB is ended as `memory` by V8's own cap on its worker, though it never yields (4A2-Q7 (b))",
    async () => {
      // it allocates without a pause, so no pong can say its heap: V8's cap on the worker (resourceLimits) ends it
      const run = await host(
        flow(
          [
            "const kept = [];",
            "for (;;) {",
            "  let s = 0.5;",
            "  for (let i = 0; i < 1e6; i += 1) s += i;",
            "  kept.push(new Array(1 << 14).fill(s));",
            "}",
          ].join("\n"),
        ),
        { heapMb: 32, timings: { pingMs: 500, pingMisses: 4 } },
      );
      const pid = await within(run.ready);
      expect(typeof pid).toBe("number");
      expect(await within(run.ended)).toEqual({ kind: "ended", why: "memory" });
      expect(alive(pid as number)).toBe(false);
    },
    ROW_MS,
  );

  it(
    "H8b: a pong's heap is telemetry: a host that says it uses more than HOST_HEAP_MB is never ended for saying so",
    async () => {
      // the stand-in states a heap past the cap in every pong; the cap is V8's on the worker, never the pong's word
      const over = (FLOW_LIMITS.HOST_HEAP_MB + 1) * 1024 * 1024;
      const run = await host(flow("return 1;"), {
        launch: standIn({ heap: over }),
        timings: { pingMs: 100 },
      });
      expect(typeof (await within(run.ready))).toBe("number");
      // ten pings answered: a host at work, never ended
      expect(await within(run.ended, 1_000)).toBe("timeout");
    },
    ROW_MS,
  );

  it(
    "H8c: a host V8 aborts for its own heap (the host's thread, not its worker's) is read as `memory`: by SIGABRT, or by the heap line on stderr",
    async () => {
      const aborted = await host(flow("return 1;"), {
        launch: standIn({ onRun: "process.kill(process.pid, 'SIGABRT');" }),
      });
      expect(await within(aborted.ended)).toEqual({ kind: "ended", why: "memory" });
      const said = await host(flow("return 1;"), {
        launch: standIn({
          onRun:
            "process.stderr.write('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\\n', () => process.exit(134));",
        }),
      });
      expect(await within(said.ended)).toEqual({ kind: "ended", why: "memory" });
      // a child that leaves any other way is a host that left, never `memory`
      const left = await host(flow("return 1;"), {
        launch: standIn({ onRun: "process.exit(3);" }),
      });
      expect(await within(left.ended)).toEqual({ kind: "left", code: 3, signal: null });
    },
    ROW_MS,
  );

  it(
    "H8d: V8's heap line split across writes is still read as `memory`: stderr is read as a bounded tail, never chunk by chunk",
    async () => {
      const split = await host(flow("return 1;"), {
        launch: standIn({
          onRun: [
            "const later = (text, then) => process.stderr.write(text, () => setTimeout(then, 50));",
            "later('FATAL ERROR: Reached heap li', () =>",
            "  later('mit Allocation failed - JavaScript heap out of mem', () =>",
            "    process.stderr.write('ory\\n', () => process.exit(134))));",
          ].join(" "),
        }),
      });
      expect(await within(split.ended)).toEqual({ kind: "ended", why: "memory" });
    },
    ROW_MS,
  );

  it(
    "H25: memory V8's heap cap cannot see (typed arrays' backing stores) ends a run `memory` at the host's resident cap, though the script awaits between them (bth's re-read N1)",
    async () => {
      // each 64 MiB array is filled, so its pages are resident, and each is followed by an answered ask, so every ping
      // is answered and the old generation stays small: neither V8's cap nor the ping can end it, the host's RSS cap
      // must. The host idles near 76 MB with its worker locked down (measured 13:27Z), so 160 MB is passed at the
      // second array; the real number's row is the mini's (4 × 256 MiB under HOST_RSS_MB).
      // The script then waits on "hold", which is never answered, so the run cannot end on its own: the cap is the only
      // way out. Without the hold the row was timing-bound. On a fast host the six fills, their asks and the return
      // all fit inside one 50 ms read (run 158, the mini alone: 84 ms for the whole row, ended `done 6`), and the
      // cap holds only to within one read (N1's Found). On a slow host the cap fires mid-allocation instead, before
      // the hold, so the row asserts the end and the first ask, never which ask came last
      const { handler, calls } = scripted((call) =>
        call.args[0] === "hold" ? "never" : { ok: true, value: "yes" },
      );
      const run = await host(
        flow(
          [
            'await ask("start");',
            "const kept = [];",
            "for (let i = 0; i < 6; i += 1) {",
            "  kept.push(new Uint8Array(64 * 1024 * 1024).fill(1));",
            '  await ask("more?");',
            "}",
            'await ask("hold");',
            "return kept.length;",
          ].join("\n"),
        ),
        { handler, rssMb: 160 },
      );
      const pid = await within(run.ready);
      expect(typeof pid).toBe("number");
      expect(await within(run.ended)).toEqual({ kind: "ended", why: "memory" });
      // it started under its cap (its first ask was heard)
      expect(calls[0]?.args).toEqual(["start"]);
      expect(alive(pid as number)).toBe(false);
    },
    ROW_MS,
  );

  it(
    "H26: a run whose frame would pass the host's bound, its script's escapes and its input together, is refused before any host starts, in fieldd's words (bth's re-read N6)",
    async () => {
      // a flow within SCRIPT_MAX_BYTES, mostly raw control characters in a template (six bytes each as JSON), and the
      // largest input a run takes: FLOW_INPUTS_MAX values of FLOW_INPUT_VALUE_MAX control characters. Each is within
      // its own bound; the `run` frame carrying them is not within the host's (TO_FLOW_HOST_FRAME_MAX)
      const script = flow(`const words = \`${"\u0001".repeat(60_000)}\`;\nreturn words.length;`);
      expect(script.byteLength).toBeLessThanOrEqual(FLOW_LIMITS.SCRIPT_MAX_BYTES);
      const input = Object.fromEntries(
        Array.from({ length: FLOW_INPUTS_MAX }, (_, i) => [
          `value${i}`,
          "\u0001".repeat(FLOW_INPUT_VALUE_MAX),
        ]),
      );
      const { handler, calls } = scripted();
      const run = await host(script, { handler, input });
      expect(await within(run.ended)).toEqual({
        kind: "refused",
        reason: expect.stringContaining("its script and its input together"),
      });
      // no host was started for it, so no call was made
      expect(await within(run.ready)).toBeUndefined();
      expect(calls).toEqual([]);
    },
    ROW_MS,
  );

  it(
    "H27: after its run has ended, a host never holds what its script goes on to allocate: its worker is ended at the end, and its cap holds until it leaves (bth's second re-read R1)",
    async () => {
      // fieldd is out of this row: the host is told `run` directly and never `shutdown`, so nothing but the host itself
      // ends what its script does after `done`. The script resolves, so `done` is said first (its fill waits two more
      // microtasks than the worker's own continuation), then fills ONE 1 GiB array: a single builtin no termination
      // interrupts mid-call. A host that keeps its worker after the end, its cap stopped, holds the whole fill
      // (measured 13:55Z: 1,097 MB). Held, it never holds most of it: the worker is ended before the fill starts, or,
      // were the fill already running, the cap kills the host within one 50 ms read (at ~10 GB/s, under 600 MB)
      const base = runOf(
        flow(
          [
            "Promise.resolve()",
            "  .then(() => 0)",
            "  .then(() => 0)",
            "  .then(() => new Uint8Array(2 ** 30).fill(1));",
            "return 1;",
          ].join("\n"),
        ),
      ) as Extract<ToFlowHost, { t: "run" }>;
      const direct = await directHost(PATH_ONLY);
      children.push(direct.child);
      const exited = exitOf(direct.child);
      expect(await heardOf(direct.heard, "ready")).toEqual({ t: "ready", pid: direct.child.pid });
      direct.tell({ ...base, limits: { ...base.limits, rssMb: 160 } });
      expect(await heardOf(direct.heard, "done")).toEqual({ t: "done", value: 1 });
      // what the host held at its highest in the second and a half after its end
      const window = new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(await peakRssMb(direct.child.pid as number, window)).toBeLessThan(768);
      // and it still leaves when its pipe closes
      direct.close();
      expect(await within(exited)).not.toBe("timeout");
    },
    ROW_MS,
  );

  it(
    "H28: memory the host's resident size does not show, as a paged-out host's, is still read: the worker's own external memory and heap end a run `memory` (bth's second re-read R2)",
    async () => {
      // the door: the REAL host, started with a preload that makes its resident size read 1 byte, as a host under
      // memory pressure can read far under what it holds (macOS's resident size leaves out compressed and swapped
      // pages). The worker's `getHeapStatistics()` (Node's own, on this repo's Node: .nvmrc says 26) still counts
      // the typed arrays it keeps. The script keeps six filled 64 MiB arrays, an answered ask after each, under
      // `rssMb: 160`. A host that reads its resident size alone never sees them.
      // The script then waits on "hold", which is never answered, so the run cannot end on its own: the cap is the only
      // way out. Without the hold the row was timing-bound. On a fast host the six fills, their asks and the return
      // all fit inside one 50 ms read (run 158, the mini alone: 84 ms for the whole row, ended `done 6`), and the
      // cap holds only to within one read (N1's Found). On a slow host the cap fires mid-allocation instead, before
      // the hold, so the row asserts the end and the first ask, never which ask came last
      const dir = mkdtempSync(join(inject("fielddRunRoot"), "vf-fh-rss-"));
      const readsLow = join(dir, "rss-reads-low.cjs");
      writeFileSync(readsLow, "process.memoryUsage.rss = () => 1;\n");
      const base = runOf(
        flow(
          [
            'await ask("start");',
            "const kept = [];",
            "for (let i = 0; i < 6; i += 1) {",
            "  kept.push(new Uint8Array(64 * 1024 * 1024).fill(1));",
            '  await ask("more?");',
            "}",
            'await ask("hold");',
            "return kept.length;",
          ].join("\n"),
        ),
      ) as Extract<ToFlowHost, { t: "run" }>;
      const direct = await directHost(PATH_ONLY, ["--require", readsLow]);
      children.push(direct.child);
      const exited = exitOf(direct.child);
      expect(await heardOf(direct.heard, "ready")).toEqual({ t: "ready", pid: direct.child.pid });
      direct.tell({ ...base, limits: { ...base.limits, rssMb: 160 } });
      expect(await answeredToEnd(direct, { holds: "hold" })).toEqual({ t: "memory" });
      // it started under its cap (its first ask was heard)
      const asks = (direct.heard as readonly { t?: string; args?: unknown[] }[]).filter(
        (frame) => frame.t === "call",
      );
      expect(asks[0]?.args).toEqual(["start"]);
      expect(await within(exited)).toEqual({ code: null, signal: "SIGKILL" });
    },
    ROW_MS,
  );

  it(
    "H29: the run fieldd sized is the run it sends: a caller's input changed after the start never reaches the host (bth's second re-read L2)",
    async () => {
      // fieldd sizes the `run` frame at the start (N6) and sends it at READY, which comes later. The input is the
      // caller's object: changed in between, a frame built again at READY would carry what was never sized
      const input: Record<string, string> = { word: "sized" };
      const run = await host(flow("return input.word;"), { input });
      input["word"] = "changed after the start";
      expect(await within(run.ended)).toEqual({ kind: "done", value: "sized" });
    },
    ROW_MS,
  );

  // CP-4a2b (§13a slices 1–2, M-h) — the host's Owed tail from CP-4a2a: its own deadline at a leave (O1), a count it
  // cannot read (O2) and no inspector by a signal (P6). The stub is a preload a row hands its direct host alone
  // (test/fixtures/flows/heap-stats-stub.cjs; D20): it needs no builtin and no allocation, so each row holds on any
  // host's speed and under any globals list.
  const HEAP_STATS_STUB = join(import.meta.dirname, "fixtures", "flows", "heap-stats-stub.cjs");
  const stubbed = (modes: string) =>
    directHost({ ...PATH_ONLY, VF_HOST_STUB: modes }, ["--require", HEAP_STATS_STUB]);

  it(
    "H30: a host whose worker never goes still leaves: past its run's `leaveMs` it kills itself, with fieldd gone (O1)",
    async () => {
      // `stuck` makes the worker's terminate never settle, the state one long builtin under the cap makes. fieldd is
      // gone (its pipe closed), so only the host's own deadline can end it
      const base = runOf(flow('await ask("hold");')) as Extract<ToFlowHost, { t: "run" }>;
      const direct = await stubbed("stuck");
      children.push(direct.child);
      const exited = exitOf(direct.child);
      expect(await heardOf(direct.heard, "ready")).toEqual({ t: "ready", pid: direct.child.pid });
      direct.tell({ ...base, limits: { ...base.limits, leaveMs: 100 } });
      expect(await heardOf(direct.heard, "call")).toMatchObject({ t: "call", what: "ask" });
      direct.close();
      expect(await within(exited)).toEqual({ code: null, signal: "SIGKILL" });
    },
    ROW_MS,
  );

  it(
    "H31: a worker's count the host cannot read ends its run `fatal`, never a cap that NaN is never past (O2)",
    async () => {
      // `missing` drops `external_memory` from the worker's count, as a later Node that renamed it would: the sum is
      // NaN, and NaN is past no cap. The script waits on a hold, so only the host's read of its count can end it
      const direct = await stubbed("missing");
      children.push(direct.child);
      expect(await heardOf(direct.heard, "ready")).toEqual({ t: "ready", pid: direct.child.pid });
      direct.tell(runOf(flow('await ask("hold");')));
      expect(await answeredToEnd(direct, { holds: "hold" })).toEqual({
        t: "fatal",
        reason: expect.stringContaining("cannot read its worker's memory"),
      });
    },
    ROW_MS,
  );

  /** Node's words when SIGUSR1 opens its inspector, or fails to (a port in use). */
  const INSPECTOR_SAID = /Debugger listening|inspector/i;

  /** P6's door: a host started by `launch` through fieldd's own supervisor, its stderr kept, sent SIGUSR1 while its
   * script waits on its one ask, which is answered once the row's window has passed. What the host wrote to stderr,
   * and how its run ended. */
  async function afterSigusr1(
    launch: FlowsHostLaunch,
  ): Promise<{ stderr: string; ended: Awaited<FlowHostRun["ended"]> | "timeout" }> {
    let stderr = "";
    let asked: () => void = () => {};
    const askedOnce = new Promise<void>((resolve) => {
      asked = resolve;
    });
    let answer: (answer: FlowHostAnswer) => void = () => {};
    const held = new Promise<FlowHostAnswer>((resolve) => {
      answer = resolve;
    });
    const run = startFlowHost({
      launch: { kind: "launch", launch },
      bytes: flow('return await ask("hold");'),
      input: {},
      handler: {
        call: () => {
          asked();
          return held;
        },
        log: () => {},
      },
      environment: PATH_ONLY,
      spawn: (command, args, options) => {
        const child = spawn(command, args, options);
        child.stderr?.on("data", (chunk: Buffer | string) => {
          stderr += String(chunk);
        });
        return child;
      },
    });
    runs.push(run);
    const pid = await within(run.ready);
    expect(typeof pid, "the host said READY").toBe("number");
    expect(await within(askedOnce), "the script made its ask").toBeUndefined();
    process.kill(pid as number, "SIGUSR1");
    // an inspector says so on stderr within milliseconds: a second is the row's whole window
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline && !INSPECTOR_SAID.test(stderr))
      await new Promise((resolve) => setTimeout(resolve, 25));
    answer({ ok: true, value: "went on" });
    return { stderr, ended: await within(run.ended) };
  }

  it(
    "H32: the development host opens no inspector on SIGUSR1: its launch passes --disable-sigusr1 before the bundle, and its held run goes on (P6)",
    async () => {
      const bundle = (await flowsHostLaunch()).args.at(-1) as string;
      const choice = chooseFlowsHostLaunch({
        sea: false,
        execPath: process.execPath,
        bundleDir: join(bundle, ".."),
        exists: (path) => path === bundle,
      });
      expect(choice.kind).toBe("launch");
      const said = await afterSigusr1((choice as { launch: FlowsHostLaunch }).launch);
      expect(said.stderr).not.toMatch(INSPECTOR_SAID);
      expect(said.ended).toEqual({ kind: "done", value: "went on" });
      expect(choice).toEqual({
        kind: "launch",
        launch: { command: process.execPath, args: ["--disable-sigusr1", bundle] },
      });
    },
    ROW_MS,
  );

  it(
    "H32b: a host started without the flag opens no inspector either: it takes SIGUSR1 itself from its first statement, as under every launch (P6)",
    async () => {
      const bundle = (await flowsHostLaunch()).args.at(-1) as string;
      const said = await afterSigusr1({ command: process.execPath, args: [bundle] });
      expect(said.stderr).not.toMatch(INSPECTOR_SAID);
      expect(said.ended).toEqual({ kind: "done", value: "went on" });
    },
    ROW_MS,
  );

  it(
    "H9: a host that misses its pings is ended, its reason `unanswered`: a script that spins",
    async () => {
      const run = await host(flow("while (true) {}"), {
        timings: { pingMs: 100, pingMisses: 2 },
      });
      const pid = await within(run.ready);
      expect(typeof pid).toBe("number");
      expect(await within(run.ended)).toEqual({ kind: "ended", why: "unanswered" });
      expect(alive(pid as number)).toBe(false);
    },
    ROW_MS,
  );

  it(
    "H20: liveness is the pong alone: a script that logs without ever yielding still misses its pings (bth's review P1)",
    async () => {
      // a log line a millisecond, far under the log bound, from a worker that never yields to answer a ping
      const run = await host(
        flow('for (;;) {\n  for (let i = 0; i < 1e6; i += 1);\n  log("busy");\n}'),
        { timings: { pingMs: 100, pingMisses: 2 } },
      );
      expect(typeof (await within(run.ready))).toBe("number");
      expect(await within(run.ended, 5_000)).toEqual({ kind: "ended", why: "unanswered" });
    },
    ROW_MS,
  );

  it(
    "H21: a run that floods fieldd is ended `flood`: past HOST_CALLS_WAITING_MAX calls waiting at once, or HOST_LOG_LINES_MAX lines (bth's review P1)",
    async () => {
      // calls fired without an await, none answered: a script that yields, so its pings never end it
      const waiting = await host(
        flow(
          `for (let i = 0; i < ${FLOW_LIMITS.HOST_CALLS_WAITING_MAX + 10}; i += 1) agent("step " + i);\nawait new Promise(() => {});`,
        ),
        { handler: scripted(() => "never").handler },
      );
      expect(await within(waiting.ended)).toEqual({ kind: "ended", why: "flood" });
      // log lines past the run's bound
      const said = await host(
        flow(
          `for (let i = 0; i < ${FLOW_LIMITS.HOST_LOG_LINES_MAX + 10}; i += 1) log("line " + i);\nreturn 1;`,
        ),
      );
      expect(await within(said.ended)).toEqual({ kind: "ended", why: "flood" });
      // at the bounds, a run is whole: as many calls waiting as the bound, then answered, and as many lines
      const { handler } = scripted(() => ({ ok: true, value: "ok" }));
      const within_ = await host(
        flow(
          [
            `const all = [];`,
            `for (let i = 0; i < ${FLOW_LIMITS.HOST_CALLS_WAITING_MAX}; i += 1) all.push(agent("step " + i));`,
            "await Promise.all(all);",
            `for (let i = 0; i < ${FLOW_LIMITS.HOST_LOG_LINES_MAX}; i += 1) log("line " + i);`,
            "return all.length;",
          ].join("\n"),
        ),
        { handler },
      );
      expect(await within(within_.ended)).toEqual({
        kind: "done",
        value: FLOW_LIMITS.HOST_CALLS_WAITING_MAX,
      });
    },
    ROW_MS,
  );

  it(
    "H22: the child holds a call's arguments, and the run's result, to ARGS_DEPTH_MAX before it sends them (bth's review P1)",
    async () => {
      const deep = `let d = "x";\nfor (let i = 0; i < ${FLOW_LIMITS.ARGS_DEPTH_MAX + 1}; i += 1) d = [d];`;
      const { handler, calls } = scripted(() => ({ ok: true, value: "answered" }));
      const asked = await host(
        flow(
          `${deep}\ntry { await agent("Review", d); return "sent"; } catch (error) { return error.message; }`,
        ),
        { handler },
      );
      const ended = await within(asked.ended);
      expect(ended).toMatchObject({ kind: "done" });
      expect((ended as { value?: string }).value).toMatch(/nest/);
      expect(calls).toEqual([]);
      // a result nested past the bound is no result a run keeps: the run says so
      const returned = await host(flow(`${deep}\nreturn d;`));
      const end = await within(returned.ended);
      expect(end).toMatchObject({ kind: "threw" });
      expect((end as { message?: string }).message).toMatch(/nest/);
    },
    ROW_MS,
  );

  it(
    "H23: fieldd reads a frame nested past ARGS_DEPTH_MAX and its envelope as a child that broke its bounds: `protocol`, never handed on (bth's review P1)",
    async () => {
      const { handler, calls } = scripted(() => ({ ok: true, value: "answered" }));
      const run = await host(flow("return 1;"), {
        handler,
        launch: standIn({
          onRun: `let d = "x"; for (let i = 0; i < ${FLOW_LIMITS.ARGS_DEPTH_MAX + 8}; i += 1) d = [d]; say({ t: "call", id: 1, what: "agent", args: [d] });`,
        }),
      });
      expect(await within(run.ended)).toEqual({ kind: "ended", why: "protocol" });
      expect(calls).toEqual([]);
    },
    ROW_MS,
  );

  it(
    "H24: a handler that throws as it is called never throws at fieldd's pipe: its call is refused, its log line passed over (bth's review P1)",
    async () => {
      const handler: FlowCallHandler = {
        call() {
          throw new Error("the handler broke");
        },
        log() {
          throw new Error("the log broke");
        },
      };
      const run = await host(
        flow(
          'log("first");\ntry { await agent("Review"); return "answered"; } catch (error) { return error.message; }',
        ),
        { handler },
      );
      expect(await within(run.ended)).toEqual({
        kind: "done",
        value: "VibeField could not answer this call.",
      });
    },
    ROW_MS,
  );

  it(
    "H10: a script past SCRIPT_MAX_BYTES is refused before any host starts",
    async () => {
      const big = flow(`// ${"x".repeat(FLOW_LIMITS.SCRIPT_MAX_BYTES)}\nreturn 1;`);
      const run = await host(big, {
        launch: { command: "/nonexistent/vibefield-flows-host", args: [] },
      });
      const ended = await within(run.ended);
      expect(ended).toMatchObject({ kind: "refused" });
      expect((ended as { reason?: string }).reason).toMatch(/64 KiB/);
      expect(await run.ready).toBeUndefined();
    },
    ROW_MS,
  );

  it(
    "H14: an answer past RESULT_MAX_BYTES never crosses the pipe whole: text is cut to fit, anything else refused",
    async () => {
      const long = "x".repeat(FLOW_LIMITS.RESULT_MAX_BYTES + 4_000);
      const { handler } = scripted((call) =>
        call.args[0] === "text" ? { ok: true, value: long } : { ok: true, value: { notes: long } },
      );
      const run = await host(
        flow(
          [
            'const text = await agent("text");',
            "let other;",
            'try { await agent("object"); other = "answered"; } catch (error) { other = error.message; }',
            'return [text.length, text.endsWith("…"), other];',
          ].join("\n"),
        ),
        { handler },
      );
      const ended = await within(run.ended);
      expect(ended).toMatchObject({ kind: "done" });
      const [length, marked, other] = (ended as { value?: [number, boolean, string] }).value ?? [];
      // the script hears the cut: its text ends in the mark, and the mark's 3 bytes and the JSON string's two quotes
      // are inside the bound (finding 7, ruled (a))
      expect(marked).toBe(true);
      expect(length).toBe(FLOW_LIMITS.RESULT_MAX_BYTES - 2 - 3 + 1);
      expect(other).toMatch(/64 KiB/);
    },
    ROW_MS,
  );

  it("H14b: a cut never overshoots: escape-heavy text is cut to the longest whole prefix within RESULT_MAX_BYTES, never to nothing (finding 7)", () => {
    // the pipe's text leaves room for the mark the script's text ends with (ruled (a))
    const max = FLOW_LIMITS.RESULT_MAX_BYTES - Buffer.byteLength(FLOW_CUT_MARK);
    const high = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
    // a control character and an ANSI escape cost 6 bytes a character in JSON, é two, a pair four, x one
    for (const unit of ["\u0001", "\u001b[0m", "é", "😀", "x"]) {
      const value = unit.repeat(Math.ceil((2 * max) / unit.length));
      const said = boundedAnswer({ ok: true, value });
      expect(said, JSON.stringify(unit)).toMatchObject({ ok: true, cut: true });
      const text = (said as { value?: unknown }).value;
      expect(typeof text).toBe("string");
      const cut = text as string;
      expect(cut.length, `${JSON.stringify(unit)}: never cut to nothing`).toBeGreaterThan(0);
      expect(value.startsWith(cut)).toBe(true);
      expect(flowAnswerBytes(cut)).toBeLessThanOrEqual(max);
      // the longest that fits: the next whole character (a surrogate pair is one) is past the bound
      const step = high(value.charCodeAt(cut.length)) ? 2 : 1;
      expect(
        flowAnswerBytes(value.slice(0, cut.length + step)),
        JSON.stringify(unit),
      ).toBeGreaterThan(max);
      // and never half a pair
      expect(high(cut.charCodeAt(cut.length - 1))).toBe(false);
    }
  });

  it(
    "H18: an 'error' from a child that started never settles its run: fieldd logs it and waits for the child to leave (finding 8)",
    async () => {
      let child: ChildProcess | undefined;
      let answer: (reply: FlowHostAnswer) => void = () => {};
      const calls: FlowHostCall[] = [];
      const handler: FlowCallHandler = {
        call(call) {
          calls.push(call);
          return new Promise<FlowHostAnswer>((resolve) => {
            answer = resolve;
          });
        },
        log() {},
      };
      const run = startFlowHost({
        launch: { kind: "launch", launch: await flowsHostLaunch() },
        bytes: flow('return await agent("Review");'),
        input: {},
        handler,
        environment: PATH_ONLY,
        spawn: (command, args, options) => {
          child = spawn(command, args, options);
          return child;
        },
      });
      runs.push(run);
      expect(typeof (await within(run.ready))).toBe("number");
      const deadline = Date.now() + WAIT_MS;
      while (calls.length === 0 && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 25));
      expect(calls).toHaveLength(1);
      // a write or a kill that failed while the child lives (ChildProcess emits 'error' for both, not only a spawn)
      child?.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      expect(await within(run.ended, 500), "the run is not settled while its child lives").toBe(
        "timeout",
      );
      // the child's own end is the run's: its answer reaches it, and it returns
      answer({ ok: true, value: "answered" });
      expect(await within(run.ended)).toEqual({ kind: "done", value: "answered" });
      expect(alive(child?.pid as number)).toBe(false);
      // a spawn that failed (no pid) is still the run's end, at once, in its own words
      const never = await host(flow("return 1;"), {
        launch: { command: "/nonexistent/vibefield-flows-host", args: [] },
      });
      const ended = await within(never.ended);
      expect(ended).toMatchObject({ kind: "fatal" });
      expect((ended as { reason?: string }).reason).toMatch(/^the flow host did not start: /);
      expect(await never.ready).toBeUndefined();
    },
    ROW_MS,
  );

  it(
    "H19: `ready` is the child fieldd started, never the pid it says, and a Stop before READY sends it no `run` and no ping (finding 9)",
    async () => {
      const marks = mkdtempSync(join(inject("fielddRunRoot"), "vf-fh-ready-marks-"));
      const dir = mkdtempSync(join(inject("fielddRunRoot"), "vf-fh-ready-"));
      const file = join(dir, "stand-in.cjs");
      // a stand-in whose READY was on its way when fieldd stopped it: it says READY, with a pid of its own making,
      // only once it hears the shutdown, and it marks every `run` and `ping` it is sent after that
      writeFileSync(
        file,
        standInSource([
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          `const marks = ${JSON.stringify(marks)};`,
          "let said = false;",
          "on((m) => {",
          "  if (m && m.t === 'shutdown' && !said) {",
          "    said = true;",
          "    say({ t: 'ready', pid: 1 });",
          "    setTimeout(() => process.exit(0), 500);",
          "    return;",
          "  }",
          "  if (m && (m.t === 'run' || m.t === 'ping')) fs.writeFileSync(path.join(marks, m.t), '');",
          "});",
        ]),
      );
      let child: ChildProcess | undefined;
      const run = startFlowHost({
        launch: { kind: "launch", launch: { command: process.execPath, args: [file] } },
        bytes: flow("return 1;"),
        input: {},
        handler: scripted().handler,
        environment: PATH_ONLY,
        timings: { pingMs: 50, stopGraceMs: 2_000 },
        spawn: (command, args, options) => {
          child = spawn(command, args, options);
          return child;
        },
      });
      runs.push(run);
      expect(await within(run.stop())).toEqual({ kind: "stopped" });
      expect(readdirSync(marks), "a Stop before READY: no run, no ping").toEqual([]);
      expect(typeof child?.pid).toBe("number");
      expect(await within(run.ready), "the child fieldd started, not the pid it said").toBe(
        child?.pid,
      );
    },
    ROW_MS,
  );

  it(
    "H15: a call past RESULT_MAX_BYTES is refused in the child before it is sent: the handler never hears it",
    async () => {
      const { handler, calls } = scripted(() => ({ ok: true, value: "answered" }));
      const run = await host(
        flow(
          `try { await agent("x".repeat(${FLOW_LIMITS.RESULT_MAX_BYTES})); return "sent"; } catch (error) { return error.message; }`,
        ),
        { handler },
      );
      const ended = await within(run.ended);
      expect(ended).toMatchObject({ kind: "done" });
      expect((ended as { value?: string }).value).toMatch(/64 KiB/);
      expect(calls).toEqual([]);
    },
    ROW_MS,
  );
});

describe("CP-4a2a — fieldd's side of the host: the rewrite, the role, the launch", () => {
  const module = [
    'export const meta = { name: "Rewrite", input: { n: "text" } };',
    "const helper = (x) => x + 1;",
    "export default async function (input) {",
    "  return helper(Number(input.n));",
    "}",
    "",
  ].join("\n");

  it(
    "H11: acorn rewrites the module's exports into one script, its lines where they were (CP4-S4 (a))",
    async () => {
      const read = flowScriptOf(bytes(module));
      expect(read.kind).toBe("script");
      const script = (read as { script?: string }).script ?? "";
      expect(script).not.toMatch(/\bexport\b/);
      expect(script.split("\n")[3]).toBe("  return helper(Number(input.n));");
      // the other forms the static read accepts: `export { meta }` and a default that names a function
      for (const form of [
        'const meta = { name: "Named" };\nexport { meta };\nasync function run() { return 2; }\nexport default run;\n',
        'export const meta = { name: "Declared" };\nexport default async function run() { return 2; }\n',
      ]) {
        const other = flowScriptOf(bytes(form));
        expect(other.kind, form).toBe("script");
        expect((other as { script?: string }).script, form).not.toMatch(/\bexport\b/);
      }
      // what a flow cannot be: a module that imports, re-exports another, or does not parse
      for (const refused of [
        'import fs from "node:fs";\nexport default async function () {}\n',
        'export * from "./other.js";\nexport default async function () {}\n',
        "export default async function ( {\n",
      ])
        expect(flowScriptOf(bytes(refused)).kind, refused).toBe("refused");
      // and the rewrite runs: the host evaluates it and the default export answers
      const run = await host(bytes(module), { input: { n: "41" } });
      expect(await within(run.ended)).toEqual({ kind: "done", value: 42 });
    },
    ROW_MS,
  );

  it("H12: the role is the first argument's alone: an agent's own argument never picks `flows-host`", () => {
    expect(roleOf(["node", "fieldd", "--vibefield-role=flows-host"])).toBe("flows-host");
    expect(roleOf(["node", "fieldd", "--model", "--vibefield-role=flows-host"])).toBeUndefined();
    expect(roleOf(["node", "fieldd", "--vibefield-role=flows-hosts"])).toBe("unknown");
  });

  it("H13: the launch: the packaged executable in its role, the bundle beside bin.cjs, or `unconfigured`", () => {
    const beside = (present: string) => (path: string) => path === present;
    expect(
      chooseFlowsHostLaunch({
        sea: true,
        execPath: "/A/fieldd",
        bundleDir: undefined,
        exists: beside("/A/flows-host.cjs"),
      }),
    ).toEqual({
      kind: "launch",
      launch: { command: "/A/fieldd", args: ["--vibefield-role=flows-host"] },
    });
    expect(
      chooseFlowsHostLaunch({
        sea: true,
        execPath: "/A/fieldd",
        bundleDir: undefined,
        exists: () => false,
      }),
    ).toMatchObject({
      kind: "unconfigured",
      reason: expect.stringMatching(/not beside the executable/),
    });
    expect(
      chooseFlowsHostLaunch({
        sea: false,
        execPath: "/usr/local/bin/node",
        bundleDir: "/B/dist",
        exists: beside("/B/dist/flows-host.cjs"),
      }),
    ).toEqual({
      kind: "launch",
      launch: {
        command: "/usr/local/bin/node",
        args: ["--disable-sigusr1", "/B/dist/flows-host.cjs"],
      },
    });
    expect(
      chooseFlowsHostLaunch({
        sea: false,
        execPath: "/n",
        bundleDir: undefined,
        exists: () => true,
      }),
    ).toMatchObject({ kind: "unconfigured", reason: expect.stringMatching(/source run/) });
  });
});
